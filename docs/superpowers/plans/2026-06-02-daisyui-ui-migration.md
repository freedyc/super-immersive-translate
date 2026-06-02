# daisyUI UI 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 history/pdf/wordbook/options 四个独立页面迁移到 Tailwind 4 + daisyUI 5 + Lucide，并引入全局统一、可扩展多主题的主题系统。

**Architecture:** 先建一层共享主题模块 `utils/theme.js`（主题清单为单一数据源，跟随系统 + 手动覆盖，存 `chrome.storage.sync.theme`，跨页面实时同步）+ 共享 daisyUI 主题启用 CSS；popup/sandbox 接入同一套；再按 history → pdf → wordbook → options 逐页迁移、逐页 `npm run build` 验收。各页仅改 DOM/类名/图标，业务逻辑与元素 ID 契约保持不变。

**Tech Stack:** Vite 8 + @crxjs/vite-plugin、Tailwind CSS 4、daisyUI 5、Lucide、chrome.storage.sync。

> **本仓库无测试框架。** 每个任务的验证步是 `npm run build`（必须成功）+ 加载 `dist/` 为未打包扩展后按清单手动核对。所有 emoji 图标替换为 Lucide。各页 JS 引用的 `getElementById` ID **必须原样保留**，否则功能回退。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `utils/theme.js` | 全局主题逻辑唯一来源：清单、解析、应用、控件 | 新建 |
| `styles/theme.css` | daisyUI 插件 + 启用主题清单（CSS 侧单一来源） | 新建 |
| `popup/popup.{js,css,html}` | 接入共享主题控件 | 改 |
| `sandbox/{sandbox.js,sandbox.css,index.html}` | 接入共享主题 CSS/控件 | 改 |
| `history/{index.html,history.css,history.js}` | daisyUI 重写 | 改 |
| `pdf/{viewer.html,viewer.css,viewer.js}` | daisyUI 重写 | 改 |
| `wordbook/{index.html,wordbook.css,wordbook.js}` | daisyUI 重写 | 改 |
| `options/{options.html,options.css,options.js}` | daisyUI 重写 | 改 |

不动：`content/*.css`、`vite.config.js`、各页业务逻辑与存储 schema（`theme` key 除外）。

---

## Task 1: 共享主题模块 `utils/theme.js`

**Files:**
- Create: `utils/theme.js`

- [ ] **Step 1: 写 `utils/theme.js`**

```js
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
```

- [ ] **Step 2: 验证可解析（构建冒烟）**

Run: `npm run build`
Expected: 构建成功，无报错（此时 theme.js 尚未被任何页面 import，仅验证语法）。

- [ ] **Step 3: Commit**

```bash
git add utils/theme.js
git commit -m "feat(theme): add shared global theme module with extensible theme list"
```

---

## Task 2: 共享 daisyUI 主题 CSS + 跨 import 验证

**Files:**
- Create: `styles/theme.css`
- Modify: `popup/popup.css`, `sandbox/sandbox.css`

- [ ] **Step 1: 写 `styles/theme.css`**

```css
/* styles/theme.css — daisyUI 主题启用清单（CSS 侧单一来源）
   新增主题：在下面 themes: 追加同名主题，并同步 utils/theme.js 的 AVAILABLE_THEMES。 */
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

- [ ] **Step 2: popup.css 改用共享主题**

把 `popup/popup.css` 顶部的 `@plugin "daisyui";` 一行替换为对共享文件的 import：

```css
@import "tailwindcss";
@import "../styles/theme.css";

/* 以下原有自定义样式（滚动条、过渡）保持不变 */
```

- [ ] **Step 3: sandbox.css 改用共享主题**

把 `sandbox/sandbox.css` 顶部 `@plugin "daisyui";` 替换为：

```css
@import "tailwindcss";
@import "../styles/theme.css";

