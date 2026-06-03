# 快捷翻译侧边栏 + 网页同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「快捷翻译」(`sandbox/`) 在保留标签页打开方式的同时，支持用 Chrome Side Panel API 以侧边栏形式打开，并与当前网页同步（划词联动 / 翻译当前页 / 跟随标签 / 停靠工作台）。

**Architecture:** 复用同一个 `sandbox/` 页面，通过 URL 参数 `?context=panel` 区分面板/标签两种形态。面板形态下显示一个额外的「当前页」标签承载页面同步：面板侧监听 `chrome.tabs` 事件跟随当前标签；content script 在选区变化时向运行时广播选中文字、面板接收并翻译；面板按钮通过消息驱动现有全页翻译。入口为 popup 新增按钮 + 右键菜单项，均调用 `chrome.sidePanel.setOptions` + `open`。

**Tech Stack:** Chrome Side Panel API (`chrome.sidePanel`, MV3, Chrome/Edge 114+)、现有 `chrome.tabs`/`chrome.runtime` 消息、Tailwind 4 + daisyUI 5 + Lucide。

> **本仓库无测试框架。** 每个任务验证 = `npm run build` 成功 + 加载 `dist/` 手动核对清单。所有图标用 Lucide。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `manifest.json` | 加 `sidePanel` 权限 + `side_panel` 注册 | 改 |
| `popup/popup.html` `popup/popup.js` | 「侧边栏打开」入口按钮 | 改 |
| `background/background.js` | 右键菜单「在侧边栏打开」+ 打开逻辑 | 改 |
| `sandbox/sandbox.js` | `?context=panel` 识别、「当前页」标签、跟随标签、划词接收、翻译当前页 | 改 |
| `sandbox/index.html` | 「当前页」nav 按钮 + 内容区（默认隐藏） | 改 |
| `sandbox/sandbox.css` | 窄面板响应式微调 | 改 |
| `content/selection.js` | 选区变化时向面板广播选中文字 | 改 |

不动：四个现有工具标签（文本/图片/文档/网站）内部逻辑、标签页打开方式、`utils/translator.js`、`utils/theme.js`。

---

## Task 1: 打开侧边栏（manifest + popup 按钮 + 右键菜单）

完成后：能从 popup 按钮或右键菜单在浏览器右侧开出侧边栏，显示现有 sandbox（四工具可用）。

**Files:**
- Modify: `manifest.json`
- Modify: `popup/popup.html`, `popup/popup.js`
- Modify: `background/background.js`

- [ ] **Step 1: manifest 加 sidePanel 权限与注册**

把 `manifest.json` 的 permissions 行改为（新增 `sidePanel`）：
```json
  "permissions": ["storage", "activeTab", "contextMenus", "sidePanel"],
```
并在 `"background"` 块之后（或任意顶层位置）新增：
```json
  "side_panel": {
    "default_path": "sandbox/index.html"
  },
```

- [ ] **Step 2: popup 加「侧边栏打开」按钮**

在 `popup/popup.html` 的底部 footer（含 `#openWordbook`/`#openHistory`/`#openSettings` 的那个 `<div class="flex border-t ...">`）里，作为第一个按钮插入：
```html
      <button id="openSidePanel" class="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors">
        <i data-lucide="panel-right" class="w-4 h-4"></i>
        <span class="font-extrabold text-[9px]">侧边栏</span>
      </button>
```

- [ ] **Step 3: popup.js 接线打开侧边栏**

在 `popup/popup.js` 中，于已有的 `document.getElementById('openWordbook')...` 这一组「Open pages」监听附近，新增：
```js
  const sidePanelBtn = document.getElementById('openSidePanel');
  if (!chrome.sidePanel) {
    // 旧版浏览器 / Firefox：无 Side Panel API，隐藏入口
    sidePanelBtn.style.display = 'none';
  } else {
    sidePanelBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sandbox/index.html?context=panel',
        enabled: true
      });
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    });
  }
```

- [ ] **Step 4: background 加右键菜单「在侧边栏打开」**

在 `background/background.js` 的 `chrome.runtime.onInstalled` 里现有 `contextMenus.create(...)` 之后，新增（仅当支持时）：
```js
  if (chrome.sidePanel) {
    chrome.contextMenus.create({
      id: 'open-side-panel',
      title: '⚡ 在侧边栏打开快捷翻译',
      contexts: ['page', 'selection']
    });
  }
```
并在现有的 `chrome.contextMenus.onClicked.addListener(async (info, tab) => { ... })` 内，追加分支：
```js
  } else if (info.menuItemId === 'open-side-panel') {
    if (!tab?.id || !chrome.sidePanel) return;
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sandbox/index.html?context=panel',
      enabled: true
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
```

