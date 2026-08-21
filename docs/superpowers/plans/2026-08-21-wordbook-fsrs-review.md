# 单词本 FSRS 间隔重复复习系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给单词本加上 FSRS 驱动的间隔重复复习调度，替换掉现在"标记已掌握就再也不会复习"的一次性开关，同时新增例句上下文、发音、popup 待复习提醒这几项配套功能。

**Architecture:** 新增 `utils/srs.js` 封装 `ts-fsrs` 库，作为 FSRS 算法的唯一入口；`wordbook/wordbook.js` 新增「今日复习」视图，读写每个词每个方向（recall/recognition）各自独立的 FSRS 调度状态；`content/selection.js` 在收藏单词时顺手捕获例句上下文；`utils/github-sync.js` 的 `mergeWordbook` 按字段结构类型（标量/字典/数组）扩展合并规则。

**Tech Stack:** Manifest V3 Chrome 扩展，Vite + `@crxjs/vite-plugin`，新增依赖 `ts-fsrs`（MIT，零依赖），复用已有的 `utils/tts.js`（`window.ttsManager`）。

**Spec:** `docs/superpowers/specs/2026-08-21-wordbook-fsrs-review-design.md`

## Global Constraints

- Manifest V3 插件，无测试框架/无 linter/无 typecheck。验证方式统一为：`npm run build` → 手动加载/刷新 `dist/`（真实浏览器交互按既有约定推迟给控制者事后补做，不阻塞任务完成；能静态核对的逻辑必须核对）。
- FSRS 算法只能通过 `utils/srs.js` 暴露的函数使用，其他文件不直接 `import 'ts-fsrs'`。
- `srs` 字段是开放字典（`{ [模式名]: FSRSCard }`），新增测验模式只加 key，不改数据结构。
- `contexts` 是数组，每次收藏词汇都追加一条，不覆盖旧的。
- FSRSCard 的 `due`/`last_review` 是 `Date` 对象，写入 `chrome.storage.local` 或经过 `JSON.stringify`（GitHub 同步）前必须先用 `serializeCard()` 转成 ISO 字符串；从 storage 读出后用 `deserializeCard()` 转回 `Date` 才能传给 `ts-fsrs`。
- `known: boolean` 字段废弃：新代码不再读也不再写；旧数据里如果还有这个字段，原样留着，不做清理迁移。
- `mergeWordbook`/`mergeHistories`/`syncHistoryNow`/`syncWordbookNow`/`syncNow`（`utils/github-sync.js` 现有导出）的对外接口（函数名、参数、返回值形状）必须保持不变。
- UI 文案与代码注释使用中文。Lucide 图标必须先加进 `utils/icons.js` 的白名单才能用。Git 提交信息使用本仓库既有的 conventional commit 前缀（`feat:`/`fix:`/`refactor:`/`docs:`/`perf:`）。

---

## Task 1: `ts-fsrs` 依赖 + `utils/srs.js`

**Files:**
- Modify: `package.json`
- Create: `utils/srs.js`

**Interfaces:**
- Produces：
  - `createCard(now?: Date): FSRSCard` —— 新建一张空卡（`state: New`）
  - `scheduleNext(card: FSRSCard, grade: 'again'|'hard'|'good'|'easy', now?: Date): FSRSCard` —— 按评分算出更新后的卡
  - `isDue(card: FSRSCard | null | undefined, now?: Date): boolean` —— 卡不存在（未初始化）或 `due <= now` 都算到期
  - `serializeCard(card: FSRSCard | null): object | null` —— `due`/`last_review` 转成 ISO 字符串，供写入 storage
  - `deserializeCard(raw: object | null): FSRSCard | null` —— 反向转换，供传给 `ts-fsrs` 使用

- [ ] **Step 1: 安装依赖**

Run: `npm install ts-fsrs`

Expected: `package.json` 的 `dependencies` 里出现类似 `"ts-fsrs": "^x.x.x"` 一行（具体版本号由 npm registry 决定，不用对照固定数字）。

- [ ] **Step 2: 把版本号从范围钉死成精确值**

打开 `package.json`，找到刚才 `npm install` 写入的那一行（形如 `"ts-fsrs": "^4.2.1"`，实际数字以你本机安装结果为准），去掉开头的 `^`，改成精确版本（比如 `"ts-fsrs": "4.2.1"`）。改完后重新跑一次 `npm install` 确认 `package-lock.json` 没有因为这个改动产生额外变化（应该没有，因为已经安装过这个精确版本）。

（这么做的原因：FSRS 算法未来的 major 版本可能调整参数含义，钉死版本号避免依赖自动升级悄悄改变已有用户的复习调度效果，跟这个仓库其他依赖不同、是这个库特有的谨慎处理。）

- [ ] **Step 3: 写 `utils/srs.js`**

```js
// FSRS（Free Spaced Repetition Scheduler）间隔重复算法的唯一入口：
// 其他文件只调用这里导出的函数，不直接 import 'ts-fsrs'，方便以后换算法
// 实现或调整参数时只改这一个文件。
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

const scheduler = fsrs();

const GRADE_TO_RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function createCard(now = new Date()) {
  return createEmptyCard(now);
}

export function scheduleNext(card, grade, now = new Date()) {
  const rating = GRADE_TO_RATING[grade];
  if (!rating) throw new Error(`未知的评分档位: ${grade}`);
  const result = scheduler.next(card, now, rating);
  return result.card;
}

export function isDue(card, now = new Date()) {
  if (!card) return true; // 还没初始化过的卡视为"待学习"，纳入复习队列
  return card.due <= now;
}

// chrome.storage 的写入、以及 GitHub 同步里的 JSON.stringify，都不能安全往返 Date 对象，
// 存储前统一转成 ISO 字符串，取出来后再用 deserializeCard 转回 Date 供 ts-fsrs 使用。
export function serializeCard(card) {
  if (!card) return card ?? null;
  return {
    ...card,
    due: card.due instanceof Date ? card.due.toISOString() : card.due,
    last_review: card.last_review instanceof Date ? card.last_review.toISOString() : card.last_review,
  };
}

export function deserializeCard(raw) {
  if (!raw) return raw ?? null;
  return {
    ...raw,
    due: raw.due ? new Date(raw.due) : raw.due,
    last_review: raw.last_review ? new Date(raw.last_review) : raw.last_review,
  };
}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建无报错。这个模块此时还没有调用方，功能验证放在后续任务。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json utils/srs.js
git commit -m "feat(wordbook): add ts-fsrs dependency and utils/srs.js wrapper"
```

---

## Task 2: `content/selection.js` 捕获例句上下文

**Files:**
- Modify: `content/selection.js`

