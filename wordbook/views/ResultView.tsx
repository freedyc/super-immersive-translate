/**
 * 学习结果页。
 *
 * 只放对下一步有用的信息：做了多少、正确率、下次什么时候复习、哪些词错了。
 * 不放奖杯彩带那一套——目标是让人知道接下来该干什么，不是发一枚徽章。
 */
import { CheckCircle2, ArrowRight, RotateCw } from 'lucide-react';
import type { Word } from '../../types/models.ts';

export interface SessionResult {
  /** 答题总数（按题目计，不是单词数） */
  total: number;
  correct: number;
  /** 答错过的词，去重 */
  missed: Word[];
  /** 下次复习的人话描述，比如「明天复习」 */
  nextReviewText: string;
}

interface Props {
  result: SessionResult;
  /** 有错词时提供「再练一遍错词」 */
  onRetryMissed?: () => void;
  onDone: () => void;
  /** 复习完还有新词要学时，主按钮变成「继续学新词」 */
  continueLabel?: string;
}

export function ResultView({ result, onRetryMissed, onDone, continueLabel }: Props) {
  const accuracy = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-30 bg-base-200 overflow-y-auto">
      <div className="max-w-md mx-auto px-4 py-12 flex flex-col items-center gap-6">
        <CheckCircle2 className="w-16 h-16 text-success/60" />
        <h2 className="text-xl font-semibold">本轮完成</h2>

        <div className="grid grid-cols-3 gap-3 w-full">
          <div className="flex flex-col items-center gap-1 px-3 py-4 rounded-xl bg-base-100">
            <div className="text-2xl font-bold tabular-nums">{result.total}</div>
            <div className="text-xs text-base-content/50">答题数</div>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-4 rounded-xl bg-base-100">
            <div className={`text-2xl font-bold tabular-nums ${
              accuracy >= 80 ? 'text-success' : 'text-warning'
            }`}>
              {result.total > 0 ? `${accuracy}%` : '—'}
            </div>
            <div className="text-xs text-base-content/50">正确率</div>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-4 rounded-xl bg-base-100">
            <div className="text-2xl font-bold tabular-nums text-warning">{result.missed.length}</div>
            <div className="text-xs text-base-content/50">待加强</div>
          </div>
        </div>

        <div className="text-sm text-base-content/60">
          下次复习：<span className="font-medium text-base-content/80">{result.nextReviewText}</span>
        </div>

        {result.missed.length > 0 && (
          <div className="card bg-base-100 shadow-sm rounded-xl w-full">
            <div className="card-body p-4 gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-base-content/40">
                这些词答错了
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {result.missed.map((w) => (
                  <span key={w.id} className="badge badge-warning badge-outline">{w.word}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 w-full">
          <button className="btn btn-primary gap-1" onClick={onDone}>
            <ArrowRight className="w-4 h-4" />
            {continueLabel ?? '完成'}
          </button>
          {onRetryMissed && result.missed.length > 0 && (
            <button className="btn btn-ghost btn-sm gap-1" onClick={onRetryMissed}>
              <RotateCw className="w-4 h-4" />
              再练一遍错词
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
