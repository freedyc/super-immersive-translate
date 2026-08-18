// 翻译历史的唯一写入口：划词面板、sandbox 都调用这里，避免各自维护一份裁剪逻辑。
import { pick } from './defaults.js';

export async function saveHistoryEntry({ text, translation, engine, url = '', title = '' }) {
  // 整个函数体兜底 try/catch：保证这个 promise 永远不 reject，调用方（选词面板、
  // sandbox 等）可以放心 fire-and-forget，不用各自补 .catch。历史记录保存失败属于
  // 可接受的静默降级，不应该影响翻译主流程或产生未处理的 promise rejection。
  try {
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
  } catch (e) {
    // chrome.storage.sync.get 等意外失败：静默吞掉，不让调用方处理 unhandled rejection。
  }
}