**Interfaces:**
- Produces：保存的单词条目带 `contexts: Array<{ sentence, url, title, timestamp }>`，新收藏追加、更新已有条目也追加（不覆盖旧的）

- [ ] **Step 1: 加句子提取函数**

在 `content/selection.js` 的 `showPanel` 函数定义（当前文件里 `function showPanel(text, rect) {`）**之前**插入：

```js
  // 从一个 Range 所在的最近块级祖先元素里，找出包含选中文字的那一句话，
  // 作为收藏单词时的记忆上下文。找不到就返回空字符串，不影响主流程。
  const SENTENCE_BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FIGCAPTION'
  ]);

  function extractSentenceContext(range, selectedText) {
    try {
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

      let block = node;
      while (block && block !== document.body && !SENTENCE_BLOCK_TAGS.has(block.tagName)) {
        block = block.parentElement;
      }
      if (!block || block === document.body) return '';

      const blockText = block.textContent.replace(/\s+/g, ' ').trim();
      const needle = selectedText.trim();
      const idx = blockText.indexOf(needle);
      if (idx === -1) return '';

      const sentences = blockText.match(/[^。！？.!?]+[。！？.!?]?/g) || [blockText];
      let pos = 0;
      for (const s of sentences) {
        const start = pos;
        const end = pos + s.length;
        if (idx >= start && idx < end) {
          return s.trim().slice(0, 200);
        }
        pos = end;
      }
      return blockText.slice(0, 200);
    } catch (e) {
      return '';
    }
  }

```

- [ ] **Step 2: 声明模块级状态变量**

第 32-33 行原本是：

```js
  let pendingText = '';
  let pendingRect = null;
```

改成：

```js
  let pendingText = '';
  let pendingRect = null;
  let pendingSentence = '';
  let currentSentence = '';
```

- [ ] **Step 3: `translateSelection` 消息处理里捕获句子**

第 60-73 行原本是：

```js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'translateSelection') {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || msg.text;
      if (text && text.length >= 1) {
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const rect = range ? range.getBoundingClientRect() : {
          bottom: window.innerHeight / 2,
          right: window.innerWidth / 2,
          left: window.innerWidth / 2,
          top: window.innerHeight / 2
        };
        showPanel(text, rect);
      }
      sendResponse({ ok: true });
```

改成：

```js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'translateSelection') {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || msg.text;
      if (text && text.length >= 1) {
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const rect = range ? range.getBoundingClientRect() : {
          bottom: window.innerHeight / 2,
          right: window.innerWidth / 2,
          left: window.innerWidth / 2,
          top: window.innerHeight / 2
        };
        pendingSentence = range ? extractSentenceContext(range, text) : '';
        showPanel(text, rect);
      }
      sendResponse({ ok: true });
```

- [ ] **Step 4: `showPanel` 里把 `pendingSentence` 存成 `currentSentence`**

第 421-432 行原本是：

```js
  function showPanel(text, rect) {
    removeIcon();
    if (panel && !isPinned) forceRemovePanel();

    const engineResults = selectionEngines.map(id => ({
      id,
      name: Translator.ENGINES[id]?.name || id,
      loading: true, result: '', error: null
    }));

    historyPendingText = text;
    renderPanel(text, engineResults);
    positionPanel(rect);
```

改成：

```js
  function showPanel(text, rect) {
    removeIcon();
    if (panel && !isPinned) forceRemovePanel();

    const engineResults = selectionEngines.map(id => ({
      id,
      name: Translator.ENGINES[id]?.name || id,
      loading: true, result: '', error: null
    }));

    historyPendingText = text;
    currentSentence = pendingSentence;
    renderPanel(text, engineResults);
    positionPanel(rect);
```

- [ ] **Step 5: mouseup 处理（icon/direct 模式）里捕获句子**

第 459-463 行原本是：

```js
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingText = text;
      pendingRect = rect;
```

改成：

```js
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingText = text;
      pendingRect = rect;
      pendingSentence = extractSentenceContext(range, text);
```

- [ ] **Step 6: dblclick 处理里捕获句子**

第 496-499 行原本是：

```js
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPanel(text, rect);
```

改成：

```js
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingSentence = extractSentenceContext(range, text);
      showPanel(text, rect);
```

- [ ] **Step 7: 保存单词时把句子追加进 `contexts`**

第 220-239 行原本是：

```js
      const word = {
        id: crypto.randomUUID(),
        text: sourceText,
        translations,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      };

      // Save to storage
      const { wordbook = [] } = await chrome.storage.local.get('wordbook');
      // Avoid duplicates
      const exists = wordbook.findIndex(w => w.text.toLowerCase() === sourceText.toLowerCase());
      if (exists >= 0) {
        word.id = wordbook[exists].id || word.id; // 更新已有条目时保留原 id，避免不必要地重新生成
        wordbook[exists] = { ...wordbook[exists], ...word };
      } else {
        wordbook.unshift(word);
      }
      await chrome.storage.local.set({ wordbook });
      chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
```

改成：

```js
      const word = {
        id: crypto.randomUUID(),
        text: sourceText,
        translations,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      };

      const newContext = currentSentence
        ? [{ sentence: currentSentence, url: window.location.href, title: document.title, timestamp: Date.now() }]
        : [];

      // Save to storage
      const { wordbook = [] } = await chrome.storage.local.get('wordbook');
      // Avoid duplicates
      const exists = wordbook.findIndex(w => w.text.toLowerCase() === sourceText.toLowerCase());
      if (exists >= 0) {
        word.id = wordbook[exists].id || word.id; // 更新已有条目时保留原 id，避免不必要地重新生成
        const existingContexts = wordbook[exists].contexts || [];
        wordbook[exists] = { ...wordbook[exists], ...word, contexts: [...existingContexts, ...newContext] };
      } else {
        word.contexts = newContext;
        wordbook.unshift(word);
      }
      await chrome.storage.local.set({ wordbook });
      chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
```

- [ ] **Step 8: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对：`extractSentenceContext` 全程包在 `try/catch` 里，任何异常都返回空字符串，不会让保存单词这个核心流程失败；`contexts` 在"新建"和"更新已有条目"两条分支里都不会丢失历史数据（更新分支是 `[...existingContexts, ...newContext]` 而不是直接覆盖）。

浏览器交互验证（打开一个网页、划词收藏单词、检查 `chrome.storage.local` 里 `wordbook` 条目的 `contexts` 数组是否有内容）由控制者事后补做。

- [ ] **Step 9: Commit**

```bash
git add content/selection.js
git commit -m "feat(wordbook): capture sentence context when saving a word"
```

---

