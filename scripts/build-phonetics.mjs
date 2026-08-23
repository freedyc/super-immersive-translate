/**
 * 从 CMUdict 生成本地音标表。
 *
 * 为什么要本地表：音标是词典数据，不是需要推理的东西。此前它唯一的来源是
 * AI 生成——默认配置下没有任何 AI 引擎可用，于是音标永远为空。本地表让
 * 绝大多数词离线、零延迟、零隐私成本地拿到读音。
 *
 * CMUdict 是美式发音（BSD-like 许可，见 data/phonetics-LICENSE）。英音和真人
 * 发音音频由 dictionaryapi.dev 兜底，那条路要联网，只在本地查不到时才走。
 *
 * 输出按首字母分成 26 个分片：整表 2.8 MB，一次性载入每个页面不可接受；
 * 分片后平均 94 KB，查词时只载入需要的那一片并常驻内存。
 *
 * 用法：node scripts/build-phonetics.mjs <cmudict.dict> public/data/phonetics
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ARPAbet → IPA。CMUdict 的元音带重音数字（0 无 / 1 主 / 2 次），先剥掉再查表
const MAP = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
  F: 'f', G: 'ɡ', HH: 'h',
  IH: 'ɪ', IY: 'i', JH: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  OW: 'oʊ', OY: 'ɔɪ',
  P: 'p', R: 'ɹ', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ',
  UH: 'ʊ', UW: 'u',
  V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
const VOWELS = new Set(['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW']);

/** 非重读的 AH/ER 在英语里读作弱化音，标成 ʌ/ɝ 会显得很怪 */
function ipaOf(base, stress) {
  if (base === 'AH' && stress === '0') return 'ə';
  if (base === 'ER' && stress === '0') return 'ɚ';
  return MAP[base];
}

/**
 * 英语合法的音节起始辅音丛（ARPAbet）。
 *
 * 只按「尽量多划给后一个音节」切分会切出 /ˌsɛɹəˈndɪpɪti/、/tɹænˈzleɪt/ 这种，
 * "nd"、"zl" 根本不能作音节开头。最大起始原则必须受音位规则约束。
 */
const ONSETS3 = new Set(['S P L', 'S P R', 'S P Y', 'S T R', 'S K R', 'S K W', 'S K Y']);
const ONSETS2 = new Set([
  'P L', 'P R', 'P Y', 'B L', 'B R', 'B Y',
  'T R', 'T W', 'T Y', 'D R', 'D W', 'D Y',
  'K L', 'K R', 'K W', 'K Y', 'G L', 'G R', 'G W',
  'F L', 'F R', 'F Y', 'TH R', 'TH W', 'SH R',
  'S L', 'S W', 'S P', 'S T', 'S K', 'S M', 'S N', 'S F',
  'HH Y', 'V Y', 'M Y', 'N Y', 'L Y',
]);

/** 单辅音都能作起始，NG 除外——英语里 /ŋ/ 不出现在音节开头 */
function legalOnset(phones) {
  if (phones.length === 0) return true;
  if (phones.length === 1) return phones[0].base !== 'NG';
  const key = phones.map((p) => p.base).join(' ');
  return phones.length === 2 ? ONSETS2.has(key) : ONSETS3.has(key);
}

/**
 * 切音节：受音位约束的最大起始原则。
 *
 * 重音符号标在**音节**开头，不是元音开头。直接打在元音前会得到
 * /kʌmˈpjuːtɚ/ 里 p 归错音节这类错位。
 */
function syllabify(phones) {
  const nuclei = [];
  phones.forEach((p, i) => { if (VOWELS.has(p.base)) nuclei.push(i); });
  if (nuclei.length === 0) return [{ phones, stress: '0' }];

  // 先定每个音节的起点：从后一个元音往前尽量多吃辅音，吃到不合法为止
  const starts = [0];
  for (let n = 1; n < nuclei.length; n++) {
    const vowel = nuclei[n];
    const available = vowel - nuclei[n - 1] - 1; // 两元音之间的辅音个数
    let take = Math.min(available, 3);
    while (take > 0 && !legalOnset(phones.slice(vowel - take, vowel))) take--;
    starts.push(vowel - take);
  }

  return nuclei.map((vowel, n) => ({
    phones: phones.slice(starts[n], n + 1 < starts.length ? starts[n + 1] : phones.length),
    stress: phones[vowel].stress,
  }));
}

function toIpa(arpa) {
  const phones = arpa.map((tok) => {
    const m = tok.match(/^([A-Z]+)([0-2])?$/);
    if (!m) return null;
    return { base: m[1], stress: m[2] ?? '' };
  });
  if (phones.some((p) => !p || !MAP[p.base])) return null;

  const syllables = syllabify(phones);
  // 单音节词不标重音——所有单音节词都是重读的，标了只是噪音
  const single = syllables.length === 1;
  return syllables.map((syl) => {
    const mark = single ? '' : syl.stress === '1' ? 'ˈ' : syl.stress === '2' ? 'ˌ' : '';
    return mark + syl.phones.map((p) => ipaOf(p.base, p.stress)).join('');
  }).join('');
}

const [, , inPath, outDir] = process.argv;
if (!inPath || !outDir) {
  console.error('用法: node scripts/build-phonetics.mjs <cmudict.dict> public/data/phonetics');
  process.exit(1);
}

const out = {};
let skipped = 0;
for (const line of readFileSync(inPath, 'utf8').split('\n')) {
  if (!line || line.startsWith(';;;')) continue;
  const [head, ...rest] = line.split(' ');
  // CMUdict 用 word(2) 表示同一个词的第二种读音，只取第一种
  if (/\(\d\)$/.test(head)) continue;
  const word = head.toLowerCase();
  // 只留纯字母词：缩写、带标点的条目对本插件没用，还白占体积
  if (!/^[a-z]+$/.test(word)) continue;
  const ipa = toIpa(rest.join(' ').trim().split(/\s+/));
  if (!ipa) { skipped++; continue; }
  if (!(word in out)) out[word] = ipa;
}

mkdirSync(outDir, { recursive: true });
const shards = {};
for (const [word, ipa] of Object.entries(out)) {
  (shards[word[0]] ??= {})[word] = ipa;
}
let total = 0;
for (const [letter, entries] of Object.entries(shards)) {
  const json = JSON.stringify(entries);
  writeFileSync(join(outDir, `${letter}.json`), json);
  total += json.length;
}
console.log(`词条 ${Object.keys(out).length}，跳过 ${skipped}，`
  + `${Object.keys(shards).length} 个分片，共 ${(total / 1048576).toFixed(2)} MB`);
