# 翻译历史存储统一 + 可配置上限 + GitHub 跨设备同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 `content/selection.js` 与 `sandbox/sandbox.js` 里重复的翻译历史保存逻辑，历史保存上限改为默认不限制、用户可配置，并支持通过用户自己的 GitHub 账号（Secret Gist 或指定仓库）做跨设备同步。

**Architecture:** 新增 `utils/history.js` 作为本地历史写入的唯一入口；新增 `utils/github-sync.js` 负责远端读写与合并去重（纯函数，不做调度）；`background/background.js` 用 `chrome.alarms` 编排防抖/周期同步触发；`options/` 页面新增设置 UI。设置项按项目既有约定集中加进 `utils/defaults.js` 的 `DEFAULTS`。

**Tech Stack:** Manifest V3 Chrome 扩展，Vite + `@crxjs/vite-plugin`，原生 `chrome.storage`/`chrome.alarms`/`fetch`，GitHub REST API v3（Gist API + Contents API），daisyUI 5（options 页面既有样式）。

## Global Constraints

- 这是 Manifest V3 插件，无测试框架/无 linter/无 typecheck（见项目 CLAUDE.md）。验证方式统一为：`npm run build` → 在 `chrome://extensions/` 加载/刷新 `dist/` → 手动操作 + 打开对应上下文的 DevTools 控制台核实。
- 内容脚本（`content/*.js`）是用 `import` 写的 ES 模块，**必须**经 `@crxjs/vite-plugin` 构建后才能跑，不能直接加载源码目录。
- 所有新增设置项只加一处：`utils/defaults.js` 的 `DEFAULTS`（+ 需要窄读时用 `pick(...)`）。
- UI 文案与代码注释使用中文，跟随现有页面风格。
- `options/options.html` 使用 daisyUI 5 class（`card`/`btn`/`input input-bordered`/`toggle`/`radio`/`label`），不要引入新的 CSS 框架写法。
- Lucide 图标必须先加进 `utils/icons.js` 的白名单才能在页面里用 `data-lucide="..."`。
- Git 提交信息使用本仓库既有的 conventional commit 前缀（`feat:`/`fix:`/`refactor:`/`docs:`/`perf:`）。
- 本计划只覆盖设计文档 `docs/superpowers/specs/2026-08-17-translation-history-storage-design.md` 的阶段 1–4（本地统一上限、GitHub 手动同步、自动同步、仓库目标）。阶段 5（OAuth Device Flow）依赖项目维护者手动注册 GitHub OAuth App，本计划**不实现**，仅在最后留一条后续说明。

---

## Task 1: manifest 权限 + `historyMaxItems` 默认值

**Files:**
- Modify: `manifest.json:6`
- Modify: `utils/defaults.js:10-60`

**Interfaces:**
- Produces: `DEFAULTS.historyMaxItems`（`number`，`0` 表示不限制），后续任务通过 `pick('historyMaxItems')` 读取

- [ ] **Step 1: 给 manifest 加 `unlimitedStorage` 权限**

编辑 `manifest.json` 第 6 行：

```json
  "permissions": ["storage", "unlimitedStorage", "activeTab", "contextMenus", "sidePanel"],
```

- [ ] **Step 2: `utils/defaults.js` 新增 `historyMaxItems`**

在 `DEFAULTS` 对象里，`theme: 'system',` 这一行后面新增一个 `history` 分组（紧跟 `// core` 分组之后）：

```js
  theme: 'system',

  // history
  historyMaxItems: 0, // 0 = 不限制

  // selection translation
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建无报错；打开 `dist/manifest.json`，确认 `permissions` 数组里含 `unlimitedStorage`。

- [ ] **Step 4: Commit**

```bash
git add manifest.json utils/defaults.js
git commit -m "feat(history): add unlimitedStorage permission and historyMaxItems setting"
```

---

## Task 2: 新建 `utils/history.js` 共享保存函数

**Files:**
- Create: `utils/history.js`

**Interfaces:**
- Consumes: `pick` from `./defaults.js`（签名 `pick(...keys: string[]): object`）
- Produces: `saveHistoryEntry({ text, translation, engine, url?, title? }): Promise<void>`，供 Task 3、Task 4 调用

- [ ] **Step 1: 写 `utils/history.js`**

```js
// 翻译历史的唯一写入口：划词面板、sandbox 都调用这里，避免各自维护一份裁剪逻辑。
import { pick } from './defaults.js';

export async function saveHistoryEntry({ text, translation, engine, url = '', title = '' }) {
  const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));
  const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');

  translationHistory.unshift({
    id: crypto.randomUUID(),
    text,
    translation,
    engine,
    url,
    title,
    timestamp: Date.now(),
  });

  if (historyMaxItems > 0 && translationHistory.length > historyMaxItems) {
    translationHistory.length = historyMaxItems;
  }

  try {
    await chrome.storage.local.set({ translationHistory });
  } catch (e) {
    // 磁盘写满等极端情况兜底：裁掉最早 15% 后重试一次，并留痕供 UI 提示。
    const trimmed = translationHistory.slice(0, Math.ceil(translationHistory.length * 0.85));
    await chrome.storage.local.set({ translationHistory: trimmed, historyTrimNotice: Date.now() });
  }

  chrome.runtime.sendMessage({ action: 'historyChanged' }).catch(() => {});
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建无报错（这个模块此时还没有调用方，纯语法/类型层面的检查；功能验证放在 Task 3）。

- [ ] **Step 3: Commit**

```bash
git add utils/history.js
git commit -m "feat(history): add shared saveHistoryEntry helper"
```

---

## Task 3: `content/selection.js` 迁移到共享保存函数

**Files:**
- Modify: `content/selection.js:1-3` (imports)
- Modify: `content/selection.js:373-388` (`saveToHistory` 定义)
- Modify: `content/selection.js:406` (调用点)

**Interfaces:**
- Consumes: `saveHistoryEntry` from `../utils/history.js`（见 Task 2）

- [ ] **Step 1: 加 import**

编辑 `content/selection.js` 第 1-3 行：