## Task 3: `wordbook/wordbook.js` 并发写入保护

**Files:**
- Modify: `wordbook/wordbook.js`

**Interfaces:**
- Produces：`applySearchFilter()`（内部函数，根据当前搜索框的值重新计算 `filteredWords`）

- [ ] **Step 1: 抽出 `applySearchFilter` 辅助函数，供搜索和外部变更监听共用**

第 59-71 行原本是：

```js
  // ========== Search ==========
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      filteredWords = [...wordbook];
    } else {
      filteredWords = wordbook.filter(w =>
        w.text.toLowerCase().includes(q) ||
        Object.values(w.translations || {}).some(t => t.toLowerCase().includes(q))
      );
    }
    renderList();
  });
```

改成：

```js
  // ========== Search ==========
  function applySearchFilter() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!q) {
      filteredWords = [...wordbook];
    } else {
      filteredWords = wordbook.filter(w =>
        w.text.toLowerCase().includes(q) ||
        Object.values(w.translations || {}).some(t => t.toLowerCase().includes(q))
      );
    }
  }

  document.getElementById('searchInput').addEventListener('input', () => {
    applySearchFilter();
    renderList();
  });
```

- [ ] **Step 2: 加 `chrome.storage.onChanged` 监听**

在 `saveWordbook` 函数定义（`async function saveWordbook() { ... }`）之后紧跟着插入：

```js

  // 后台自动同步可能在用户复习/浏览期间把远端合并结果写回 wordbook，如果不监听
  // 就会被内存里的旧快照在下次保存时覆盖掉。任何外部变更都重新读取 + 重渲染当前视图，
  // 顺带重新应用搜索框里已经输入的关键字，不会打断用户正在做的筛选。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wordbook) {
      wordbook = changes.wordbook.newValue || [];
      applySearchFilter();
      render();
    }
  });
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 无报错。

背景页 Console（`chrome://extensions/` →「服务工作线程」）手动验证（由控制者事后补做）：打开单词本页面，在背景页 Console 执行

```js
chrome.storage.local.get('wordbook', r => {
  const wb = r.wordbook || [];
  wb.push({ id: crypto.randomUUID(), text: 'test-sync-word', translations: { google: '测试同步词' }, timestamp: Date.now(), contexts: [] });
  chrome.storage.local.set({ wordbook: wb });
});
```

Expected：不刷新页面的情况下，单词本页面的列表/计数会自动出现这个新词。

- [ ] **Step 4: Commit**

```bash
git add wordbook/wordbook.js
git commit -m "feat(wordbook): reload on external storage changes to avoid clobbering background sync"
```

---

## Task 4: 已掌握徽章改为从 `srs.recall` 派生，移除手动标记

**Files:**
- Modify: `wordbook/wordbook.js`
- Modify: `wordbook/index.html`

**Interfaces:**
- Consumes：`isDue`、`deserializeCard`（Task 1 的 `utils/srs.js`）
- Produces：`getMasteryBadge(word): { text: string, cls: string }`、`isMastered(word): boolean`

- [ ] **Step 1: 加 import**

第 5-7 行原本是：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
```

改成：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { isDue, deserializeCard } from '../utils/srs.js';
```

- [ ] **Step 2: 加徽章派生函数**

在 `escapeHtml` 函数定义（`function escapeHtml(str) { ... }`）之前插入：

```js
  // 稳定性达到约 3 周（21 天）视为"已掌握"，这是一个可调阈值，不是 FSRS 算法本身规定的。
  const MASTERED_STABILITY_DAYS = 21;

  function isMastered(word) {
    const raw = word.srs?.recall;
    if (!raw || raw.reps === 0) return false;
    return deserializeCard(raw).stability >= MASTERED_STABILITY_DAYS;
  }

  function getMasteryBadge(word) {
    const raw = word.srs?.recall;
    if (!raw || raw.reps === 0) return { text: '未学习', cls: 'badge-ghost' };
    const card = deserializeCard(raw);
    if (card.stability >= MASTERED_STABILITY_DAYS) return { text: '已掌握', cls: 'badge-success' };
    if (isDue(card)) return { text: '待复习', cls: 'badge-warning' };
    return { text: '学习中', cls: 'badge-info' };
  }

```

- [ ] **Step 3: `renderList()` 改用新徽章，移除手动切换按钮**

第 87-137 行（`renderList` 函数体）原本是：

```js
    container.innerHTML = filteredWords.map((w, i) => {
      const translations = Object.entries(w.translations || {}).map(([engine, text]) =>
        `<div class="flex gap-2 items-baseline text-sm">
          <span class="badge badge-ghost badge-sm shrink-0">${ENGINE_NAMES[engine] || engine}</span>
          <span class="text-base-content/80">${escapeHtml(text)}</span>
        </div>`
      ).join('');

      const status = w.known
        ? '<span class="badge badge-success badge-sm">已掌握</span>'
        : '<span class="badge badge-warning badge-sm">学习中</span>';

      const time = new Date(w.timestamp).toLocaleDateString('zh-CN');
      const source = w.url
        ? `<a href="${escapeHtml(w.url)}" target="_blank" class="link link-hover text-xs text-base-content/50" title="${escapeHtml(w.title || w.url)}">${escapeHtml(w.title || '来源页面')}</a>`
        : '';

      return `
        <div class="card bg-base-100 shadow word-card" data-index="${i}">
          <div class="card-body gap-2 p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="font-bold text-lg text-base-content">${escapeHtml(w.text)}</div>
              <div class="flex gap-1 shrink-0">
                <button class="btn btn-ghost btn-xs toggle-known" title="${w.known ? '标记为未掌握' : '标记为已掌握'}">
                  <i data-lucide="${w.known ? 'check-circle' : 'circle'}" class="w-4 h-4 ${w.known ? 'text-success' : 'text-base-content/40'}"></i>
                </button>
                <button class="btn btn-ghost btn-xs delete-word" title="删除">
                  <i data-lucide="trash-2" class="w-4 h-4 text-error/60"></i>
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-1">${translations}</div>
            <div class="flex items-center gap-2 mt-1">${status} <span class="text-xs text-base-content/40">${time}</span> ${source}</div>
          </div>
        </div>
      `;
    }).join('');
    createIcons({ icons });

    // Bind card events
    container.querySelectorAll('.toggle-known').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        const realIdx = wordbook.indexOf(filteredWords[idx]);
        wordbook[realIdx].known = !wordbook[realIdx].known;
        filteredWords[idx].known = wordbook[realIdx].known;
        saveWordbook();
        renderList();
      });
    });

    container.querySelectorAll('.delete-word').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        const realIdx = wordbook.indexOf(filteredWords[idx]);
        wordbook.splice(realIdx, 1);
        filteredWords.splice(idx, 1);
        saveWordbook();
        render();
      });
    });
  }
```

