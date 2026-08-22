# 多站点视频 + 会议实时字幕双语引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把只支持 YouTube 的 `content/youtube.js` 重构成配置化的多站点字幕引擎 `content/subtitle.js`，覆盖 9 个视频/会议平台 + 一个通用兜底，加一个总开关。

**Architecture:** 引擎（观察/去抖/翻译/注入/清理/开关响应）与站点解耦，只依赖"当前适配器"的 `{ containerSelector, segmentSelector, mountSelector, parseText? }` 接口；`content/subtitle-adapters.js` 是纯数据注册表，加站点只改这一个文件；没有适配器命中时退到通用 `<video>` textTrack cue 兜底。

**Tech Stack:** Manifest V3 content script（vanilla JS，无框架），复用现有 `utils/translator.js` 单例，`chrome.storage.sync` 读写设置。无测试框架/linter，验证方式是 `npm run build` 后手动加载 `dist/` 到 `chrome://extensions/`，真实网站/会议环境的交互核对由控制者事后补做（浏览器自动化工具在本项目历史上一直连不上）。

**Spec:** `docs/superpowers/specs/2026-06-03-multi-site-subtitles-design.md`（含 2026-08-22 追加的会议字幕补充小节 —— 执行者请通读原文件，本计划的适配器选择器数值都摘自那里）

## Global Constraints

- 阶段 1（Task 1）重构后，YouTube 字幕翻译行为必须跟改造前完全等价——这是整个重构的安全网，后续任务出问题都靠对比这个基线定位。
- 所有站点适配器的选择器均标注"待真实环境验证"（spec 原文的措辞），不承诺开箱即用；这是已知限制，不是任务失败。
- 引擎逻辑不感知任何具体站点，只依赖适配器接口；加站点/改选择器只改 `content/subtitle-adapters.js`。
- 手写 CSS（`content/subtitle.css`），不用 Tailwind——跟 `content/selection.css`/`content/content.css` 等其余注入宿主页的样式一致，复用 `--sit-*` CSS 自定义属性系统。
- 不碰 `chrome.storage.local` 里的用户数据（历史/单词本），不涉及 GitHub 同步逻辑。
- 每个任务完成后跑 `npm run build`，确认无报错；每个任务标注需要控制者在真实站点/会议里手动核对的部分。

---

### Task 1: 重构为适配器驱动的引擎（行为等价基线，仅 YouTube）

**Files:**
- Create: `content/subtitle-adapters.js`
- Create: `content/subtitle.js`
- Create: `content/subtitle.css`
- Delete: `content/youtube.js`
- Delete: `content/youtube.css`
- Modify: `manifest.json`

**Interfaces:**
- Produces: `SITE_ADAPTERS`（数组，导出自 `content/subtitle-adapters.js`），每项形状 `{ name: string, hostIncludes: string[], containerSelector: string, segmentSelector: string, mountSelector: string, parseText?: (raw: string) => string }`。后续任务（Task 3/6）只往这个数组里追加新条目。
- Produces: `content/subtitle.js` 里的 `TRANS_CLASS = 'sit-subtitle-translation'` 常量、`cleanup()` 函数——Task 2/4 会在这基础上扩展。

- [ ] **Step 1: 创建适配器注册表**

`content/subtitle-adapters.js`：

```js
// 站点字幕适配器注册表 —— 纯数据，加站点/改选择器只改这里，不用碰引擎逻辑。
// 每条：{ name, hostIncludes, containerSelector, segmentSelector, mountSelector, parseText? }
// parseText 可选：不填就是恒等函数，segmentSelector 抓到的原始文本直接送翻译；
// 需要先从原始文本里摘取要翻译的部分（比如 Zoom 的 "发言人: 内容"）才定义它。
export const SITE_ADAPTERS = [
  {
    name: 'youtube',
    hostIncludes: ['youtube.com'],
    containerSelector: '.ytp-caption-window-container',
    segmentSelector: '.ytp-caption-segment',
    mountSelector: '.ytp-caption-window-bottom, .ytp-caption-window-top, [class*="caption-window"]',
  },
];
```

- [ ] **Step 2: 创建引擎文件**

`content/subtitle.js`（从 `content/youtube.js` 迁移，把三个写死的选择器换成从命中的适配器读取；其余逻辑原样保留）：

