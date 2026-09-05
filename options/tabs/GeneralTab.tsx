import { Card, SelectField, CheckField, EngineFields } from '../components/Field.tsx';
import {
  ENGINES, LANGS, DISPLAY_MODES, SELECTION_MODES,
  SELECTION_ENGINE_OPTIONS, ENGINE_FIELDS, AI_ENGINES,
} from '../../utils/translation-options.ts';
import type { TabProps } from '../lib/types.ts';
import { ConcurrencyGrid } from '../components/ConcurrencyGrid.tsx';
import { OllamaSetupCard } from '../components/OllamaSetupCard.tsx';

export function GeneralTab({ settings, update }: Pick<TabProps, 'settings' | 'update'>) {
  const selEngines = settings.selectionEngines || [];
  // Ollama 可能被三个地方任意一个用上：默认引擎、全页专用引擎、划词并行引擎。
  // 只在 engine === 'ollama' 时才提示，会漏掉「划词用 Google、整页用 Ollama」
  // 这种很常见的组合——那种情况下用户连模型名都没地方填。
  const usesOllama = settings.engine === 'ollama'
    || settings.fullPageEngine === 'ollama'
    || selEngines.includes('ollama');

  const toggleSelectionEngine = (value: string, checked: boolean) => {
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

        {usesOllama && (
          <div className="bg-base-200/50 border border-base-200 rounded-xl p-3">
            <OllamaSetupCard settings={settings} update={update} />
          </div>
        )}

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
          label="全页翻译引擎"
          hint="留空 = 跟随上面的默认引擎。划词要即时响应、整页更在意不限量不花钱，两者的最优选择常常不是同一个。站点专属引擎优先级更高。"
          value={settings.fullPageEngine || ''}
          options={[['', '跟随默认引擎'], ...ENGINES]}
          onChange={(v) => update({ fullPageEngine: v })}
        />

        <ConcurrencyGrid
          value={(settings.engineConcurrency as Record<string, number>) || {}}
          onChange={(v) => update({ engineConcurrency: v })}
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
        <div>
          <label className="label pb-1">
            <span className="text-xs text-base-content/60">自定义翻译提示词</span>
          </label>
          <textarea
            className="textarea textarea-sm w-full font-mono text-xs"
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

        <div>
          <label className="label pb-1">
            <span className="text-xs text-base-content/60">划词引擎 (多选)</span>
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
