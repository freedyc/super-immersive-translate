/**
 * 从 WordNet 生成本地词性表。
 *
 * 和音标同一个病根：词性此前唯一来源是 AI 生成，默认配置下没有可用的 AI 引擎，
 * 于是「词类标识」永远是空的。词性同样是词典数据。
 *
 * WordNet 只覆盖四个**开放词类**（名词/动词/形容词/副词）——那正是它作为
 * 语义网络的范围。剩下六类（代词/介词/连词/感叹词/冠词/限定词）是封闭词类，
 * 成员固定且不到两百个，直接穷举在 CLOSED_CLASS 里，且优先级高于 WordNet：
 * 「a」在 WordNet 里是名词（指字母 a），但用户划到它时想看到的是冠词。
 *
 * 用法：node scripts/build-pos.mjs <wordnet 目录> public/data/pos
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 词性代号 → 中文标签。代号存进数据文件，标签在运行时映射，改文案不用重新生成数据 */
export const POS_CODES = {
  n: '名词', v: '动词', j: '形容词', r: '副词',
  p: '代词', i: '介词', c: '连词', e: '感叹词', a: '冠词', d: '限定词',
};

/** 封闭词类：成员固定，WordNet 不收（或收得不是用户想要的那个义项） */
const CLOSED_CLASS = {
  a: ['a', 'an', 'the'],
  p: [
    'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'who', 'whom', 'whose', 'which', 'what', 'that', 'this', 'these', 'those',
    'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything',
    'someone', 'somebody', 'something', 'no one', 'nobody', 'nothing',
    'each', 'either', 'neither', 'one', 'oneself', 'none',
  ],
  i: [
    'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
    'at', 'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
    'beyond', 'by', 'concerning', 'despite', 'down', 'during', 'except', 'for',
    'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto',
    'opposite', 'out', 'outside', 'over', 'past', 'per', 'regarding', 'round',
    'since', 'than', 'through', 'throughout', 'till', 'to', 'toward', 'towards',
    'under', 'underneath', 'until', 'unto', 'up', 'upon', 'via', 'with',
    'within', 'without',
  ],
  c: [
    'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
    'although', 'though', 'because', 'since', 'unless', 'until', 'while',
    'whereas', 'whether', 'if', 'once', 'than', 'that', 'when', 'whenever',
    'where', 'wherever', 'after', 'before', 'as',
  ],
  e: [
    'oh', 'ah', 'ouch', 'oops', 'wow', 'hey', 'hi', 'hello', 'bye', 'goodbye',
    'alas', 'aha', 'hurray', 'hooray', 'ugh', 'yay', 'huh', 'eh', 'yikes',
    'phew', 'shh', 'oops', 'bravo', 'amen',
  ],
  d: [
    'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
    'our', 'their', 'some', 'any', 'no', 'every', 'each', 'either', 'neither',
    'all', 'both', 'half', 'much', 'many', 'more', 'most', 'few', 'fewer',
    'fewest', 'little', 'less', 'least', 'several', 'enough', 'such', 'what',
    'which', 'whose',
  ],
};

const FILES = { noun: 'n', verb: 'v', adj: 'j', adv: 'r' };

const [, , wnDir, outDir] = process.argv;
if (!wnDir || !outDir) {
  console.error('用法: node scripts/build-pos.mjs <wordnet 目录> public/data/pos');
  process.exit(1);
}

/** word → Map<code, senseCount>。义项数用来给多词性的词排序 */
const table = new Map();

for (const [file, code] of Object.entries(FILES)) {
  const text = readFileSync(join(wnDir, `index.${file}`), 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(' ')) continue; // 文件头是空格开头的版权声明
    const parts = line.split(/\s+/);
    const word = parts[0];
    if (!/^[a-z]+$/.test(word)) continue; // 跳过多词条目和带标点的
    const senses = Number(parts[2]) || 1;
    if (!table.has(word)) table.set(word, new Map());
    table.get(word).set(code, senses);
  }
}

// 封闭词类后加，且排在最前——「a」在 WordNet 里是名词（字母 a），
// 但划到它时想看到的是冠词
for (const [code, words] of Object.entries(CLOSED_CLASS)) {
  for (const word of words) {
    if (!/^[a-z]+$/.test(word)) continue;
    if (!table.has(word)) table.set(word, new Map());
    table.get(word).set(code, Infinity);
  }
}

const shards = {};
for (const [word, codes] of table) {
  // 义项多的词性排前面：run 有 41 个动词义项、16 个名词义项，动词才是主用法
  const ordered = [...codes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .join('');
  (shards[word[0]] ??= {})[word] = ordered;
}

mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [letter, entries] of Object.entries(shards)) {
  const json = JSON.stringify(entries);
  writeFileSync(join(outDir, `${letter}.json`), json);
  total += json.length;
}
console.log(`词条 ${table.size}，${Object.keys(shards).length} 个分片，`
  + `共 ${(total / 1048576).toFixed(2)} MB`);