.translation-result { min-height: 120px; }
```

- [ ] **Step 4: 构建验证 `@plugin` 跨 import 是否生效**

Run: `npm run build`
Expected: 构建成功。加载 `dist/`，打开 popup，DevTools 检查 `:root` 是否存在 daisyUI 主题变量（如 `--color-base-100`），明暗均正常。
**若构建报 `@plugin` 不可在被 import 文件中使用：** 退化方案——删除 `styles/theme.css`，改为在每个页面 CSS 内联那一行 `@plugin "daisyui" { themes: light --default, dark --prefersdark; }`；后续各页任务的 CSS 步同样内联。清单权威仍是 `utils/theme.js`。

- [ ] **Step 5: Commit**

```bash
git add styles/theme.css popup/popup.css sandbox/sandbox.css
git commit -m "feat(theme): centralize daisyUI theme enablement; popup/sandbox use it"
```

---

## Task 3: popup 接入统一主题控件

**Files:**
- Modify: `popup/popup.html`（header 主题按钮容器）, `popup/popup.js`（替换二元 toggle）

**保留契约：** `theme` 存储 key 不变；其余设置逻辑不动。

- [ ] **Step 1: popup.html 替换主题按钮为控件容器**

把 header 里 `#themeToggle` 那个 `<button>`（含 `#themeIcon`）替换为：

```html
<div id="themeControl" class="text-primary-content"></div>
```

- [ ] **Step 2: popup.js 接入 theme.js**

在 `popup.js` 顶部 import 区加入：

```js
import { applyTheme, initThemeControl } from '../utils/theme.js';
```

删除 popup.js 中旧的主题逻辑：`updateThemeToggleUI` 函数、`themeToggle` 点击监听、`settings.theme` 的读取应用、saveSettings 里写 `theme` 的那一行（约 popup.js:52,56-57,135-149,214,231 附近）。在 `createIcons({ icons })` 之后加：

```js
await applyTheme();
await initThemeControl(document.getElementById('themeControl'));
```

确保 popup 初始化函数为 `async`（如不是，包一层）。

- [ ] **Step 3: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，打开 popup：
- header 出现主题下拉（跟随系统/浅色/深色）；
- 切「深色」popup 变暗；切「跟随系统」随系统明暗；
- 选择被持久化（重开 popup 保持）。

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat(theme): popup uses unified theme control"
```

---

## Task 4: sandbox 接入统一主题控件

**Files:**
- Modify: `sandbox/index.html`（header 加容器）, `sandbox/sandbox.js`（接入）

- [ ] **Step 1: index.html 加主题容器**

在 sandbox header 合适位置加：

```html
<div id="themeControl"></div>
```

- [ ] **Step 2: sandbox.js 接入**

顶部加：

```js
import { applyTheme, initThemeControl } from '../utils/theme.js';
```

在现有 `createIcons({ icons })` 之后加（必要时把初始化包成 async IIFE）：

```js
await applyTheme();
await initThemeControl(document.getElementById('themeControl'));
```

- [ ] **Step 3: 构建 + 验收**

Run: `npm run build`
Expected: 成功。打开 sandbox 页，主题下拉可用，切换与 popup 联动（在 popup 改主题，sandbox 已开页面实时变化）。

- [ ] **Step 4: Commit**

```bash
git add sandbox/index.html sandbox/sandbox.js
git commit -m "feat(theme): sandbox uses unified theme control"
```

---

## Task 5: 迁移 history 页

**Files:**
- Modify: `history/index.html`, `history/history.css`, `history/history.js`

**保留 ID 契约（history.js 依赖）：** `searchInput`, `countLabel`, `clearBtn`, `historyList`, `emptyState`。
**功能清单：** 搜索过滤、记录计数、清空、列表渲染、空状态。

- [ ] **Step 1: history.css 换为 daisyUI**

整文件替换为：

```css
@import "tailwindcss";
@import "../styles/theme.css";
```
（若有必需的自定义，仅保留极少量。删除原手写 reset 与所有自定义类。）

- [ ] **Step 2: index.html 用 daisyUI 重写**

- `<body>` 加 `class="bg-base-200 text-base-content min-h-screen"`，`<html>` 不写死 data-theme（由 theme.js 设置）。
- 顶栏用 `navbar bg-base-100 shadow`：左侧标题（Lucide `history` 图标 + 「翻译历史」），右侧放 `#searchInput`（`input input-bordered input-sm`）、`#countLabel`（`badge badge-ghost`）、`#clearBtn`（`btn btn-error btn-sm`，内含 Lucide `trash-2`）、以及主题容器 `<div id="themeControl"></div>`。
- 主体 `#historyList` 用 `class="container mx-auto p-4 flex flex-col gap-3"`；`#emptyState` 用居中卡片（Lucide `inbox` 图标）。
- 引入脚本不变：`<script type="module" src="history.js"></script>`。
- **所有上述 ID 必须保留。**

