/**
 * 学新词流程（沉浸式）。
 *
 * 交互刻意做成「先回忆、再看答案」：释义默认隐藏，用户先自己想，
 * 点开之后再评估熟悉度。直接把释义摆出来会退化成走马观花，学习效果差很多。
 *
 * 熟悉度四档映射到 FSRS 的四个评分。这次评估的是「看到词能否想起意思」，
 * 所以只给 en2zh 这个方向种下卡片——拼写、听力是另外的能力，
 * 没测过就凭空给它们排复习计划是替用户编数据。
 */
import { useCallback, useEffect, useState } from 'react';
import { Volume2, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { Familiarity, LearningRecord, Word } from '../../types/models.ts';
import { TaggedSentence } from '../components/TaggedSentence.tsx';

/** 四档熟悉度。顺序即从生疏到熟练，对应键盘 1–4 */
const LEVELS: { grade: Familiarity; label: string; cls: string }[] = [
  { grade: 'again', label: '不认识', cls: 'btn-outline' },
  { grade: 'hard', label: '有点印象', cls: 'btn-outline' },
  { grade: 'good', label: '认识', cls: 'btn-outline btn-info' },
  { grade: 'easy', label: '已掌握', cls: 'btn-outline btn-success' },
];

interface Props {
  words: Word[];
  records: Map<string, LearningRecord>;
  onGrade: (wordId: string, grade: Familiarity) => Promise<void> | void;
  onExit: () => void;
  onFinish: () => void;
}

export function LearnView({ words, onGrade, onExit, onFinish }: Props) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  const word = words[index];
  const done = index >= words.length;

  useEffect(() => {
    setRevealed(false);
    setShowDetail(false);
  }, [index]);

  useEffect(() => {
    if (done) onFinish();
  }, [done, onFinish]);

  const grade = useCallback(async (g: Familiarity) => {
    if (!word || busy) return;
    setBusy(true);
    try {
      await onGrade(word.id, g);
      setIndex((i) => i + 1);
    } finally {
      setBusy(false);
    }
  }, [word, busy, onGrade]);

  // 键盘：空格揭晓释义，1–4 评估熟悉度。学习流程里手不该离开键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) {
        e.preventDefault();
        grade(LEVELS[n - 1].grade);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [revealed, grade]);

  if (done || !word) return null;

  const primary = word.meanings[0];
  const example = word.examples[0];
  const phonetic = word.phonetic || word.phoneticUS || word.phoneticUK;
  const hasDetail = word.meanings.length > 1 || word.examples.length > 1;

  return (
    <div className="fixed inset-0 z-30 bg-base-200 flex flex-col">
      {/* 顶栏只留进度和退出——学习页面不放无关导航 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-base-100 border-b border-base-200 shrink-0">
        <button className="btn btn-ghost btn-sm btn-circle" title="退出学习" onClick={onExit}>
          <X className="w-4 h-4" />
        </button>
        <progress
          className="progress progress-primary flex-1 h-2"
          value={index}
          max={words.length}
        />
        <span className="text-sm text-base-content/60 tabular-nums whitespace-nowrap">
          {index + 1} / {words.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-8 flex flex-col items-center gap-5">
          <div className="text-center">
            <h1 className="text-4xl font-bold leading-tight break-words">{word.word}</h1>
            {phonetic && (
              <div className="text-sm font-mono text-base-content/50 mt-2">{phonetic}</div>
            )}
          </div>

          <button
            className="btn btn-ghost btn-sm gap-1.5"
            onClick={() => window.ttsManager.speak(word.word, 'en-US')}
          >
            <Volume2 className="w-4 h-4" />
            朗读
          </button>

          {!revealed ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-base-content/50">先想想它的意思</p>
              <button className="btn btn-primary" onClick={() => setRevealed(true)}>
                查看释义
              </button>
              <kbd className="kbd kbd-sm">空格</kbd>
            </div>
          ) : (
            <div className="w-full flex flex-col gap-4 animate-[fadeIn_150ms_ease-out]">
              <div className="card bg-base-100 shadow-sm rounded-xl">
                <div className="card-body p-5 gap-2">
                  {primary ? (
                    <>
                      <span className="badge badge-outline badge-sm self-start">
                        {primary.partOfSpeech}
                      </span>
                      <div className="text-lg leading-relaxed">
                        {primary.definitions.join('；')}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-base-content/50">这个词还没有释义</div>
                  )}
                </div>
              </div>

              {example && (
                <div className="card bg-base-100 shadow-sm rounded-xl">
                  <div className="card-body p-5 gap-1">
                    <div className="text-sm leading-relaxed">
                      <TaggedSentence sentence={example.sentence} tokens={example.tokens} />
                    </div>
                    {example.translation && (
                      <div className="text-xs text-base-content/50">{example.translation}</div>
                    )}
                    {example.sourceTitle && (
                      <div className="text-[11px] text-base-content/35 mt-1">
                        来自：{example.sourceTitle}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {hasDetail && (
                <>
                  <button
                    className="btn btn-ghost btn-sm gap-1 self-center"
                    onClick={() => setShowDetail((s) => !s)}
                  >
                    {showDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {showDetail ? '收起' : '更多释义与例句'}
                  </button>

                  {showDetail && (
                    <div className="card bg-base-100 shadow-sm rounded-xl">
                      <div className="card-body p-5 gap-3">
                        {word.meanings.slice(1).map((m, i) => (
                          <div key={i} className="flex flex-col gap-1">
                            <span className="badge badge-outline badge-sm self-start">
                              {m.partOfSpeech}
                            </span>
                            <div className="text-sm">{m.definitions.join('；')}</div>
                          </div>
                        ))}
                        {word.examples.slice(1).map((ex, i) => (
                          <div key={i} className="text-sm text-base-content/70 leading-relaxed">
                            {ex.sentence}
                            {ex.translation && (
                              <div className="text-xs text-base-content/45">{ex.translation}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 评估区固定在底部，移动端单手可及；避开 iOS 底部安全区 */}
      {revealed && (
        <div
          className="shrink-0 bg-base-100 border-t border-base-200 px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-lg mx-auto grid grid-cols-4 gap-2">
            {LEVELS.map((lvl, i) => (
              <button
                key={lvl.grade}
                className={`btn btn-sm ${lvl.cls} flex-col h-auto py-2 gap-0.5`}
                disabled={busy}
                onClick={() => grade(lvl.grade)}
              >
                <span className="text-xs">{lvl.label}</span>
                <kbd className="kbd kbd-xs opacity-50">{i + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