```js
import './subtitle.css';
import { translator } from '../utils/translator.js';
import { SITE_ADAPTERS } from './subtitle-adapters.js';

/**
 * Multi-site Subtitle Translation - Super Immersive Translate
 * Detects live captions on the current site (via a matching adapter) and
 * injects a bilingual translation line.
 */
(function () {
  'use strict';

  const adapter = SITE_ADAPTERS.find(a => a.hostIncludes.some(h => location.hostname.includes(h)));
  if (!adapter) return; // 本任务范围内只有 youtube 一个适配器，等价于原来 youtube.js 的域名判断

  const TRANS_CLASS = 'sit-subtitle-translation';
  let observer = null;
  let lastCaptionText = '';
  let translateTimer = null;

  function init() {
    waitForCaptions();
    listenForNavigation();
  }

  function waitForCaptions() {
    const check = () => {
      const container = document.querySelector(adapter.containerSelector);
      if (container) {
        setupObserver(container);
        return;
      }
      setTimeout(check, 2000);
    };
    check();
  }

  function listenForNavigation() {
    let lastUrl = location.href;
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCaptionText = '';
        cleanup();
        setTimeout(waitForCaptions, 1000);
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function setupObserver(container) {
    cleanup();
    observer = new MutationObserver(handleCaptionChange);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(translateTimer);
    document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
  }

  function handleCaptionChange() {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(processCaption, 150);
  }

  function processCaption() {
    const segments = document.querySelectorAll(adapter.segmentSelector);
    if (segments.length === 0) {
      document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
      lastCaptionText = '';
      return;
    }

    let text = '';
    segments.forEach(s => { text += s.textContent; });
    text = text.trim();

    const parsed = adapter.parseText ? adapter.parseText(text) : text;
    if (!parsed || parsed === lastCaptionText) return;
    lastCaptionText = parsed;

    translateCaption(parsed);
  }

  async function translateCaption(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showTranslation(result);
      }
    } catch (e) {
      console.error('[SIT] Subtitle translation error:', e);
    }
  }

  function showTranslation(text) {
    const captionWindow = document.querySelector(adapter.mountSelector);
    if (!captionWindow) return;

    let el = captionWindow.querySelector('.' + TRANS_CLASS);
    if (!el) {
      el = document.createElement('span');
      el.className = TRANS_CLASS;
      captionWindow.appendChild(el);
    }
    el.textContent = text;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

注意：`processCaption` 里加了 `adapter.parseText ? adapter.parseText(text) : text` 这一行——这是为 Task 6 的 Zoom 适配器预留的钩子，youtube 适配器没定义 `parseText`，行为不变（`parsed === text`）。

- [ ] **Step 3: 迁移样式文件**

`content/subtitle.css`（内容原样从 `content/youtube.css` 复制，Task 4 会再往这个文件追加内容）：

```css
/* Multi-site Subtitle Translation */

.sit-subtitle-translation {
  display: block;
  color: var(--sit-translation-color, #9b59b6);
  font-size: 0.85em;
  padding: 2px 6px;
  margin-top: 4px;
  text-align: center;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.9);
  font-family: inherit;
  line-height: 1.4;
  word-break: break-word;
}
```

- [ ] **Step 4: 更新 manifest.json**

`manifest.json` 的 `content_scripts[0].js` 数组里，把 `"content/youtube.js"` 替换成 `"content/subtitle.js"`（其余条目和顺序不变）：

```json
"js": ["utils/translator.js", "utils/tts.js", "content/selection.js", "content/content.js", "content/input-translate.js", "content/subtitle.js"],
```

- [ ] **Step 5: 删除旧文件**

```bash
rm content/youtube.js content/youtube.css
```

- [ ] **Step 6: 构建验证**

```bash
npm run build
```

预期：无报错，`dist/` 里能看到 `content/subtitle.js` 打包产物，且不再有 `youtube.js` 相关产物。

- [ ] **Step 7: 手动验证（标记待控制者完成）**

在真实 YouTube 视频页打开双语字幕，确认译文行显示、切视频后（SPA 导航）字幕能重新工作、关闭视频字幕后译文行消失——跟重构前行为完全一致。这一步浏览器自动化工具连不上，由控制者手动核对。

- [ ] **Step 8: Commit**

```bash
git add content/subtitle.js content/subtitle-adapters.js content/subtitle.css manifest.json
git rm content/youtube.js content/youtube.css
git commit -m "refactor(subtitle): youtube.js 重构为适配器驱动的多站点字幕引擎"
```

---

### Task 2: 字幕翻译总开关（`subtitleTranslate`）

**Files:**
- Modify: `utils/defaults.js`
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `content/subtitle.js`

**Interfaces:**
- Consumes: Task 1 产出的 `content/subtitle.js` 里的 `init()`、`cleanup()` 函数（改名为 `start()`/`stop()`，见下方）。
- Produces: `DEFAULTS.subtitleTranslate`（布尔，默认 `true`），后续任务不需要关心这个字段，它只影响引擎是否运行。

- [ ] **Step 1: 加默认值**

`utils/defaults.js`，在 `// full-page behavior / style` 分组前面加一个新分组（紧接在 `selectionEngines` 那行之后）：

