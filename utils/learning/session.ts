/**
 * 未完成学习会话的存档格式与有效性判断。
 *
 * 纯函数放这里而不是放 React hook 里，是为了能在 scripts/verify.mjs 里断言——
 * 「什么样的存档才该恢复」是这套逻辑里最容易出错的一块：
 * 判松了会让用户接着一个跨天的旧队列，判紧了「继续学习」永远不出现。
 */
import type { ExerciseType } from '../../types/models.ts';

export interface SessionSnapshot {
  /** new Date().toDateString()，跨天作废 */
  date: string;
  phase: 'review' | 'learn';
  /** 复习阶段是 词+题型，学新词阶段 exercise 为空 */
  queue: { wordId: string; exercise?: ExerciseType }[];
  /** 下一道要答的题在 queue 里的下标 */
  index: number;
  correct: number;
  total: number;
  /** 本轮答错过的词 */
  missedIds: string[];
}

/**
 * 存档能不能用来恢复。
 *
 * 跨天作废：昨天排的队列是按昨天的到期情况算的，今天该复习的词已经不一样了。
 * index === 0 视为无效：一题都没答的存档恢复了也没有意义，
 * 反而会让首页显示「继续学习」，暗示有进度可续。
 */
export function isResumable(
  snapshot: unknown,
  now: Date = new Date(),
): snapshot is SessionSnapshot {
  const s = snapshot as SessionSnapshot | null;
  return !!s
    && (s.phase === 'review' || s.phase === 'learn')
    && s.date === now.toDateString()
    && Array.isArray(s.queue)
    && Number.isInteger(s.index)
    && s.index > 0
    && s.index < s.queue.length;
}
