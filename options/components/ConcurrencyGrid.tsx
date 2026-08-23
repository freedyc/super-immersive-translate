/**
 * 每引擎并发设置，一个引擎一张卡片。
 *
 * 此前是一个全局三档预设（2/5/10），再跟一张**硬编码**的引擎上限表取较小值——
 * 用户既看不到那张表，也改不了它：本机 Ollama 明明能跑更高，却被一个
 * 为公共免费接口设计的数字压着。现在建议值和理由都摊开，值由用户定。
 */
import {
  ENGINE_CONCURRENCY, ENGINE_NAMES, MAX_CONCURRENCY, resolveEngineConcurrency,
} from '../../utils/translation-options.ts';

export function ConcurrencyGrid({ value, onChange }: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const set = (engine: string, raw: string) => {
    const next = { ...value };
    const n = Number(raw);
    // 清空输入框 = 回到建议值，而不是变成 0
    if (!raw || !Number.isFinite(n) || n <= 0) delete next[engine];
    else next[engine] = Math.min(Math.floor(n), MAX_CONCURRENCY);
    onChange(next);
  };

  const customCount = Object.keys(value).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-base-content/60 flex-1">各引擎并发数</span>
        {customCount > 0 && (
          <span className="badge badge-primary badge-sm">{customCount} 项已自定义</span>
        )}
        <button
          className="btn btn-ghost btn-xs"
          disabled={customCount === 0}
          onClick={() => onChange({})}
        >
          恢复建议值
        </button>
      </div>

      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}
      >
        {Object.entries(ENGINE_CONCURRENCY).map(([engine, profile]) => {
          const effective = resolveEngineConcurrency(engine, value);
          const custom = value[engine] !== undefined;
          const locked = profile.hardMax === 1;
          return (
            <div
              key={engine}
              className={`card bg-base-100 border rounded-xl transition-colors ${
                custom ? 'border-primary/40' : 'border-base-300'
              }`}
            >
              <div className="card-body p-3 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold flex-1 truncate">
                    {ENGINE_NAMES[engine] || engine}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={profile.hardMax ?? MAX_CONCURRENCY}
                    className="input input-sm w-16 text-center tabular-nums"
                    placeholder={String(profile.recommended)}
                    disabled={locked}
                    title={locked ? '技术上限，改不了' : `留空即用建议值 ${profile.recommended}`}
                    value={custom ? value[engine] : ''}
                    onChange={(e) => set(engine, e.target.value)}
                  />
                </div>

                <p className="text-[11px] text-base-content/50 leading-snug">
                  {profile.note}
                </p>

                <div className="flex items-center gap-1.5 text-[11px]">
                  {locked ? (
                    <span className="text-base-content/40">技术上限 1，多开只会排队</span>
                  ) : custom ? (
                    <>
                      <span className="badge badge-primary badge-xs">当前 {effective}</span>
                      <span className="text-base-content/40">建议 {profile.recommended}</span>
                    </>
                  ) : (
                    <span className="text-base-content/40">
                      使用建议值 {profile.recommended}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-base-content/40">
        留空即使用建议值。在线 API 调太高会被限流（429）；本机 Ollama 不受此限，
        上限取决于显存和 <code className="text-[11px]">OLLAMA_NUM_PARALLEL</code>，可按机器能力调高。
      </p>
    </div>
  );
}
