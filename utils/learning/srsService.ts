/**
 * 间隔重复调度服务。
 *
 * UI 组件只跟这一层打交道，不直接 import ts-fsrs——将来换算法只改这个文件。
 * 对外也只暴露「今天复习 / 明天复习 / 需要加强 / 已掌握」这种用户能理解的说法，
 * Stability / Difficulty / Retrievability 这些术语留在内部模型里，不上界面。
 */
import { createCard, scheduleNext, isDue, serializeCard, deserializeCard } from '../srs.js';
import type {
  ExerciseRecord,
  ExerciseType,
  Familiarity,
  LearningRecord,
  LearningStatus,
} from '../../types/models.ts';

/** 稳定性达到约 3 周视为「已掌握」。可调阈值，不是 FSRS 算法本身的规定 */
export const MASTERED_STABILITY_DAYS = 21;

/** 连续答错到这个次数就标记为「需要加强」 */
const DIFFICULT_WRONG_STREAK = 3;

/** 新建一条空的学习记录 */
export function createRecord(wordId: string): LearningRecord {
  return {
    wordId,
    studyCount: 0,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    byExercise: {},
  };
}

/**
 * 记录一次答题结果，返回更新后的记录（不改原对象）。
 *
 * 只有 'again' 算答错——'hard' 表示答对了但吃力，如果把它算成错，
 * 正确率会显著偏低，用户会以为自己学得比实际差。
 */
export function recordAnswer(
  record: LearningRecord,
  exercise: ExerciseType,
  grade: Familiarity,
  now: Date = new Date(),
): LearningRecord {
  const wasCorrect = grade !== 'again';
  const prev = record.byExercise[exercise];
  const card = prev ? deserializeCard(prev.card) : createCard(now);
  const nextCard = scheduleNext(card, grade, now);

  const nextExercise: ExerciseRecord = {
    card: serializeCard(nextCard),
    correct: (prev?.correct ?? 0) + (wasCorrect ? 1 : 0),
    wrong: (prev?.wrong ?? 0) + (wasCorrect ? 0 : 1),
  };

  return {
    ...record,
    firstStudiedAt: record.firstStudiedAt ?? now.getTime(),
    lastStudiedAt: now.getTime(),
    studyCount: record.studyCount + 1,
    correctCount: record.correctCount + (wasCorrect ? 1 : 0),
    wrongCount: record.wrongCount + (wasCorrect ? 0 : 1),
    streak: wasCorrect ? record.streak + 1 : 0,
    byExercise: { ...record.byExercise, [exercise]: nextExercise },
  };
}

/** 这个题型是否到期需要复习。从没学过的返回 false——新词归「学新词」流程管 */
export function isExerciseDue(
  record: LearningRecord | undefined,
  exercise: ExerciseType,
  now: Date = new Date(),
): boolean {
  const entry = record?.byExercise[exercise];
  if (!entry) return false;
  return isDue(deserializeCard(entry.card), now);
}

/** 这个题型有没有学过 */
export function hasLearned(
  record: LearningRecord | undefined,
  exercise: ExerciseType,
): boolean {
  return !!record?.byExercise[exercise];
}

/** 取某个题型的下次复习时间，没学过返回 null */
export function nextReviewAt(
  record: LearningRecord | undefined,
  exercise: ExerciseType,
): Date | null {
  const entry = record?.byExercise[exercise];
  if (!entry) return null;
  return deserializeCard(entry.card).due;
}

/** 整条记录里最早的下次复习时间——用于在列表里显示「明天复习」这种提示 */
export function earliestReviewAt(record: LearningRecord | undefined): Date | null {
  const times = Object.keys(record?.byExercise ?? {})
    .map((ex) => nextReviewAt(record, ex as ExerciseType))
    .filter((d): d is Date => d !== null);
  if (times.length === 0) return null;
  return times.reduce((a, b) => (a < b ? a : b));
}

/**
 * 派生展示状态。**不存储**——存了就会跟 FSRS 卡片不一致。
 * 判断顺序有讲究：suspended 是用户主动意图，优先级最高；
 * difficult 要排在 mastered 前面，否则一个稳定性够高但一直答错的词会被误标成已掌握。
 */
export function deriveStatus(record: LearningRecord | undefined, now: Date = new Date()): LearningStatus {
  if (!record || Object.keys(record.byExercise).length === 0) return 'new';
  if (record.suspended) return 'suspended';

  const entries = Object.values(record.byExercise);
  const totalWrong = entries.reduce((sum, e) => sum + e.wrong, 0);
  const totalCorrect = entries.reduce((sum, e) => sum + e.correct, 0);

  // 错得多且近期没连对，属于需要加强
  if (totalWrong >= DIFFICULT_WRONG_STREAK && record.streak < 2) return 'difficult';

  // 所有题型的稳定性都够高才算掌握——只有一种题型练熟不代表真的会
  const allStable = entries.every(
    (e) => deserializeCard(e.card).stability >= MASTERED_STABILITY_DAYS,
  );
  if (allStable && totalCorrect > 0) return 'mastered';

  const anyDue = entries.some((e) => isDue(deserializeCard(e.card), now));
  return anyDue ? 'reviewing' : 'learning';
}

/** 掌握度百分比（0–100），用于列表里的进度条 */
export function masteryPercent(record: LearningRecord | undefined): number {
  const entries = Object.values(record?.byExercise ?? {});
  if (entries.length === 0) return 0;
  const avg = entries.reduce(
    (sum, e) => sum + Math.min(1, deserializeCard(e.card).stability / MASTERED_STABILITY_DAYS),
    0,
  ) / entries.length;
  return Math.round(avg * 100);
}

/** 展示状态 → 中文标签与 daisyUI 徽章样式 */
export const STATUS_LABEL: Record<LearningStatus, { text: string; cls: string }> = {
  new: { text: '未学习', cls: 'badge-ghost' },
  learning: { text: '学习中', cls: 'badge-info' },
  reviewing: { text: '待复习', cls: 'badge-warning' },
  difficult: { text: '需要加强', cls: 'badge-error' },
  mastered: { text: '已掌握', cls: 'badge-success' },
  suspended: { text: '已暂停', cls: 'badge-ghost' },
};

/** 把下次复习时间说成人话，不暴露具体天数计算 */
export function describeNextReview(due: Date | null, now: Date = new Date()): string {
  if (!due) return '尚未安排';
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((due.getTime() - startOfToday.getTime()) / 86_400_000);
  if (days <= 0) return '今天复习';
  if (days === 1) return '明天复习';
  if (days < 7) return `${days} 天后复习`;
  if (days < 30) return `${Math.round(days / 7)} 周后复习`;
  return `${Math.round(days / 30)} 个月后复习`;
}
