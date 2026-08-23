/**
 * 选择题，同时承载两个方向：
 *   en2zh 看英文单词选中文释义
 *   zh2en 看中文释义选英文单词
 *
 * 答对按反应快慢推导难易度（越快说明记得越牢），答错一律 again。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { Familiarity, Word } from '../../../types/models.ts';
import { buildChoices, EXERCISE_LABEL, primaryDefinition } from '../../lib/questions.ts';
import { AnswerFeedback } from '../AnswerFeedback.tsx';

interface Props {
  word: Word;
  pool: Word[];
  mode: 'en2zh' | 'zh2en';
  onGrade: (grade: Familiarity) => void;
}

export function ChoiceQuestion({ word, pool, mode, onGrade }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { options, correctIndex, ownerByOption } = useMemo(
    () => buildChoices(word, pool, mode === 'en2zh' ? 'meaning' : 'word'),
    [word.id, pool, mode],
  );

  useEffect(() => {
    setPicked(null);
    startedAt.current = Date.now();
    return () => clearTimeout(timerRef.current);
  }, [word.id, mode]);

  const answered = picked !== null;
  const isCorrect = picked === correctIndex;

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const elapsed = Date.now() - startedAt.current;
    if (i !== correctIndex) return; // 答错时等用户点「继续」，不自动跳走

    const grade: Familiarity = elapsed < 2000 ? 'easy' : elapsed < 5000 ? 'good' : 'hard';
    // 答对没什么要读的，短暂停顿后自动推进，保持节奏
    timerRef.current = setTimeout(() => onGrade(grade), 700);
  };

  // 数字键 1–4 选项
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  const prompt = mode === 'en2zh' ? word.word : primaryDefinition(word);
  const phonetic = word.phonetic || word.phoneticUS || word.phoneticUK;

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 text-center">
          {EXERCISE_LABEL[mode]}
        </span>

        <div className="flex flex-col items-center gap-1">
          <div className={`font-bold text-center break-words ${
            mode === 'en2zh' ? 'text-3xl' : 'text-xl text-base-content/80'
          }`}>
            {prompt}
          </div>
          {mode === 'en2zh' && (
            <div className="flex items-center gap-2">
              {phonetic && <span className="text-sm font-mono text-base-content/50">{phonetic}</span>}
              <button
                className="btn btn-ghost btn-sm btn-circle"
                title="发音"
                onClick={() => window.ttsManager.speak(word.word, 'en-US')}
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            let cls = 'btn btn-outline justify-start gap-3';
            if (answered) {
              if (i === correctIndex) cls += ' btn-success';
              else if (i === picked) cls += ' btn-warning'; // 温和提示，不用 error 红
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
            correctAnswer={options[correctIndex]}
            word={word}
            confusedWith={isCorrect ? undefined : ownerByOption.get(options[picked!])}
            onContinue={isCorrect ? undefined : () => onGrade('again')}
          />
        )}
      </div>
    </div>
  );
}
