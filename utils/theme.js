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
  controls.forEach((refresh) => refresh(value));
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

// 在 container 内渲染一个图标按钮 + 弹出菜单的主题选择器
export async function initThemeControl(container) {
  const current = await getStoredTheme();
  const items = [{ value: SYSTEM_VALUE, label: '跟随系统', icon: 'monitor' }]
    .concat(AVAILABLE_THEMES.map((n) => ({ value: n, label: metaFor(n).label, icon: metaFor(n).icon })));

  container.innerHTML = `
    <div class="dropdown dropdown-end">
      <div tabindex="0" role="button" class="btn btn-ghost btn-circle btn-sm" title="主题" aria-label="主题">
        <i data-lucide="palette" class="w-4 h-4"></i>
      </div>
      <ul tabindex="0" class="dropdown-content menu bg-base-100 text-base-content rounded-box z-50 w-36 p-2 shadow-lg border border-base-300">
        ${items.map((it) => `
          <li>
            <a data-theme-value="${it.value}" class="flex items-center gap-2">
              <i data-lucide="${it.icon}" class="w-4 h-4 shrink-0"></i>
              <span class="flex-1">${it.label}</span>
              <i data-lucide="check" class="w-4 h-4 shrink-0 theme-check"></i>
            </a>
          </li>`).join('')}
      </ul>
    </div>`;

  const menu = container.querySelector('ul');

  function refresh(value) {
    menu.querySelectorAll('[data-theme-value]').forEach((a) => {
      const active = a.dataset.themeValue === value;
      a.classList.toggle('menu-active', active);
      const check = a.querySelector('.theme-check');
      if (check) check.style.visibility = active ? 'visible' : 'hidden';
    });
  }

  menu.querySelectorAll('[data-theme-value]').forEach((a) => {
    a.addEventListener('click', () => {
      setTheme(a.dataset.themeValue);
      a.blur();
      container.querySelector('[role="button"]')?.blur();
    });
  });

  createIcons({ icons });
  refresh(current); // 在 createIcons 之后，作用于已渲染的 svg
  controls.add(refresh);
  return container;
}
