/**
 * 设置页复用的表单原子组件。都是 daisyUI 的 className，不引 MUI——
 * 这些是最基础的表单控件，daisyUI 已经覆盖，没必要为它们多一层组件库。
 */

export function Card({ title, children }) {
  return (
    <div className="card bg-base-100 shadow-sm mb-4 rounded-xl">
      <div className="card-body p-5 gap-4">
        {title && <h3 className="font-semibold text-sm">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function SelectField({ label, hint, value, options, onChange }) {
  return (
    <div className="form-control">
      {label && (
        <label className="label pb-1">
          <span className="label-text text-xs text-base-content/60">{label}</span>
        </label>
      )}
      <select
        className="select select-bordered select-sm w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p className="text-xs text-base-content/40 mt-1">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, value, type = 'text', placeholder, onChange }) {
  return (
    <div className="form-control">
      {label && (
        <label className="label pb-1">
          <span className="label-text text-xs text-base-content/60">{label}</span>
        </label>
      )}
      <input
        type={type}
        className="input input-bordered input-sm w-full"
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-base-content/40 mt-1">{hint}</p>}
    </div>
  );
}

export function CheckField({ label, checked, onChange }) {
  return (
    <label className="cursor-pointer flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="checkbox checkbox-primary checkbox-sm"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function RangeField({ label, value, min, max, step, format, onChange }) {
  return (
    <div className="form-control">
      <label className="label pb-1">
        <span className="label-text text-xs text-base-content/60">{label}</span>
        <span className="label-text-alt text-xs font-mono">{format ? format(value) : value}</span>
      </label>
      <input
        type="range"
        className="range range-primary range-xs"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** 引擎配置字段组：按当前引擎渲染它需要的 key/模型/地址 */
export function EngineFields({ fields, settings, update }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="bg-base-200/50 border border-base-200 rounded-xl p-3 flex flex-col gap-3">
      {fields.map((f) => (
        <TextField
          key={f.key}
          label={f.label}
          type={f.type}
          hint={f.hint}
          placeholder={f.placeholder}
          value={settings[f.key]}
          onChange={(v) => update({ [f.key]: v }, { debounce: true })}
        />
      ))}
    </div>
  );
}