改成：

```js
    container.innerHTML = filteredWords.map((w, i) => {
      const translations = Object.entries(w.translations || {}).map(([engine, text]) =>
        `<div class="flex gap-2 items-baseline text-sm">
          <span class="badge badge-ghost badge-sm shrink-0">${ENGINE_NAMES[engine] || engine}</span>
          <span class="text-base-content/80">${escapeHtml(text)}</span>
        </div>`
      ).join('');

      const badge = getMasteryBadge(w);
      const status = `<span class="badge ${badge.cls} badge-sm">${badge.text}</span>`;

      const time = new Date(w.timestamp).toLocaleDateString('zh-CN');
      const source = w.url
        ? `<a href="${escapeHtml(w.url)}" target="_blank" class="link link-hover text-xs text-base-content/50" title="${escapeHtml(w.title || w.url)}">${escapeHtml(w.title || '来源页面')}</a>`
        : '';

      return `
        <div class="card bg-base-100 shadow word-card" data-index="${i}">
          <div class="card-body gap-2 p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="font-bold text-lg text-base-content">${escapeHtml(w.text)}</div>
              <div class="flex gap-1 shrink-0">
                <button class="btn btn-ghost btn-xs delete-word" title="删除">
                  <i data-lucide="trash-2" class="w-4 h-4 text-error/60"></i>
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-1">${translations}</div>
            <div class="flex items-center gap-2 mt-1">${status} <span class="text-xs text-base-content/40">${time}</span> ${source}</div>
          </div>
        </div>
      `;
    }).join('');
    createIcons({ icons });

    // Bind card events
    container.querySelectorAll('.delete-word').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        const realIdx = wordbook.indexOf(filteredWords[idx]);
        wordbook.splice(realIdx, 1);
        filteredWords.splice(idx, 1);
        saveWordbook();
        render();
      });
    });
  }
```

- [ ] **Step 4: 移除卡片学习视图的"认识/不认识"按钮（`wordbook/index.html`）**

`wordbook/index.html` 里第 135-149 行原本是：

```html
            <!-- Card actions -->
            <div class="flex justify-center gap-3">
              <button id="cardKnow" class="btn btn-success btn-sm gap-1">
                <i data-lucide="check-circle" class="w-4 h-4"></i>
                认识
              </button>
              <button id="cardDontKnow" class="btn btn-warning btn-sm gap-1">
                <i data-lucide="help-circle" class="w-4 h-4"></i>
                不认识
              </button>
              <button id="cardShuffle" class="btn btn-secondary btn-sm gap-1">
                <i data-lucide="shuffle" class="w-4 h-4"></i>
                随机
              </button>
            </div>
```

改成：

```html
            <!-- Card actions -->
            <div class="flex justify-center gap-3">
              <button id="cardShuffle" class="btn btn-secondary btn-sm gap-1">
                <i data-lucide="shuffle" class="w-4 h-4"></i>
                随机
              </button>
            </div>
```

- [ ] **Step 5: 移除对应的事件监听（`wordbook/wordbook.js`）**

第 198-212 行原本是：

```js
  document.getElementById('cardKnow').addEventListener('click', () => {
    if (wordbook.length === 0) return;
    wordbook[cardIndex].known = true;
    saveWordbook();
    if (cardIndex < wordbook.length - 1) { cardIndex++; }
    renderCard();
  });

  document.getElementById('cardDontKnow').addEventListener('click', () => {
    if (wordbook.length === 0) return;
    wordbook[cardIndex].known = false;
    saveWordbook();
    if (cardIndex < wordbook.length - 1) { cardIndex++; }
    renderCard();
  });

  document.getElementById('cardShuffle').addEventListener('click', () => {
```

改成：

```js
  document.getElementById('cardShuffle').addEventListener('click', () => {
```

- [ ] **Step 6: `renderStats()` 改用 `isMastered`**

第 305-322 行（`renderStats` 函数体开头部分）原本是：

```js
  function renderStats() {
    const total = wordbook.length;
    const known = wordbook.filter(w => w.known).length;
    const unknown = total - known;
```

改成：

```js
  function renderStats() {
    const total = wordbook.length;
    const known = wordbook.filter(isMastered).length;
    const unknown = total - known;
```

- [ ] **Step 7: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对：`getCardIndex`/`.delete-word` 等仍然正常工作（这次改动只删除了 `.toggle-known` 相关代码块，没有动 `getCardIndex` 函数本身）；新词（没有 `srs.recall`）在列表页显示"未学习"徽章。

- [ ] **Step 8: Commit**

```bash
git add wordbook/wordbook.js wordbook/index.html
git commit -m "refactor(wordbook): derive mastery badge from srs.recall, drop manual known toggle"
```

---

## Task 5: 「今日复习」视图 —— 队列、会话流程、两种题型、发音、popup 入口

**Files:**
- Modify: `wordbook/index.html`
- Modify: `wordbook/wordbook.js`
- Modify: `utils/icons.js`

**Interfaces:**
- Consumes：`createCard`、`scheduleNext`、`isDue`、`serializeCard`、`deserializeCard`（Task 1）；`window.ttsManager`（已有 `utils/tts.js`）
- Produces：`buildReviewQueue()`、`findWordByKey(key)`、`initReview()`、`renderReviewQuestion()`、`recordReviewResult(word, mode, grade)`、`renderRecallQuestion(word)`、`renderRecognitionQuestion(word)` —— 均为 `wordbook.js` 内部函数，不导出；`wordbook/index.html?view=review` 这个查询参数会让页面加载后直接跳到复习视图（供 Task 6 的 popup 入口跳转用）

这是本计划里最大的一个任务，因为"今日复习"是一个只有队列+会话流程+两种题型渲染器同时存在才能真正跑通、测出来的功能，拆得更细会导致某个子任务提交后应用直接报错（后面的渲染函数还不存在）。

- [ ] **Step 1: `utils/icons.js` 加 `Plus` 图标**

