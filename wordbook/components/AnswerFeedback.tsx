/**
 * 统一的答题反馈。
 *
 * 两条刻意的设计：
 * 1. **答错不用红色警告**，用 warning 色 + 中性措辞。学习产品里把错误做成惩罚，
 *    只会让人不想继续；这里的目的是让人看清正确答案，不是让人内疚。
 * 2. **答错必须手动点「继续」**，答对才自动推进。答错时页面上有需要读的内容
 *    （正确答案、混淆说明），自动跳走等于没给人看的机会。
 */
import { useEffect } from 'react';
import { Volume2, ArrowRight, Check } from 'lucide-react';
import type { Familiarity, Word } from '../../types/models.ts';

interface Props {
  correct: boolean;
  /** 用户的答案；答对时通常不必重复展示 */
  userAnswer?: string;
  correctAnswer: string;
  word: Word;
  /** 用户选的那个答案其实属于哪个词——答错时说明混淆在哪 */
  confusedWith?: string;
  /** 答对且需要自评难易度时传（拼写题） */
  onGrade?: (grade: Familiarity) => void;
  /** 需要显式确认才继续时传（答错场景） */
  onContinue?: () => void;
}

const GRADES: [Familiarity, string][] = [
  ['hard', '困难'],
  ['good', '记得'],
  ['easy', '简单'],
];

export function AnswerFeedback({
  correct, userAnswer, correctAnswer, word, confusedWith, onGrade, onContinue,
}: Props) {
  // 回车/空格继续，手不用离开键盘
  useEffect(() => {
    if (!onContinue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onContinue();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onContinue]);

  const example = word.examples[0];

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 ${
        correct
          ? 'border-success/30 bg-success/5'
          : 'border-warning/40 bg-warning/5'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {correct ? (
          <>
            <Check className="w-5 h-5 text-success shrink-0" />
            <span className="font-semibold text-success">答对了</span>
          </>
        ) : (
          <span className="font-semibold text-warning">再看一眼</span>
        )}
      </div>

      {!correct && (
        <div className="flex flex-col gap-1.5 text-sm">
          {userAnswer && (
            <div className="text-base-content/60">
              你的答案：<span className="line-through">{userAnswer}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-base-content/60">正确答案：</span>
            <span className="font-semibold">{correctAnswer}</span>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              title="朗读"
              onClick={() => window.ttsManager.speak(word.word, 'en-US')}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* 只有真的能说清混淆对象时才显示，不硬凑一句解析 */}
          {confusedWith && confusedWith !== word.word && (
            <div className="text-xs text-base-content/50">
              你选的是「{confusedWith}」的意思，两个词容易混。
            </div>
          )}
        </div>
      )}

      {example?.sentence && (
        <div className="text-sm text-base-content/70 leading-relaxed border-t border-base-content/10 pt-2">
          {example.sentence}
          {example.translation && (
            <div className="text-xs text-base-content/45 mt-0.5">{example.translation}</div>
          )}
        </div>
      )}

      {onGrade && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-base-content/50">这个词对你来说：</span>
          <div className="flex gap-2">
            {GRADES.map(([grade, label]) => (
              <button
                key={grade}
                className="btn btn-sm btn-outline flex-1"
                onClick={() => onGrade(grade)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {onContinue && (
        <button className="btn btn-primary btn-sm gap-1 self-end" onClick={onContinue}>
          <ArrowRight className="w-4 h-4" />
          继续
        </button>
      )}
    </div>
  );
}