```js
import './selection.css';
import { Translator } from '../utils/translator.js';
import { pick } from '../utils/defaults.js';
import { saveHistoryEntry } from '../utils/history.js';
```

- [ ] **Step 2: 删除本地 `saveToHistory`，只保留 `historyPendingText` 状态**

把第 373-388 行：

```js
  // ========== History ==========
  let historyPendingText = null;

  async function saveToHistory(text, translation, engine) {
    try {
      const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');
      translationHistory.unshift({
        text, translation, engine,
        url: location.href,
        title: document.title,
        timestamp: Date.now()
      });
      if (translationHistory.length > 500) translationHistory.length = 500;
      await chrome.storage.local.set({ translationHistory });
    } catch (e) { /* ignore */ }
  }
```

改成：

```js
  // ========== History ==========
  let historyPendingText = null;
```

- [ ] **Step 3: 改调用点**

第 405-408 行原本是：

```js
      if (historyPendingText && result) {
        saveToHistory(historyPendingText, result, engineId);
        historyPendingText = null;
      }
```

改成：

```js
      if (historyPendingText && result) {
        saveHistoryEntry({
          text: historyPendingText,
          translation: result,
          engine: engineId,
          url: location.href,
          title: document.title,
        });
        historyPendingText = null;
      }
```

- [ ] **Step 4: 构建 + 手动验证**

Run: `npm run build`

然后在 `chrome://extensions/` 刷新插件，打开任意网页，选中一段文字触发划词翻译面板，等结果出来。

打开该网页的 DevTools → Console，执行：

```js
chrome.storage.local.get('translationHistory', r => console.log(r.translationHistory[0]))
```

Expected: 打印出的第一条记录含 `id`（UUID 格式字符串）、`text`、`translation`、`engine`、`url`、`title`、`timestamp` 字段。

- [ ] **Step 5: Commit**

```bash
git add content/selection.js
git commit -m "refactor(selection): use shared saveHistoryEntry instead of local copy"
```

---

## Task 4: `sandbox/sandbox.js` 迁移到共享保存函数

**Files:**
- Modify: `sandbox/sandbox.js:1-5` (imports)
- Modify: `sandbox/sandbox.js:158-160` (调用点)
- Modify: `sandbox/sandbox.js:276-289` (`saveToHistory` 定义，删除)

**Interfaces:**
- Consumes: `saveHistoryEntry` from `../utils/history.js`

- [ ] **Step 1: 加 import**

编辑 `sandbox/sandbox.js` 第 1-5 行：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { createWorker } from 'tesseract.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
import { saveHistoryEntry } from '../utils/history.js';
```

- [ ] **Step 2: 改调用点**

第 157-160 行原本是：

```js
        // Save history and prepare wordbook data
        currentSaveData = { source: text, target: translatedText, engine: window.translator.engine };
        saveToHistory(text, translatedText, window.translator.engine);
```

改成：

```js
        // Save history and prepare wordbook data
        currentSaveData = { source: text, target: translatedText, engine: window.translator.engine };
        saveHistoryEntry({ text, translation: translatedText, engine: window.translator.engine });
```

- [ ] **Step 3: 删除本地 `saveToHistory` 函数**

删掉第 276-289 行（含注释行）：

```js
  // History saving function
  async function saveToHistory(source, target, engine) {
    const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');
    translationHistory.unshift({
      text: source,
      translation: target,
      engine: engine,
      timestamp: Date.now()
    });
    if (translationHistory.length > 1000) {
      translationHistory.pop();
    }
    await chrome.storage.local.set({ translationHistory });
  }
```

确认删除后，上下文（`saveWordBtn` 的 click 监听结束 `});` 与文件后续内容）保持完整，不留孤立的空行块。

- [ ] **Step 4: 构建 + 手动验证**

Run: `npm run build`

刷新插件，打开「快捷翻译」（popup 里的入口或 `chrome-extension://<id>/sandbox/index.html?tab=text`），在文本框输入内容触发翻译。

打开该页面的 DevTools → Console：

```js
chrome.storage.local.get('translationHistory', r => console.log(r.translationHistory[0]))
```

Expected: 新条目排在最前面，带 `id`/`timestamp`，`url`/`title` 为空字符串（sandbox 场景不传）。

- [ ] **Step 5: Commit**

```bash
git add sandbox/sandbox.js
git commit -m "refactor(sandbox): use shared saveHistoryEntry instead of local copy"
```

---

## Task 5: 历史上限 UI + 隐私说明

**Files:**
- Modify: `options/options.html:477-480`
- Modify: `options/options.js:38-96` (load)
- Modify: `options/options.js:167-175` (saveFields)
- Modify: `options/options.js:355-399` (saveAll)

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.historyMaxItems`（来自 Task 1 的 `DEFAULTS`）

- [ ] **Step 1: `options.html` 新增卡片**

在 `tab-data` 区块里，`<h2>` 和「导出 / 导入配置」卡片之间插入。原文（第 477-480 行）：

```html
      <section class="tab" id="tab-data">
        <h2 class="text-xl font-semibold mb-5">数据管理</h2>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm">导出 / 导入配置</h3>
```

改成：

```html
      <section class="tab" id="tab-data">
        <h2 class="text-xl font-semibold mb-5">数据管理</h2>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm">历史记录</h3>
            <p class="text-xs text-base-content/40 -mt-2">翻译历史默认仅保存在本机，不会上传到任何服务器；如需多设备同步，可在下方开启 GitHub 同步</p>
            <div class="flex items-center gap-3">
              <label class="text-sm text-base-content/70" for="historyMaxItems">保存条数上限</label>
              <input type="number" min="0" step="1" id="historyMaxItems" class="input input-bordered input-sm w-28" />
              <span class="text-xs text-base-content/40">0 = 不限制</span>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm">导出 / 导入配置</h3>
```

- [ ] **Step 2: `options.js` load 部分回填值**

在第 94-96 行（`renderSiteEngines` 那一行）之后新增：

```js
  $('siteMode').value = settings.siteRules.mode;
  renderSiteList(settings.siteRules.sites);
  renderSiteEngines(settings.siteEngines);

  // History
  $('historyMaxItems').value = settings.historyMaxItems;