```js
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, BarChart2, BookOpen, Check, CheckCircle,
  CloudSync, Copy, Database, Download, ExternalLink, File, FileText, Globe, Globe2, HelpCircle,
  History, Image, Inbox, Info, Keyboard, Languages, Layers, List, Mic, Monitor, Moon,
  MousePointer2, Package, PackageOpen, Palette, PanelRight, PenLine, Plus, RotateCcw, RotateCw, SearchX,
  Settings, Settings2, Share2, Shuffle, SkipForward, Star, Sun, Trash2, Upload,
  Volume2, X, Zap,
} from 'lucide';

export const icons = {
  ArrowLeft, ArrowLeftRight, ArrowRight, BarChart2, BookOpen, Check, CheckCircle,
  CloudSync, Copy, Database, Download, ExternalLink, File, FileText, Globe, Globe2, HelpCircle,
  History, Image, Inbox, Info, Keyboard, Languages, Layers, List, Mic, Monitor, Moon,
  MousePointer2, Package, PackageOpen, Palette, PanelRight, PenLine, Plus, RotateCcw, RotateCw, SearchX,
  Settings, Settings2, Share2, Shuffle, SkipForward, Star, Sun, Trash2, Upload,
  Volume2, X, Zap,
};
```

- [ ] **Step 2: `wordbook/index.html` 加导航项 + TTS 脚本引入**

第 24-51 行（`<nav>` 里的菜单）原本是：

```html
      <nav class="flex-1 py-2">
        <ul class="menu menu-md gap-0.5 w-full px-0">
          <li>
            <a href="#" class="nav-item active" data-view="list">
              <i data-lucide="list" class="w-4 h-4"></i>
              单词列表
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="cards">
              <i data-lucide="layers" class="w-4 h-4"></i>
              卡片学习
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="quiz">
              <i data-lucide="pen-line" class="w-4 h-4"></i>
              拼写测验
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="stats">
              <i data-lucide="bar-chart-2" class="w-4 h-4"></i>
              学习统计
            </a>
          </li>
        </ul>
      </nav>
```

改成：

```html
      <nav class="flex-1 py-2">
        <ul class="menu menu-md gap-0.5 w-full px-0">
          <li>
            <a href="#" class="nav-item active" data-view="review">
              <i data-lucide="rotate-cw" class="w-4 h-4"></i>
              今日复习
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="list">
              <i data-lucide="list" class="w-4 h-4"></i>
              单词列表
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="cards">
              <i data-lucide="layers" class="w-4 h-4"></i>
              卡片学习
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="quiz">
              <i data-lucide="pen-line" class="w-4 h-4"></i>
              拼写测验
            </a>
          </li>
          <li>
            <a href="#" class="nav-item" data-view="stats">
              <i data-lucide="bar-chart-2" class="w-4 h-4"></i>
              学习统计
            </a>
          </li>
        </ul>
      </nav>
```

**注意**：这里把「今日复习」设成默认 `active`（`class="nav-item active"`），原本「单词列表」的 `active` 要去掉（改成 `class="nav-item"`，已经体现在上面的替换里）——「今日复习」现在是新的默认首屏视图。

- [ ] **Step 3: `wordbook/index.html` 加复习视图容器**

第 91-98 行（List View 前面）原本是：

```html
        <!-- List View -->
        <div id="listView" class="view active">
```

改成：

```html
        <!-- Review View -->
        <div id="reviewView" class="view active">
          <div class="max-w-xl mx-auto mt-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-semibold">今日复习</h2>
              <span class="badge badge-primary badge-lg" id="reviewDueCount">0</span>
            </div>

            <div id="reviewQuestion"></div>

            <div id="reviewEmpty" class="flex flex-col items-center justify-center py-16 text-base-content/50" style="display:none">
              <i data-lucide="check-circle" class="w-16 h-16 mb-4 text-success/60"></i>
              <h3 class="text-lg font-semibold mb-1 text-base-content/60">今天的复习完成了 🎉</h3>
              <button id="reviewLearnNewBtn" class="btn btn-primary btn-sm mt-4 gap-1">
                <i data-lucide="plus" class="w-4 h-4"></i>
                提前学新词
              </button>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div id="listView" class="view">
```

**注意**：原本 `listView` 的 `class="view active"` 要去掉 `active`（改成 `class="view"`，已经体现在上面的替换里）——「今日复习」现在是默认激活的视图。

- [ ] **Step 4: `wordbook/index.html` 引入 `tts.js`**

文件末尾原本是：

```html
  <script type="module" src="wordbook.js"></script>
</body>
</html>
```

改成：

```html
  <script type="module" src="../utils/tts.js"></script>
  <script type="module" src="wordbook.js"></script>
</body>
</html>
```

- [ ] **Step 5: `wordbook/wordbook.js` 扩展 import**

第 5-8 行（Task 4 已经加过 `isDue`/`deserializeCard`）：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { isDue, deserializeCard } from '../utils/srs.js';
```

改成：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { createCard, scheduleNext, isDue, serializeCard, deserializeCard } from '../utils/srs.js';
```

- [ ] **Step 6: `switchView` 支持 `review`，读取 URL 查询参数**

第 14 行（模块状态声明）原本是：

```js
  let currentView = 'list';
```

改成：

```js
  let currentView = 'review';
```

第 47-57 行（`switchView` 函数）原本是：

```js
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(view + 'View')?.classList.add('active');

    if (view === 'cards') initCards();
    if (view === 'quiz') initQuiz();
    if (view === 'stats') renderStats();
  }
```

改成：

```js
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(view + 'View')?.classList.add('active');

    if (view === 'review') initReview();
    if (view === 'cards') initCards();
    if (view === 'quiz') initQuiz();
    if (view === 'stats') renderStats();
  }
```

在文件末尾的「Start」区块里，第 393-399 行原本是：

```js
  // ========== Start ==========
  await applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  createIcons({ icons });
  await loadWordbook();
})();
```

改成：

```js
  // ========== Start ==========
  await applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  await window.ttsManager.init();
  createIcons({ icons });
  await loadWordbook();

  const requestedView = new URLSearchParams(location.search).get('view');
  if (requestedView && document.getElementById(requestedView + 'View')) {
    switchView(requestedView);
  } else {
    switchView('review');
  }
})();
```

（`loadWordbook()` 内部会调用 `render()`，但 `render()` 只更新单词列表相关的元素，不会主动切视图；这里显式调用一次 `switchView` 确保页面加载时"今日复习"视图真正初始化过一次，同时处理 popup 跳转带来的 `?view=review` 参数——不过因为 review 已经是默认视图，这个参数目前主要是为了未来"跳到别的具体视图"留出口子，行为上不会有变化。）

- [ ] **Step 7: 队列构建**

在 `initQuiz` 函数定义（`function initQuiz() { ... }`）之前插入：

```js
  // ========== Review (FSRS) ==========
  function findWordByKey(key) {
    return wordbook.find(w => w.text.toLowerCase() === key);
  }

  function buildReviewQueue() {
    const now = new Date();
    const queue = [];
    wordbook.forEach((w) => {
      ['recall', 'recognition'].forEach((mode) => {
        const raw = w.srs?.[mode];
        const card = raw ? deserializeCard(raw) : null;
        if (isDue(card, now)) {
          queue.push({ key: w.text.toLowerCase(), mode });
        }
      });
    });
    shuffleInPlace(queue);
    return queue;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

```