- [ ] **Step 3: history.js 接入主题 + Lucide + 类名同步**

顶部加：

```js
import { createIcons, icons } from 'lucide';
import { applyTheme, initThemeControl } from '../utils/theme.js';
```

在初始化处（DOMContentLoaded 或现有入口）加：

```js
await applyTheme();
await initThemeControl(document.getElementById('themeControl'));
createIcons({ icons });
```

把列表渲染里拼接的卡片 HTML 改用 daisyUI 类（`card bg-base-100 shadow-sm`，原文/译文分区、来源、时间戳；删除按钮用 `btn btn-ghost btn-xs` + Lucide `x`）。**每次重渲染列表后调用 `createIcons({ icons })`** 以渲染动态插入的图标。emoji（🗑️/📝 等）替换为 Lucide。保留所有数据读写与事件逻辑不变。

- [ ] **Step 4: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，打开 history 页：
- 主题下拉可用、与 popup 联动；
- 有历史时卡片正常渲染，搜索可过滤，计数正确，删除单条、清空可用；
- 无历史显示空状态；
- 图标均为 Lucide，无残留 emoji/手写类。

- [ ] **Step 5: Commit**

```bash
git add history/index.html history/history.css history/history.js
git commit -m "feat(ui): migrate history page to daisyUI + Lucide + unified theme"
```

---

## Task 6: 迁移 pdf 页（文档翻译查看器）

**Files:**
- Modify: `pdf/viewer.html`, `pdf/viewer.css`, `pdf/viewer.js`

**保留 ID 契约（viewer.js 依赖）：** `uploadArea`, `fileInput`, `workspace`, `engine`, `sourceText`, `translatedText`, `translateBtn`, `clearBtn`, `copyBtn`, `charCount`, `progressBar`, `progressFill`, `progressLabel`。
**功能清单：** 拖拽/选择上传 PDF/TXT/MD/HTML、解析进度、源文/译文双栏、引擎选择、翻译、复制、清空、字数统计。

- [ ] **Step 1: viewer.css 换为 daisyUI**

```css
@import "tailwindcss";
@import "../styles/theme.css";

/* 仅保留确有必要的自定义，例如进度条/双栏滚动 */
```
删除手写 reset 与自定义类；进度条优先用 daisyUI `progress`（若 viewer.js 用 `#progressFill` 设宽度，则保留一个最小自定义进度条结构并保留这些 ID）。

- [ ] **Step 2: viewer.html 用 daisyUI 重写**

- `navbar`：标题（Lucide `file-text`）+ `#engine`（`select select-bordered select-sm`）+ 主题容器 `<div id="themeControl"></div>`。
- `#uploadArea`：daisyUI 卡片样式的拖拽区（`card border-2 border-dashed`），内含 `#fileInput`（隐藏 input）、提示文案与 Lucide `upload`。
- `#workspace`：两列（`grid md:grid-cols-2 gap-4`），左 `#sourceText`、右 `#translatedText`（各用 `textarea textarea-bordered` 或 `card` + 可滚动 `prose`，按现有 viewer.js 对元素类型的读写决定，**保持元素标签类型不变**）。
- 工具条：`#translateBtn`（`btn btn-primary`）、`#copyBtn`（`btn btn-ghost`）、`#clearBtn`（`btn btn-ghost`）、`#charCount`（`badge`）。
- 进度：`#progressBar`/`#progressFill`/`#progressLabel`，结构与 viewer.js 写法对齐。
- 脚本引入不变。**所有 ID 保留，元素标签类型（textarea vs div）保持与 viewer.js 读写一致。**

- [ ] **Step 3: viewer.js 接入主题 + Lucide**

顶部加 import（同 Task 5 的两行）；初始化处加 `applyTheme()` / `initThemeControl(...)` / `createIcons({ icons })`；动态插入图标处补 `createIcons`。emoji 换 Lucide。**进度更新、文件解析、翻译调用、复制/清空逻辑保持不变。**

- [ ] **Step 4: 构建 + 验收**

Run: `npm run build`
Expected: 成功。打开 pdf 页：
- 上传一个 .txt 与一个 .pdf，能解析并显示源文；
- 选引擎、点翻译，译文出现，进度条动；
- 复制/清空/字数统计正常；
- 主题联动；图标为 Lucide。

- [ ] **Step 5: Commit**