```

- [ ] **Step 3: 加进自动保存监听**

第 167-171 行的 `saveFields` 数组：

```js
  const saveFields = [
    'engine', 'targetLang', 'displayMode', 'translateConcurrency', 'selectionMode',
    'hoverTranslate', 'inputTranslate',
    'translationBold', 'translationShowBorder', 'siteMode', 'historyMaxItems'
  ];
```

- [ ] **Step 4: `saveAll()` 写回**

`saveAll()` 末尾第 396-398 行原本是：

```js
      siteRules: { mode: $('siteMode').value, sites: current.siteRules.sites },
      siteEngines: current.siteEngines
    };
```

改成：

```js
      siteRules: { mode: $('siteMode').value, sites: current.siteRules.sites },
      siteEngines: current.siteEngines,
      historyMaxItems: parseInt($('historyMaxItems').value, 10) || 0,
    };
```

（注意给原来的 `siteEngines: current.siteEngines` 补上行尾逗号）

- [ ] **Step 5: 构建 + 手动验证**

Run: `npm run build`

刷新插件，打开 options 页「数据」标签，确认能看到「历史记录」卡片，输入框默认显示 `0`。改成 `5`，切到其他标签再切回来，确认值保持 `5`（说明已写入 storage）。

在 options 页 DevTools Console 执行：

```js
chrome.storage.sync.get('historyMaxItems', console.log)
```

Expected: `{ historyMaxItems: 5 }`

改回 `0`，触发一次划词翻译，用 Task 3 的验证命令确认新条目仍能正常写入（0 = 不限制，不裁剪）。

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat(options): add configurable history item cap with privacy note"
```

---

## Task 6: GitHub 设置项 + `utils/github-sync.js`（Gist 分支）

**Files:**
- Modify: `utils/defaults.js:10-60`
- Create: `utils/github-sync.js`

**Interfaces:**
- Consumes: `pick` from `./defaults.js`
- Produces:
  - `pullRemoteHistory(): Promise<Array<HistoryEntry>>`
  - `pushRemoteHistory(list: Array<HistoryEntry>): Promise<void>`
  - `mergeHistories(local: Array<HistoryEntry>, remote: Array<HistoryEntry>): Array<HistoryEntry>`
  - `syncNow(): Promise<{ ok: boolean, error?: string }>`
  - `HistoryEntry` 形状：`{ id, text, translation, engine, url, title, timestamp }`
  - 供 Task 7（background 手动触发）、Task 9/10（自动触发）、Task 12（仓库分支扩展）使用

- [ ] **Step 1: `utils/defaults.js` 新增 GitHub 同步设置**

Task 1 已经加过的这一段（`DEFAULTS` 里）：

```js
  // history
  historyMaxItems: 0, // 0 = 不限制

  // selection translation
```

改成：

```js
  // history
  historyMaxItems: 0, // 0 = 不限制

  // GitHub 跨设备同步
  githubSyncEnabled: false,
  githubSyncAuthMethod: 'pat', // 'pat' | 'oauth'（oauth 暂未实现，预留）
  githubToken: '',
  githubOAuthAccessToken: '', // 预留给未来的 Device Flow 登录
  githubSyncTargetType: 'gist', // 'gist' | 'repo'
  githubGistId: '',
  githubRepoOwner: '',
  githubRepoName: '',
  githubRepoBranch: 'main',
  githubRepoPath: 'translation-history.json',
  githubSyncMode: 'manual', // 'auto' | 'manual'
  githubSyncIntervalMinutes: 30,

  // selection translation
```

- [ ] **Step 2: 写 `utils/github-sync.js`**

```js
// GitHub 同步：只负责"读远端 / 写远端 / 合并"，不做调度决策（调度在 background）。
import { pick } from './defaults.js';

const API_BASE = 'https://api.github.com';
const GIST_FILENAME = 'translation-history.json';

async function getAuthHeaders() {
  const { githubSyncAuthMethod, githubToken, githubOAuthAccessToken } = await chrome.storage.sync.get(
    pick('githubSyncAuthMethod', 'githubToken', 'githubOAuthAccessToken')
  );
  const token = githubSyncAuthMethod === 'oauth' ? githubOAuthAccessToken : githubToken;
  if (!token) throw new Error('未配置 GitHub Token');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function pullFromGist(headers, gistId) {
  if (!gistId) return { list: [] };
  const res = await fetch(`${API_BASE}/gists/${gistId}`, { headers });
  if (res.status === 404) return { list: [] };
  if (!res.ok) throw new Error(`读取 Gist 失败: HTTP ${res.status}`);
  const data = await res.json();
  const file = data.files?.[GIST_FILENAME];
  const list = file?.content ? JSON.parse(file.content) : [];
  return { list };
}

async function pushToGist(headers, gistId, list) {
  const content = JSON.stringify(list);
  if (!gistId) {
    const res = await fetch(`${API_BASE}/gists`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'Super Immersive Translate - 翻译历史同步',
        public: false,
        files: { [GIST_FILENAME]: { content } },
      }),
    });
    if (!res.ok) throw new Error(`创建 Gist 失败: HTTP ${res.status}`);
    const data = await res.json();
    return data.id;
  }
  const res = await fetch(`${API_BASE}/gists/${gistId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
  });
  if (!res.ok) throw new Error(`更新 Gist 失败: HTTP ${res.status}`);
  return gistId;
}

export async function pullRemoteHistory() {
  const settings = await chrome.storage.sync.get(pick('githubSyncTargetType', 'githubGistId'));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    throw new Error('仓库同步尚未实现');
  }
  const { list } = await pullFromGist(headers, settings.githubGistId);
  return list;
}

export async function pushRemoteHistory(list) {
  const settings = await chrome.storage.sync.get(pick('githubSyncTargetType', 'githubGistId'));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    throw new Error('仓库同步尚未实现');
  }
  const gistId = await pushToGist(headers, settings.githubGistId, list);
  if (gistId !== settings.githubGistId) {
    await chrome.storage.sync.set({ githubGistId: gistId });
  }
}