- [ ] **Step 8: 会话流程编排**

紧接着 Step 7 插入的代码之后，继续插入：

```js
  let reviewQueue = [];
  let reviewIndex = 0;

  function initReview() {
    reviewQueue = buildReviewQueue();
    reviewIndex = 0;
    renderReviewQuestion();
  }

  function renderReviewQuestion() {
    const dueCountEl = document.getElementById('reviewDueCount');
    const emptyEl = document.getElementById('reviewEmpty');
    const questionEl = document.getElementById('reviewQuestion');

    if (reviewIndex >= reviewQueue.length) {
      questionEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      dueCountEl.textContent = '0';
      createIcons({ icons });
      return;
    }

    const item = reviewQueue[reviewIndex];
    const word = findWordByKey(item.key);
    if (!word) {
      // 复习队列生成之后、答到这道题之前，这个词被删掉了：跳过。
      reviewIndex++;
      renderReviewQuestion();
      return;
    }

    emptyEl.style.display = 'none';
    questionEl.style.display = '';
    dueCountEl.textContent = String(reviewQueue.length - reviewIndex);

    if (item.mode === 'recall') {
      renderRecallQuestion(word);
    } else {
      renderRecognitionQuestion(word);
    }
  }

  async function recordReviewResult(word, mode, grade) {
    const now = new Date();
    const raw = word.srs?.[mode];
    const card = raw ? deserializeCard(raw) : createCard(now);
    const nextCard = scheduleNext(card, grade, now);

    const idx = wordbook.findIndex(w => w.text.toLowerCase() === word.text.toLowerCase());
    if (idx >= 0) {
      wordbook[idx].srs = wordbook[idx].srs || {};
      wordbook[idx].srs[mode] = serializeCard(nextCard);
      await saveWordbook();
    }

    reviewIndex++;
    renderReviewQuestion();
  }

  document.getElementById('reviewLearnNewBtn').addEventListener('click', () => {
    const newQueue = [];
    wordbook.forEach((w) => {
      ['recall', 'recognition'].forEach((mode) => {
        if (!w.srs?.[mode]) newQueue.push({ key: w.text.toLowerCase(), mode });
      });
    });
    shuffleInPlace(newQueue);
    reviewQueue = newQueue;
    reviewIndex = 0;
    renderReviewQuestion();
  });

```

- [ ] **Step 9: recall 方向题型渲染**

紧接着 Step 8 插入的代码之后，继续插入：

```js
  function reviewSentenceHtml(word) {
    const ctx = word.contexts && word.contexts.length > 0 ? word.contexts[word.contexts.length - 1] : null;
    if (!ctx || !ctx.sentence) return '';
    return `<div class="text-sm text-base-content/50 italic mt-2">${escapeHtml(ctx.sentence)}</div>`;
  }

  function renderRecallQuestion(word) {
    const trans = Object.values(word.translations || {});
    const prompt = trans[0] || '???';
    document.getElementById('reviewQuestion').innerHTML = `
      <div class="card bg-base-100 shadow-sm rounded-xl mb-4">
        <div class="card-body gap-4">
          <div class="text-xl text-base-content/70 leading-relaxed">${escapeHtml(prompt)}</div>
          <input type="text" id="reviewRecallInput" class="input input-bordered text-center text-lg" placeholder="输入单词..." autocomplete="off" />
          <div id="reviewRecallFeedback" class="quiz-feedback text-base font-semibold min-h-6"></div>
          <div id="reviewRecallGrades" class="flex justify-center gap-2" style="display:none">
            <button class="btn btn-sm btn-outline" data-grade="hard">困难</button>
            <button class="btn btn-sm btn-outline" data-grade="good">记得</button>
            <button class="btn btn-sm btn-outline" data-grade="easy">简单</button>
          </div>
          ${reviewSentenceHtml(word)}
        </div>
      </div>
    `;

    const input = document.getElementById('reviewRecallInput');
    input.focus();

    function check() {
      const answer = input.value.trim().toLowerCase();
      const correct = word.text.toLowerCase();
      const feedback = document.getElementById('reviewRecallFeedback');
      input.disabled = true;

      if (answer === correct) {
        feedback.textContent = '✅ 正确！选一个难易度：';
        feedback.className = 'quiz-feedback correct';
        document.getElementById('reviewRecallGrades').style.display = 'flex';
      } else {
        feedback.textContent = `❌ 正确答案: ${word.text}`;
        feedback.className = 'quiz-feedback wrong';
        setTimeout(() => recordReviewResult(word, 'recall', 'again'), 900);
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !input.disabled) check();
    });

    document.getElementById('reviewRecallGrades').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => recordReviewResult(word, 'recall', btn.dataset.grade));
    });
  }

```

- [ ] **Step 10: recognition 方向题型渲染 + 发音**

紧接着 Step 9 插入的代码之后，继续插入：

```js
  function renderRecognitionQuestion(word) {
    const correctAnswer = Object.values(word.translations || {})[0] || '';
    const distractorPool = wordbook
      .filter(w => w.text.toLowerCase() !== word.text.toLowerCase())
      .map(w => Object.values(w.translations || {})[0])
      .filter(Boolean);
    const distractors = shuffleInPlace([...distractorPool]).slice(0, 3);
    const options = shuffleInPlace([correctAnswer, ...distractors].filter(Boolean));

    document.getElementById('reviewQuestion').innerHTML = `
      <div class="card bg-base-100 shadow-sm rounded-xl mb-4">
        <div class="card-body gap-4">
          <div class="flex items-center justify-center gap-2">
            <div class="text-3xl font-bold">${escapeHtml(word.text)}</div>
            <button id="reviewSpeakBtn" class="btn btn-ghost btn-sm btn-circle" title="发音">
              <i data-lucide="volume-2" class="w-4 h-4"></i>
            </button>
          </div>
          <div class="flex flex-col gap-2" id="reviewOptions">
            ${options.map(opt => `<button class="btn btn-outline justify-start" data-option="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
          </div>
          ${reviewSentenceHtml(word)}
        </div>
      </div>
    `;
    createIcons({ icons });

    const startedAt = Date.now();

    document.getElementById('reviewSpeakBtn').addEventListener('click', () => {
      window.ttsManager.speak(word.text, 'auto');
    });

    document.getElementById('reviewOptions').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const elapsed = Date.now() - startedAt;
        const isCorrect = btn.dataset.option === correctAnswer;
        const optionButtons = document.getElementById('reviewOptions').querySelectorAll('button');
        optionButtons.forEach(b => { b.disabled = true; });
        btn.classList.add(isCorrect ? 'btn-success' : 'btn-error');
        if (!isCorrect) {
          const correctBtn = [...optionButtons].find(b => b.dataset.option === correctAnswer);
          correctBtn?.classList.add('btn-success');
        }

        let grade;
        if (!isCorrect) {
          grade = 'again';
        } else if (elapsed < 2000) {
          grade = 'easy';
        } else if (elapsed < 5000) {
          grade = 'good';
        } else {
          grade = 'hard';
        }

        setTimeout(() => recordReviewResult(word, 'recognition', grade), 700);
      });
    });
  }

