/**
 * 听音辨词：播放发音，从选项里选出对应的单词。
 *
 * 发音必须是显眼且可重复点击的——这道题没听清就完全没法答，
 * 把播放按钮做小或只在进入时自动播一次都会让人卡住。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import type { Familiarity, Word } from '../../../types/models.ts';
import { buildChoices, EXERCISE_LABEL } from '../../lib/questions.ts';
import { AnswerFeedback } from '../AnswerFeedback.tsx';

interface Props {
  word: Word;
  pool: Word[];
  onGrade: (grade: Familiarity) => void;
}

export function ListeningQuestion({ word, pool, onGrade }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { options, correctIndex, ownerByOption } = useMemo(
    () => buildChoices(word, pool, 'word'),
    [word.id, pool],
  );

  const play = useCallback(async () => {
    setPlaying(true);
    setPlayFailed(false);
    try {
      await window.ttsManager.speak(word.word, 'en-US');
    } catch {
      // 没有可用语音包时给出明确提示，而不是让用户对着一道听不到的题干等
      setPlayFailed(true);
    } finally {
      setPlaying(false);
    }
  }, [word.word]);

  // 进入题目自动播一次，省掉一次点击
  useEffect(() => {
    setPicked(null);
    startedAt.current = Date.now();
    play();
    return () => clearTimeout(timerRef.current);
  }, [word.id, play]);

  const answered = picked !== null;
  const isCorrect = picked === correctIndex;

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const elapsed = Date.now() - startedAt.current;
    if (i !== correctIndex) return;
    // 听力题需要先听完再判断，反应时间天然比看题长，阈值相应放宽
    const grade: Familiarity = elapsed < 3500 ? 'easy' : elapsed < 7000 ? 'good' : 'hard';
    timerRef.current = setTimeout(() => onGrade(grade), 700);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); play(); return; }
      if (answered) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        e.preventDefault();
        choose(n - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 text-center">
          {EXERCISE_LABEL.listening}
        </span>

        <div className="flex flex-col items-center gap-2 py-2">
          <button
            className="btn btn-primary btn-lg btn-circle shadow-md"
            title="重新播放（R）"
            disabled={playing}
            onClick={play}
          >
            {playing
              ? <Loader2 className="w-6 h-6 animate-spin" />
              : <Volume2 className="w-6 h-6" />}
          </button>
          <span className="text-xs text-base-content/50">
            {playing ? '播放中…' : '点击重新播放'} · <kbd className="kbd kbd-xs">R</kbd>
          </span>
          {playFailed && (
            <span className="text-xs text-warning">
              当前浏览器没有可用的英语语音，可在设置里改用 OpenAI 朗读
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            let cls = 'btn btn-outline justify-start gap-3';
            if (answered) {
              if (i === correctIndex) cls += ' btn-success';
              else if (i === picked) cls += ' btn-warning';
            }
            return (
              <button
                key={`${opt}-${i}`}
                className={cls}
                disabled={answered}
                onClick={() => choose(i)}
              >
                <kbd className="kbd kbd-xs opacity-50">{i + 1}</kbd>
                <span className="flex-1 text-left">{opt}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <AnswerFeedback
            correct={isCorrect}
            userAnswer={isCorrect ? undefined : options[picked!]}
            correctAnswer={word.word}
            word={word}
            confusedWith={isCorrect ? undefined : ownerByOption.get(options[picked!])}
            onContinue={isCorrect ? undefined : () => onGrade('again')}
          />
        )}
      </div>
    </div>
  );
}
