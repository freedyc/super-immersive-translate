/**
 * 我的词库：搜索结果、掌握度、音标/词性、例句双语朗读、AI 重新生成例句、删除。
 *
 * 顶部的状态筛选里「需要加强」就是错词本——错词不单独存一张表，
 * 它本来就是学习记录派生出来的一个状态，另存一份必然跟主表对不上。
 */
import { useMemo, useState } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import { Translator } from '../../utils/translator.js';
import { generateExampleSentence } from '../../utils/example-sentence.js';
import { deriveStatus, masteryPercent, STATUS_LABEL } from '../../utils/learning/srsService.ts';
import { SpeakButton } from '../components/SpeakButton.tsx';
import { WordDetailDrawer } from '../components/WordDetailDrawer.tsx';
import type { LearningRecord, LearningStatus, Word } from '../../types/models.ts';

interface WordActions {
  onDelete: (wordId: string) => void;
  onRegenerate: (word: Word) => Promise<void>;
}

function WordCard({
  word, record, onDelete, onRegenerate, onOpen,
}: {
  word: Word;
  record: LearningRecord | undefined;
  onOpen: (word: Word) => void;
} & WordActions) {
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
          {/* 点词头打开详情抽屉。整卡可点会跟卡内的发音/删除按钮抢事件 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="font-bold text-lg text-base-content link link-hover text-left"
              title="查看详情"
              onClick={() => onOpen(word)}
            >
              {word.word}
            </button>
            {phonetic && <span className="text-xs text-base-content/40 font-mono">{phonetic}</span>}
          </div>
          <div className="flex gap-1 shrink-0">
            <SpeakButton text={word.word} lang="en-US" title="发音" />
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

type Filter = 'all' | 'difficult' | 'learning' | 'mastered' | 'new';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'difficult', label: '需要加强' },
  { id: 'learning', label: '学习中' },
  { id: 'mastered', label: '已掌握' },
  { id: 'new', label: '未学习' },
];

function matches(filter: Filter, status: LearningStatus): boolean {
  switch (filter) {
    case 'all': return true;
    case 'difficult': return status === 'difficult';
    // 「待复习」也属于学习中——对用户来说它们都是「还没学完的」
    case 'learning': return status === 'learning' || status === 'reviewing';
    case 'mastered': return status === 'mastered';
    case 'new': return status === 'new';
    default: return true;
  }
}

export function ListView({
  words, records, totalCount, onDelete, onRegenerate,
}: {
  words: Word[];
  records: Map<string, LearningRecord>;
  totalCount: number;
} & WordActions) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Word | null>(null);

  // 每个筛选项都带计数，用户不用逐个点开才知道哪个是空的
  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.id] = 0;
    for (const w of words) {
      const status = deriveStatus(records.get(w.id));
      for (const f of FILTERS) if (matches(f.id, status)) out[f.id]++;
    }
    return out;
  }, [words, records]);

  const visible = useMemo(
    () => (filter === 'all'
      ? words
      : words.filter((w) => matches(filter, deriveStatus(records.get(w.id))))),
    [words, records, filter],
  );

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-base-content/50">
        <h3 className="text-lg font-semibold mb-1 text-base-content/60">还没有收藏单词</h3>
        <p className="text-sm">在网页上划词翻译时，点击收藏星标即可添加</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="tabs tabs-box self-start">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            className={`tab gap-1.5 ${filter === f.id ? 'tab-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="badge badge-sm badge-ghost tabular-nums">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p>{words.length === 0 ? '没有匹配的单词' : '这个分类下暂时没有单词'}</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {visible.map((w) => (
            <WordCard
              key={w.id}
              word={w}
              record={records.get(w.id)}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onOpen={setDetail}
            />
          ))}
        </div>
      )}

      <WordDetailDrawer
        word={detail}
        record={detail ? records.get(detail.id) : undefined}
        onClose={() => setDetail(null)}
      />
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
