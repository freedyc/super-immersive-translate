/**
 * 复习流程（沉浸式），由「今日学习」启动。
 *
 * 两条不能破坏的约束：
 * 1. 拼写题的例句和语法拆解都要等判分之后才显示——它们都包含要默写的那个词，
 *    提前显示等于直接给答案。
 * 2. 答错不用红色警告，用温和措辞。学习产品里把错误做成惩罚只会让人不想继续。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, X, CheckCircle2 } from 'lucide-react';
import { TaggedSentence } from '../components/TaggedSentence.tsx';
import { ROLE_ORDER, shuffled } from '../lib/mastery.ts';
import { createRecord, isExerciseDue, recordAnswer } from '../../utils/learning/srsService.ts';
import type {
  ExerciseType, Familiarity, LearningRecord, Word,
} from '../../types/models.ts';

/** 本批实现的两种题型；另外两种（zh2en / listening）在下一批加入 */
const REVIEW_EXERCISES: ExerciseType[] = ['en2zh', 'spelling'];

interface QueueItem {
  word: Word;
  exercise: ExerciseType;
}

interface Props {
  words: Word[];
  allWords: Word[];
  records: Map<string, LearningRecord>;
  updateRecord: (
    wordId: string,
    mutate: (prev: LearningRecord | undefined) => LearningRecord,
  ) => Promise<void>;
  onExit: () => void;
  onFinish: () => void;
}

function definitionsOf(word: Word): string[] {
  return [...new Set(word.meanings.flatMap((m) => m.definitions).filter(Boolean))];
}

