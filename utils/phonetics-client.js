/**
 * 音标查询的调用端。
 *
 * 内容脚本和各页面都通过 Service Worker 查（utils/phonetics.js 在那边持有
 * 分片缓存），避免每个页面各自把 94 KB 的分片载一遍。
 */

/** 同一个词在一次会话里只问一次 */
const cache = new Map();

/**
 * @param {string} word
 * @returns {Promise<string>} 美式音标，查不到返回空串
 */
export function lookupPhonetic(word) {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return Promise.resolve('');
  if (!cache.has(key)) {
    cache.set(key, chrome.runtime.sendMessage({ action: 'lookupPhonetic', word: key })
      .then((r) => r?.phonetic || '')
      // Service Worker 没起来或消息通道断了，音标缺失是可降级的，不要抛给调用方
      .catch(() => ''));
  }
  return cache.get(key);
}
