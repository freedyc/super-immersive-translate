/**
 * 学习统计视图：总量/已掌握/待学习/今日新增 + 最近收藏的词。
 */
import { useMemo } from 'react';
import { isMastered } from '../lib/mastery.ts';
import type { WordEntry } from '../../types/models.ts';

export function StatsView({ words }: { words: WordEntry[] }) {
  const stats = useMemo(() => {
    const total = words.length;
    const known = words.filter(isMastered).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return {
      total,
      known,
      unknown: total - known,
      today: words.filter((w) => w.timestamp >= todayStart.getTime()).length,
    };
  }, [words]);

  const cards = [
    { title: '总单词数', value: stats.total, cls: '' },
    { title: '已掌握', value: stats.known, cls: 'text-success' },
    { title: '待学习', value: stats.unknown, cls: 'text-warning' },
    { title: '今日新增', value: stats.today, cls: 'text-primary' },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.title} className="stat bg-base-100 rounded-box shadow">
            <div className="stat-title">{c.title}</div>
            <div className={`stat-value ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body">
          <h3 className="font-semibold text-sm mb-2">最近收藏</h3>
          <div className="flex flex-wrap gap-2">
            {words.slice(0, 20).map((w) => (
              <span key={w.id || w.text} className="badge badge-outline">{w.text}</span>
            ))}
            {words.length === 0 && (
              <span className="text-sm text-base-content/50">还没有收藏任何单词</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