- [ ] **Step 5: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`：
- popup 底部出现「侧边栏」按钮；点击 → 浏览器右侧打开侧边栏，显示 sandbox，四个工具标签（文字/图片/文档/网站）可正常切换使用；
- 网页右键出现「在侧边栏打开快捷翻译」，点击同样打开侧边栏。

- [ ] **Step 6: Commit**
```bash
git add manifest.json popup/popup.html popup/popup.js background/background.js
git commit -m "feat(sidepanel): open quick-translate sandbox in a Chrome side panel"
```

---

## Task 2: 面板形态识别 + 「当前页」标签骨架 + 跟随标签

完成后：侧边栏里多出「当前页」标签（标签页形态不显示），展示当前标签页标题/URL，并随标签切换/导航更新。

**Files:**
- Modify: `sandbox/index.html`
- Modify: `sandbox/sandbox.js`

- [ ] **Step 1: index.html 加「当前页」nav 按钮（默认隐藏）**

在 `sandbox/index.html` 的 nav 容器里（`#nav-text` 等四个按钮所在的 `<div class="flex gap-2">`），在 `#nav-text` 之前插入：
```html
          <button id="nav-page" class="btn btn-sm btn-ghost text-base-content/60 rounded-full px-4 hidden"><i data-lucide="globe-2" class="w-4 h-4 mr-1"></i>当前页</button>
```

- [ ] **Step 2: index.html 加「当前页」内容区（默认隐藏）**

在 `#content-text` 区块（`<div id="content-text" ...>`）之前插入：
```html
        <div id="content-page" class="hidden p-6 flex flex-col gap-4 min-h-[300px]">
          <div class="card bg-base-100 border border-base-300 rounded-xl">
            <div class="card-body p-4 gap-2">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <i data-lucide="globe-2" class="w-4 h-4 text-primary"></i>
                <span id="pageTitle" class="truncate">（未获取到当前页）</span>
              </div>
              <a id="pageUrl" href="#" target="_blank" class="link link-primary text-xs truncate"></a>
              <button id="translatePageBtn" class="btn btn-primary btn-sm w-fit mt-1">
                <i data-lucide="languages" class="w-4 h-4"></i> 翻译/还原当前页
              </button>
              <p id="pageUnavailable" class="hidden text-xs text-warning">当前页面不可翻译（受限页面）。</p>
            </div>
          </div>
          <div class="card bg-base-100 border border-base-300 rounded-xl flex-1">
            <div class="card-body p-4 gap-2">
              <div class="text-xs font-semibold text-base-content/50">划词联动</div>
              <div id="pageSelectionText" class="text-sm font-medium break-words">在网页中选中文字即可在此翻译</div>
              <div class="divider my-1"></div>
              <div id="pageSelectionResult" class="text-sm text-secondary break-words"></div>
            </div>
          </div>
        </div>
```

- [ ] **Step 3: sandbox.js 识别面板上下文并显示「当前页」标签**

在 `sandbox/sandbox.js` 的 `switchTab` 定义与四个 nav 元素引用之后（紧接 `const switchTab = ...};` 闭合后、`if (navText) navText.addEventListener...` 之前），加入面板上下文识别与「当前页」纳入 switchTab 管理：
```js
  const isPanel = new URLSearchParams(window.location.search).get('context') === 'panel';
  const navPage = document.getElementById('nav-page');
  const contentPage = document.getElementById('content-page');
  // 让「当前页」也参与统一的高亮/显隐管理
  navs.push(navPage);
  contents.push(contentPage);
  if (isPanel) {
    document.documentElement.classList.add('panel');
    if (navPage) navPage.classList.remove('hidden');
    if (navPage) navPage.addEventListener('click', () => switchTab(navPage, contentPage));
  }
```
> 注意：`navs`/`contents` 是 `const` 数组，但用 `.push()` 修改内容是允许的（不是重新赋值）。switchTab 遍历它们即可自动把 `#nav-page`/`#content-page` 纳入互斥切换。

- [ ] **Step 4: sandbox.js 跟随当前标签 + 默认进入「当前页」**

