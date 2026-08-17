// 翻译历史的唯一写入口：划词面板、sandbox 都调用这里，避免各自维护一份裁剪逻辑。
import { pick } from './defaults.js';

export async function saveHistoryEntry({ text, translation, engine, url = '', title = '' }) {
  const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));
  const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');

  translationHistory.unshift({
    id: crypto.randomUUID(),
    text,
    translation,
    engine,
    url,
    title,
    timestamp: Date.now(),
  });

  if (historyMaxItems > 0 && translationHistory.length > historyMaxItems) {
    translationHistory.length = historyMaxItems;
  }

  try {
    await chrome.storage.local.set({ translationHistory });
  } catch (e) {
    // 磁盘写满等极端情况兜底：裁掉最早 15% 后重试一次，并留痕供 UI 提示。
    const trimmed = translationHistory.slice(0, Math.ceil(translationHistory.length * 0.85));
    await chrome.storage.local.set({ translationHistory: trimmed, historyTrimNotice: Date.now() });
  }

  chrome.runtime.sendMessage({ action: 'historyChanged' }).catch(() => {});
}
