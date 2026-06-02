// utils/theme.js — 全局统一、可扩展多主题
import { createIcons, icons } from 'lucide';

// === 主题清单：扩展多主题的单一数据源 ===
// 新增主题：把名字加到 AVAILABLE_THEMES，并在 styles/theme.css 的 themes: 行启用同名主题。
export const AVAILABLE_THEMES = ['light', 'dark'];

// system 模式解析到的明/暗主题
export const DEFAULT_LIGHT = 'light';
export const DEFAULT_DARK = 'dark';

// 可选：每主题中文名 + Lucide 图标；未列出的主题自动回退，无需改代码即可显示
export const THEME_META = {
  light: { label: '浅色', icon: 'sun' },
  dark: { label: '深色', icon: 'moon' },
};

const STORAGE_KEY = 'theme';
const SYSTEM_VALUE = 'system';
const mql = window.matchMedia('(prefers-color-scheme: dark)');
const controls = new Set();

function metaFor(name) {
  return THEME_META[name] || {
    label: name.charAt(0).toUpperCase() + name.slice(1),
    icon: 'palette',
  };
}

export function resolveTheme(value) {
  if (value === SYSTEM_VALUE) return mql.matches ? DEFAULT_DARK : DEFAULT_LIGHT;
  return AVAILABLE_THEMES.includes(value) ? value : DEFAULT_LIGHT;
}

async function getStoredTheme() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: SYSTEM_VALUE });
  return data[STORAGE_KEY];
}

function applyResolved(value) {
  document.documentElement.setAttribute('data-theme', resolveTheme(value));
}

export async function applyTheme() {
  applyResolved(await getStoredTheme());
}

export async function setTheme(value) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: value });
  // 由下面的 storage.onChanged 统一应用（本页也会触发）
}

function syncControls(value) {
  controls.forEach((sel) => { sel.value = value; });
}

// 系统明暗变化：仅 system 模式时重新应用
mql.addEventListener('change', async () => {
  if ((await getStoredTheme()) === SYSTEM_VALUE) applyResolved(SYSTEM_VALUE);
});

// 跨页面/跨标签实时同步
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes[STORAGE_KEY]) return;
  const value = changes[STORAGE_KEY].newValue;
  applyResolved(value);
  syncControls(value);
});

// 在 container 内渲染一个 daisyUI 下拉主题选择器
export async function initThemeControl(container) {
  const current = await getStoredTheme();
  const opts = [`<option value="${SYSTEM_VALUE}">跟随系统</option>`]
    .concat(AVAILABLE_THEMES.map((n) => `<option value="${n}">${metaFor(n).label}</option>`))
    .join('');
  container.innerHTML = `
    <label class="flex items-center gap-1.5" title="主题">
      <i data-lucide="palette" class="w-4 h-4"></i>
      <select class="select select-bordered select-xs" aria-label="主题">${opts}</select>
    </label>`;
  const select = container.querySelector('select');
  select.value = current;
  select.addEventListener('change', () => setTheme(select.value));
  controls.add(select);
  createIcons({ icons });
  return select;
}
