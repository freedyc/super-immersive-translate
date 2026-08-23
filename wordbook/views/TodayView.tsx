/**
 * 今日学习首页。
 *
 * 只有一个主要操作：「开始今日学习」。词库、统计、设置都是次级入口，
 * 不放同等级的按钮跟它抢注意力。
 */
import { useMemo } from 'react';
import { Play, Flame, BookOpen, Clock, CheckCircle2, Sparkles } from 'lucide-react';
import type { LearningRecord, StudyConfig, Word } from '../../types/models.ts';
import { buildTodayQueue, estimateMinutes } from '../../utils/learning/queue.ts';
import { deriveStatus } from '../../utils/learning/srsService.ts';

interface Props {
  words: Word[];
  records: Map<string, LearningRecord>;
  config: StudyConfig;
  /** 上次中断的会话，有则显示「继续学习」而不是「开始今日学习」 */
  hasUnfinished: boolean;
  onStart: () => void;
  onGoToLibrary: () => void;
}

/** 连续学习天数：从今天往前数，直到某天没有学习记录为止 */
function calcStreak(records: Map<string, LearningRecord>, now = new Date()): number {
  const days = new Set<string>();
  for (const r of records.values()) {
    if (r.lastStudiedAt) days.add(new Date(r.lastStudiedAt).toDateString());
  }
  if (days.size === 0) return 0;

  let streak = 0;
  const cursor = new Date(now);
  // 今天还没学不算断签，所以从今天开始试探，今天没有就从昨天算起
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function StatTile({ icon, label, value, tone = '' }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-4 rounded-xl bg-base-200/50">
      <div className={`${tone || 'text-base-content/40'}`}>{icon}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-base-content/50">{label}</div>
    </div>
  );
}

export function TodayView({
  words, records, config, hasUnfinished, onStart, onGoToLibrary,
}: Props) {
  const queue = useMemo(
    () => buildTodayQueue(words, records, config),
    [words, records, config],
  );

  const stats = useMemo(() => {
    let mastered = 0;
    for (const w of words) {
      if (deriveStatus(records.get(w.id)) === 'mastered') mastered++;
    }
    return {
      total: words.length,
      mastered,
      streak: calcStreak(records),
      minutes: estimateMinutes(queue),
    };
  }, [words, records, queue]);

  const nothingToDo = queue.items.length === 0;
  const progress = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;

  // 一个词都没有：这是新用户，别让他对着空首页发呆，直接告诉他怎么开始
  if (words.length === 0) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center flex flex-col items-center gap-4">
        <BookOpen className="w-16 h-16 text-base-content/20" />
        <h2 className="text-xl font-semibold">还没有可学的单词</h2>
        <p className="text-sm text-base-content/60 leading-relaxed">
          在网页上划词翻译时，点击面板里的星标即可收藏。
          <br />
          收藏的每个词都会带上你遇到它的那句原文。
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-8 flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          icon={<Sparkles className="w-5 h-5" />}
          label="今日新学"
          value={queue.newWordCount}
          tone={queue.newWordCount > 0 ? 'text-primary' : ''}
        />
        <StatTile
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="今日复习"
          value={queue.reviewWordCount}
          tone={queue.reviewWordCount > 0 ? 'text-warning' : ''}
        />
        <StatTile
          icon={<Clock className="w-5 h-5" />}
          label="预计用时"
          value={stats.minutes === 0 ? '—' : `${stats.minutes}′`}
        />
      </div>

      {nothingToDo ? (
        <div className="card bg-base-100 shadow-sm rounded-xl">
          <div className="card-body items-center text-center gap-2 py-8">
            <CheckCircle2 className="w-12 h-12 text-success/60" />
            <h3 className="font-semibold">今天的任务已完成</h3>
            <p className="text-sm text-base-content/60">
              到期的词都复习过了。明天再来，或者去词库里挑几个词提前学。
            </p>
            <button className="btn btn-outline btn-sm mt-2" onClick={onGoToLibrary}>
              去词库看看
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary btn-lg w-full gap-2 shadow-md" onClick={onStart}>
          <Play className="w-5 h-5" />
          {hasUnfinished ? '继续学习' : '开始今日学习'}
        </button>
      )}

      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body p-5 gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-base-content/70">
              <BookOpen className="w-4 h-4" />
              我的词库
            </span>
            <span className="text-base-content/50 tabular-nums">
              已掌握 {stats.mastered} / {stats.total}
            </span>
          </div>
          <progress className="progress progress-success w-full h-2" value={progress} max="100" />

          {stats.streak > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-base-content/60 pt-1">
              <Flame className="w-4 h-4 text-warning" />
              连续学习 <span className="font-semibold tabular-nums">{stats.streak}</span> 天
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
