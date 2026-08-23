/**
 * 每引擎并发设置，一个引擎一张卡片。
 *
 * 此前是一个全局三档预设（2/5/10），再跟一张**硬编码**的引擎上限表取较小值——
 * 用户既看不到那张表，也改不了它：本机 Ollama 明明能跑更高，却被一个
 * 为公共免费接口设计的数字压着。现在建议值和理由都摊开，值由用户定。
 *
 * 这里用 MUI Card 而不是 daisyUI：每张卡要同时放标题、数字输入、说明、
 * 当前生效值四层信息，MUI 的 Card/CardContent 自带的层次和间距规范
 * 比手搭 div 更稳，数字输入也直接用 TextField 的尺寸体系。
 */
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ flex: 1, opacity: 0.7 }}>
          各引擎并发数
        </Typography>
        {customCount > 0 && (
          <Chip size="small" variant="outlined" label={`${customCount} 项已自定义`} />
        )}
        <Button size="small" disabled={customCount === 0} onClick={() => onChange({})}>
          恢复建议值
        </Button>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        {Object.entries(ENGINE_CONCURRENCY).map(([engine, profile]) => {
          const effective = resolveEngineConcurrency(engine, value);
          const custom = value[engine] !== undefined;
          const locked = profile.hardMax === 1;
          return (
            <Card key={engine} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
                    {ENGINE_NAMES[engine] || engine}
                  </Typography>
                  {custom && <Chip size="small" color="primary" label="自定义" />}
                </Box>

                <Tooltip title={locked ? '这是技术上限，改不了' : `建议 ${profile.recommended}，留空即用建议值`}>
                  <TextField
                    type="number"
                    size="small"
                    fullWidth
                    disabled={locked}
                    placeholder={String(profile.recommended)}
                    value={custom ? value[engine] : ''}
                    onChange={(e) => set(engine, e.target.value)}
                    slotProps={{
                      htmlInput: { min: 1, max: profile.hardMax ?? MAX_CONCURRENCY },
                    }}
                  />
                </Tooltip>

                <Typography
                  variant="caption"
                  component="p"
                  sx={{ mt: 1, opacity: 0.55, lineHeight: 1.45 }}
                >
                  {profile.note}
                </Typography>
                <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.4 }}>
                  {locked
                    ? '技术上限 1，多开只会排队'
                    : custom
                      ? `当前 ${effective} · 建议 ${profile.recommended}`
                      : `使用建议值 ${profile.recommended}`}
                </Typography>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      <Typography variant="caption" sx={{ opacity: 0.5 }}>
        在线 API 调太高会被限流（429）；本机 Ollama 不受此限，上限取决于显存和{' '}
        <code>OLLAMA_NUM_PARALLEL</code>，可按机器能力调高。
      </Typography>
    </Box>
  );
}
