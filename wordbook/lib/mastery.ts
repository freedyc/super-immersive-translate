/**
 * 单词掌握度 / 词性配色的共享工具 —— 原来散在 wordbook.js 里，
 * React 化之后多个视图（列表/统计/复习）都要用，抽出来避免各写一份。
 */
import { isDue, deserializeCard } from '../../utils/srs.js';
import type { WordEntry, WordContext } from '../../types/models.ts';

// 稳定性达到约 3 周（21 天）视为"已掌握"，这是一个可调阈值，不是 FSRS 算法本身规定的。
export const MASTERED_STABILITY_DAYS = 21;

export const ENGINE_NAMES: Record<string, string> = {
  google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
  libre: 'Libre', deepl: 'DeepL', custom: 'Custom',
};

// 词类 → daisyUI badge 语义色，10 个词类复用 8 种语义色（部分虚词共用同一色）。
// 索引签名放宽成 string：AI 返回的词性不保证落在这十类里，取不到就退回中性色。
export const POS_BADGE_CLASS: Record<string, string> = {
  '名词': 'badge-primary', '代词': 'badge-neutral', '动词': 'badge-secondary',
  '形容词': 'badge-accent', '副词': 'badge-info', '介词': 'badge-neutral',
  '连词': 'badge-neutral', '感叹词': 'badge-warning', '冠词': 'badge-neutral',
  '限定词': 'badge-neutral',
};

// 语法角色展示顺序（语法拆解侧栏按这个顺序排，不按 AI 返回的随机顺序）
export const ROLE_ORDER = ['主语', '谓语', '宾语', '定语', '状语', '补语', '其他'];

export function isMastered(word: WordEntry): boolean {
  const raw = word.srs?.recall;
  if (!raw || raw.reps === 0) return false;
  return deserializeCard(raw).stability >= MASTERED_STABILITY_DAYS;
}

export interface MasteryBadge {
  text: string;
  cls: string;
}

export function getMasteryBadge(word: WordEntry): MasteryBadge {
  const raw = word.srs?.recall;
  if (!raw || raw.reps === 0) return { text: '未学习', cls: 'badge-ghost' };
  const card = deserializeCard(raw);
  if (card.stability >= MASTERED_STABILITY_DAYS) return { text: '已掌握', cls: 'badge-success' };
  if (isDue(card)) return { text: '待复习', cls: 'badge-warning' };
  return { text: '学习中', cls: 'badge-info' };
}

export function getMasteryPercent(word: WordEntry): number {
  const raw = word.srs?.recall;
  if (!raw || raw.reps === 0) return 0;
  return Math.min(100, Math.round((deserializeCard(raw).stability / MASTERED_STABILITY_DAYS) * 100));
}

export function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function latestContext(word: WordEntry | undefined | null): WordContext | null {
  return word?.contexts?.length ? word.contexts[word.contexts.length - 1] : null;
}
