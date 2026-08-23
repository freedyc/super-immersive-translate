/**
 * 单词头部信息：单词 + 音标 + 词性 + 发音。
 *
 * 六个渲染点此前各写各的（我的词库、详情抽屉、卡片浏览、学新词、选择题、sandbox），
 * 音标取值顺序、有没有方括号、缺失时显示什么，每处都不一样。统一到这里。
 *
 * 取值规则在 utils/learning/wordMeta.ts，划词面板（内容脚本，不能用 React）
 * 共用的是那套数据函数，不是这个组件。
 */
import { SpeakButton } from '../wordbook/components/SpeakButton.tsx';
import {
  formatPhonetic, MISSING_PHONETIC_HINT, pickPhonetic, pickPos,
} from '../utils/learning/wordMeta.ts';
import type { Word } from '../types/models.ts';

export function WordMeta({
  word, size = 'md', showMissingHint = false, onWordClick, className = '',
}: {
  word: Word;
  /** md = 列表/卡片，lg = 详情页和答题页的主标题 */
  size?: 'sm' | 'md' | 'lg';
  /** 没有音标时是否解释原因。列表里逐条解释是噪音，详情页里有用 */
  showMissingHint?: boolean;
  /** 传了就把单词本身变成可点的（词库卡片点词头打开详情） */
  onWordClick?: () => void;
  className?: string;
}) {
  const phonetic = pickPhonetic(word);
  const pos = pickPos(word);

  const wordCls = size === 'lg' ? 'text-2xl font-bold'
    : size === 'sm' ? 'text-sm font-semibold'
      : 'text-lg font-bold';

  return (
    <div className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {onWordClick ? (
          <button
            className={`${wordCls} break-words link link-hover text-left`}
            title="查看详情"
            onClick={onWordClick}
          >
            {word.word}
          </button>
        ) : (
          <span className={`${wordCls} break-words`}>{word.word}</span>
        )}
        {phonetic && (
          <span className="text-xs font-mono text-base-content/45">
            {formatPhonetic(phonetic)}
          </span>
        )}
        {pos && <span className="badge badge-ghost badge-sm">{pos}</span>}
        <SpeakButton text={word.word} lang="en-US" title="发音" />
      </div>
      {!phonetic && showMissingHint && (
        <span className="text-xs text-base-content/35">{MISSING_PHONETIC_HINT}</span>
      )}
    </div>
  );
}
