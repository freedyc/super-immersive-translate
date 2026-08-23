/**
 * 拼写练习：看中文释义拼出英文单词。自由练习模式，不写回 FSRS 调度
 * （写回调度的是「今日学习」里的复习流程）。
 *
 * 关于发音按钮：答题前点它等于把答案念出来，这时候练的是「听写」而不是
 * 「由词义回忆拼写」。两种练法都成立，所以按钮一直可用，但答题前标成「提示」，
 * 让用户自己知道这一下拿了提示。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, SkipForward, ArrowRight, Volume2, VolumeX, Loader2, PenLine } from 'lucide-react';
import { shuffled } from '../lib/mastery.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import type { Word } from '../../types/models.ts';

export function QuizView({ words, onGoToLibrary }: {
  words: Word[];
  onGoToLibrary: () => void;
}) {
  // 进入视图时定一次顺序，之后不因为 words 引用变化而重排（否则答一题就跳题）
  const [queue, setQueue] = useState(() => shuffled(words));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [hintUsed, setHintUsed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakFailed, setSpeakFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (queue.length === 0 && words.length > 0) setQueue(shuffled(words));
  }, [words, queue.length]);

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [index, result]);

  const current = queue.length > 0 ? queue[index % queue.length] : null;

  // 释义去重：多个词性下可能重复出现同一条中文，全列出来只是噪音
  const meanings = useMemo(() => {
    if (!current) return [];
    return [...new Set(current.meanings.flatMap((m) => m.definitions).filter(Boolean))];
  }, [current]);

  const speak = async () => {
    if (!current || speaking) return;
    if (!result) setHintUsed(true); // 答题前听 = 用了提示
    setSpeakFailed(false);
    setSpeaking(true);
    try {
      await window.ttsManager.speak(current.word, 'en-US');
    } catch {
      // 静默失败会让用户以为是自己没点到，这里明说念不出来
      setSpeakFailed(true);
    } finally {
      setSpeaking(false);
    }
  };

  const check = () => {
    if (!current || result) return;
    const ok = answer.trim().toLowerCase() === current.word.toLowerCase();
    setResult(ok ? 'correct' : 'wrong');
    setStats((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }));
  };

  const next = () => {
    setIndex((i) => i + 1);
    setAnswer('');
    setResult(null);
    setHintUsed(false);
    setSpeakFailed(false);
  };

  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  const phonetic = current?.phonetic || current?.phoneticUS || current?.phoneticUK;

  if (words.length === 0) {
    return (
      <EmptyState
        Icon={PenLine}
        title="还没有可以练习的单词"
        hint="拼写练习从词库里随机出题。先收藏几个词，或者去「今日学习」按计划来。"
        actionLabel="去我的词库"
        onAction={onGoToLibrary}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="card bg-base-100 shadow-sm rounded-xl mb-6">
        <div className="card-body gap-4">
          {!current ? (
            <div className="text-center text-base-content/50 py-6">没有单词可以练习</div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  中文释义
                </span>
                <div className="text-xl text-base-content/80 leading-relaxed text-center break-words">
                  {meanings[0] || '???'}
                </div>
                {meanings.length > 1 && (
                  <div className="text-sm text-base-content/45 text-center break-words">
                    {meanings.slice(1).join(' / ')}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-1">
                <button
                  className={`btn btn-ghost btn-sm gap-1.5 ${speakFailed ? 'text-warning' : ''}`}
                  onClick={speak}
                  disabled={speaking}
                  title={result ? '朗读单词' : '朗读单词（会念出答案）'}
                >
                  {speaking
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : speakFailed
                      ? <VolumeX className="w-4 h-4" />
                      : <Volume2 className="w-4 h-4" />}
                  {result ? '朗读单词' : '听发音（提示）'}
                </button>
                {speakFailed && (
                  <span className="text-xs text-warning">
                    念不出来，可能缺少英语语音包
                  </span>
                )}
              </div>

              <input
                ref={inputRef}
                type="text"
                className="input w-full text-center text-lg"
                placeholder="输入英文单词..."
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={answer}
                disabled={!!result}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
              />

              {/* 答错用温和的措辞，不做成红色警告 */}
              <div className={`quiz-feedback text-base font-semibold min-h-6 text-center ${result || ''}`}>
                {result === 'correct' && (hintUsed ? '✅ 正确（用了提示）' : '✅ 正确！')}
                {result === 'wrong' && `再看一眼：${current.word}`}
              </div>

              {/* 答完再露出音标，避免答题前从音标反推拼写 */}
              {result && phonetic && (
                <div className="text-center text-sm font-mono text-base-content/50">{phonetic}</div>
              )}
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

      <div className="flex justify-center">
        <div className="badge badge-ghost badge-lg gap-2 p-3 tabular-nums">
          正确 <span className="font-bold">{stats.correct}</span>
          <span className="opacity-40">/</span>
          <span className="font-bold">{stats.total}</span>
          {stats.total > 0 && <span className="opacity-60">（{accuracy}%）</span>}
        </div>
      </div>
    </div>
  );
}
