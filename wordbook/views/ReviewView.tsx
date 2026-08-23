/**
 * 复习流程（沉浸式），由「今日学习」启动。
 *
 * 四种题型统一由 components/questions 下的组件渲染，本文件只负责编排：
 * 建队列、推进、记录结果、结束时给结算页。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ROLE_ORDER, shuffled } from '../lib/mastery.ts';
import { canAsk } from '../lib/questions.ts';
import { ChoiceQuestion } from '../components/questions/ChoiceQuestion.tsx';
import { ListeningQuestion } from '../components/questions/ListeningQuestion.tsx';
import { SpellingQuestion } from '../components/questions/SpellingQuestion.tsx';
import { ResultView, type SessionResult } from './ResultView.tsx';
import type { SessionSnapshot } from '../lib/useStudySession.ts';
import {
  createRecord, describeNextReview, earliestReviewAt, isExerciseDue, recordAnswer,
} from '../../utils/learning/srsService.ts';
import type {
  ExerciseType, Familiarity, LearningRecord, StudyConfig, Word,
} from '../../types/models.ts';

interface QueueItem {
  word: Word;
  exercise: ExerciseType;
}

interface Props {
  words: Word[];
  allWords: Word[];
  records: Map<string, LearningRecord>;
  config: StudyConfig;
  updateRecord: (
    wordId: string,
    mutate: (prev: LearningRecord | undefined) => LearningRecord,
  ) => Promise<void>;
  onExit: () => void;
  onFinish: () => void;
  /** 复习完还有新词要学时的按钮文案 */
  continueLabel?: string;
  /** 上次中断的存档；有则接着答，而不是重新洗牌 */
  resume?: SessionSnapshot | null;
  /** 每答一题回调，用于写存档 */
  onProgress?: (snapshot: Omit<SessionSnapshot, 'date' | 'phase'>) => void;
  /** 本轮全部答完 */
  onSessionEnd?: () => void;
}

function GrammarSidebar({ word }: { word: Word }) {
  const tokens = word.examples[0]?.tokens;
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

export function ReviewView({
  words, allWords, records, config, updateRecord, onExit, onFinish, continueLabel,
  resume, onProgress, onSessionEnd,
}: Props) {
  // 进入时定一次队列：每答一题都会写回记录，跟着 records 重建会让队列在答题中途被打乱
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    if (resume) {
      const byId = new Map(words.map((w) => [w.id, w]));
      // 存档里的词可能已经被删了，跳过而不是让流程崩在一个空词上
      const restored = resume.queue
        .map((q) => {
          const word = byId.get(q.wordId);
          return word && q.exercise ? { word, exercise: q.exercise } : null;
        })
        .filter((x): x is QueueItem => x !== null);
      if (restored.length > 0) return restored;
    }
    const items: QueueItem[] = [];
    for (const word of words) {
      const record = records.get(word.id);
      for (const exercise of config.enabledExercises) {
        // 出不了的题直接跳过，而不是渲染一道答不了的题
        if (!canAsk(word, exercise, allWords)) continue;
        if (isExerciseDue(record, exercise)) items.push({ word, exercise });
      }
    }
    return shuffled(items);
  });

  const [index, setIndex] = useState(resume?.index ?? 0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState(
    () => ({ correct: resume?.correct ?? 0, total: resume?.total ?? 0 }),
  );
  const [missed, setMissed] = useState<Map<string, Word>>(() => {
    if (!resume) return new Map();
    const byId = new Map(words.map((w) => [w.id, w]));
    const out = new Map<string, Word>();
    for (const id of resume.missedIds) {
      const w = byId.get(id);
      if (w) out.set(id, w);
    }
    return out;
  });

  const done = index >= queue.length;
  const current = done ? null : queue[index];

  const grade = useCallback(async (g: Familiarity) => {
    if (!current) return;
    const { word, exercise } = current;

    await updateRecord(word.id, (prev) =>
      recordAnswer(prev ?? createRecord(word.id), exercise, g));

    const wasCorrect = g !== 'again';
    const nextStats = {
      correct: stats.correct + (wasCorrect ? 1 : 0),
      total: stats.total + 1,
    };
    const nextMissed = wasCorrect ? missed : new Map(missed).set(word.id, word);
    const nextIndex = index + 1;

    setStats(nextStats);
    setMissed(nextMissed);
    setRevealed(false);
    setIndex(nextIndex);

    if (nextIndex >= queue.length) {
      onSessionEnd?.();
    } else {
      onProgress?.({
        queue: queue.map((q) => ({ wordId: q.word.id, exercise: q.exercise })),
        index: nextIndex,
        correct: nextStats.correct,
        total: nextStats.total,
        missedIds: [...nextMissed.keys()],
      });
    }
  }, [current, updateRecord, stats, missed, index, queue, onProgress, onSessionEnd]);

  const result: SessionResult = useMemo(() => {
    const missedWords = [...missed.values()];
    // 结算页展示的下次复习时间取本轮涉及词里最早的那个
    const soonest = words
      .map((w) => earliestReviewAt(records.get(w.id)))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return {
      total: stats.total,
      correct: stats.correct,
      missed: missedWords,
      nextReviewText: describeNextReview(soonest),
    };
  }, [stats, missed, words, records]);

  const retryMissed = useCallback(() => {
    const retry: QueueItem[] = [];
    for (const word of missed.values()) {
      for (const exercise of config.enabledExercises) {
        if (canAsk(word, exercise, allWords)) {
          retry.push({ word, exercise });
          break; // 错词重练每个词出一道就够，不必把所有题型再来一遍
        }
      }
    }
    setQueue(shuffled(retry));
    setIndex(0);
    setStats({ correct: 0, total: 0 });
    setMissed(new Map());
  }, [missed, config.enabledExercises, allWords]);

  // 队列本来就空（没有可出的题）时也要销掉存档，否则「继续学习」会一直亮着
  useEffect(() => {
    if (queue.length === 0) onSessionEnd?.();
  }, [queue.length, onSessionEnd]);

  // 队列本来就是空的（比如所有到期词都出不了题）：别把用户困在空白页
  if (queue.length === 0) {
    return (
      <div className="fixed inset-0 z-30 bg-base-200 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h2 className="text-lg font-semibold">暂时没有可复习的题目</h2>
        <p className="text-sm text-base-content/60">
          到期的单词还没有释义，出不了题。可以先去词库里补上释义。
        </p>
        <button className="btn btn-primary" onClick={onFinish}>知道了</button>
      </div>
    );
  }

  if (done) {
    return (
      <ResultView
        result={result}
        onRetryMissed={retryMissed}
        onDone={onFinish}
        continueLabel={continueLabel}
      />
    );
  }

  const { word, exercise } = current!;
  // 拼写题判分前不能露出语法拆解——里面有要默写的那个词
  const showSidebar = exercise !== 'spelling' || revealed;

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
            {exercise === 'spelling' && (
              <SpellingQuestion
                key={`${word.id}-spelling-${index}`}
                word={word}
                onGrade={grade}
                onReveal={setRevealed}
              />
            )}
            {(exercise === 'en2zh' || exercise === 'zh2en') && (
              <ChoiceQuestion
                key={`${word.id}-${exercise}-${index}`}
                word={word}
                pool={allWords}
                mode={exercise}
                onGrade={grade}
              />
            )}
            {exercise === 'listening' && (
              <ListeningQuestion
                key={`${word.id}-listening-${index}`}
                word={word}
                pool={allWords}
                onGrade={grade}
              />
            )}
          </div>
          <aside>{showSidebar && <GrammarSidebar word={word} />}</aside>
        </div>
      </div>
    </div>
  );
}