export function mergeHistories(local, remote) {
  const byId = new Map();
  [...remote, ...local].forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export async function syncNow() {
  try {
    const { translationHistory: rawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const local = rawLocal.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
    const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));

    const remote = await pullRemoteHistory();
    const merged = mergeHistories(local, remote);
    const localSlice = historyMaxItems > 0 ? merged.slice(0, historyMaxItems) : merged;

    await chrome.storage.local.set({ translationHistory: localSlice });
    await pushRemoteHistory(merged);
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: null } });
    return { ok: true };
  } catch (err) {
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: err.message } });
    return { ok: false, error: err.message };
  }
}
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建无报错（此模块还没有调用方，功能验证放在 Task 8）。

- [ ] **Step 4: Commit**

```bash
git add utils/defaults.js utils/github-sync.js
git commit -m "feat(sync): add GitHub gist-backed history sync core"
```

---

## Task 7: background 手动同步消息处理

**Files:**
- Modify: `manifest.json:6`
- Modify: `background/background.js:4` (import)
- Modify: `background/background.js:60-68` (onMessage)

**Interfaces:**
- Consumes: `syncNow` from `../utils/github-sync.js`（Task 6）
- Produces: 响应 `chrome.runtime.sendMessage({ action: 'triggerHistorySync' })`，供 Task 8 的「立即同步」按钮调用

- [ ] **Step 1: manifest 加 `alarms` 权限（为 Task 9/10 提前铺好，本任务暂不用）**

```json
  "permissions": ["storage", "unlimitedStorage", "activeTab", "contextMenus", "sidePanel", "alarms"],
```

- [ ] **Step 2: background.js 加 import**

第 4 行改成：

```js
import { pick } from '../utils/defaults.js';
import { syncNow } from '../utils/github-sync.js';
```

- [ ] **Step 3: 扩展 onMessage 监听器**

第 60-68 行原本是：

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.sync.get(pick(
      'engine', 'targetLang', 'sourceLang', 'selectionMode', 'selectionEngines',
      'deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl'
    )).then(sendResponse);
    return true;
  }
});
```

改成：

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.sync.get(pick(
      'engine', 'targetLang', 'sourceLang', 'selectionMode', 'selectionEngines',
      'deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl'
    )).then(sendResponse);
    return true;
  }
  if (msg.action === 'triggerHistorySync') {
    syncNow().then(sendResponse);
    return true;
  }
});
```

- [ ] **Step 4: 构建 + 手动验证（需要一个真实 GitHub Token）**

Run: `npm run build`，刷新插件。

去 https://github.com/settings/tokens/new?scopes=gist 创建一个只有 `gist` 权限的测试用 Personal Access Token。

打开 `chrome://extensions/`，找到本插件，点「服务工作线程」（service worker）打开背景页 DevTools Console，依次执行：

```js
await chrome.storage.sync.set({ githubToken: '粘贴你的token', githubSyncEnabled: true });
const res = await chrome.runtime.sendMessage({ action: 'triggerHistorySync' });
console.log(res);
```

Expected: `res` 为 `{ ok: true }`；去 https://gist.github.com （登录同一账号）能看到一个新建的 secret gist，文件名 `translation-history.json`，内容是当前本机的历史数组。

再执行 `await chrome.storage.local.get('githubSyncStatus')`，Expected: `lastError` 为 `null`，`lastSyncAt` 是刚才的时间戳。

- [ ] **Step 5: Commit**

```bash
git add manifest.json background/background.js
git commit -m "feat(sync): wire manual GitHub sync trigger in background"
```

---

## Task 8: 同步设置 UI（启用开关 + Token + 立即同步按钮）

**Files:**
- Modify: `utils/icons.js`
- Modify: `options/options.html`（新增卡片，紧跟 Task 5 新增的「历史记录」卡片之后）
- Modify: `options/options.js`（load / 监听 / saveAll）

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.githubSyncEnabled` / `githubToken`（Task 6 的 `DEFAULTS`）；`chrome.runtime.sendMessage({ action: 'triggerHistorySync' })`（Task 7）

- [ ] **Step 1: `utils/icons.js` 加 `Github` 图标**

```js
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, BarChart2, BookOpen, Check, CheckCircle,
  Copy, Database, Download, ExternalLink, File, FileText, Github, Globe, Globe2, HelpCircle,
  History, Image, Inbox, Info, Keyboard, Languages, Layers, List, Mic, Monitor, Moon,
  MousePointer2, Package, PackageOpen, Palette, PanelRight, PenLine, RotateCcw, RotateCw, SearchX,
  Settings, Settings2, Share2, Shuffle, SkipForward, Star, Sun, Trash2, Upload,
  Volume2, X, Zap,
} from 'lucide';

export const icons = {
  ArrowLeft, ArrowLeftRight, ArrowRight, BarChart2, BookOpen, Check, CheckCircle,
  Copy, Database, Download, ExternalLink, File, FileText, Github, Globe, Globe2, HelpCircle,
  History, Image, Inbox, Info, Keyboard, Languages, Layers, List, Mic, Monitor, Moon,
  MousePointer2, Package, PackageOpen, Palette, PanelRight, PenLine, RotateCcw, RotateCw, SearchX,
  Settings, Settings2, Share2, Shuffle, SkipForward, Star, Sun, Trash2, Upload,
  Volume2, X, Zap,
};
```

- [ ] **Step 2: `options.html` 新增「GitHub 跨设备同步」卡片**

紧跟在 Task 5 新增的「历史记录」卡片之后、「导出 / 导入配置」卡片之前插入。定位锚点（Task 5 完成后的文件状态）：

```html
              <span class="text-xs text-base-content/40">0 = 不限制</span>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm">导出 / 导入配置</h3>
