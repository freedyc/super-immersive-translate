/**
 * 今日任务队列的编排。
 *
 * 两条硬约束（都是本项目踩过或推演出来的坑）：
 * 1. **新词不会自动涌进复习队列**——只有学过且到期的才算复习，新词受每日上限控制。
 *    否则老用户升级后会看到几百个词堆成一队。
 * 2. **题型不可用时跳过，而不是渲染一道答不了的题**——没有译文的词出不了选择题，
 *    TTS 不可用时出不了听力题。
 */
import type {
  ExerciseType,
  LearningRecord,
  QueueItem,
  StudyConfig,
  StudyQueue,
  Word,
} from '../../types/models.ts';
import { hasLearned, isExerciseDue } from './srsService.ts';

export const DEFAULT_STUDY_CONFIG: StudyConfig = {
  dailyNewLimit: 10,
  dailyReviewLimit: 0, // 0 = 不限制：到期的词压着不复习只会越积越多
  enabledExercises: ['en2zh', 'zh2en', 'listening', 'spelling'],
};

/** 每道题大致耗时（秒），用于估算「预计学习时间」 */
const SECONDS_PER_ITEM: Record<ExerciseType, number> = {
  en2zh: 8,
  zh2en: 10,
  listening: 12,
  spelling: 20,
};

/** 判断某个词能不能出某种题型 */
export function canRender(
  word: Word,
  exercise: ExerciseType,
  opts: { ttsAvailable?: boolean } = {},
): boolean {
  const hasMeaning = word.meanings.some((m) => m.definitions.some(Boolean));
  switch (exercise) {
    case 'en2zh':
    case 'zh2en':
      // 选择题要有释义当正确答案
      return hasMeaning;
    case 'spelling':
      return hasMeaning;
    case 'listening':
      // 没有音频文件时靠 TTS 兜底；TTS 也不可用就出不了这道题
      return hasMeaning && (!!word.audioUS || !!word.audioUK || opts.ttsAvailable !== false);
    default:
      return false;
  }
}

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 构建今日队列。
 *
 * 复习优先于新词：先把到期的清掉再学新的，否则复习会越欠越多。
 */
export function buildTodayQueue(
  words: Word[],
  records: Map<string, LearningRecord>,
  config: StudyConfig = DEFAULT_STUDY_CONFIG,
  opts: { now?: Date; ttsAvailable?: boolean } = {},
): StudyQueue {
  const now = opts.now ?? new Date();
  const exercises = config.enabledExercises.length > 0
    ? config.enabledExercises
    : DEFAULT_STUDY_CONFIG.enabledExercises;

  const reviewItems: QueueItem[] = [];
  const newItems: QueueItem[] = [];
  const reviewWords = new Set<string>();
  const newWords = new Set<string>();

  for (const word of words) {
    const record = records.get(word.id);
    if (record?.suspended) continue;

    for (const exercise of exercises) {
      if (!canRender(word, exercise, opts)) continue;

      if (isExerciseDue(record, exercise, now)) {
        reviewItems.push({ wordId: word.id, exercise, kind: 'review' });
        reviewWords.add(word.id);
      } else if (!hasLearned(record, exercise)) {
        newItems.push({ wordId: word.id, exercise, kind: 'new' });
        newWords.add(word.id);
      }
    }
  }

  // 新词按**单词**计上限，不是按题目——限 10 个新词指的是 10 个词，
  // 不是 10 道题（10 道题可能只有 3 个词）
  const allowedNewWords = new Set(
    shuffle([...newWords]).slice(0, Math.max(0, config.dailyNewLimit)),
  );
  const limitedNew = newItems.filter((it) => allowedNewWords.has(it.wordId));

  let limitedReview = shuffle(reviewItems);
  if (config.dailyReviewLimit > 0) {
    const allowedReviewWords = new Set(
      [...reviewWords].slice(0, config.dailyReviewLimit),
    );
    limitedReview = limitedReview.filter((it) => allowedReviewWords.has(it.wordId));
    reviewWords.clear();
    allowedReviewWords.forEach((id) => reviewWords.add(id));
  }

  return {
    items: [...limitedReview, ...shuffle(limitedNew)],
    newWordCount: allowedNewWords.size,
    reviewWordCount: reviewWords.size,
  };
}

/** 预计学习时间（分钟），至少显示 1 分钟 */
export function estimateMinutes(queue: StudyQueue): number {
  if (queue.items.length === 0) return 0;
  const seconds = queue.items.reduce((sum, it) => sum + (SECONDS_PER_ITEM[it.exercise] ?? 10), 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** 统计到期需要复习的**单词**数（跨所有题型去重）——首页和角标都用这个口径 */
export function countDueWords(
  words: Word[],
  records: Map<string, LearningRecord>,
  exercises: ExerciseType[] = DEFAULT_STUDY_CONFIG.enabledExercises,
  now: Date = new Date(),
): number {
  let count = 0;
  for (const word of words) {
    const record = records.get(word.id);
    if (record?.suspended) continue;
    if (exercises.some((ex) => isExerciseDue(record, ex, now))) count++;
  }
  return count;
}
