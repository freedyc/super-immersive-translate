/**
 * 学习设置：每日额度和启用的题型。
 *
 * 这页只管「今日学习」怎么排队，不碰翻译引擎那些设置——那些在扩展的选项页里。
 */
import { Info } from 'lucide-react';
import { EXERCISE_LABEL } from '../lib/questions.ts';
import type { ExerciseType, StudyConfig } from '../../types/models.ts';

interface Props {
  config: StudyConfig;
  allExercises: ExerciseType[];
  onChange: (patch: Partial<StudyConfig>) => void;
}

const EXERCISE_HINT: Record<ExerciseType, string> = {
  en2zh: '看英文单词，从四个释义里选对的',
  zh2en: '看中文释义，从四个单词里选对的',
  listening: '听发音选单词，需要浏览器有英语语音',
  spelling: '看释义默写单词，最费时也最扎实',
};

/**
 * 滑杆一行：标题 + 当前值 + 提示。
 *
 * 不用 daisyUI 的 form-control / label-text —— 那是 daisyUI 4 的类，
 * 5 里已经删掉了，写上去等于什么样式都没有。
 */
function SliderRow({ label, value, hint, children }: {
  label: string;
  value: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-base-content/60 tabular-nums">{value}</span>
      </div>
      {children}
      <span className="text-xs text-base-content/45">{hint}</span>
    </div>
  );
}

export function SettingsView({ config, allExercises, onChange }: Props) {
  const toggle = (ex: ExerciseType) => {
    const on = config.enabledExercises.includes(ex);
    // 全关会让今日队列永远空着，最后一项不允许关掉
    if (on && config.enabledExercises.length === 1) return;
    onChange({
      enabledExercises: on
        ? config.enabledExercises.filter((e) => e !== ex)
        : [...config.enabledExercises, ex],
    });
  };

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body gap-4">
          <h2 className="card-title text-base">每日额度</h2>

          <SliderRow
            label="每天学习新词上限"
            value={`${config.dailyNewLimit} 个`}
            hint="设为 0 就只复习不学新词"
          >
            <input
              type="range"
              className="range range-primary range-sm w-full"
              min={0}
              max={50}
              step={5}
              value={config.dailyNewLimit}
              onChange={(e) => onChange({ dailyNewLimit: Number(e.target.value) })}
            />
          </SliderRow>

          <SliderRow
            label="每天复习上限"
            value={config.dailyReviewLimit === 0 ? '不限' : `${config.dailyReviewLimit} 个`}
            hint="建议保持「不限」：到期的词压着不复习只会越积越多"
          >
            <input
              type="range"
              className="range range-warning range-sm w-full"
              min={0}
              max={100}
              step={10}
              value={config.dailyReviewLimit}
              onChange={(e) => onChange({ dailyReviewLimit: Number(e.target.value) })}
            />
          </SliderRow>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">启用的题型</h2>
          <div className="flex items-start gap-2 text-xs text-base-content/50">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>每种题型的复习进度是分开记的，关掉一种不会丢已有进度。</span>
          </div>

          {allExercises.map((ex) => {
            const on = config.enabledExercises.includes(ex);
            const last = on && config.enabledExercises.length === 1;
            return (
              <label
                key={ex}
                className={`flex items-center gap-3 py-2 border-b border-base-200 last:border-0 ${
                  last ? 'cursor-not-allowed' : 'cursor-pointer'
                }`}
                title={last ? '至少要保留一种题型' : undefined}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={on}
                  disabled={last}
                  onChange={() => toggle(ex)}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{EXERCISE_LABEL[ex]}</div>
                  <div className="text-xs text-base-content/50">{EXERCISE_HINT[ex]}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