```

改成：

```html
              <span class="text-xs text-base-content/40">0 = 不限制</span>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm flex items-center gap-2">
              <i data-lucide="github" class="w-4 h-4"></i>
              GitHub 跨设备同步
            </h3>
            <p class="text-xs text-base-content/40 -mt-2">开启后，翻译历史会通过你自己的 GitHub 账号同步到其他设备</p>

            <label class="label cursor-pointer justify-start gap-3 px-0">
              <input type="checkbox" id="githubSyncEnabled" class="toggle toggle-primary toggle-sm" />
              <span class="label-text text-sm">启用 GitHub 同步</span>
            </label>

            <div id="githubSyncSettings" class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70" for="githubToken">Personal Access Token</label>
                <input type="password" id="githubToken" placeholder="ghp_..." class="input input-bordered input-sm w-full max-w-sm" />
                <a href="https://github.com/settings/tokens/new?scopes=gist&description=Super%20Immersive%20Translate" target="_blank" rel="noopener" class="text-xs link link-primary w-fit">
                  去 GitHub 创建 Token（需要 gist 权限）
                </a>
              </div>

              <div class="flex items-center gap-3">
                <button class="btn btn-outline btn-sm" id="githubSyncNowBtn">
                  <i data-lucide="rotate-cw" class="w-4 h-4"></i>
                  立即同步
                </button>
                <span id="githubSyncStatus" class="text-xs text-base-content/40">尚未同步</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-sm mb-4 rounded-xl">
          <div class="card-body p-5 gap-4">
            <h3 class="font-semibold text-sm">导出 / 导入配置</h3>
```

- [ ] **Step 3: `options.js` load 部分**

紧跟 Task 5 加的 `$('historyMaxItems').value = settings.historyMaxItems;` 之后追加：

```js
  // History
  $('historyMaxItems').value = settings.historyMaxItems;

  // GitHub sync
  $('githubSyncEnabled').checked = settings.githubSyncEnabled;
  $('githubToken').value = settings.githubToken;
  updateGithubSyncUI(settings.githubSyncEnabled);
  refreshSyncStatus();
```

- [ ] **Step 4: `options.js` 新增函数与监听器**

在 `saveAll` 函数定义（第 355 行）之前插入：

```js
  function updateGithubSyncUI(enabled) {
    $('githubSyncSettings').style.display = enabled ? 'flex' : 'none';
  }

  async function refreshSyncStatus() {
    const { githubSyncStatus } = await chrome.storage.local.get('githubSyncStatus');
    const el = $('githubSyncStatus');
    if (!githubSyncStatus || !githubSyncStatus.lastSyncAt) {
      el.textContent = '尚未同步';
      el.className = 'text-xs text-base-content/40';
      return;
    }
    const time = new Date(githubSyncStatus.lastSyncAt).toLocaleString();
    if (githubSyncStatus.lastError) {
      el.textContent = `上次同步失败（${time}）：${githubSyncStatus.lastError}`;
      el.className = 'text-xs text-error';
    } else {
      el.textContent = `上次同步成功：${time}`;
      el.className = 'text-xs text-success';
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.githubSyncStatus) refreshSyncStatus();
  });

  $('githubSyncEnabled').addEventListener('change', (e) => {
    updateGithubSyncUI(e.target.checked);
    saveAll();
  });

  $('githubToken').addEventListener('input', debounce(saveAll, 500));

  $('githubSyncNowBtn').addEventListener('click', async () => {
    const btn = $('githubSyncNowBtn');
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ action: 'triggerHistorySync' });
    } finally {
      btn.disabled = false;
    }
  });

```

注意：这段代码里用到了 `debounce`，但 `debounce` 函数本身定义在文件末尾（第 445 行）。JS 函数声明会被提升（hoisting），`debounce` 是用 `function debounce(...)` 声明的，在模块内任意位置调用都没问题，不需要挪动位置。

- [ ] **Step 5: `saveAll()` 写回新增字段**

第 396-399 行原本是（Task 5 已把 `historyMaxItems` 加进来）：

```js
      siteRules: { mode: $('siteMode').value, sites: current.siteRules.sites },
      siteEngines: current.siteEngines,
      historyMaxItems: parseInt($('historyMaxItems').value, 10) || 0,
    };
    await chrome.storage.sync.set(newSettings);
  }
```

改成：

```js
      siteRules: { mode: $('siteMode').value, sites: current.siteRules.sites },
      siteEngines: current.siteEngines,
      historyMaxItems: parseInt($('historyMaxItems').value, 10) || 0,
      githubSyncEnabled: $('githubSyncEnabled').checked,
      githubToken: $('githubToken').value,
    };
    await chrome.storage.sync.set(newSettings);
  }
```

- [ ] **Step 6: 构建 + 手动验证**

Run: `npm run build`，刷新插件，打开 options「数据」标签。

Expected：能看到「GitHub 跨设备同步」卡片；勾选「启用 GitHub 同步」后 Token 输入框区域可见，取消勾选后隐藏。

粘贴 Task 7 里创建的测试 Token，点击「立即同步」，按钮短暂 disabled 后恢复，状态文字变成「上次同步成功：...」。

- [ ] **Step 7: Commit**

```bash
git add utils/icons.js options/options.html options/options.js
git commit -m "feat(options): add GitHub sync settings UI with manual sync button"
```

---

## Task 9: 写入后防抖自动同步

**Files:**
- Modify: `background/background.js`

**Interfaces:**
- Consumes: `historyChanged` 消息（Task 2 的 `saveHistoryEntry` 已在发送）

- [ ] **Step 1: 扩展 onMessage 监听器，加防抖闹钟**

在 Task 7 修改过的 onMessage 监听器里，`triggerHistorySync` 分支之后追加一个分支：

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.sync.get(pick(
      'engine', 'targetLang', 'sourceLang', 'selectionMode', 'selectionEngines',
      'deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl'
    )).then(sendResponse);
    return true;
  }
  if (msg.action === 'triggerHistorySync') {
    syncNow().then(sendResponse);
    return true;
  }
  if (msg.action === 'historyChanged') {
    chrome.storage.sync.get(pick('githubSyncEnabled')).then(({ githubSyncEnabled }) => {
      if (githubSyncEnabled) {
        chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 });
      }
    });
  }
});
```

- [ ] **Step 2: 加 `onAlarm` 处理**

在文件末尾（`chrome.runtime.onMessage.addListener(...)` 块之后）追加：

```js

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'history-sync-debounce' || alarm.name === 'history-sync-periodic') {
    syncNow();
  }
});
```

