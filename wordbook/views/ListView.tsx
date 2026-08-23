/**
 * 单词列表视图：搜索结果、掌握度、音标/词性、例句双语朗读、AI 重新生成例句、删除。
 */
import { useState } from 'react';
import { Volume2, RotateCw, Trash2 } from 'lucide-react';
import { Translator } from '../../utils/translator.js';
import { generateExampleSentence } from '../../utils/example-sentence.js';
import {
  ENGINE_NAMES, getMasteryBadge, getMasteryPercent, latestContext,
} from '../lib/mastery.ts';
import type { WordEntry } from '../../types/models.ts';
import type { WordMutator } from '../lib/useWordbook.ts';

function SpeakButton({ text, lang, title }: { text: string; lang: string; title: string }) {
  return (
    <button
      className="btn btn-ghost btn-xs btn-circle shrink-0"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        window.ttsManager.speak(text, lang);
      }}
    >
      <Volume2 className="w-3 h-3" />
    </button>
  );
}

interface WordActions {
  onDelete: (word: WordEntry) => void;
  onRegenerate: (word: WordEntry) => Promise<void>;
}

function WordCard({ word, onDelete, onRegenerate }: { word: WordEntry } & WordActions) {
  const [busy, setBusy] = useState(false);
  const badge = getMasteryBadge(word);
  const percent = getMasteryPercent(word);
  const progressCls = percent >= 100
    ? 'progress-success'
    : (badge.cls === 'badge-warning' ? 'progress-warning' : 'progress-primary');
  const ctx = latestContext(word);

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      await onRegenerate(word);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow rounded-xl hover:shadow-lg transition-shadow">
      <div className="card-body gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-lg text-base-content">{word.text}</div>
            {word.ipa && <span className="text-xs text-base-content/40 font-mono">{word.ipa}</span>}
            {word.pos && <span className="badge badge-outline badge-sm">{word.pos}</span>}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              className="btn btn-ghost btn-xs btn-circle"
              title="发音"
              onClick={() => window.ttsManager.speak(word.text, 'auto')}
            >
              <Volume2 className="w-4 h-4" />
            </button>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              title="AI 生成新例句 / 补全音标词性"
              disabled={busy}
              onClick={handleRegenerate}
            >
              <RotateCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            </button>
            <button className="btn btn-ghost btn-xs" title="删除" onClick={() => onDelete(word)}>
              <Trash2 className="w-4 h-4 text-error/60" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {Object.entries(word.translations || {}).map(([engine, text]) => (
            <div key={engine} className="flex gap-2 items-baseline text-sm">
              <span className="badge badge-ghost badge-sm shrink-0">{ENGINE_NAMES[engine] || engine}</span>
              <span className="text-base-content/80">{text}</span>
            </div>
          ))}
        </div>

        {ctx?.sentence && (
          <div className="flex flex-col gap-1 mt-1 p-2 rounded-lg bg-base-200/50 text-xs">
            <div className="flex items-start gap-1.5">
              <span className="italic text-base-content/70 flex-1">{ctx.sentence}</span>
              <SpeakButton text={ctx.sentence} lang="en-US" title="朗读例句" />
            </div>
            {ctx.translation && (
              <div className="flex items-start gap-1.5">
                <span className="text-base-content/50 flex-1">{ctx.translation}</span>
                <SpeakButton text={ctx.translation} lang="zh-CN" title="朗读译文" />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1">
          <span className={`badge ${badge.cls} badge-sm`}>{badge.text}</span>
          <span className="text-xs text-base-content/40">
            {new Date(word.timestamp).toLocaleDateString('zh-CN')}
          </span>
          {word.url && (
            <a
              href={word.url}
              target="_blank"
              rel="noreferrer"
              className="link link-hover text-xs text-base-content/50"
              title={word.title || word.url}
            >
              {word.title || '来源页面'}
            </a>
          )}
        </div>

        <div className="mt-1">
          <div className="flex justify-between text-[10px] text-base-content/40 mb-0.5">
            <span>掌握度</span><span>{percent}%</span>
          </div>
          <progress className={`progress ${progressCls} w-full h-1.5`} value={percent} max="100" />
        </div>
      </div>
    </div>
  );
}

export function ListView({
  words, totalCount, onDelete, onRegenerate,
}: { words: WordEntry[]; totalCount: number } & WordActions) {
  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-base-content/50">
        <h3 className="text-lg font-semibold mb-1 text-base-content/60">还没有收藏单词</h3>
        <p className="text-sm">在网页上划词翻译时，点击收藏星标即可添加</p>
      </div>
    );
  }

  if (words.length === 0) {
    return <div className="text-center py-12 text-base-content/50"><p>没有匹配的单词</p></div>;
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
      {words.map((w) => (
        <WordCard
          key={w.id || w.text}
          word={w}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}

// AI 重新生成例句：追加一条新的 context（不覆盖旧的），顺带补齐缺失的词性/音标。
// 已有的词性/音标不覆盖，避免同一个词的标注来回跳变。
export async function regenerateExample(
  word: WordEntry,
  updateWord: (text: string, mutate: WordMutator) => Promise<void>,
): Promise<boolean> {
  const t = new Translator();
  await t.init();
  const generated = await generateExampleSentence(word.text, t);
  if (!generated) return false;
  await updateWord(word.text, (w) => {
    w.contexts = [...(w.contexts || []), {
      sentence: generated.sentence,
      translation: generated.translation,
      tokens: generated.tokens,
      url: null,
      title: 'AI 生成',
      timestamp: Date.now(),
      source: 'ai',
    }];
    if (generated.pos && !w.pos) w.pos = generated.pos;
    if (generated.ipa && !w.ipa) w.ipa = generated.ipa;
  });
  return true;
}
