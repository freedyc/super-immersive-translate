/**
 * 本地词性查询。
 *
 * 和音标同一个病根：词性此前唯一来源是 AI 生成，而默认配置（engine: 'google'，
 * AI key 全空）下没有可用引擎，「词类标识」永远是空的。
 *
 * 数据来自 WordNet 3.1 的四个开放词类，外加穷举的六个封闭词类
 * （见 scripts/build-pos.mjs 与 data/pos/LICENSE）。返回的是**代号串**，
 * 按义项数排序，比如 run → 'vn'（动词义项远多于名词）。中文标签在
 * utils/learning/wordMeta.ts 里映射——改文案不必重新生成数据。
 */

const shards = new Map();

function loadShard(letter) {
  if (!shards.has(letter)) {
    shards.set(letter, fetch(chrome.runtime.getURL(`data/pos/${letter}.json`))
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})));
  }
  return shards.get(letter);
}

/**
 * @param {string} word
 * @returns {Promise<string>} 词性代号串（如 'vn'），查不到返回空串
 */
export async function lookupPos(word) {
  const key = String(word || '').trim().toLowerCase();
  if (!/^[a-z]+$/.test(key)) return '';
  const shard = await loadShard(key[0]);
  if (shard[key]) return shard[key];

  // 规则变化的词形词典里未必单独收录，但词性可以确定地推出来
  if (/(ing|ed)$/.test(key)) {
    const stem = key.replace(/(ing|ed)$/, '');
    // 动词的 -ing/-ed 形式既可作动词也常作形容词（a running joke / a used car）
    if (shard[stem]?.includes('v') || shard[`${stem}e`]?.includes('v')) return 'vj';
  }
  if (key.endsWith('s')) {
    const stem = shard[key.slice(0, -1)];
    // -s 只在词干本来就是名词或动词时才有意义，形容词加 s 不成词
    if (stem) {
      const kept = [...stem].filter((c) => c === 'n' || c === 'v').join('');
      if (kept) return kept;
    }
  }
  if (key.endsWith('ly') && shard[key.slice(0, -2)]?.includes('j')) return 'r';
  return '';
}