```bash
git add pdf/viewer.html pdf/viewer.css pdf/viewer.js
git commit -m "feat(ui): migrate pdf viewer to daisyUI + Lucide + unified theme"
```

---

## Task 7: 迁移 wordbook 页（单词本）

**Files:**
- Modify: `wordbook/index.html`, `wordbook/wordbook.css`, `wordbook/wordbook.js`

**保留 ID 契约（wordbook.js 依赖）：** `searchInput`, `wordCount`, `wordList`, `emptyState`, `recentWords`, `clearAllBtn`, `exportBtn`, `importBtn`, `importFile`, `statTotal`, `statKnown`, `statUnknown`, `statToday`, `flashcard`, `cardWord`, `cardSource`, `cardTranslation`, `cardProgress`, `cardPrev`, `cardNext`, `cardKnow`, `cardDontKnow`, `cardShuffle`, `quizPrompt`, `quizInput`, `quizCheck`, `quizSkip`, `quizNext`, `quizFeedback`, `quizCorrect`, `quizTotal`。
**功能清单：** 单词列表（搜索/标记/删除）、卡片学习（翻转/上一张下一张/随机/认识不认识）、拼写测验（输入校验/计分/跳过/下一题）、统计（总数/已掌握/待学/今日）、JSON 导入导出。

> wordbook.js 大量用模板字符串拼 DOM，类名最易出错——迁移时务必让 JS 里拼接的类名与新 daisyUI 结构一致。

- [ ] **Step 1: wordbook.css 换为 daisyUI**

```css
@import "tailwindcss";
@import "../styles/theme.css";
```
删除原 `:root` 自定义变量体系与手写类（颜色改走 daisyUI 主题变量）。

- [ ] **Step 2: index.html 用 daisyUI 重写**

- `navbar`：标题（Lucide `book-open`）+ 主题容器。
- 三个视图（列表/卡片/测验）用 daisyUI `tabs tabs-bordered` 或 `tab` 切换（保持原有切换机制对应的 ID/结构）。
- 统计区：4 个 daisyUI `stat`（`statTotal/statKnown/statUnknown/statToday`）。
- 列表：`#wordList` 用 `grid gap-3`，单词卡 `card bg-base-100`；搜索 `#searchInput`（`input input-bordered`）；`#wordCount`（`badge`）；工具按钮 `exportBtn/importBtn/clearAllBtn`（`btn`），`#importFile` 隐藏 input。
- 卡片学习：`#flashcard`（可翻转卡，`card` + 自定义 flip 用最小自定义 CSS 保留），含 `cardWord/cardSource/cardTranslation/cardProgress` 与按钮 `cardPrev/cardNext/cardKnow/cardDontKnow/cardShuffle`（`btn`）。
- 测验：`quizPrompt`、`quizInput`（`input input-bordered`）、按钮 `quizCheck/quizSkip/quizNext`、`quizFeedback`、计分 `quizCorrect/quizTotal`。
- **全部 ID 保留。** 脚本引入不变。

- [ ] **Step 3: wordbook.js 接入主题 + Lucide + 类名同步**

顶部加 import 两行；初始化加 `applyTheme()`/`initThemeControl(...)`/`createIcons({ icons })`。把所有模板字符串拼接的元素类名改为新 daisyUI 类；每次重渲染列表/卡片/测验后调用 `createIcons({ icons })`。emoji 换 Lucide。**收藏数据结构、导入导出、计分、卡片状态逻辑保持不变。**

- [ ] **Step 4: 构建 + 验收**

Run: `npm run build`
Expected: 成功。打开 wordbook 页（先确保有几条收藏，可在网页划词收藏，或导入一个 JSON）：
- 列表渲染、搜索、标记已掌握/学习中、删除可用；
- 卡片可翻转、上一张/下一张、随机、认识/不认识；
- 拼写测验可答题、计分、跳过、下一题；
- 统计数字正确；导出下载 JSON、导入回填；
- 主题联动；图标 Lucide。

- [ ] **Step 5: Commit**

```bash
git add wordbook/index.html wordbook/wordbook.css wordbook/wordbook.js
git commit -m "feat(ui): migrate wordbook to daisyUI + Lucide + unified theme"
```

---

## Task 8: 迁移 options 页（完整设置）

**Files:**
- Modify: `options/options.html`, `options/options.css`, `options/options.js`

