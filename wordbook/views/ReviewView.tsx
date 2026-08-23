/**
 * 今日复习视图（FSRS 调度）。
 *
 * 两条重要约束，改动时不要破坏：
 * 1. 默认队列只包含"已经学过且到期"的词——从没学过的新词不会自动涌进来，
 *    只能通过「提前学新词」主动拉取。这同时天然形成了每日新词节奏，不需要额外的上限设置。
 * 2. 拼写方向（recall）的例句和语法拆解都要等判分之后才显示——它们都包含要默写的
 *    那个词本身，提前显示等于直接给答案。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Volume2, CheckCircle, Plus } from 'lucide-react';
import { createCard, scheduleNext, isDue, serializeCard, deserializeCard } from '../../utils/srs.js';
import { TaggedSentence } from '../components/TaggedSentence.tsx';
import { shuffled, latestContext, ROLE_ORDER } from '../lib/mastery.ts';
import type { WordEntry, ReviewMode } from '../../types/models.ts';
import type { WordMutator } from '../lib/useWordbook.ts';

const MODES: ReviewMode[] = ['recall', 'recognition'];

/** 复习队列里的一项：某个词的某个方向 */
interface QueueItem {
  key: string;
  mode: ReviewMode;
}

type Grade = 'again' | 'hard' | 'good' | 'easy';

function hasTranslation(word: WordEntry): boolean {
  return Object.values(word.translations || {}).some(Boolean);
}

// 只收"学过且到期"的 (词, 方向) 组合
function buildDueQueue(wordbook: WordEntry[], now = new Date()): QueueItem[] {
  const queue: QueueItem[] = [];
  wordbook.forEach((w) => {
    const translated = hasTranslation(w);
    MODES.forEach((mode) => {
      if (mode === 'recognition' && !translated) return; // 没有翻译的词出不了选择题
      const raw = w.srs?.[mode];
      if (!raw) return; // 没学过 → 归「学新词」管
      if (isDue(deserializeCard(raw), now)) queue.push({ key: w.text.toLowerCase(), mode });
    });
  });
  return shuffled(queue);
}

// 只收"从没学过"的 (词, 方向) 组合
function buildNewQueue(wordbook: WordEntry[]): QueueItem[] {
  const queue: QueueItem[] = [];
  wordbook.forEach((w) => {
    const translated = hasTranslation(w);
    MODES.forEach((mode) => {
      if (mode === 'recognition' && !translated) return;
      if (!w.srs?.[mode]) queue.push({ key: w.text.toLowerCase(), mode });
    });
  });
  return shuffled(queue);
}