```js
  // subtitle translation
  subtitleTranslate: true,

```

- [ ] **Step 2: options 页加开关**

`options/options.html`，在现有 `hoverTranslate`/`inputTranslate` 那个 `<div class="flex gap-6 flex-wrap">` 里追加一个 checkbox（跟现有两个写法完全一致）：

```html
              <label class="cursor-pointer flex items-center gap-2 text-sm">
                <input type="checkbox" id="subtitleTranslate" class="checkbox checkbox-primary checkbox-sm" />
                <span>视频/会议双语字幕</span>
              </label>
```

- [ ] **Step 3: options.js 接入读取/保存**

`options/options.js`，三处修改：

1. 加载时赋值（紧跟在 `$('inputTranslate').checked = settings.inputTranslate;` 之后）：
```js
  $('subtitleTranslate').checked = settings.subtitleTranslate;
```

2. `saveFields` 数组（当前是 `['engine', 'targetLang', 'displayMode', 'translateConcurrency', 'selectionMode', 'hoverTranslate', 'inputTranslate', 'translationBold', 'translationShowBorder', 'siteMode', 'historyMaxItems']`）里追加 `'subtitleTranslate'`：
```js
  const saveFields = [
    'engine', 'targetLang', 'displayMode', 'translateConcurrency', 'selectionMode',
    'hoverTranslate', 'inputTranslate', 'subtitleTranslate',
    'translationBold', 'translationShowBorder', 'siteMode', 'historyMaxItems'
  ];
```

3. `saveAll()` 的 `newSettings` 对象里加一行（紧跟在 `inputTranslate: $('inputTranslate').checked,` 之后）：
```js
      subtitleTranslate: $('subtitleTranslate').checked,
```

- [ ] **Step 4: 引擎读取并响应开关**

`content/subtitle.js` 整体改写为异步启动 + 开关响应（用 `import { pick } from '../utils/defaults.js';` 读取单个字段，跟 `content/selection.js` 现有的 `chrome.storage.sync.get(pick(...))` 用法一致）。把 Task 1 里 `if (!adapter) return;` 之后到文件末尾的部分，替换成：

