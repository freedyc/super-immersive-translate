/**
 * 拼写题：看中文释义拼出英文单词。
 *
 * 例句和音标都等判分之后才显示——它们都包含要默写的那个词（或其读音线索），
 * 提前露出来等于直接给答案。
 */
import { useEffect, useRef, useState } from 'react';
import type { Familiarity, Word } from '../../../types/models.ts';
import { EXERCISE_LABEL, definitionsOf } from '../../lib/questions.ts';
import { AnswerFeedback } from '../AnswerFeedback.tsx';

interface Props {
  word: Word;
  onGrade: (grade: Familiarity) => void;
  /** 判分后通知外层——语法拆解侧栏同样要等判分才能露出 */
  onReveal?: (revealed: boolean) => void;
}

export function SpellingQuestion({ word, onGrade, onReveal }: Props) {
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<'correct' | 'wrong' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAnswer('');
    setState(null);
    onReveal?.(false);
    inputRef.current?.focus();
  }, [word.id, onReveal]);

  const check = () => {
    if (state) return;
    const ok = answer.trim().toLowerCase() === word.word.toLowerCase();
    setState(ok ? 'correct' : 'wrong');
    onReveal?.(true);
  };

  const meanings = definitionsOf(word);
  const phonetic = word.phonetic || word.phoneticUS || word.phoneticUK;

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl mb-4">
      <div className="card-body gap-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 text-center">
          {EXERCISE_LABEL.spelling}
        </span>

        <div className="flex flex-col items-center gap-1">
          <div className="text-xl text-base-content/80 leading-relaxed text-center break-words">
            {meanings[0] || '???'}
          </div>
          {meanings.length > 1 && (
            <div className="text-sm text-base-content/45 text-center break-words">
              {meanings.slice(1).join(' / ')}
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          className="input w-full text-center text-lg"
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

        {!state && (
          <button className="btn btn-primary btn-sm self-center" onClick={check}>
            检查
          </button>
        )}

        {state && (
          <>
            {phonetic && (
              <div className="text-center text-sm font-mono text-base-content/50">{phonetic}</div>
            )}
            <AnswerFeedback
              correct={state === 'correct'}
              userAnswer={state === 'wrong' ? (answer.trim() || '（未作答）') : undefined}
              correctAnswer={word.word}
              word={word}
              // 答对时自评难易度；答错固定按 again 处理，只需点继续
              onGrade={state === 'correct' ? onGrade : undefined}
              onContinue={state === 'wrong' ? () => onGrade('again') : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