- [ ] **Step 3: 构建 + 手动验证**

Run: `npm run build`，刷新插件，确保 Task 8 里已勾选「启用 GitHub 同步」并填好 Token。

打开背景页 Console（`chrome://extensions/` →「服务工作线程」），执行：

```js
chrome.alarms.getAll(console.log)
```

Expected: 此时为空数组（还没有历史写入触发）。

去任意网页触发一次划词翻译，回到背景页 Console 再次执行 `chrome.alarms.getAll(console.log)`。

Expected: 能看到一条 `name: 'history-sync-debounce'` 的闹钟，`scheduledTime` 约为当前时间 + 1 分钟。等待约 1 分钟后，`chrome.storage.local.get('githubSyncStatus', console.log)` 应显示刚刚有过一次新的 `lastSyncAt`。

- [ ] **Step 4: Commit**

```bash
git add background/background.js
git commit -m "feat(sync): debounce GitHub sync after local history writes"
```

---

## Task 10: 周期自动同步 + 设置变更时重建闹钟

**Files:**
- Modify: `background/background.js`
- Modify: `utils/defaults.js`（无需改动，`githubSyncMode`/`githubSyncIntervalMinutes` 已在 Task 6 加好）

**Interfaces:**
- Consumes: `DEFAULTS.githubSyncMode` / `githubSyncIntervalMinutes`（Task 6）

- [ ] **Step 1: 加周期闹钟设置函数，并在 onInstalled/onStartup 调用**

`background/background.js` 现有的 `chrome.runtime.onInstalled.addListener(() => { ... 创建右键菜单 ... });`（第 6-26 行）改成：

```js
async function setupPeriodicSyncAlarm() {
  const { githubSyncEnabled, githubSyncMode, githubSyncIntervalMinutes } = await chrome.storage.sync.get(
    pick('githubSyncEnabled', 'githubSyncMode', 'githubSyncIntervalMinutes')
  );
  await chrome.alarms.clear('history-sync-periodic');
  if (githubSyncEnabled && githubSyncMode === 'auto') {
    chrome.alarms.create('history-sync-periodic', { periodInMinutes: githubSyncIntervalMinutes });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-page',
    title: '⚡ 翻译此页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '⚡ 翻译选中文本',
    contexts: ['selection']
  });

  if (chrome.sidePanel) {
    chrome.contextMenus.create({
      id: 'open-side-panel',
      title: '⚡ 在侧边栏打开快捷翻译',
      contexts: ['page', 'selection']
    });
  }

  setupPeriodicSyncAlarm();
});

chrome.runtime.onStartup.addListener(setupPeriodicSyncAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.githubSyncEnabled || changes.githubSyncMode || changes.githubSyncIntervalMinutes)) {
    setupPeriodicSyncAlarm();
  }
});
```

- [ ] **Step 2: 构建 + 手动验证**

Run: `npm run build`，刷新插件（刷新会触发 `onInstalled`）。

背景页 Console 执行 `chrome.alarms.getAll(console.log)`：

Expected（此时 `githubSyncMode` 默认是 `'manual'`）：不含 `history-sync-periodic`。

去 options 页把「同步方式」切到「自动」（Task 11 会加这个 UI；本任务先用控制台模拟）：

```js
await chrome.storage.sync.set({ githubSyncMode: 'auto', githubSyncIntervalMinutes: 1 });
```

再执行 `chrome.alarms.getAll(console.log)`：

Expected: 出现 `name: 'history-sync-periodic'`，`periodInMinutes: 1`。

- [ ] **Step 3: Commit**

```bash
git add background/background.js
git commit -m "feat(sync): add periodic GitHub sync alarm driven by user settings"
```

---

## Task 11: 同步方式（自动/手动 + 间隔）UI

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.githubSyncMode` / `githubSyncIntervalMinutes`（Task 6）

- [ ] **Step 1: `options.html` 在「立即同步」按钮前插入同步方式选择**

定位锚点（Task 8 完成后的文件状态）：

```html
              <div class="flex items-center gap-3">
                <button class="btn btn-outline btn-sm" id="githubSyncNowBtn">
```

改成：

```html
              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步方式</label>
                <div class="flex items-center gap-4 flex-wrap">
                  <label class="label cursor-pointer gap-2 px-0">
                    <input type="radio" name="githubSyncMode" id="githubSyncModeAuto" value="auto" class="radio radio-sm" />
                    <span class="label-text text-sm">自动，每隔</span>
                  </label>
                  <input type="number" min="1" step="1" id="githubSyncIntervalMinutes" class="input input-bordered input-xs w-16" />
                  <span class="text-sm text-base-content/70">分钟</span>
                  <label class="label cursor-pointer gap-2 px-0">
                    <input type="radio" name="githubSyncMode" id="githubSyncModeManual" value="manual" class="radio radio-sm" />
                    <span class="label-text text-sm">手动</span>
                  </label>
                </div>
              </div>

              <div class="flex items-center gap-3">
                <button class="btn btn-outline btn-sm" id="githubSyncNowBtn">
```

- [ ] **Step 2: `options.js` load 部分**

紧跟 Task 8 加的 `refreshSyncStatus();` 之后追加：

```js
  updateGithubSyncUI(settings.githubSyncEnabled);
  refreshSyncStatus();
  $('githubSyncIntervalMinutes').value = settings.githubSyncIntervalMinutes;
  document.querySelectorAll('input[name="githubSyncMode"]').forEach((r) => {
    r.checked = r.value === settings.githubSyncMode;
  });
```

- [ ] **Step 3: `options.js` 监听器**

紧跟 Task 8 加的 `$('githubToken').addEventListener('input', debounce(saveAll, 500));` 之后追加：

```js
  $('githubToken').addEventListener('input', debounce(saveAll, 500));

  document.querySelectorAll('input[name="githubSyncMode"]').forEach((r) => {
    r.addEventListener('change', saveAll);
  });
  $('githubSyncIntervalMinutes').addEventListener('input', debounce(saveAll, 500));