```js
import './subtitle.css';
import { translator } from '../utils/translator.js';
import { pick } from '../utils/defaults.js';
import { SITE_ADAPTERS } from './subtitle-adapters.js';

(function () {
  'use strict';

  const adapter = SITE_ADAPTERS.find(a => a.hostIncludes.some(h => location.hostname.includes(h)));

  const TRANS_CLASS = 'sit-subtitle-translation';
  let observer = null;
  let lastCaptionText = '';
  let translateTimer = null;

  function start() {
    if (!adapter) return; // Task 4 会在这里加通用 cue 兜底分支
    waitForCaptions();
    listenForNavigation();
  }

  function stop() {
    cleanup();
  }

  function waitForCaptions() {
    const check = () => {
      const container = document.querySelector(adapter.containerSelector);
      if (container) {
        setupObserver(container);
        return;
      }
      setTimeout(check, 2000);
    };
    check();
  }

  function listenForNavigation() {
    let lastUrl = location.href;
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCaptionText = '';
        cleanup();
        setTimeout(waitForCaptions, 1000);
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function setupObserver(container) {
    cleanup();
    observer = new MutationObserver(handleCaptionChange);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(translateTimer);
    document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
  }

  function handleCaptionChange() {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(processCaption, 150);
  }

  function processCaption() {
    const segments = document.querySelectorAll(adapter.segmentSelector);
    if (segments.length === 0) {
      document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
      lastCaptionText = '';
      return;
    }

    let text = '';
    segments.forEach(s => { text += s.textContent; });
    text = text.trim();

    const parsed = adapter.parseText ? adapter.parseText(text) : text;
    if (!parsed || parsed === lastCaptionText) return;
    lastCaptionText = parsed;

    translateCaption(parsed);
  }

  async function translateCaption(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showTranslation(result);
      }
    } catch (e) {
      console.error('[SIT] Subtitle translation error:', e);
    }
  }

  function showTranslation(text) {
    const captionWindow = document.querySelector(adapter.mountSelector);
    if (!captionWindow) return;

    let el = captionWindow.querySelector('.' + TRANS_CLASS);
    if (!el) {
      el = document.createElement('span');
      el.className = TRANS_CLASS;
      captionWindow.appendChild(el);
    }
    el.textContent = text;
  }

  async function boot() {
    const { subtitleTranslate } = await chrome.storage.sync.get(pick('subtitleTranslate'));
    if (subtitleTranslate) start();

    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.subtitleTranslate) return;
      if (changes.subtitleTranslate.newValue) start(); else stop();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 5: 构建验证**

```bash
npm run build
```

- [ ] **Step 6: 手动验证（标记待控制者完成）**

options 页勾掉「视频/会议双语字幕」，刷新 YouTube 视频页确认不再出现译文；重新勾选后确认恢复。

- [ ] **Step 7: Commit**

```bash
git add utils/defaults.js options/options.html options/options.js content/subtitle.js
git commit -m "feat(subtitle): 加字幕翻译总开关 subtitleTranslate"
```

---

### Task 3: 加视频平台适配器（Netflix / Bilibili / Coursera / Udemy / TED）

**Files:**
- Modify: `content/subtitle-adapters.js`

**Interfaces:**
- Consumes: Task 1 定义的适配器形状（无新字段，这批都不需要 `parseText`）。
- Produces: 无（纯数据追加，不改变任何接口）。

- [ ] **Step 1: 追加五个适配器**

`content/subtitle-adapters.js`，在 `SITE_ADAPTERS` 数组的 youtube 条目后面追加（选择器摘自 spec，均标注"待真实环境验证"）：

```js
  {
    name: 'netflix',
    hostIncludes: ['netflix.com'],
    containerSelector: '.player-timedtext',
    segmentSelector: '.player-timedtext-text-container',
    mountSelector: '.player-timedtext',
  },
  {
    name: 'bilibili',
    hostIncludes: ['bilibili.com'],
    containerSelector: '.bpx-player-subtitle-panel',
    segmentSelector: '.bpx-player-subtitle-panel-text',
    mountSelector: '.bpx-player-subtitle-panel',
  },
  {
    name: 'coursera',
    hostIncludes: ['coursera.org'],
    containerSelector: '.vjs-text-track-display',
    segmentSelector: '.vjs-text-track-cue',
    mountSelector: '.vjs-text-track-display',
  },
  {
    name: 'udemy',
    hostIncludes: ['udemy.com'],
    containerSelector: '[class*="captions-display--captions-container"]',
    segmentSelector: '[class*="captions-display--captions-container"]',
    mountSelector: '[class*="captions-display--captions-container"]',
  },
  {
    name: 'ted',
    hostIncludes: ['ted.com'],
    containerSelector: '.vjs-text-track-display',
    segmentSelector: '.vjs-text-track-cue',
    mountSelector: '.vjs-text-track-display',
  },
```

- [ ] **Step 2: 构建验证**

```bash
npm run build
```

- [ ] **Step 3: 手动验证（标记待控制者完成）**

逐站点在真实环境打开一段带字幕的视频，核对选择器是否命中；命中失败的站点记下实际的容器/字幕 class 名，回来改这个文件对应条目即可（引擎逻辑不用动）。这一批预期部分选择器需要现场微调，不是本任务的失败信号。

- [ ] **Step 4: Commit**

```bash
git add content/subtitle-adapters.js
git commit -m "feat(subtitle): 加 Netflix/Bilibili/Coursera/Udemy/TED 站点适配器"
```

---

### Task 4: 通用 `<video>` cue 兜底 + 覆盖层样式

**Files:**
- Modify: `content/subtitle.js`
- Modify: `content/subtitle.css`

**Interfaces:**
- Consumes: Task 2 产出的 `start()`/`stop()` 函数——本任务把 `start()` 里 `if (!adapter) return;` 的分支改成调用兜底逻辑，而不是直接返回。
- Produces: `OVERLAY_CLASS = 'sit-subtitle-overlay'` 常量，`startCueFallback()`/`stopCueFallback()` 函数（供本文件内部使用，不对外暴露）。

- [ ] **Step 1: 引擎加兜底逻辑**

`content/subtitle.js`：

1. 顶部常量区（`const TRANS_CLASS = 'sit-subtitle-translation';` 之后）加一行：
```js
  const OVERLAY_CLASS = 'sit-subtitle-overlay';
  let cueUnsubscribers = [];
