/**
 * Background service worker - Super Immersive Translate
 */
import { pick } from '../utils/defaults.js';
import { syncNow } from '../utils/github-sync.js';
import { lookupPhonetic } from '../utils/phonetics.js';

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
  // 音标查询走 Service Worker：分片载入后常驻在这里，
  // 内容脚本和各页面共用同一份缓存，不必每个页面各载一次
  if (msg.action === 'lookupPhonetic') {
    lookupPhonetic(msg.word).then((phonetic) => sendResponse({ phonetic }));
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