```

- [ ] **Step 11: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对以下几点：
- `renderReviewQuestion` 调用的 `renderRecallQuestion`/`renderRecognitionQuestion` 都已经在 Step 9/10 定义，且都是 `function` 声明（会被提升），跟 Step 8 里 `renderReviewQuestion` 的定义顺序无关
- `recordReviewResult` 写回的是 `wordbook[idx].srs[mode] = serializeCard(nextCard)`，跟 Task 4 的 `getMasteryBadge`/`isMastered` 读的 `word.srs?.recall` 是同一个字段路径
- `reviewSentenceHtml` 对 `word.contexts` 缺失（`undefined`，比如 sandbox 保存的词）做了防护，不会抛异常
- `window.ttsManager` 通过 Step 4 新增的 `<script type="module" src="../utils/tts.js"></script>` 标签在 `wordbook.js` 之前加载，Step 6 的 `await window.ttsManager.init()` 能正常拿到这个全局对象

浏览器交互验证（打开单词本页面，确认默认停在"今日复习"、有到期词时能正常答题、FSRS 状态正确写回、干扰项不重复、发音按钮有声音、队列耗尽后"提前学新词"能正常工作）由控制者事后补做。

- [ ] **Step 12: Commit**

```bash
git add wordbook/index.html wordbook/wordbook.js utils/icons.js
git commit -m "feat(wordbook): add FSRS-driven daily review view (recall + recognition)"
```

---

## Task 6: `utils/github-sync.js` 的 `mergeWordbook` 扩展合并规则

**Files:**
- Modify: `utils/github-sync.js`

**Interfaces:**
- Consumes：无新依赖（不需要 import `utils/srs.js`，合并时只比较 `last_review` 字符串，不需要真的反序列化成 `Date` 对象来跑 FSRS 计算）
- Produces：`mergeWordbook(local, remote)` 签名不变，返回的条目额外带 `contexts`/`srs` 字段

- [ ] **Step 1: 扩展合并逻辑**

第 194-225 行（`mergeWordbook` 函数）原本是：

```js
export function mergeWordbook(local, remote) {
  const byText = new Map();
  // remote 在前、local 在后：同一个 key 第二次出现时（一定是 local）该次的字段优先，
  // 从而实现"本地同引擎覆盖远端"的约定；known/timestamp 用哪边都一样
  // （|| 和 Math.min 本身顺序无关）。
  // id 字段是唯一的例外：取 prior（远端）优先，而不是本地优先。id 不参与任何展示/业务逻辑，
  // 只用于去重；一旦"本地优先"，两台设备互推时 id 会在两个随机值之间来回切换——内容完全没变
  // 也会产生一次无意义的 commit/版本变更。远端优先能让 id 在第一次推送后收敛、不再变化。
  [...remote, ...local].forEach((entry) => {
    // 远端文件可能被手动编辑成畸形数据（缺 text 或整条为 null），跳过而不是让 toLowerCase() 抛异常。
    const key = entry?.text?.toLowerCase();
    if (!key) return;
    const prior = byText.get(key);
    if (!prior) {
      byText.set(key, entry);
      return;
    }
    const priorTs = prior.timestamp ?? Infinity;
    const entryTs = entry.timestamp ?? Infinity;
    const minTs = Math.min(priorTs, entryTs);
    byText.set(key, {
      id: prior.id || entry.id,
      text: prior.text,
      translations: { ...prior.translations, ...entry.translations },
      known: prior.known || entry.known,
      timestamp: minTs === Infinity ? Date.now() : minTs,
      url: entry.url || prior.url,
      title: entry.title || prior.title,
    });
  });
  return Array.from(byText.values()).sort((a, b) => b.timestamp - a.timestamp);
}
```

改成：

```js
// contexts 数组按 sentence+url 去重取并集：每条上下文是独立的"捕获事件"，
// 不是会演变的状态，两边各自收集的都要保留，不能"新覆盖旧"。
function mergeContexts(a = [], b = []) {
  const seen = new Map();
  [...a, ...b].forEach((ctx) => {
    if (!ctx?.sentence) return;
    const key = `${ctx.sentence}|${ctx.url || ''}`;
    if (!seen.has(key)) seen.set(key, ctx);
  });
  return Array.from(seen.values());
}

// srs 是"模式名 -> FSRSCard"的开放字典：按 key 遍历合并，某个 key 只在一边存在时
// 直接取那一边；两边都有同一个 key 时，取 last_review 较新的那一整张卡（不拆开卡内部
// 字段合并，因为 FSRS 的 difficulty/stability 等字段彼此关联，混着来会破坏算法的假设）。
// 这条"字典型字段按 key 合并、每个 key 内部整体取更优先一方"的约定，供以后任何新增的
// 字典型字段（比如未来的听力模式）复用，不需要每次新增字段都重新设计一遍合并规则。
function mergeSrs(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result = {};
  keys.forEach((mode) => {
    const cardA = a[mode];
    const cardB = b[mode];
    if (!cardA) { result[mode] = cardB; return; }
    if (!cardB) { result[mode] = cardA; return; }
    const tsA = cardA.last_review ? new Date(cardA.last_review).getTime() : 0;
    const tsB = cardB.last_review ? new Date(cardB.last_review).getTime() : 0;
    result[mode] = tsA >= tsB ? cardA : cardB;
  });
  return result;
}