```

2. 把 Task 2 里的
```js
  function start() {
    if (!adapter) return; // Task 4 会在这里加通用 cue 兜底分支
    waitForCaptions();
    listenForNavigation();
  }

  function stop() {
    cleanup();
  }
```
替换成：
```js
  function start() {
    if (adapter) {
      waitForCaptions();
      listenForNavigation();
    } else {
      startCueFallback();
    }
  }

  function stop() {
    cleanup();
    stopCueFallback();
  }
```

3. 在 `showTranslation` 函数之后、`async function boot()` 之前，新增：
```js
  // 通用兜底：没有专属适配器命中时，扫描页面 <video> 的原生字幕轨（WebVTT track），
  // 监听 cuechange 取当前激活字幕文本翻译，用固定定位覆盖层展示。只对真正用 <track>
  // 渲染字幕的页面有效——很多站点自定义 DOM 渲染字幕，不会触发这个（那些站点应该走
  // 专属适配器，不是这个兜底要解决的问题）。
  function startCueFallback() {
    document.querySelectorAll('video').forEach((video) => {
      if (!video.textTracks) return;
      Array.from(video.textTracks).forEach((track) => {
        const onCueChange = () => {
          if (track.mode === 'disabled') return;
          const cues = track.activeCues;
          if (!cues || cues.length === 0) return;
          const text = Array.from(cues).map(c => c.text).join(' ').trim();
          if (!text) return;
          translateCueText(text);
        };
        track.addEventListener('cuechange', onCueChange);
        cueUnsubscribers.push(() => track.removeEventListener('cuechange', onCueChange));
      });
    });
  }

  function stopCueFallback() {
    cueUnsubscribers.forEach(fn => fn());
    cueUnsubscribers = [];
    document.querySelectorAll('.' + OVERLAY_CLASS).forEach(el => el.remove());
  }

  async function translateCueText(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showCueOverlay(result);
      }
    } catch (e) {
      console.error('[SIT] Cue fallback translation error:', e);
    }
  }

  function showCueOverlay(text) {
    let el = document.querySelector('.' + OVERLAY_CLASS);
    if (!el) {
      el = document.createElement('div');
      el.className = OVERLAY_CLASS;
      document.body.appendChild(el);
    }
    el.textContent = text;
  }
```

- [ ] **Step 2: 加覆盖层样式**

`content/subtitle.css` 末尾追加：

```css
.sit-subtitle-overlay {
  position: fixed;
  bottom: 8%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  max-width: 80vw;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.75);
  color: var(--sit-translation-color, #9b59b6);
  font-size: 16px;
  text-align: center;
  border-radius: 4px;
  pointer-events: none;
  line-height: 1.4;
  word-break: break-word;
}
```

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

- [ ] **Step 4: 手动验证（标记待控制者完成）**

找一个用原生 `<video>` + `<track>` 渲染字幕的页面（比如某些教育类站点或本地 HTML5 视频demo），确认没有专属适配器命中时兜底能显示双语覆盖层；YouTube 等已有专属适配器的站点确认走的还是专属适配器路径（不会同时触发兜底）。

- [ ] **Step 5: Commit**

```bash
git add content/subtitle.js content/subtitle.css
git commit -m "feat(subtitle): 加通用 <video> cue 兜底适配器"
```

---

### Task 5: 收尾文档

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 无（纯文档，不影响任何代码接口）。

- [ ] **Step 1: 更新内容脚本清单**

`CLAUDE.md` 第 77 行，把：
```
5. `content/youtube.js` — YouTube subtitle detection + bilingual captions.
```
改成：
```
5. `content/subtitle.js` — Multi-site live-caption bilingual translation (config-driven
   adapter registry in `content/subtitle-adapters.js`, one small config per site — see
   `docs/superpowers/specs/2026-06-03-multi-site-subtitles-design.md`). Falls back to a
   generic `<video>` textTrack cue watcher when no site adapter matches. Toggle via the
   `subtitleTranslate` setting.
