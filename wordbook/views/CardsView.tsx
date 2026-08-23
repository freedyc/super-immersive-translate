/**
 * 卡片学习视图：翻转卡片自由浏览，不接入 FSRS 调度（那是"今日复习"的职责）。
 */
import { useEffect, useState } from 'react';
import { Volume2, RotateCw, ArrowLeft, ArrowRight, Shuffle } from 'lucide-react';
import { TaggedSentence } from '../components/TaggedSentence.tsx';
import { latestContext } from '../lib/mastery.ts';
import type { WordEntry } from '../../types/models.ts';

export function CardsView({ words }: { words: WordEntry[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // 切到别的词就把卡片翻回正面，避免下一张直接露出答案
  useEffect(() => { setFlipped(false); }, [index]);

  // 单词本被外部改动（删词/后台同步）后下标可能越界，夹回合法范围
  useEffect(() => {
    if (index > words.length - 1) setIndex(Math.max(0, words.length - 1));
  }, [words.length, index]);

  // 方向键翻页、空格翻面——沿用旧版的键盘习惯
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(words.length - 1, i + 1));
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [words.length]);

  const word = words[index];
  const trans = Object.values(word?.translations || {});
  const ctx = latestContext(word);

  return (
    <div className="max-w-lg mx-auto mt-8 text-center">
      {/* 高度比原来的 h-72 高一档：背面要放主译文+其他译文+例句+例句翻译，
          288px 减去内边距后放不下，之前会被裁掉 */}
      <div
        className={`flashcard w-full h-80 mb-6 ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flashcard-inner">
          {/* 正面：单词 → 音标 → 词性/发音，三段各自成行居中，不再把大字和小控件挤在一行 */}
          <div className="flashcard-front bg-gradient-to-br from-primary to-secondary text-primary-content shadow-xl">
            <div className="flashcard-scroll gap-2 text-center">
              <div className="text-4xl font-bold leading-tight break-words">
                {word ? word.text : '没有单词'}
              </div>

              {word?.ipa && (
                <div className="text-sm font-mono opacity-75">{word.ipa}</div>
              )}

              {word && (
                <div className="flex items-center gap-2 mt-1">
                  {word.pos && (
                    <span className="badge badge-sm bg-primary-content/15 border-primary-content/30 text-primary-content">
                      {word.pos}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost btn-circle btn-sm text-primary-content hover:bg-primary-content/15"
                    title="发音"
                    onClick={(e) => { e.stopPropagation(); window.ttsManager.speak(word.text, 'auto'); }}
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="flashcard-hint">
              <RotateCw className="w-3.5 h-3.5" />
              点击翻转
            </div>
          </div>

          {/* 背面：主译文 → 其他译文 → 例句，内容长了在卡片内滚动 */}
          <div className="flashcard-back bg-base-100 border-2 border-base-300 shadow-xl">
            <div className="flashcard-scroll gap-3 text-center">
              <div className="text-2xl font-semibold text-base-content leading-snug break-words">
                {trans[0] || '无翻译'}
              </div>

              {trans.length > 1 && (
                <div className="text-sm text-base-content/50 break-words">
                  {trans.slice(1).join(' / ')}
                </div>
              )}

              {ctx?.sentence && (
                <div className="w-full pt-3 border-t border-base-300 flex flex-col gap-1">
                  <div className="text-sm text-base-content/70 leading-relaxed">
                    <TaggedSentence sentence={ctx.sentence} tokens={ctx.tokens} />
                  </div>
                  {ctx.translation && (
                    <div className="text-xs text-base-content/40">{ctx.translation}</div>
                  )}
                </div>
              )}
            </div>

            <div className="flashcard-hint">
              <RotateCw className="w-3.5 h-3.5" />
              点击翻回
            </div>
          </div>
        </div>
      </div>

      {/* 三栏等宽：计数器居中且宽度固定，位数变化时两侧按钮不会左右跳动 */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <button
          className="btn btn-outline btn-sm gap-1 flex-1 justify-center"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="w-4 h-4" />
          上一个
        </button>
        <span className="text-sm text-base-content/60 font-medium tabular-nums whitespace-nowrap shrink-0 w-20 text-center">
          {words.length === 0 ? '0 / 0' : `${index + 1} / ${words.length}`}
        </span>
        <button
          className="btn btn-outline btn-sm gap-1 flex-1 justify-center"
          disabled={index >= words.length - 1}
          onClick={() => setIndex((i) => Math.min(words.length - 1, i + 1))}
        >
          下一个
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex justify-center gap-3">
        <button
          className="btn btn-secondary btn-sm gap-1"
          disabled={words.length === 0}
          onClick={() => setIndex(Math.floor(Math.random() * words.length))}
        >
          <Shuffle className="w-4 h-4" />
          随机
        </button>
      </div>
    </div>
  );
}
