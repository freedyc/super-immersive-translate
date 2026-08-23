/**
 * 本地词典查询的调用端（音标 + 词性）。
 *
 * 两样一次问完：它们总是一起要用，分成两条消息等于每个词两轮往返。
 * 分片缓存在 Service Worker 里（utils/phonetics.js、utils/pos.js），
 * 内容脚本和各页面共用，不必每个页面各载一遍。
 */

/** 同一个词在一次会话里只问一次 */
const cache = new Map();

/**
 * @param {string} word
 * @returns {Promise<{phonetic: string, pos: string}>}
 *   phonetic 为美式音标（不带斜杠），pos 为词性代号串（如 'vn'）；查不到都是空串
 */
export function lookupWordMeta(word) {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return Promise.resolve({ phonetic: '', pos: '' });
  if (!cache.has(key)) {
    cache.set(key, chrome.runtime.sendMessage({ action: 'lookupWordMeta', word: key })
      .then((r) => ({ phonetic: r?.phonetic || '', pos: r?.pos || '' }))
      // Service Worker 没起来或通道断了：这两样都是可降级的，不要抛给调用方
      .catch(() => ({ phonetic: '', pos: '' })));
  }
  return cache.get(key);
}
