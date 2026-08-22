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
import { useEffect, useMemo, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';

// 从 documentElement 上读一个 daisyUI 颜色变量的计算值。
// daisyUI 5 的变量是 --color-xxx 形式，值可能是 oklch()，浏览器能直接用，
// 传给 MUI 也没问题（MUI 只是把它塞进 CSS，不做色值运算）。
function readVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildTheme(mode) {
  return createTheme({
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
  });
}

function currentMode() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function MuiBridge({ children }) {
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
