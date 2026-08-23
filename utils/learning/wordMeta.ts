/**
 * 单词展示信息的统一口径。
 *
 * 音标、词性、主例句这三样在六个地方渲染（划词面板、我的词库、详情抽屉、
 * 卡片浏览、学新词、sandbox），此前每处各写各的取值逻辑，于是同一个词
 * 在不同页面显示得不一样。取值规则收在这里，渲染各自负责。
 *
 * 渲染没有统一成一个组件是有原因的：划词面板是注入到宿主页面的，
 * CSS 必须手写且带前缀（见 CLAUDE.md），不能引 Tailwind/React。
 * 所以共享的是**数据**，React 页面共用 components/WordMeta.tsx，
 * 内容脚本共用下面的 wordMetaHtml()。
 */
import type { Example, Word } from '../../types/models.ts';

/**
 * 挑一条音标显示。
 *
 * 优先英美标注过的，其次是没标注的那条（现有 AI 生成的 IPA 属于这种）。
 * 顺序反过来会让接入词典数据后仍然显示 AI 那条不太可靠的。
 */
export function pickPhonetic(word: Pick<Word, 'phonetic' | 'phoneticUS' | 'phoneticUK'>): string {
  return word.phoneticUS || word.phoneticUK || word.phonetic || '';
}

/** 音标带不带方括号在数据里不统一，显示时补齐 */
export function formatPhonetic(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return /^[/[].*[/\]]$/.test(s) ? s : `/${s}/`;
}

/** 主词性。没有就返回空串，不要编一个 */
export function pickPos(word: Pick<Word, 'meanings'>): string {
  return word.meanings.find((m) => m.partOfSpeech)?.partOfSpeech ?? '';
}

/** 展示用的主例句：优先真实语境，其次 AI 生成 */
export function pickExample(word: Pick<Word, 'examples'>): Example | null {
  return word.examples.find((e) => e.origin === 'context')
    ?? word.examples[word.examples.length - 1]
    ?? null;
}

/** 释义去重后的扁平列表——多个词性下常有重复的同一条中文 */
export function definitionList(word: Pick<Word, 'meanings'>): string[] {
  return [...new Set(word.meanings.flatMap((m) => m.definitions).filter(Boolean))];
}

/**
 * 词性代号 → 中文标签。代号存在数据文件里（见 scripts/build-pos.mjs），
 * 标签在这里映射——改文案不必重新生成 1.2 MB 的数据。
 *
 * 这十类与 utils/example-sentence.js 给 AI 的词类清单是同一套，
 * 所以本地词典和 AI 两个来源标出来的词性不会互相打架。
 */
const POS_LABELS: Record<string, string> = {
  n: '名词', v: '动词', j: '形容词', r: '副词',
  p: '代词', i: '介词', c: '连词', e: '感叹词', a: '冠词', d: '限定词',
};

/**
 * 把词性代号串排版成展示文案，如 `vn` → `动词 · 名词`。
 *
 * 最多显示三类。light 是形/名/动/副四类，全列出来徽章会比单词本身还长，
 * 而排在后面的词性义项本来就少，对用户的价值递减。
 */
export function formatPos(code: string, max = 3): string {
  return [...(code || '')]
    .map((c) => POS_LABELS[c])
    .filter(Boolean)
    .slice(0, max)
    .join(' · ');
}

/** 音标缺失时告诉用户为什么，而不是留白让人以为是加载中 */
export const MISSING_PHONETIC_HINT = '这个词不在本地词典里，可点「重新生成」让 AI 补';
