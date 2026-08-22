import { Card, SelectField, CheckField, EngineFields } from '../components/Field.jsx';
import {
  ENGINES, LANGS, DISPLAY_MODES, CONCURRENCY, SELECTION_MODES,
  SELECTION_ENGINE_OPTIONS, ENGINE_FIELDS, AI_ENGINES,
} from '../lib/constants.js';

export function GeneralTab({ settings, update }) {
  const selEngines = settings.selectionEngines || [];

  const toggleSelectionEngine = (value, checked) => {
    const next = checked ? [...selEngines, value] : selEngines.filter((x) => x !== value);
    // 一个都不选会让划词面板没有引擎可用，兜底保留 google
    update({ selectionEngines: next.length > 0 ? next : ['google'] });
  };

  return (
    <>
      <Card title="翻译">
        <SelectField
          label="翻译引擎"
          value={settings.engine}
          options={ENGINES}
          onChange={(v) => update({ engine: v })}
        />

        <EngineFields fields={ENGINE_FIELDS[settings.engine]} settings={settings} update={update} />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="目标语言"
            value={settings.targetLang}
            options={LANGS}
            onChange={(v) => update({ targetLang: v })}
          />
          <SelectField
            label="显示模式"
            value={settings.displayMode}
            options={DISPLAY_MODES}
            onChange={(v) => update({ displayMode: v })}
          />
        </div>

        <SelectField
          label="全页翻译并发"
          hint="并发越高翻译越快，但 Google 等免费接口可能因请求过多被限流 (429)。本地 WebLLM 始终单路。"
          value={settings.translateConcurrency}
          options={CONCURRENCY}
          onChange={(v) => update({ translateConcurrency: v })}
        />

        <div className="flex gap-6 flex-wrap">
          <CheckField
            label="鼠标悬停翻译段落"
            checked={settings.hoverTranslate}
            onChange={(v) => update({ hoverTranslate: v })}
          />
          <CheckField
            label="输入框实时翻译"
            checked={settings.inputTranslate}
            onChange={(v) => update({ inputTranslate: v })}
          />
          <CheckField
            label="视频/会议双语字幕"
            checked={settings.subtitleTranslate}
            onChange={(v) => update({ subtitleTranslate: v })}
          />
        </div>
      </Card>

      <Card title="AI 引擎提示词">
        <div className="form-control">
          <label className="label pb-1">
            <span className="label-text text-xs text-base-content/60">自定义翻译提示词</span>
          </label>
          <textarea
            className="textarea textarea-bordered textarea-sm w-full font-mono text-xs"
            rows={3}
            value={settings.aiPrompt ?? ''}
            onChange={(e) => update({ aiPrompt: e.target.value }, { debounce: true })}
          />
          <p className="text-xs text-base-content/40 mt-1">
            仅对 AI 类引擎（{AI_ENGINES.join(' / ')}）生效。
            <code>{'{targetLang}'}</code> 会被替换成目标语言；
            分隔符 <code>▁▁▁</code> 的说明必须保留，否则批量翻译的结果会对不上原文。
          </p>
        </div>
      </Card>

      <Card title="划词翻译">
        <SelectField
          label="划词模式"
          value={settings.selectionMode}
          options={SELECTION_MODES}
          onChange={(v) => update({ selectionMode: v })}
        />

        <div className="form-control">
          <label className="label pb-1">
            <span className="label-text text-xs text-base-content/60">划词引擎 (多选)</span>
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1">
            {SELECTION_ENGINE_OPTIONS.map(([v, label]) => (
              <label key={v} className="cursor-pointer flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-xs"
                  checked={selEngines.includes(v)}
                  onChange={(e) => toggleSelectionEngine(v, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
