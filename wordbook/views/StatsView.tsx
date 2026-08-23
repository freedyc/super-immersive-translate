/**
 * 学习统计。
 *
 * 只放能指导下一步行动的数据：光展示「总共学了多少」没有行动价值，
 * 「最容易错的词」才能让用户知道该去练什么。
 */
import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LearningRecord, LearningStatus, Word } from '../../types/models.ts';
import { deriveStatus, STATUS_LABEL } from '../../utils/learning/srsService.ts';

interface Props {
  words: Word[];
  records: Map<string, LearningRecord>;
}

export function StatsView({ words, records }: Props) {
  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const byStatus: Record<LearningStatus, number> = {
      new: 0, learning: 0, reviewing: 0, difficult: 0, mastered: 0, suspended: 0,
    };

    let studiedToday = 0;
    let addedToday = 0;
    let correct = 0;
    let wrong = 0;

    for (const w of words) {
      const record = records.get(w.id);
      byStatus[deriveStatus(record)]++;
      if (w.addedAt >= todayMs) addedToday++;
      if (record?.lastStudiedAt && record.lastStudiedAt >= todayMs) studiedToday++;
      correct += record?.correctCount ?? 0;
      wrong += record?.wrongCount ?? 0;
    }

    const total = correct + wrong;
    return {
      byStatus,
      studiedToday,
      addedToday,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
    };
  }, [words, records]);

  // 错得最多的词——这是统计页里唯一直接可行动的部分
  const troublesome = useMemo(() => {
    return words
      .map((w) => ({ word: w, record: records.get(w.id) }))
      .filter((x) => (x.record?.wrongCount ?? 0) > 0)
      .sort((a, b) => (b.record!.wrongCount) - (a.record!.wrongCount))
      .slice(0, 10);
  }, [words, records]);

  const cards = [
    { title: '总单词数', value: words.length, cls: '' },
    { title: '今日学习', value: stats.studiedToday, cls: 'text-primary' },
    { title: '今日新增', value: stats.addedToday, cls: 'text-info' },
    {
      title: '累计正确率',
      value: stats.accuracy === null ? '—' : `${stats.accuracy}%`,
      cls: stats.accuracy !== null && stats.accuracy >= 80 ? 'text-success' : 'text-warning',
    },
  ];

  const distribution: LearningStatus[] = ['new', 'learning', 'reviewing', 'difficult', 'mastered'];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">{c.title}</div>
            <div className={`stat-value tabular-nums ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body gap-3">
          <h3 className="font-semibold text-sm">熟练度分布</h3>
          {words.length === 0 ? (
            <p className="text-sm text-base-content/50">还没有单词</p>
          ) : (
            <div className="flex flex-col gap-2">
              {distribution.map((status) => {
                const count = stats.byStatus[status];
                const pct = Math.round((count / words.length) * 100);
                const label = STATUS_LABEL[status];
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className={`badge ${label.cls} badge-sm w-20 justify-center shrink-0`}>
                      {label.text}
                    </span>
                    <progress className="progress progress-primary flex-1 h-2" value={pct} max="100" />
                    <span className="text-xs text-base-content/50 tabular-nums w-12 text-right">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body gap-3">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-warning" />
            最容易出错的词
          </h3>
          {troublesome.length === 0 ? (
            <p className="text-sm text-base-content/50">还没有错题记录</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {troublesome.map(({ word, record }) => (
                <div key={word.id} className="flex items-center justify-between text-sm py-1">
                  <span className="font-medium">{word.word}</span>
                  <span className="text-xs text-base-content/50 tabular-nums">
                    错 {record!.wrongCount} 次 · 对 {record!.correctCount} 次
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