```

- [ ] **Step 4: `saveAll()` 写回**

紧跟 Task 8 加的 `githubToken: $('githubToken').value,` 之后追加：

```js
      githubSyncEnabled: $('githubSyncEnabled').checked,
      githubToken: $('githubToken').value,
      githubSyncMode: document.querySelector('input[name="githubSyncMode"]:checked')?.value || 'manual',
      githubSyncIntervalMinutes: parseInt($('githubSyncIntervalMinutes').value, 10) || DEFAULT_SETTINGS.githubSyncIntervalMinutes,
    };
```

（注意这里替换的是原来紧跟在 `githubToken` 行后面的收尾 `};`，把它挪到新加的两行之后）

- [ ] **Step 5: 构建 + 手动验证**

Run: `npm run build`，刷新插件，打开 options「数据」标签。

Expected: 能看到「同步方式」单选（自动/手动）+ 间隔分钟输入框。选「自动」、间隔填 `1`，等 1 分钟以上，在背景页 Console 执行 `chrome.alarms.getAll(console.log)`，确认出现 `history-sync-periodic`。切回「手动」，再次确认该闹钟被清除（`chrome.alarms.getAll` 里不再有它）。

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat(options): add auto/manual GitHub sync mode UI"
```

---

## Task 12: `utils/github-sync.js` 仓库分支（sha 获取 + 冲突重试）

**Files:**
- Modify: `utils/github-sync.js`

**Interfaces:**
- Produces: `pullRemoteHistory()`/`pushRemoteHistory(list)` 现在同时支持 `githubSyncTargetType === 'repo'`

- [ ] **Step 1: 加 base64 UTF-8 编解码 helper + repo 读写函数**

在 `pushToGist` 函数定义之后、`export async function pullRemoteHistory()` 之前插入：

```js
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function pullFromRepo(headers, { owner, repo, branch, path }) {
  if (!owner || !repo) return { list: [], sha: '' };
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    { headers }
  );
  if (res.status === 404) return { list: [], sha: '' };
  if (!res.ok) throw new Error(`读取仓库文件失败: HTTP ${res.status}`);
  const data = await res.json();
  const list = data.content ? JSON.parse(fromBase64(data.content)) : [];
  return { list, sha: data.sha };
}

async function pushToRepo(headers, target, list, attempt = 0) {
  const { list: remoteList, sha } = await pullFromRepo(headers, target);
  const toWrite = attempt === 0 ? list : mergeHistories(list, remoteList);
  const body = {
    message: 'Update translation history',
    content: toBase64(JSON.stringify(toWrite)),
    branch: target.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    `${API_BASE}/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(target.path)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (res.status === 409 && attempt === 0) {
    return pushToRepo(headers, target, list, attempt + 1);
  }
  if (!res.ok) throw new Error(`写入仓库文件失败: HTTP ${res.status}`);
}
```

- [ ] **Step 2: 改写 `pullRemoteHistory`/`pushRemoteHistory` 分发逻辑**

把：

```js
export async function pullRemoteHistory() {
  const settings = await chrome.storage.sync.get(pick('githubSyncTargetType', 'githubGistId'));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    throw new Error('仓库同步尚未实现');
  }
  const { list } = await pullFromGist(headers, settings.githubGistId);
  return list;
}

export async function pushRemoteHistory(list) {
  const settings = await chrome.storage.sync.get(pick('githubSyncTargetType', 'githubGistId'));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    throw new Error('仓库同步尚未实现');
  }
  const gistId = await pushToGist(headers, settings.githubGistId, list);
  if (gistId !== settings.githubGistId) {
    await chrome.storage.sync.set({ githubGistId: gistId });
  }
}
```

改成：

```js
export async function pullRemoteHistory() {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoPath'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    const { list } = await pullFromRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: settings.githubRepoPath,
    });
    return list;
  }
  const { list } = await pullFromGist(headers, settings.githubGistId);
  return list;
}

export async function pushRemoteHistory(list) {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoPath'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    await pushToRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: settings.githubRepoPath,
    }, list);
    return;
  }
  const gistId = await pushToGist(headers, settings.githubGistId, list);
  if (gistId !== settings.githubGistId) {
    await chrome.storage.sync.set({ githubGistId: gistId });
  }
}
```

注意：`pushToRepo` 内部用到了 `mergeHistories`，它定义在这两个 export 函数之后。JS 里 `function` 声明会整体提升，模块顶层的具名函数在同一模块内互相调用没有顺序限制，不需要挪动 `mergeHistories` 的位置。

- [ ] **Step 3: 构建 + 手动验证（需要一个有 `repo` 权限的测试 Token 和一个测试仓库）**

Run: `npm run build`，刷新插件。

去 https://github.com/settings/tokens/new?scopes=repo 创建一个有 `repo` 权限的测试 Token；在 GitHub 建一个新的私有测试仓库（比如 `sit-history-test`）。

背景页 Console 执行：

```js
await chrome.storage.sync.set({
  githubToken: '粘贴repo权限的token',
  githubSyncEnabled: true,
  githubSyncTargetType: 'repo',
  githubRepoOwner: '你的用户名',
  githubRepoName: 'sit-history-test',
  githubRepoBranch: 'main',
  githubRepoPath: 'translation-history.json',
});
const res = await chrome.runtime.sendMessage({ action: 'triggerHistorySync' });
console.log(res);
```

Expected: `res` 为 `{ ok: true }`；去该仓库能看到新建的 `translation-history.json` 文件，内容是当前历史数组。再次执行 `triggerHistorySync`（不改动本地历史），Expected 依然 `{ ok: true }`（验证「文件已存在时走更新而非创建」路径正常，不会因为缺 sha 而 422）。

- [ ] **Step 4: Commit**

```bash
git add utils/github-sync.js
git commit -m "feat(sync): support repository file as GitHub sync target"
```

---

## Task 13: 同步载体（Gist / 仓库）选择 UI

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.githubSyncTargetType` / `githubRepoOwner` / `githubRepoName` / `githubRepoBranch` / `githubRepoPath`（Task 6）

- [ ] **Step 1: `options.html` 在「同步方式」块之前插入载体选择 + 仓库字段**

定位锚点（Task 11 完成后的文件状态）：