export function mergeWordbook(local, remote) {
  const byText = new Map();
  // remote 在前、local 在后：同一个 key 第二次出现时（一定是 local）该次的字段优先，
  // 从而实现"本地同引擎覆盖远端"的约定；known/timestamp 用哪边都一样
  // （|| 和 Math.min 本身顺序无关）。
  // id 字段是唯一的例外：取 prior（远端）优先，而不是本地优先。id 不参与任何展示/业务逻辑，
  // 只用于去重；一旦"本地优先"，两台设备互推时 id 会在两个随机值之间来回切换——内容完全没变
  // 也会产生一次无意义的 commit/版本变更。远端优先能让 id 在第一次推送后收敛、不再变化。
  [...remote, ...local].forEach((entry) => {
    // 远端文件可能被手动编辑成畸形数据（缺 text 或整条为 null），跳过而不是让 toLowerCase() 抛异常。
    const key = entry?.text?.toLowerCase();
    if (!key) return;
    const prior = byText.get(key);
    if (!prior) {
      byText.set(key, entry);
      return;
    }
    const priorTs = prior.timestamp ?? Infinity;
    const entryTs = entry.timestamp ?? Infinity;
    const minTs = Math.min(priorTs, entryTs);
    byText.set(key, {
      id: prior.id || entry.id,
      text: prior.text,
      translations: { ...prior.translations, ...entry.translations },
      known: prior.known || entry.known,
      timestamp: minTs === Infinity ? Date.now() : minTs,
      url: entry.url || prior.url,
      title: entry.title || prior.title,
      contexts: mergeContexts(prior.contexts, entry.contexts),
      srs: mergeSrs(prior.srs, entry.srs),
    });
  });
  return Array.from(byText.values()).sort((a, b) => b.timestamp - a.timestamp);
}
```

- [ ] **Step 2: 构建 + 手动走查**

Run: `npm run build`
Expected: 无报错。

`mergeContexts`/`mergeSrs` 是模块内部函数（未导出），走读源码确认以下几点：
- 两边各有一条不同 `sentence` 的 `contexts`，合并结果两条都在（`mergeContexts` 用 `sentence|url` 做 key，两条 key 不同，都会被 `seen.set` 各自保留）
- 两边都练过 `recall` 模式，`last_review` 较新的那一整张卡胜出，卡内部字段（`difficulty`/`stability` 等）不会被拆开混合
- 一边只练过 `recall`、另一边只练过 `recognition`，合并结果两个模式的卡都保留（`mergeSrs` 对只在一边存在的 key 直接透传，不算冲突）
- `entry?.text` 为空的畸形条目在外层 `mergeWordbook` 循环里已经被 `if (!key) return;` 跳过，不会走到 `mergeContexts`/`mergeSrs`

- [ ] **Step 3: Commit**

```bash
git add utils/github-sync.js
git commit -m "feat(sync): merge wordbook contexts and srs fields by structural type"
```

---

## Task 7: popup 待复习提醒入口

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`

**Interfaces:**
- Consumes：`isDue`、`deserializeCard`（Task 1 的 `utils/srs.js`）

- [ ] **Step 1: `popup/popup.html` 加徽章**

第 282-285 行原本是：

```html
      <button id="openWordbook" class="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors">
        <i data-lucide="book-open" class="w-4 h-4"></i>
        <span class="font-extrabold text-[9px]">单词本</span>
      </button>
```

改成：

```html
      <button id="openWordbook" class="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors relative">
        <i data-lucide="book-open" class="w-4 h-4"></i>
        <span class="font-extrabold text-[9px]">单词本</span>
        <span id="wordbookDueBadge" class="badge badge-error badge-xs absolute top-0.5 right-3" style="display:none">0</span>
      </button>
```

- [ ] **Step 2: `popup/popup.js` 加待复习计数 + 跳转逻辑**

第 1-4 行原本是：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
```

改成：

```js
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
import { isDue, deserializeCard } from '../utils/srs.js';
```

第 237-240 行原本是：

```js
  // Open pages
  document.getElementById('openWordbook').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('wordbook/index.html') });
  });
```

改成：

```js
  // Open pages
  document.getElementById('openWordbook').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('wordbook/index.html?view=review') });
  });
```

文件末尾原本是：

```js
  document.getElementById('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });
});
```

改成：

```js
  document.getElementById('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // Wordbook due-count badge
  (async () => {
    const { wordbook = [] } = await chrome.storage.local.get('wordbook');
    const now = new Date();
    let dueCount = 0;
    wordbook.forEach((w) => {
      ['recall', 'recognition'].forEach((mode) => {
        const raw = w.srs?.[mode];
        const card = raw ? deserializeCard(raw) : null;
        if (isDue(card, now)) dueCount++;
      });
    });
    const badge = document.getElementById('wordbookDueBadge');
    if (dueCount > 0) {
      badge.textContent = dueCount > 99 ? '99+' : String(dueCount);
      badge.style.display = '';
    }
  })();
});
```

- [ ] **Step 3: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对：`dueCount === 0` 时 `badge.style.display` 保持初始的 `'none'`（HTML 里已经默认 `style="display:none"`，JS 只在 `dueCount > 0` 时才显式改成 `''`，不会出现"显示数字 0"的情况）；点击"单词本"按钮跳转的 URL 带上了 `?view=review`，跟 Task 5 Step 6 里 `wordbook.js` 读取这个查询参数的逻辑对得上。

浏览器交互验证（有到期词时打开 popup，确认徽章数字正确、点击后单词本页面直接停在"今日复习"）由控制者事后补做。

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat(popup): show wordbook due-review count and jump to review view"
```

---

## Spec Coverage Check

| 设计文档要点 | 覆盖任务 |
|---|---|
| `ts-fsrs` 依赖 + `utils/srs.js` 封装 | Task 1 |
| `contexts` 数组、`srs` 开放字典数据模型 | Task 1（类型约定）、Task 2（写入 contexts）、Task 5（写入 srs） |
| `content/selection.js` 例句捕获，`sandbox/sandbox.js` 不捕获 | Task 2（只改 selection.js，未touch sandbox.js） |
| 「今日复习」统一视图，recall/recognition 两个方向 | Task 5 |
| recall 自报三档、recognition 自动推导四档 | Task 5 Step 9/10 |
| 队列清空后"学新词" | Task 5 Step 8 |
| 例句展示 | Task 5 Step 9/10 的 `reviewSentenceHtml` |
| 发音复用 `utils/tts.js` | Task 5 Step 4（脚本引入）、Step 10（调用） |
| 旧"卡片学习""拼写测验"保留为自由练习 | 未改动这两个视图的核心浏览/测验逻辑（Task 4 只删了 known 相关的认识/不认识按钮） |
| 已掌握徽章从 `srs.recall` 派生，不读写 `known` | Task 4 |
| `chrome.storage.onChanged` 并发保护 | Task 3 |
| `mergeWordbook` 扩展合并 `contexts`/`srs` | Task 6 |
| popup 待复习提醒入口 | Task 7 |

## 不在本计划范围内（同设计文档）

- FSRS 参数个性化优化（用库自带默认权重）
- recall/recognition 之外的新测验模式（数据结构已支持，本次不实现）
- 单词本以外的间隔重复
- 离线 TTS 音标显示
