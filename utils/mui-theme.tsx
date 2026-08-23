/**
 * MUI 主题桥 —— 让 MUI 组件跟已有的 daisyUI 视觉语言保持一致。
 *
 * 背景：MUI 默认自带 CssBaseline 全局重置 + 自己的一套配色，跟 daisyUI 正面冲突
 * （双重重置、两套色板各画各的）。所以这里的做法是：
 *   1. 绝不引入 <CssBaseline />，全局重置继续由 Tailwind/daisyUI 负责；
 *   2. MUI 的调色板从 daisyUI 当前主题的 CSS 变量里读，颜色跟着 data-theme 走；
 *   3. 只在 daisyUI 纯 CSS 搞不定的复杂交互组件上用 MUI（虚拟列表、Autocomplete、
 *      Dialog 焦点管理等），普通按钮/卡片/徽章继续用 daisyUI 的 className。
 *
 * 用法：页面根组件包一层 <MuiBridge>{children}</MuiBridge> 即可，
 * 切主题时会自动跟着重算（监听 data-theme 变化）。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';

/**
 * daisyUI 5 的颜色变量是 oklch() 格式，而 MUI **会解析**颜色去推算 hover/contrast/alpha
 * 变体，它的解析器不认 oklch —— 直接把变量值塞给 createTheme 会抛
 * "MUI error #9: unsupported color format"，整个页面白屏。
 * 所以这里先把 oklch 转成 sRGB 十六进制再交给 MUI。
 *
 * 换算走标准的 OKLab → 线性 sRGB → sRGB 路径；用已知参照验证过：
 * oklch(62.8% .2577 29.23) → #ff0000，oklch(100% 0 0) → #ffffff。
 */
function oklchToHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];

  return `#${lin.map((v) => {
    const enc = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, enc)) * 255).toString(16).padStart(2, '0');
  }).join('')}`;
}

/** 把 CSS 颜色值转成 MUI 能吃的格式。非 oklch 的（hex/rgb/hsl）原样返回，MUI 自己认得。 */
function normalizeColor(value: string, fallback: string): string {
  if (!value) return fallback;
  const m = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return value;
  const L = m[2] === '%' ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  return oklchToHex(L, parseFloat(m[3]), parseFloat(m[4]));
}

// 读 daisyUI 当前主题的某个颜色变量，转成 MUI 可解析的格式
function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return normalizeColor(raw, fallback);
  } catch {
    // 出现没见过的颜色格式时宁可退回静态兜底色，也不要让整个页面挂掉
    return fallback;
  }
}

type ThemeMode = 'light' | 'dark';

function buildTheme(mode: ThemeMode) {
  // 主题跟具体色值无关的部分，两条路径共用
  const shared = {
    // 跟 styles/theme.css 里全局设的字体保持一致，避免 MUI 组件字体跟页面其它部分不同
    typography: {
      fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    },
    shape: {
      borderRadius: 12, // 对齐项目统一的 rounded-xl 卡片圆角
    },
    components: {
      // MUI 默认给 Button 加大写字母变换，跟项目其它按钮的观感不一致
      MuiButton: {
        styleOverrides: { root: { textTransform: 'none' } },
      },
    },
  };

  try {
    return createTheme({
      ...shared,
      palette: {
        mode,
        primary: { main: readVar('--color-primary', '#3b82f6') },
        secondary: { main: readVar('--color-secondary', '#f000b8') },
        error: { main: readVar('--color-error', '#ff5861') },
        warning: { main: readVar('--color-warning', '#ffbe00') },
        info: { main: readVar('--color-info', '#00b3f0') },
        success: { main: readVar('--color-success', '#00a96e') },
        background: {
          default: readVar('--color-base-100', mode === 'dark' ? '#1d232a' : '#ffffff'),
          paper: readVar('--color-base-100', mode === 'dark' ? '#1d232a' : '#ffffff'),
        },
        text: {
          primary: readVar('--color-base-content', mode === 'dark' ? '#a6adbb' : '#1f2937'),
        },
      },
    });
  } catch (err) {
    // 配色出任何问题都不该让整个页面白屏：退回 MUI 自带的默认调色板，
    // 只保留亮/暗模式。视觉上会跟 daisyUI 略有出入，但页面是活的。
    console.warn('[MuiBridge] 调色板构建失败，退回默认配色：', err);
    return createTheme({ ...shared, palette: { mode } });
  }
}

function currentMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function MuiBridge({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(currentMode);

  // applyTheme() 是改 documentElement 的 data-theme 属性，这里监听它的变化，
  // 主题一切换就重新从 CSS 变量取色，MUI 组件跟着换肤。
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => buildTheme(mode), [mode]);

  // 注意：这里刻意不放 <CssBaseline />——全局重置归 Tailwind/daisyUI 管
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
