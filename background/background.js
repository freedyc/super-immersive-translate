/**
 * Background service worker - Super Immersive Translate
 */
import { pick } from '../utils/defaults.js';
import { syncNow } from '../utils/github-sync.js';
import { lookupPhonetic } from '../utils/phonetics.js';
import { lookupPos } from '../utils/pos.js';
import { buildRequest } from '../utils/tts-engines.js';
import { putImage, trimImages } from '../utils/image-store.js';

async function setupPeriodicSyncAlarm() {
  const { githubSyncEnabled, githubSyncMode, githubSyncIntervalMinutes } = await chrome.storage.sync.get(
    pick('githubSyncEnabled', 'githubSyncMode', 'githubSyncIntervalMinutes')
  );
  await chrome.alarms.clear('history-sync-periodic');
  if (githubSyncEnabled && githubSyncMode === 'auto') {
    chrome.alarms.create('history-sync-periodic', { periodInMinutes: githubSyncIntervalMinutes });
  }
  if (!githubSyncEnabled) {
    // 用户关闭同步开关时，顺带清掉可能还在排队的一次性防抖闹钟，
    // 不用等它自己触发再被 onAlarm 里的二次检查挡下来。
    await chrome.alarms.clear('history-sync-debounce');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-page',
    title: '⚡ 翻译此页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '⚡ 翻译选中文本',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'save-image-to-clipboard',
    title: '⚡ 保存图片到剪贴板历史',
    contexts: ['image']
  });

  if (chrome.sidePanel) {
    chrome.contextMenus.create({
      id: 'open-side-panel',
      title: '⚡ 在侧边栏打开快捷翻译',
      contexts: ['page', 'selection']
    });
  }

  setupPeriodicSyncAlarm();
});

chrome.runtime.onStartup.addListener(setupPeriodicSyncAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.githubSyncEnabled || changes.githubSyncMode || changes.githubSyncIntervalMinutes)) {
    setupPeriodicSyncAlarm();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
  } else if (info.menuItemId === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { action: 'translateSelection', text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === 'save-image-to-clipboard') {
    saveImageFromUrl(info.srcUrl, tab).catch((err) => {
      console.warn('[SIT] 保存图片失败:', err?.message || err);
    });
  } else if (info.menuItemId === 'open-side-panel') {
    if (!chrome.sidePanel) return;
    // sidePanel.open() must be called synchronously within the user gesture.
    // Awaiting setOptions first consumes the gesture and makes open() fail, so
    // fire setOptions without await and call open() in the same tick.
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sandbox/index.html?context=panel',
      enabled: true
    });
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-translate') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
  } else if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { action: 'translateSelection' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.sync.get(pick(
      'engine', 'targetLang', 'sourceLang', 'selectionMode', 'selectionEngines',
      'deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl'
    )).then(sendResponse);
    return true;
  }
  // 本地词典查询走 Service Worker：分片载入后常驻在这里，
  // 内容脚本和各页面共用同一份缓存，不必每个页面各载一次
  if (msg.action === 'lookupWordMeta') {
    Promise.all([lookupPhonetic(msg.word), lookupPos(msg.word)])
      .then(([phonetic, pos]) => sendResponse({ phonetic, pos }));
    return true;
  }
  // 朗读音频统一在这里取：内容脚本自己 fetch 跨域会受宿主页面的 CORS 约束，
  // 扩展的 host_permissions 只在 Service Worker 和扩展页面里生效
  if (msg.action === 'ttsFetch') {
    fetchTtsAudio(msg).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
  // 内容脚本的跨域请求代发。内容脚本受宿主页面的 CORS 约束
  // （Chrome 85 起 host_permissions 在那里不再豁免），而 OpenAI/Gemini/Claude
  // 都不给浏览器发 CORS 头、Ollama 默认也只放行 localhost 来源
  if (msg.action === 'proxyFetch') {
    proxyFetch(msg).then(sendResponse, (err) => sendResponse({
      ok: false, status: 0, error: err?.message || '请求失败',
    }));
    return true;
  }
  if (msg.action === 'triggerHistorySync') {
    syncNow().then(sendResponse);
    return true;
  }
  if (msg.action === 'historyChanged') {
    chrome.storage.sync.get(pick('githubSyncEnabled', 'githubSyncMode')).then(({ githubSyncEnabled, githubSyncMode }) => {
      // 只有「启用同步」且同步方式是「自动」时，写入后才排一次防抖同步；
      // 手动模式下用户翻译后不应该被静默联网同步。
      if (githubSyncEnabled && githubSyncMode === 'auto') {
        chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 });
      }
    });
  }
  if (msg.action === 'wordbookChanged') {
    chrome.storage.sync.get(pick('githubSyncEnabled', 'githubSyncMode', 'githubSyncWordbook')).then(
      ({ githubSyncEnabled, githubSyncMode, githubSyncWordbook }) => {
        // 同样只在「启用同步」+「自动」+「单词本同步开关也开着」时才排队；
        // 单词本同步被单独关掉时，光是存单词不应该触发联网同步。
        if (githubSyncEnabled && githubSyncMode === 'auto' && githubSyncWordbook) {
          chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 });
        }
      }
    );
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'history-sync-debounce' || alarm.name === 'history-sync-periodic') {
    // 排队期间用户可能已经关闭了同步开关：再确认一次，避免触发一次不该有的网络请求。
    const { githubSyncEnabled } = await chrome.storage.sync.get(pick('githubSyncEnabled'));
    if (!githubSyncEnabled) return;
    syncNow();
  }
});


