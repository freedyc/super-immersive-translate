/**
 * 拼写测验视图：看翻译拼单词，自由练习模式，不写回 FSRS 调度。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, SkipForward, ArrowRight } from 'lucide-react';
import { shuffled } from '../lib/mastery.js';

export function QuizView({ words }) {
  // 进入视图时定一次顺序，之后不因为 words 引用变化而重排（否则答一题就跳题）
  const [queue, setQueue] = useState(() => shuffled(words));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null); // null | 'correct' | 'wrong'
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const inputRef = useRef(null);

  // 单词本从空变成有内容（首次加载完成）时补一次队列
  useEffect(() => {
    if (queue.length === 0 && words.length > 0) setQueue(shuffled(words));
  }, [words, queue.length]);

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [index, result]);

  const current = queue.length > 0 ? queue[index % queue.length] : null;
  const prompt = useMemo(() => {
    if (!current) return '没有单词可以测验';
    return Object.values(current.translations || {})[0] || '???';
  }, [current]);

  const check = () => {
    if (!current || result) return;
    const ok = answer.trim().toLowerCase() === current.text.toLowerCase();
    setResult(ok ? 'correct' : 'wrong');
    setStats((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }));
  };

  const next = () => {
    setIndex((i) => i + 1);
    setAnswer('');
    setResult(null);
  };

  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="card bg-base-100 shadow-sm rounded-xl mb-6">
        <div className="card-body gap-4">
          <div className="text-xl text-base-content/70 leading-relaxed">{prompt}</div>
          {current && (
            <>
              <input
                ref={inputRef}
                type="text"
                className="input input-bordered text-center text-lg"
                placeholder="输入单词..."
                autoComplete="off"
                value={answer}
                disabled={!!result}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
              />
              <div className={`quiz-feedback text-base font-semibold min-h-6 ${result || ''}`}>
                {result === 'correct' && '✅ 正确！'}
                {result === 'wrong' && `❌ 正确答案: ${current.text}`}
              </div>
            </>
          )}
        </div>
      </div>

      {current && (
        <div className="flex justify-center gap-3 mb-5">
          {!result ? (
            <>
              <button className="btn btn-primary gap-1" onClick={check}>
                <Check className="w-4 h-4" />
                检查
              </button>
              <button className="btn btn-ghost gap-1" onClick={next}>
                <SkipForward className="w-4 h-4" />
                跳过
              </button>
            </>
          ) : (
            <button className="btn btn-primary gap-1" onClick={next}>
              <ArrowRight className="w-4 h-4" />
              下一题
            </button>
          )}
        </div>
      )}

      <div className="badge badge-ghost badge-lg gap-2 p-3">
        正确: <span className="font-bold">{stats.correct}</span>
        <span className="opacity-40">/</span>
        总计: <span className="font-bold">{stats.total}</span>
      </div>
    </div>
  );
}
