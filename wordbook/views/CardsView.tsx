/**
 * 卡片浏览：自由翻阅，不接入 FSRS 调度（那是「今日学习」的职责）。
 */
import { useEffect, useState } from 'react';
import { RotateCw, ArrowLeft, ArrowRight, Shuffle, Layers } from 'lucide-react';
import { TaggedSentence } from '../components/TaggedSentence.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { SpeakButton } from '../components/SpeakButton.tsx';
import type { Word } from '../../types/models.ts';

export function CardsView({ words, onGoToLibrary }: {
  words: Word[];
  onGoToLibrary: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // 切到别的词就翻回正面，避免下一张直接露出答案
  useEffect(() => { setFlipped(false); }, [index]);

  // 单词本被外部改动（删词/后台同步）后下标可能越界，夹回合法范围
  useEffect(() => {
    if (index > words.length - 1) setIndex(Math.max(0, words.length - 1));
  }, [words.length, index]);

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
  const primary = word?.meanings[0];
  const example = word?.examples[0];
  const phonetic = word?.phonetic || word?.phoneticUS || word?.phoneticUK;

  if (words.length === 0) {
    return (
      <EmptyState
        Icon={Layers}
        title="还没有可以浏览的卡片"
        hint="卡片浏览用的是词库里的词。在网页上划词翻译时点收藏，词就会进到这里。"
        actionLabel="去我的词库"
        onAction={onGoToLibrary}
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-8 text-center">
      {/* 背面要放释义+其他词性+例句+例句翻译，高度不够会被裁掉 */}
      <div
        className={`flashcard w-full h-80 mb-6 ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front bg-gradient-to-br from-primary to-secondary text-primary-content shadow-xl">
            <div className="flashcard-scroll gap-2 text-center">
              <div className="text-4xl font-bold leading-tight break-words">
                {word ? word.word : '没有单词'}
              </div>

              {phonetic && <div className="text-sm font-mono opacity-75">{phonetic}</div>}

              {word && (
                <div className="flex items-center gap-2 mt-1">
                  {primary?.partOfSpeech && (
                    <span className="badge badge-sm bg-primary-content/15 border-primary-content/30 text-primary-content">
                      {primary.partOfSpeech}
                    </span>
                  )}
                  <SpeakButton
                    text={word.word}
                    lang="en-US"
                    title="发音"
                    size="sm"
                    className="text-primary-content hover:bg-primary-content/15"
                  />
                </div>
              )}
            </div>

            <div className="flashcard-hint">
              <RotateCw className="w-3.5 h-3.5" />
              点击翻转
            </div>
          </div>

          <div className="flashcard-back bg-base-100 border-2 border-base-300 shadow-xl">
            <div className="flashcard-scroll gap-3 text-center">
              <div className="text-2xl font-semibold text-base-content leading-snug break-words">
                {primary?.definitions.join('；') || '无翻译'}
              </div>

              {word && word.meanings.length > 1 && (
                <div className="text-sm text-base-content/50 break-words">
                  {word.meanings.slice(1)
                    .map((m) => `${m.partOfSpeech} ${m.definitions.join('；')}`)
                    .join(' / ')}
                </div>
              )}

              {example && (
                <div className="w-full pt-3 border-t border-base-300 flex flex-col gap-1">
                  <div className="text-sm text-base-content/70 leading-relaxed">
                    <TaggedSentence sentence={example.sentence} tokens={example.tokens} />
                  </div>
                  {example.translation && (
                    <div className="text-xs text-base-content/40">{example.translation}</div>
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

      {/* 计数器固定宽度 + 等宽数字，位数变化时两侧按钮不会左右跳 */}
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