function GrammarSidebar({ word }: { word: WordEntry }) {
  const ctx = latestContext(word);
  const tokens = ctx?.tokens;
  if (!tokens?.some((t) => t.role)) return null;

  const groups: Record<string, string[]> = {};
  tokens.forEach((t) => {
    if (!t.role) return;
    (groups[t.role] = groups[t.role] || []).push(t.text);
  });
  const rows = ROLE_ORDER.filter((r) => groups[r]?.length);
  if (rows.length === 0) return null;

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl">
      <div className="card-body p-4 gap-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-base-content/40 mb-1">语法拆解</h3>
        {rows.map((role) => (
          <div key={role} className="flex items-start gap-2 py-1.5 border-b border-base-200 last:border-0">
            <span className="badge badge-outline badge-sm shrink-0 w-14 justify-center">{role}</span>
            <span className="text-sm text-base-content/70">{groups[role].join(' / ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExampleBlock({ word }: { word: WordEntry }) {
  const ctx = latestContext(word);
  if (!ctx?.sentence) return null;
  return (
    <div>
      <div className="text-sm mt-2">
        <TaggedSentence sentence={ctx.sentence} tokens={ctx.tokens} />
      </div>
      {ctx.translation && <div className="text-xs text-base-content/40 mt-1">{ctx.translation}</div>}
    </div>
  );
}

function RecallQuestion({
  word, onGrade, onRevealChange,
}: {
  word: WordEntry;
  onGrade: (grade: Grade) => void;
  onRevealChange: (revealed: boolean) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<'correct' | 'wrong' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setAnswer('');
    setState(null);
    onRevealChange(false);
    inputRef.current?.focus();
    return () => clearTimeout(timerRef.current);
  }, [word.text, onRevealChange]);

  const check = () => {
    if (state) return;
    const ok = answer.trim().toLowerCase() === word.text.toLowerCase();
    setState(ok ? 'correct' : 'wrong');
    onRevealChange(true); // 判完分才允许露出例句/语法拆解
    if (!ok) {
      timerRef.current = setTimeout(() => onGrade('again'), 900);
    }
  };

  const trans = Object.values(word.translations || {});

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <div className="text-xl text-base-content/70 leading-relaxed">{trans[0] || '???'}</div>
        <input
          ref={inputRef}
          type="text"
          className="input input-bordered text-center text-lg"
          placeholder="输入单词..."
          autoComplete="off"
          value={answer}
          disabled={!!state}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
        />
        <div className={`quiz-feedback text-base font-semibold min-h-6 ${state || ''}`}>
          {state === 'correct' && '✅ 正确！选一个难易度：'}
          {state === 'wrong' && `❌ 正确答案: ${word.text}`}
        </div>
        {state === 'correct' && (
          <div className="flex justify-center gap-2">
            {([['hard', '困难'], ['good', '记得'], ['easy', '简单']] as const).map(([grade, label]) => (
              <button key={grade} className="btn btn-sm btn-outline" onClick={() => onGrade(grade)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {state && <ExampleBlock word={word} />}
      </div>
    </div>
  );
}

function RecognitionQuestion({
  word, pool, onGrade,
}: {
  word: WordEntry;
  pool: WordEntry[];
  onGrade: (grade: Grade) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { options, correctIndex } = useMemo(() => {
    const correct = Object.values(word.translations || {})[0] || '';
    const distractors = shuffled(
      pool
        .filter((w) => w.text.toLowerCase() !== word.text.toLowerCase())
        .map((w) => Object.values(w.translations || {})[0])
        .filter(Boolean),
    ).slice(0, 3);
    const opts = shuffled([correct, ...distractors].filter(Boolean));
    return { options: opts, correctIndex: opts.indexOf(correct) };
  }, [word.text, pool]);

  useEffect(() => {
    setPicked(null);
    startedAt.current = Date.now();
    return () => clearTimeout(timerRef.current);
  }, [word.text]);

  const choose = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    const elapsed = Date.now() - startedAt.current;
    const correct = i === correctIndex;
    // 答对的话按反应快慢推导难易度：越快说明记得越牢
    const grade: Grade = !correct ? 'again' : elapsed < 2000 ? 'easy' : elapsed < 5000 ? 'good' : 'hard';
    timerRef.current = setTimeout(() => onGrade(grade), 700);
  };

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <div className="flex items-center justify-center gap-2">
          <div className="text-3xl font-bold">{word.text}</div>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            title="发音"
            onClick={() => window.ttsManager.speak(word.text, 'auto')}
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            let cls = 'btn btn-outline justify-start';
            if (picked !== null) {
              if (i === correctIndex) cls += ' btn-success';
              else if (i === picked) cls += ' btn-error';
            }
            return (
              <button key={`${opt}-${i}`} className={cls} disabled={picked !== null} onClick={() => choose(i)}>
                {opt}
              </button>
            );
          })}
        </div>
        <ExampleBlock word={word} />
      </div>
    </div>
  );
}

export function ReviewView({
  wordbook, loaded, updateWord,
}: {
  wordbook: WordEntry[];
  loaded: boolean;
  updateWord: (text: string, mutate: WordMutator) => Promise<void>;
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null); // null = 还没初始化
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // 必须等存储真的读完再建队列：加载完成前 wordbook 是空数组，
  // 这时候建出来的空队列会让页面直接显示"本轮复习完成"，即使其实有待复习的词。
  // 之后也不跟着 wordbook 变化重建——每答一题都会写回 srs，重建会打乱正在进行的队列。
  useEffect(() => {
    if (loaded && queue === null) {
      setQueue(buildDueQueue(wordbook));
      setIndex(0);
    }
  }, [loaded, wordbook, queue]);

  const current = queue && index < queue.length ? queue[index] : null;
  const word = current ? wordbook.find((w) => w.text.toLowerCase() === current.key) : null;

  // 队列生成之后、答到这题之前词被删了：跳过
  useEffect(() => {
    if (current && !word) setIndex((i) => i + 1);
  }, [current, word]);

  const recordResult = useCallback(async (grade: Grade) => {
    if (!current || !word) return;
    const now = new Date();
    const raw = word.srs?.[current.mode];
    const card = raw ? deserializeCard(raw) : createCard(now);
    const next = scheduleNext(card, grade, now);
    await updateWord(word.text, (w) => {
      w.srs = { ...(w.srs || {}), [current.mode]: serializeCard(next) };
    });
    setIndex((i) => i + 1);
    setRevealed(false);
  }, [current, word, updateWord]);

  const total = queue?.length ?? 0;
  const remaining = Math.max(0, total - index);
  const percent = total === 0 ? 0 : Math.round((Math.min(index, total) / total) * 100);
  const done = queue !== null && index >= total;

  // 拼写题判分前不显示语法拆解（会剧透答案）；识别题单词本来就明摆着，随时可显示
  const showSidebar = word && (current?.mode === 'recognition' || revealed);

  return (
    <div className="max-w-4xl mx-auto mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">今日复习</h2>
        <div
          className="radial-progress text-primary"
          // daisyUI 的 radial-progress 靠 CSS 自定义属性驱动，
          // React 的 CSSProperties 类型不认这些自定义属性，需要断言
          style={{
            '--value': done ? 100 : percent,
            '--size': '3.25rem',
            '--thickness': '4px',
          } as CSSProperties}
          role="progressbar"
        >
          <span className="text-xs font-bold">{done ? 0 : remaining}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {done ? (
            <div className="flex flex-col items-center justify-center py-16 text-base-content/50">
              <CheckCircle className="w-16 h-16 mb-4 text-success/60" />
              <h3 className="text-lg font-semibold mb-1 text-base-content/60">本轮复习完成 🎉</h3>
              <button
                className="btn btn-primary btn-sm mt-4 gap-1"
                onClick={() => { setQueue(buildNewQueue(wordbook)); setIndex(0); setRevealed(false); }}
              >
                <Plus className="w-4 h-4" />
                提前学新词
              </button>
            </div>
          ) : word && current?.mode === 'recall' ? (
            <RecallQuestion
              key={`${word.text}-recall-${index}`}
              word={word}
              onGrade={recordResult}
              onRevealChange={setRevealed}
            />
          ) : word ? (
            <RecognitionQuestion
              key={`${word.text}-recognition-${index}`}
              word={word}
              pool={wordbook}
              onGrade={recordResult}
            />
          ) : null}
        </div>

        <aside>{showSidebar && <GrammarSidebar word={word} />}</aside>
      </div>
    </div>
  );
}
