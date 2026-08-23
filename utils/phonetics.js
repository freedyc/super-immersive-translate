/**
 * 本地音标查询。
 *
 * 为什么要有它：此前音标唯一的来源是 AI 生成，而默认配置（engine: 'google'，
 * 三个 AI key 全空）下 pickEngine 会兜底试本地 Ollama，连不上就被静默吞掉——
 * 结果是划词面板和我的词库**永远**看不到音标。音标是词典数据，不是需要推理的
 * 东西，用 LLM 去查一个词怎么读既不可靠也没必要。
 *
 * 数据来自 CMUdict（美式发音，11.7 万词，见 public/data/phonetics/LICENSE）。
 * 按首字母分成 26 片，查哪片载哪片，载过的常驻内存。整表 2.4 MB，
 * 一次性载入每个页面不可接受；单片平均 94 KB。
 */

/** letter → Promise<Record<word, ipa>>；存 Promise 而不是结果，并发查同一片只载一次 */
const shards = new Map();

function loadShard(letter) {
  if (!shards.has(letter)) {
    shards.set(letter, fetch(chrome.runtime.getURL(`data/phonetics/${letter}.json`))
      .then((r) => (r.ok ? r.json() : {}))
      // 数据文件缺失不该让调用方崩掉——没有音标是可降级的，用空表继续
      .catch(() => ({})));
  }
  return shards.get(letter);
}

/**
 * 查一个词的美式音标，查不到返回空串。
 *
 * @param {string} word
 * @returns {Promise<string>} 形如 `kəmˈpjutɚ`（不带斜杠，显示时由 formatPhonetic 补）
 */
export async function lookupPhonetic(word) {
  const key = String(word || '').trim().toLowerCase();
  if (!/^[a-z]+$/.test(key)) return ''; // 词组、带标点的内容没有单一读音
  const shard = await loadShard(key[0]);
  if (shard[key]) return shard[key];

  // 规则派生：CMUdict 收了 run 但不一定收 runs/running。
  // 只做**不改变词干发音**的后缀，能明确推的才推，推不出就返回空
  return derive(key, shard);
}

/**
 * 从词干推导规则变化的读音。
 *
 * 只处理读音可以确定叠加的情况：-s/-es 的清浊由前一个音素决定，
 * -ed 同理。-ing 直接加 ɪŋ。不确定的（比如 -ly 的重音移动）一律不推。
 */
function derive(word, shard) {
  const VOICELESS = new Set(['p', 't', 'k', 'f', 'θ']);
  const SIBILANT = new Set(['s', 'z', 'ʃ', 'ʒ']);

  /** 找词干的读音：直接找，找不到就补回拼写规则去掉的字母 */
  const stemOf = (stripped) =>
    shard[stripped]                       // onboard + ing
    ?? shard[`${stripped}e`]              // curate → curating（结尾哑 e 被去掉）
    ?? (stripped.length > 2 && stripped.at(-1) === stripped.at(-2)
      ? shard[stripped.slice(0, -1)]      // run → running（辅音双写）
      : undefined);

  /** 第三人称单数 / 复数的 -s：清浊由前一个音素决定 */
  const plural = (base) => {
    const last = [...base].pop();
    if (SIBILANT.has(last)) return `${base}ɪz`;
    return base + (VOICELESS.has(last) ? 's' : 'z');
  };

  if (word.endsWith('ies')) {
    // studies → study：拼写把 y 换成 ies，读音只是在词干后加 z
    const base = shard[`${word.slice(0, -3)}y`];
    if (base) return plural(base);
  }
  if (word.endsWith('es')) {
    const base = stemOf(word.slice(0, -2));
    if (base) return plural(base);
  }
  if (word.endsWith('s')) {
    const base = shard[word.slice(0, -1)];
    if (base) return plural(base);
  }
  if (word.endsWith('ing')) {
    const base = stemOf(word.slice(0, -3));
    if (base) return `${base}ɪŋ`;
  }
  if (word.endsWith('ed')) {
    const base = stemOf(word.slice(0, -2));
    if (base) {
      const last = [...base].pop();
      if (last === 't' || last === 'd') return `${base}ɪd`;
      return base + (VOICELESS.has(last) ? 't' : 'd');
    }
  }
  return '';
}