```

- [ ] **Step 2: 更新 CSS 分类提法**

`CLAUDE.md` 第 37 行，把：
```
(`var(--p)`). The injected `content/*.css` (full-page/selection/youtube) is deliberately
```
改成：
```
(`var(--p)`). The injected `content/*.css` (full-page/selection/subtitle) is deliberately
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 反映 youtube.js → subtitle.js 的多站点重构"
```

---

### Task 6: 会议实时字幕适配器（Google Meet / Microsoft Teams / Zoom）+ `parseText` 钩子

**Files:**
- Modify: `content/subtitle-adapters.js`

**Interfaces:**
- Consumes: `processCaption()` 里已经在 Task 1 预留的 `adapter.parseText ? adapter.parseText(text) : text` 判断——本任务只需要在 Zoom 适配器上定义 `parseText`，不用再改引擎代码。
- Produces: 无（纯数据追加）。

- [ ] **Step 1: 追加 Google Meet 适配器**

`content/subtitle-adapters.js`，`SITE_ADAPTERS` 数组末尾追加（置信度高，选择器来自公开开源项目 `yunho0130/google-meet-cc-to-srt`，`jsname`/`aria-label` 是 Google 内部测试钩子，比同层的混淆 class 名更抗改版）：

```js
  {
    name: 'google-meet',
    hostIncludes: ['meet.google.com'],
    containerSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
    segmentSelector: '.ygicle.VbkSUe, .iTTPOb',
    mountSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
  },
```

- [ ] **Step 2: 追加 Microsoft Teams 适配器**

紧接着追加（置信度高，选择器来自持续维护的开源项目 `Zerg00s/Live-Captions-Saver`，`data-tid` 是微软自己的测试 id 约定，三者里最抗改版）：

```js
  {
    name: 'teams',
    hostIncludes: ['teams.microsoft.com', 'teams.live.com'],
    containerSelector: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
    segmentSelector: '[data-tid="closed-caption-text"]',
    mountSelector: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
  },
```

- [ ] **Step 3: 追加 Zoom 适配器（带 parseText）**

紧接着追加（置信度中，选择器来自开源项目 `aalemoro/meetrecap`；Zoom 常见的更新方式是复用同一个覆盖层节点、整句替换文本，且文本形如 `"发言人: 内容"`，需要 `parseText` 先切掉发言人前缀再送翻译，否则发言人姓名会被一起翻译）：

```js
  {
    name: 'zoom',
    hostIncludes: ['zoom.us'],
    containerSelector: '#live-transcription-subtitle, [class*="live-transcription-subtitle"], [class*="live-transcription"]',
    segmentSelector: '.live-transcription-subtitle__item, li, p, span',
    mountSelector: '#live-transcription-subtitle, [class*="live-transcription-subtitle"], [class*="live-transcription"]',
    parseText(raw) {
      // "张三: 今天的进度..." → 去掉发言人前缀，只翻译发言内容。
      // 冒号出现在前 30 个字符内才当作发言人前缀处理，避免把正文里偶然出现的
      // 冒号（比如引用的时间 "3:00"）误判成前缀分隔符。
      const idx = raw.indexOf(': ');
      return idx > -1 && idx < 30 ? raw.slice(idx + 2) : raw;
    },
  },
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

- [ ] **Step 5: 手动验证（标记待控制者完成）**

在真实的 Google Meet / Teams 网页版 / Zoom 网页客户端会议里开启实时字幕，核对三个适配器是否命中；重点核对 Zoom 的 `parseText` 是否正确切出发言人前缀（这是三者里置信度最低、跟其余站点更新方式最不一样的一个，最容易出现"翻译结果里带着发言人名字"这种症状，出现了就说明 `parseText` 的冒号位置判断需要按实际文本格式调整）。

- [ ] **Step 6: Commit**

```bash
git add content/subtitle-adapters.js
git commit -m "feat(subtitle): 加会议实时字幕适配器（Google Meet/Teams/Zoom）+ parseText 钩子"
```