function GrammarSidebar({ word }: { word: Word }) {
  const example = word.examples[0];
  const tokens = example?.tokens;
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

function ExampleBlock({ word }: { word: Word }) {
  const example = word.examples[0];
  if (!example?.sentence) return null;
  return (
    <div>
      <div className="text-sm mt-2">
        <TaggedSentence sentence={example.sentence} tokens={example.tokens} />
      </div>
      {example.translation && (
        <div className="text-xs text-base-content/40 mt-1">{example.translation}</div>
      )}
    </div>
  );
}

/** 拼写题：看释义写单词 */
function SpellingQuestion({
  word, onGrade, onReveal,
}: {
  word: Word;
  onGrade: (grade: Familiarity) => void;
  onReveal: (revealed: boolean) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<'correct' | 'wrong' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setAnswer('');
    setState(null);
    onReveal(false);
    inputRef.current?.focus();
    return () => clearTimeout(timerRef.current);
  }, [word.id, onReveal]);

  const check = () => {
    if (state) return;
    const ok = answer.trim().toLowerCase() === word.word.toLowerCase();
    setState(ok ? 'correct' : 'wrong');
    onReveal(true); // 判完分才允许露出例句/语法拆解
    if (!ok) timerRef.current = setTimeout(() => onGrade('again'), 1200);
  };

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 text-center">
          根据释义拼写
        </span>
        <div className="text-xl text-base-content/80 leading-relaxed text-center">
          {definitionsOf(word)[0] || '???'}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="input input-bordered text-center text-lg"
          placeholder="输入英文单词..."
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={answer}
          disabled={!!state}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
        />

        <div className={`quiz-feedback text-base font-semibold min-h-6 text-center ${state || ''}`}>
          {state === 'correct' && '✅ 正确！选一个难易度：'}
          {state === 'wrong' && `再看一眼：${word.word}`}
        </div>

        {state === 'correct' && (
          <div className="flex justify-center gap-2">
            {([['hard', '困难'], ['good', '记得'], ['easy', '简单']] as const).map(([g, label]) => (
              <button key={g} className="btn btn-sm btn-outline" onClick={() => onGrade(g)}>
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

/** 识别题：看单词选中文释义 */
function RecognitionQuestion({
  word, pool, onGrade,
}: {
  word: Word;
  pool: Word[];
  onGrade: (grade: Familiarity) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { options, correctIndex } = useMemo(() => {
    const correct = definitionsOf(word)[0] || '';
    const distractors = shuffled(
      pool
        .filter((w) => w.id !== word.id)
        .map((w) => definitionsOf(w)[0])
        .filter(Boolean),
    ).slice(0, 3);
    const opts = shuffled([correct, ...distractors].filter(Boolean));
    return { options: opts, correctIndex: opts.indexOf(correct) };
  }, [word.id, pool]);

  useEffect(() => {
    setPicked(null);
    startedAt.current = Date.now();
    return () => clearTimeout(timerRef.current);
  }, [word.id]);

  const choose = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    const elapsed = Date.now() - startedAt.current;
    const correct = i === correctIndex;
    // 答对时按反应快慢推导难易度：越快说明记得越牢
    const grade: Familiarity = !correct
      ? 'again' : elapsed < 2000 ? 'easy' : elapsed < 5000 ? 'good' : 'hard';
    timerRef.current = setTimeout(() => onGrade(grade), correct ? 700 : 1200);
  };

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <div className="flex items-center justify-center gap-2">
          <div className="text-3xl font-bold">{word.word}</div>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            title="发音"
            onClick={() => window.ttsManager.speak(word.word, 'en-US')}
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            let cls = 'btn btn-outline justify-start';
            if (picked !== null) {
              if (i === correctIndex) cls += ' btn-success';
              else if (i === picked) cls += ' btn-warning'; // 温和提示，不用 error 红
            }
            return (
              <button key={`${opt}-${i}`} className={cls} disabled={picked !== null} onClick={() => choose(i)}>
                {opt}
              </button>
            );
          })}
        </div>
        {picked !== null && <ExampleBlock word={word} />}
      </div>
    </div>
  );
}

export function ReviewView({
  words, allWords, records, updateRecord, onExit, onFinish,
}: Props) {
  // 进入时定一次队列：每答一题都会写回记录，跟着 records 重建会让队列在答题中途被打乱
  const [queue] = useState<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    for (const word of words) {
      const record = records.get(word.id);
      for (const exercise of REVIEW_EXERCISES) {
        // 没有释义的词出不了这两种题，跳过而不是渲染一道答不了的题
        if (definitionsOf(word).length === 0) continue;
        if (isExerciseDue(record, exercise)) items.push({ word, exercise });
      }
    }
    return shuffled(items);
  });

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const done = index >= queue.length;
  const current = done ? null : queue[index];

  useEffect(() => { setRevealed(false); }, [index]);

  const grade = useCallback(async (g: Familiarity) => {
    if (!current) return;
    const { word, exercise } = current;
    await updateRecord(word.id, (prev) =>
      recordAnswer(prev ?? createRecord(word.id), exercise, g));
    setIndex((i) => i + 1);
  }, [current, updateRecord]);

  if (done) {
    return (
      <div className="fixed inset-0 z-30 bg-base-200 flex flex-col items-center justify-center gap-4 px-6">
        <CheckCircle2 className="w-16 h-16 text-success/60" />
        <h2 className="text-xl font-semibold">复习完成</h2>
        <p className="text-sm text-base-content/60">共复习 {queue.length} 题</p>
        <button className="btn btn-primary" onClick={onFinish}>继续</button>
      </div>
    );
  }

  const showSidebar = current && (current.exercise === 'en2zh' || revealed);

  return (
    <div className="fixed inset-0 z-30 bg-base-200 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 bg-base-100 border-b border-base-200 shrink-0">
        <button className="btn btn-ghost btn-sm btn-circle" title="退出复习" onClick={onExit}>
          <X className="w-4 h-4" />
        </button>
        <progress className="progress progress-warning flex-1 h-2" value={index} max={queue.length} />
        <span className="text-sm text-base-content/60 tabular-nums whitespace-nowrap">
          {index + 1} / {queue.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {current!.exercise === 'spelling' ? (
              <SpellingQuestion
                key={`${current!.word.id}-spelling-${index}`}
                word={current!.word}
                onGrade={grade}
                onReveal={setRevealed}
              />
            ) : (
              <RecognitionQuestion
                key={`${current!.word.id}-en2zh-${index}`}
                word={current!.word}
                pool={allWords}
                onGrade={grade}
              />
            )}
          </div>
          <aside>{showSidebar && <GrammarSidebar word={current!.word} />}</aside>
        </div>
      </div>
    </div>
  );
}