/**
 * 取一段朗读音频，返回 data URL。
 *
 * 回传 data URL 而不是 blob URL：blob URL 绑在创建它的上下文上，
 * Service Worker 里造的到了内容脚本里就是个失效地址。
 */
async function fetchTtsAudio({ engine, text, lang, opts }) {
  const req = buildRequest(engine, text, lang, opts || {});
  if (!req) throw new Error(`引擎 ${engine} 不走网络`);

  const res = await fetch(req.url, {
    ...(req.init || {}),
    // Google/有道的取音频端点会看 UA，缺了就可能被当成爬虫挡掉
    headers: { ...(req.init?.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(`朗读服务返回 ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 512) {
    // 这些免费端点失败时也会回 200 + 一小段 JSON 错误，光看状态码判断不出来
    throw new Error('朗读服务没有返回音频');
  }
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return { dataUrl: `data:${res.headers.get('content-type') || 'audio/mpeg'};base64,${btoa(binary)}` };
}


// ─────────────────────────────────────────────────────────────────────────────
// 剪贴板图片
//
// 抓取和入库都在这里做：内容脚本跑在宿主页面的源里，看到的是另一个 IndexedDB，
// 存进去扩展页面读不到。Service Worker 与扩展页面同源。
// ─────────────────────────────────────────────────────────────────────────────

/** 列表里的缩略图边长。原图按需再取，列表不该把三十张原图全读进内存 */
const THUMB_MAX = 320;

/**
 * 生成缩略图。
 *
 * 失败就返回 null 而不是抛：缩略图只是列表体验，
 * 不该因为某张图解不开（SVG、动画 WebP 的边界情况）就连原图一起丢掉。
 */
async function makeThumbnail(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    return { thumb, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

async function saveImageFromUrl(srcUrl, tab) {
  if (!srcUrl) return;
  const { clipboardSaveImages, clipboardMaxImages, clipboardMaxImageBytes } =
    await chrome.storage.sync.get(pick(
      'clipboardSaveImages', 'clipboardMaxImages', 'clipboardMaxImageBytes',
    ));
  if (!clipboardSaveImages) return;

  // data: URL 直接就是数据，http(s) 才需要取。两种都能被 fetch 处理
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`取图片失败: HTTP ${res.status}`);
  const blob = await res.blob();

  if (!blob.type.startsWith('image/')) throw new Error(`不是图片: ${blob.type}`);
  // 超限的直接不存，而不是存进去把库撑爆
  if (blob.size > clipboardMaxImageBytes) {
    throw new Error(`图片过大 (${(blob.size / 1048576).toFixed(1)}MB)，未保存`);
  }

  const meta = await makeThumbnail(blob);
  await putImage({
    id: crypto.randomUUID(),
    blob,
    thumb: meta?.thumb ?? null,
    type: blob.type,
    size: blob.size,
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
    srcUrl,
    url: tab?.url || '',
    title: tab?.title || '',
    timestamp: Date.now(),
  });
  await trimImages(clipboardMaxImages);
  chrome.runtime.sendMessage({ action: 'clipboardImagesChanged' }).catch(() => {});
}


/**
 * 代内容脚本发一个跨域请求。
 *
 * 回传的是**文本**而不是解析后的对象：消息通道要序列化，
 * 文本原样过去由调用方自己 JSON.parse，出错时也还能看到原始响应。
 */
async function proxyFetch({ url, init = {}, timeoutMs = 30000 }) {
  try {
    const resp = await fetch(url, {
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: resp.ok, status: resp.status, body: await resp.text() };
  } catch (err) {
    // 超时和网络失败都走这里；调用方按普通失败处理（会退回 Google）
    return {
      ok: false,
      status: 0,
      error: err?.name === 'TimeoutError' ? `请求超时（${timeoutMs / 1000}s）` : err?.message,
    };
  }
}