**保留契约：** options.js 通过 `getElementById('aiPrompt'/'ollamaModel'/'ollamaUrl'/'webllmModel')` 及大量 `querySelectorAll`/`name`/`value` 选择器读写控件——**所有 input 的 `id`/`name`/`value` 与 section 容器结构必须与 options.js 现有选择器一致**。迁移前先通读 options.js，列出它依赖的全部选择器，逐一在新 HTML 中对应保留。
**功能清单（5 大分区）：** 常规（引擎/语言/各引擎 key·url·model/aiPrompt）、样式（颜色/字号/行高/加粗/边框）、快捷键（展示绑定 + 跳转）、站点（黑白名单、站点专属引擎）、数据（导入/导出/重置）。

- [ ] **Step 1: 通读 options.js 选择器**

Run: `grep -nE "getElementById|querySelector|getElementsBy|\.value|\[name=|name=\"" options/options.js`
记录每个被读写的 id/name/value，作为新 HTML 的保留清单。

- [ ] **Step 2: options.css 换为 daisyUI**

```css
@import "tailwindcss";
@import "../styles/theme.css";
```
删除 373 行手写样式与 reset；配色走主题变量。

- [ ] **Step 3: options.html 用 daisyUI 重写**

- 顶部 `navbar`：标题（Lucide `settings`）+ 主题容器。
- 5 个分区用 daisyUI `tabs tabs-lifted` 或多张 `card`（保持与 options.js 的分区切换/读取方式一致）。
- 表单控件统一 daisyUI：`select select-bordered`、`input input-bordered`、`textarea textarea-bordered`、`toggle`/`checkbox`、颜色用色块按钮；**保留每个控件的 `id`/`name`/`value`**（按 Step 1 清单）。
- 数据区按钮（导入/导出/重置）`btn`，隐藏 file input 保留 id。
- 脚本引入不变。

- [ ] **Step 4: options.js 接入主题 + Lucide**

顶部加 import 两行；初始化加 `applyTheme()`/`initThemeControl(...)`/`createIcons({ icons })`；动态生成的站点规则行等，渲染后补 `createIcons`，类名用 daisyUI。emoji 换 Lucide。**所有设置读写、保存、站点规则增删、导入导出/重置逻辑保持不变。**

- [ ] **Step 5: 构建 + 验收**

Run: `npm run build`
Expected: 成功。打开 options 页：
- 5 个分区都在、可切换；
- 改引擎/语言/各 key/aiPrompt/样式项后，回到 popup 或网页验证设置生效（如译文颜色/字号、划词引擎）；
- 站点黑白名单可增删并生效；
- 导出/导入/重置正常；
- 主题联动；图标 Lucide。

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.css options/options.js
git commit -m "feat(ui): migrate options page to daisyUI + Lucide + unified theme"
```

---

## Task 9: 收尾与文档

**Files:**
- Modify: `CLAUDE.md`（更新"哪些已迁移"的描述）, `README.md`（可选）

- [ ] **Step 1: 更新 CLAUDE.md**

把 CLAUDE.md 中关于"独立页面只有 popup/sandbox 用新体系、其余手写 CSS"的描述改为：全部独立页面（popup/sandbox/options/wordbook/pdf/history）均使用 Tailwind 4 + daisyUI 5 + Lucide，主题由 `utils/theme.js` 统一管理；`content/*.css` 仍刻意手写。

- [ ] **Step 2: 全量构建验收**

Run: `npm run build`
Expected: 成功。逐页快速回归一遍主题切换与核心功能。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md after daisyUI migration"
```

---

## Self-Review 记录

- **Spec 覆盖**：共享 theme.js（Task1）、共享 CSS+扩展性（Task2）、popup/sandbox 接入（Task3-4）、四页逐个迁移（Task5-8）、跟随系统+手动覆盖+全局同步（theme.js）、可扩展多主题单一数据源（AVAILABLE_THEMES + themes:）、逐页验收顺序 history→pdf→wordbook→options——均有对应任务。
- **占位符**：无 TBD/TODO；每个改动给出具体文件、代码或精确组件映射与验证命令。
- **类型/契约一致**：theme.js 导出名 `applyTheme/setTheme/initThemeControl/AVAILABLE_THEMES/resolveTheme` 在各页任务中一致引用；各页 `getElementById` ID 契约已逐页列明并要求保留。
- **不在范围**：`content/*.css`、`vite.config.js` 明确排除。
