/**
 * 出题的公共逻辑：取释义、挑干扰项、判断题型可用性。
 * 四种题型都要干扰项，这部分抽出来避免各写一遍、各有各的边界 bug。
 */
import type { ExerciseType, Word } from '../../types/models.ts';
import { shuffled } from './mastery.ts';

/** 一个词的全部释义，跨词性去重 */
export function definitionsOf(word: Word): string[] {
  return [...new Set(word.meanings.flatMap((m) => m.definitions).filter(Boolean))];
}

/** 主释义，没有就返回空串 */
export function primaryDefinition(word: Word): string {
  return definitionsOf(word)[0] ?? '';
}

export interface ChoiceSet {
  options: string[];
  correctIndex: number;
  /** 选项文本 → 它其实属于哪个词。用于答错时说明混淆在哪 */
  ownerByOption: Map<string, string>;
}

/**
 * 构造选择题的选项。
 *
 * 干扰项优先从「有释义且不等于正确答案」的词里随机取。选项数量不足时如实返回，
 * 不用占位符凑数——凑出来的假选项会让题目看起来很蠢，也降低练习价值。
 */
export function buildChoices(
  word: Word,
  pool: Word[],
  mode: 'meaning' | 'word',
  wanted = 4,
): ChoiceSet {
  const correct = mode === 'meaning' ? primaryDefinition(word) : word.word;
  const ownerByOption = new Map<string, string>([[correct, word.word]]);

  const candidates: string[] = [];
  for (const other of shuffled(pool)) {
    if (other.id === word.id) continue;
    const text = mode === 'meaning' ? primaryDefinition(other) : other.word;
    if (!text || text === correct || ownerByOption.has(text)) continue;
    ownerByOption.set(text, other.word);
    candidates.push(text);
    if (candidates.length >= wanted - 1) break;
  }

  const options = shuffled([correct, ...candidates]);
  return { options, correctIndex: options.indexOf(correct), ownerByOption };
}

/**
 * 这道题能不能出。
 *
 * 选择题至少要凑得出两个选项——只有一个选项的选择题没有任何练习意义，
 * 与其渲染出来不如跳过（词库很小的时候会遇到这种情况）。
 */
export function canAsk(
  word: Word,
  exercise: ExerciseType,
  pool: Word[],
  opts: { ttsAvailable?: boolean } = {},
): boolean {
  if (definitionsOf(word).length === 0) return false;

  if (exercise === 'spelling') return true;

  if (exercise === 'listening' && opts.ttsAvailable === false && !word.audioUS && !word.audioUK) {
    return false;
  }

  const mode = exercise === 'zh2en' || exercise === 'listening' ? 'word' : 'meaning';
  return buildChoices(word, pool, mode, 2).options.length >= 2;
}

/** 题型的中文名，用于题面上方的小标题 */
export const EXERCISE_LABEL: Record<ExerciseType, string> = {
  en2zh: '选出正确释义',
  zh2en: '选出正确单词',
  listening: '听发音选单词',
  spelling: '根据释义拼写',
};
