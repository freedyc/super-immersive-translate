/**
 * 我的词库：搜索结果、掌握度、音标/词性、例句双语朗读、AI 重新生成例句、删除。
 */
import { useState } from 'react';
import { Volume2, RotateCw, Trash2 } from 'lucide-react';
import { Translator } from '../../utils/translator.js';
import { generateExampleSentence } from '../../utils/example-sentence.js';
import { deriveStatus, masteryPercent, STATUS_LABEL } from '../../utils/learning/srsService.ts';
import type { LearningRecord, Word } from '../../types/models.ts';

interface WordActions {
  onDelete: (wordId: string) => void;
  onRegenerate: (word: Word) => Promise<void>;
}

function SpeakButton({ text, lang, title }: { text: string; lang: string; title: string }) {
  return (
    <button
      className="btn btn-ghost btn-xs btn-circle shrink-0"
      title={title}
      onClick={(e) => { e.stopPropagation(); window.ttsManager.speak(text, lang); }}
    >
      <Volume2 className="w-3 h-3" />
    </button>
  );
}

function WordCard({
  word, record, onDelete, onRegenerate,
}: { word: Word; record: LearningRecord | undefined } & WordActions) {
  const [busy, setBusy] = useState(false);

  const status = deriveStatus(record);
  const label = STATUS_LABEL[status];
  const percent = masteryPercent(record);
  const progressCls = percent >= 100
    ? 'progress-success'
    : (status === 'difficult' ? 'progress-error' : 'progress-primary');

  const example = word.examples[0];
  const phonetic = word.phonetic || word.phoneticUS || word.phoneticUK;

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
            <div className="font-bold text-lg text-base-content">{word.word}</div>
            {phonetic && <span className="text-xs text-base-content/40 font-mono">{phonetic}</span>}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              className="btn btn-ghost btn-xs btn-circle"
              title="发音"
              onClick={() => window.ttsManager.speak(word.word, 'en-US')}
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
            <button className="btn btn-ghost btn-xs" title="删除" onClick={() => onDelete(word.id)}>
              <Trash2 className="w-4 h-4 text-error/60" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {word.meanings.map((m, i) => (
            <div key={i} className="flex gap-2 items-baseline text-sm">
              <span className="badge badge-ghost badge-sm shrink-0">{m.partOfSpeech}</span>
              <span className="text-base-content/80">{m.definitions.join('；')}</span>
            </div>
          ))}
          {word.meanings.length === 0 && (
            <span className="text-sm text-base-content/40">还没有释义</span>
          )}
        </div>

        {example?.sentence && (
          <div className="flex flex-col gap-1 mt-1 p-2 rounded-lg bg-base-200/50 text-xs">
            <div className="flex items-start gap-1.5">
              <span className="italic text-base-content/70 flex-1">{example.sentence}</span>
              <SpeakButton text={example.sentence} lang="en-US" title="朗读例句" />
            </div>
            {example.translation && (
              <div className="flex items-start gap-1.5">
                <span className="text-base-content/50 flex-1">{example.translation}</span>
                <SpeakButton text={example.translation} lang="zh-CN" title="朗读译文" />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`badge ${label.cls} badge-sm`}>{label.text}</span>
          <span className="text-xs text-base-content/40">
            {new Date(word.addedAt).toLocaleDateString('zh-CN')}
          </span>
          {word.sourceUrl && (
            <a
              href={word.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="link link-hover text-xs text-base-content/50"
              title={word.sourceTitle || word.sourceUrl}
            >
              {word.sourceTitle || '来源页面'}
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
  words, records, totalCount, onDelete, onRegenerate,
}: {
  words: Word[];
  records: Map<string, LearningRecord>;
  totalCount: number;
} & WordActions) {
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
          key={w.id}
          word={w}
          record={records.get(w.id)}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}

/**
 * AI 重新生成例句：追加一条新例句（不覆盖旧的），顺带补齐缺失的词性/音标。
 * 已有的词性/音标不覆盖，避免同一个词的标注来回跳变。
 */
export async function regenerateExample(
  word: Word,
  updateWord: (wordId: string, mutate: (w: Word) => Word) => Promise<void>,
): Promise<boolean> {
  const t = new Translator();
  await t.init();
  const generated = await generateExampleSentence(word.word, t);
  if (!generated) return false;

  await updateWord(word.id, (w) => {
    const next: Word = {
      ...w,
      examples: [...w.examples, {
        sentence: generated.sentence,
        translation: generated.translation,
        tokens: generated.tokens,
        origin: 'ai',
        timestamp: Date.now(),
      }],
    };
    if (generated.ipa && !next.phonetic) next.phonetic = generated.ipa;
    // 没有任何释义时才用 AI 给的词性建一条，避免覆盖已有释义
    if (generated.pos && next.meanings.length === 0) {
      next.meanings = [{ partOfSpeech: generated.pos, definitions: [] }];
    }
    return next;
  });
  return true;
}