在上一步之后加入跟随逻辑（面板形态才启用）：
```js
  async function refreshCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const titleEl = document.getElementById('pageTitle');
      const urlEl = document.getElementById('pageUrl');
      const unavailable = document.getElementById('pageUnavailable');
      if (!tab) return;
      titleEl.textContent = tab.title || '(无标题)';
      urlEl.textContent = tab.url || '';
      urlEl.href = tab.url || '#';
      // 受限页面（无法注入内容脚本）
      const restricted = !tab.url || /^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/.test(tab.url);
      unavailable.classList.toggle('hidden', !restricted);
    } catch (e) { /* ignore */ }
  }

  if (isPanel) {
    refreshCurrentPage();
    chrome.tabs.onActivated.addListener(refreshCurrentPage);
    chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.title || info.url) refreshCurrentPage(); });
  }
```
并把现有「根据 `?tab` 切换初始标签」那段的末尾补上：当 `isPanel` 且未指定 `tab` 参数时，默认进入「当前页」。即在现有 `if (initialTab === 'text') { switchTab(navText, contentText); }` 之后追加：
```js
  else if (isPanel) {
    switchTab(navPage, contentPage);
  }
```

- [ ] **Step 5: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，从 popup 开侧边栏：
- 出现「当前页」标签且默认选中；标签页形态（从 popup 点「快捷翻译」开标签）**不**出现该标签；
- 「当前页」显示当前标签的标题/URL；切换浏览器标签、打开新网址时信息随之更新；
- 打开一个 `chrome://` 页面时显示「当前页面不可翻译」。

- [ ] **Step 6: Commit**
```bash
git add sandbox/index.html sandbox/sandbox.js
git commit -m "feat(sidepanel): add 当前页 tab that follows the active tab"
```

---

## Task 3: 划词联动（content 广播 → 面板接收翻译）

完成后：在网页选中文字，侧边栏「当前页」即时显示该文字并翻译。

**Files:**
- Modify: `content/selection.js`
- Modify: `sandbox/sandbox.js`

- [ ] **Step 1: content/selection.js 选区变化时广播选中文字**

在 `content/selection.js` 现有的 `document.addEventListener('mouseup', (e) => { ... })`（约 line 449）处理选区的逻辑中，取到选中文字后追加一次广播。具体：在该 handler 内已有 `const sel = window.getSelection();` 和取 `text` 的逻辑；在确认 `text` 非空的分支里加入：
```js
      // 广播给侧边栏面板（未打开则无接收者，忽略错误）
      chrome.runtime.sendMessage({ action: 'panelSelection', text }).catch(() => {});
```
> 该消息仅在用户划词（mouseup 且有选中文字）时发送，频率低、开销可忽略；面板未打开时 `sendMessage` 无接收端会 reject，`.catch(()=>{})` 静默处理，不需要 `storage.session` 门控。

- [ ] **Step 2: sandbox.js 接收 panelSelection 并翻译**

在 `sandbox/sandbox.js` 的 `if (isPanel) { ... }` 跟随逻辑附近，加入消息监听（仅面板形态注册）：
```js
  if (isPanel) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action !== 'panelSelection' || !msg.text) return;
      switchTab(navPage, contentPage);
      const selText = document.getElementById('pageSelectionText');
      const selResult = document.getElementById('pageSelectionResult');
      selText.textContent = msg.text;
      selResult.textContent = '翻译中…';
      if (testEngine) window.translator.engine = testEngine.value;
      if (testLang) window.translator.targetLang = testLang.value;
      window.translator.translate(msg.text)
        .then(t => { selResult.textContent = t; })
        .catch(() => { selResult.textContent = '翻译失败'; });
    });
  }
```
> sandbox.js 全程用 `window.translator`（`utils/translator.js` 暴露在 window 上的单例，见现有 sandbox.js line 148 `window.translator.init()` / line 170 `window.translator.translate()`）。此处复用同一单例与「文字」标签的引擎/目标语选择（`testEngine`/`testLang` 在同一 DOMContentLoaded 作用域内），不新建引擎逻辑。`window.translator.init()` 已在页面加载时调用过。

- [ ] **Step 3: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，开侧边栏后到任意普通网页选中一段文字：
- 侧边栏自动切到「当前页」标签，`划词联动` 区显示选中原文 + 译文；
- 面板未打开时网页划词照常弹出原有划词面板，无报错。

- [ ] **Step 4: Commit**
```bash
git add content/selection.js sandbox/sandbox.js
git commit -m "feat(sidepanel): live selection sync from page into the panel"
```

---

## Task 4: 翻译当前页按钮

完成后：「当前页」标签的「翻译/还原当前页」按钮能让当前网页进入/退出双语翻译。

