import type { CSSProperties } from 'react';
import { Card, CheckField, RangeField } from '../components/Field.tsx';
import { COLORS } from '../../utils/translation-options.ts';
import type { TabProps } from '../lib/types.ts';

export function StyleTab({ settings, update }: Pick<TabProps, 'settings' | 'update'>) {
  const previewStyle: CSSProperties = {
    color: settings.translationColor,
    fontSize: `${settings.translationFontSize}em`,
    lineHeight: settings.translationLineHeight,
    fontWeight: settings.translationBold ? 'bold' : 'normal',
    borderLeftWidth: settings.translationShowBorder ? '2px' : '0',
    borderLeftStyle: 'solid',
    borderLeftColor: settings.translationColor,
    paddingLeft: settings.translationShowBorder ? '8px' : '0',
  };

  return (
    <>
      <Card title="译文样式">
        <div>
          <label className="label pb-1">
            <span className="text-xs text-base-content/60">译文颜色</span>
          </label>
          <div className="flex gap-3 items-center mt-1">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`w-6 h-6 rounded-full border border-base-content/10 cursor-pointer transition-transform hover:scale-110 ${
                  settings.translationColor === c ? 'color-dot active' : ''
                }`}
                style={{ background: c }}
                onClick={() => update({ translationColor: c })}
              />
            ))}
          </div>
        </div>

        <RangeField
          label="字号"
          value={settings.translationFontSize}
          min="0.7"
          max="1.4"
          step="0.01"
          format={(v) => `${v}em`}
          onChange={(v) => update({ translationFontSize: v }, { debounce: true })}
        />

        <RangeField
          label="行高"
          value={settings.translationLineHeight}
          min="1.2"
          max="2.4"
          step="0.1"
          onChange={(v) => update({ translationLineHeight: v }, { debounce: true })}
        />

        <div className="flex gap-6 flex-wrap">
          <CheckField
            label="译文加粗"
            checked={settings.translationBold}
            onChange={(v) => update({ translationBold: v })}
          />
          <CheckField
            label="显示左侧竖线"
            checked={settings.translationShowBorder}
            onChange={(v) => update({ translationShowBorder: v })}
          />
        </div>
      </Card>

      <Card title="预览">
        <div className="p-4 bg-base-200 rounded-lg">
          <p className="text-sm text-base-content/70 mb-2">
            The quick brown fox jumps over the lazy dog.
          </p>
          <p style={previewStyle}>敏捷的棕色狐狸跳过了那只懒狗。</p>
        </div>
      </Card>
    </>
  );
}