```html
              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步方式</label>
```

改成：

```html
              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步载体</label>
                <div class="flex items-center gap-4">
                  <label class="label cursor-pointer gap-2 px-0">
                    <input type="radio" name="githubSyncTargetType" id="githubSyncTargetGist" value="gist" class="radio radio-sm" />
                    <span class="label-text text-sm">Secret Gist</span>
                  </label>
                  <label class="label cursor-pointer gap-2 px-0">
                    <input type="radio" name="githubSyncTargetType" id="githubSyncTargetRepo" value="repo" class="radio radio-sm" />
                    <span class="label-text text-sm">指定仓库</span>
                  </label>
                </div>
              </div>

              <div id="githubRepoFields" class="flex flex-col gap-2">
                <div class="flex gap-2 flex-wrap">
                  <input type="text" id="githubRepoOwner" placeholder="owner" class="input input-bordered input-sm w-32" />
                  <input type="text" id="githubRepoName" placeholder="repo" class="input input-bordered input-sm w-32" />
                  <input type="text" id="githubRepoBranch" placeholder="main" class="input input-bordered input-sm w-24" />
                </div>
                <input type="text" id="githubRepoPath" placeholder="translation-history.json" class="input input-bordered input-sm w-full max-w-sm" />
                <a href="https://github.com/settings/tokens/new?scopes=repo&description=Super%20Immersive%20Translate" target="_blank" rel="noopener" class="text-xs link link-primary w-fit">
                  用仓库同步需要 repo 权限的 Token（Gist 只需要 gist 权限）
                </a>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步方式</label>
```

- [ ] **Step 2: `options.js` load 部分**

紧跟 Task 11 加的那段（`githubSyncIntervalMinutes`/`githubSyncMode` 回填）之后追加：

```js
  document.querySelectorAll('input[name="githubSyncMode"]').forEach((r) => {
    r.checked = r.value === settings.githubSyncMode;
  });
  document.querySelectorAll('input[name="githubSyncTargetType"]').forEach((r) => {
    r.checked = r.value === settings.githubSyncTargetType;
  });
  $('githubRepoOwner').value = settings.githubRepoOwner;
  $('githubRepoName').value = settings.githubRepoName;
  $('githubRepoBranch').value = settings.githubRepoBranch;
  $('githubRepoPath').value = settings.githubRepoPath;
  updateGithubTargetUI(settings.githubSyncTargetType);
```

- [ ] **Step 3: `options.js` 新增函数与监听器**

紧跟 Task 8 加的 `updateGithubSyncUI` 函数定义之后插入：

```js
  function updateGithubSyncUI(enabled) {
    $('githubSyncSettings').style.display = enabled ? 'flex' : 'none';
  }

  function updateGithubTargetUI(targetType) {
    $('githubRepoFields').style.display = targetType === 'repo' ? 'flex' : 'none';
  }
```

紧跟 Task 11 加的 `$('githubSyncIntervalMinutes').addEventListener('input', debounce(saveAll, 500));` 之后追加：

```js
  document.querySelectorAll('input[name="githubSyncTargetType"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      updateGithubTargetUI(e.target.value);
      saveAll();
    });
  });
  ['githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoPath'].forEach((id) => {
    $(id).addEventListener('input', debounce(saveAll, 500));
  });
```

- [ ] **Step 4: `saveAll()` 写回**

紧跟 Task 11 加的 `githubSyncMode`/`githubSyncIntervalMinutes` 两行之后追加：

```js
      githubSyncMode: document.querySelector('input[name="githubSyncMode"]:checked')?.value || 'manual',
      githubSyncIntervalMinutes: parseInt($('githubSyncIntervalMinutes').value, 10) || DEFAULT_SETTINGS.githubSyncIntervalMinutes,
      githubSyncTargetType: document.querySelector('input[name="githubSyncTargetType"]:checked')?.value || 'gist',
      githubRepoOwner: $('githubRepoOwner').value,
      githubRepoName: $('githubRepoName').value,
      githubRepoBranch: $('githubRepoBranch').value || 'main',
      githubRepoPath: $('githubRepoPath').value || 'translation-history.json',
    };
```

- [ ] **Step 5: 构建 + 手动验证**

Run: `npm run build`，刷新插件，打开 options「数据」标签。

Expected: 能看到「同步载体」单选（Secret Gist / 指定仓库）。默认选中 Gist 时，仓库字段区域隐藏；切到「指定仓库」时，四个输入框（owner/repo/branch/path）显示出来。

填入 Task 12 里用过的测试仓库信息，点击「立即同步」，确认状态文字变成成功，且该仓库文件内容更新。切回「Secret Gist」，再次「立即同步」，确认改为写入 Task 7 里创建的那个 gist（两条链路互不干扰）。

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat(options): add sync target selector (gist vs repository)"
```

---

## Spec Coverage Check

| 设计文档要点 | 覆盖任务 |
|---|---|
| 统一 `saveToHistory` 重复逻辑 | Task 2, 3, 4 |
| 保存上限默认不限制、可配置 | Task 1, 5 |
| `unlimitedStorage` 权限 + 隐私提示 | Task 1, 5 |
| GitHub 认证（PAT） | Task 6, 8 |
| Gist 同步载体 | Task 6, 8 |
| 仓库同步载体 | Task 12, 13 |
| 合并去重策略 | Task 6（`mergeHistories`） |
| 自动/手动同步触发 | Task 7（手动）、Task 9（防抖）、Task 10（周期）、Task 11（UI） |
| 错误处理（token 失效/网络/404/409） | Task 6（catch 统一记录）、Task 12（409 重试） |
| OAuth Device Flow | **不在本计划范围**，设计文档已标注为需项目维护者手动注册 OAuth App 的后续阶段 |

## 不在本计划范围内（同设计文档）

- OAuth Device Flow 登录（阶段 5）——需要先手动在 GitHub 注册一个 OAuth App 拿到 `client_id`，这一步无法由实现任务自动完成。等 P0（PAT）跑稳后再单独立项。
- 自建同步后端、端到端加密远端内容、Gist/仓库以外的同步载体、多账号并行同步。