**Files:**
- Modify: `sandbox/sandbox.js`

- [ ] **Step 1: 接线 translatePageBtn → 复用现有全页翻译 toggle**

在 `sandbox/sandbox.js` 的 `if (isPanel) { ... }` 区域加入：
```js
  if (isPanel) {
    const translatePageBtn = document.getElementById('translatePageBtn');
    if (translatePageBtn) {
      translatePageBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
        } catch (e) {
          document.getElementById('pageUnavailable').classList.remove('hidden');
        }
      });
    }
  }
```
> `content/content.js` 已监听 `{ action: 'toggle' }` 切换全页翻译；此处复用，不新增协议。受限页面 `sendMessage` 失败时显示不可翻译提示。

- [ ] **Step 2: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，开侧边栏，普通网页上点「翻译/还原当前页」：
- 网页进入双语翻译；再次点击还原；
- `chrome://` 等受限页面点击 → 显示「当前页面不可翻译」。

- [ ] **Step 3: Commit**
```bash
git add sandbox/sandbox.js
git commit -m "feat(sidepanel): translate current page from the panel button"
```

---

## Task 5: 窄面板响应式打磨

完成后：侧边栏窄宽度下 sandbox 布局不拥挤、可正常使用。

**Files:**
- Modify: `sandbox/sandbox.css`

- [ ] **Step 1: 加 `.panel` 窄宽响应式样式**

在 `sandbox/sandbox.css` 末尾追加（仅在 `<html class="panel">` 即面板形态生效，使用 daisyUI 5 颜色变量，不用 v4 短名）：
```css
/* ── 侧边栏（窄面板）形态 ── */
.panel body { width: 100%; }

/* 顶部导航在窄宽下换行紧凑 */
.panel .max-w-5xl { max-width: 100%; }

/* 文字标签的左右双栏在窄面板下改为上下堆叠 */
.panel #content-text { flex-direction: column; }

/* 收紧主要内边距 */
.panel #content-page,
.panel #content-image,
.panel #content-document,
.panel #content-website { padding: 1rem; }
```
> 若构建后发现某区域仍溢出，可按需补充最小规则；优先用已有 Tailwind 响应式类，自定义 CSS 保持最少。

- [ ] **Step 2: 构建 + 验收**

Run: `npm run build`
Expected: 成功。加载 `dist/`，开侧边栏逐标签查看：
- 文字标签源/译文上下堆叠不溢出；图片/文档/网站标签在窄宽下可正常操作；
- 主题切换、引擎选择等控件不被裁切。

- [ ] **Step 3: Commit**
```bash
git add sandbox/sandbox.css
git commit -m "style(sidepanel): responsive tweaks for narrow side-panel width"
```

---

## Task 6: 收尾 — 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 记录侧边栏形态**

在 CLAUDE.md 描述 `sandbox/` 的位置补充一句：sandbox 既可作为标签页打开，也可经 Chrome Side Panel API 以侧边栏打开（`?context=panel`），面板形态额外提供「当前页」标签（跟随活动标签、划词联动、翻译当前页）；入口为 popup 的「侧边栏」按钮与右键菜单。

- [ ] **Step 2: 全量构建 + 提交**
```bash
npm run build
git add CLAUDE.md
git commit -m "docs: note side-panel mode for sandbox in CLAUDE.md"
```

---

## Self-Review 记录

- **Spec 覆盖**：Side Panel API（Task1 manifest）、复用 sandbox + `?context=panel`（Task2）、四同步能力——停靠工作台（Task1 复用四工具）/跟随标签（Task2）/划词联动（Task3）/翻译当前页（Task4）、入口 popup+右键（Task1）、保留标签页形式（Task1 不动旧入口）、窄面板响应式（Task5）、受限页面与旧版优雅降级（Task1 Step3 隐藏、Task2/4 提示）——均有对应任务。
- **storage.session 风险**：按 spec 的回退方案落地——content 无条件广播 + `.catch`，无需 session 门控（Task3 Step1）。
- **占位符**：无 TBD/TODO；每步给出具体文件锚点与代码。Task3 Step2 有一处「确认 sandbox 翻译入口函数名并复用」的实现指示，因 sandbox 翻译调用细节需就地确认，已显式说明复用而非新建。
- **命名一致**：`?context=panel`、`isPanel`、`#nav-page`/`#content-page`、`panelSelection`、`#translatePageBtn`、`.panel` class 在各任务间一致引用。
- **不在范围**：四工具内部逻辑、标签页打开方式、translator/theme 模块明确排除。
