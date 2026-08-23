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
      <div
        className={`flashcard w-full h-72 mb-6 ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front bg-gradient-to-br from-primary to-secondary text-primary-content shadow-xl">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-4xl font-bold">{word ? word.text : '没有单词'}</div>
              {word?.pos && (
                <span className="badge badge-outline border-primary-content/40 text-primary-content/80 badge-sm">
                  {word.pos}
                </span>
              )}
              {word && (
                <button
                  className="btn btn-ghost btn-circle btn-sm text-primary-content"
                  title="发音"
                  onClick={(e) => { e.stopPropagation(); window.ttsManager.speak(word.text, 'auto'); }}
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {word?.ipa && <div className="text-sm opacity-70 font-mono mb-2">{word.ipa}</div>}
            <div className="text-sm opacity-70 flex items-center gap-1">
              <RotateCw className="w-3.5 h-3.5" />
              点击翻转
            </div>
          </div>

          <div className="flashcard-back bg-base-100 border-2 border-base-300 shadow-xl">
            <div className="text-2xl font-semibold text-base-content mb-3">{trans[0] || '无翻译'}</div>
            <div className="text-sm text-base-content/50">
              {trans.length > 1 ? trans.slice(1).join(' / ') : (word?.title || '')}
            </div>
            {ctx?.sentence && (
              <div className="text-sm text-base-content/60 mt-3 px-4 leading-relaxed">
                <TaggedSentence sentence={ctx.sentence} tokens={ctx.tokens} />
                {ctx.translation && (
                  <div className="text-xs text-base-content/40 mt-1">{ctx.translation}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6 mb-5">
        <button
          className="btn btn-outline btn-sm gap-1"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="w-4 h-4" />
          上一个
        </button>
        <span className="text-sm text-base-content/60 font-medium">
          {words.length === 0 ? '0 / 0' : `${index + 1} / ${words.length}`}
        </span>
        <button
          className="btn btn-outline btn-sm gap-1"
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
