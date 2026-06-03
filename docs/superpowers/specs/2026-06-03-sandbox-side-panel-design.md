# 设计：快捷翻译（sandbox）侧边栏模式 + 网页同步

日期：2026-06-03
状态：已批准设计，待写实现计划

## 背景与目标

「快捷翻译」（`sandbox/`）目前只能以**标签页**形式打开（popup 的导航按钮 / dock 通过 `chrome.tabs.create({ url: 'sandbox/index.html?tab=...' })`）。

目标：在保留标签页形式的同时，**新增「侧边栏」打开形式**——浏览器右侧常驻面板，与网页并排，并和当前网页同步联动。

技术方案：**Chrome 原生 Side Panel API（`chrome.sidePanel`，Manifest V3，Chrome/Edge 114+）**。Firefox 不支持该 API（其 `sidebar_action` 不在本期范围）。

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 侧边栏技术 | Chrome 原生 Side Panel API（`chrome.sidePanel`） |
| 面板界面 | 复用并扩展现有 `sandbox/`（同一份代码，标签页/侧边栏两种形态） |
| 同步能力 | 四项全要：划词联动、翻译当前页、跟随当前标签、停靠工作台 |
| 打开入口 | 保留 popup；在 popup 加「侧边栏打开」按钮 + 右键菜单项「在侧边栏打开」 |
| 图标行为 | **不**启用 `openPanelOnActionClick`，点工具栏图标仍弹 popup |
| 标签页形式 | 原样保留 |
| 形态区分 | 用 URL 查询参数 `?context=panel` 让同一 sandbox 页区分面板/标签 |

## 架构

### 1. Manifest 与入口

- `permissions` 增加 `"sidePanel"`。
- 新增顶层 `"side_panel": { "default_path": "sandbox/index.html" }`（注册面板所需；实际打开时按标签覆盖路径）。
- **popup**（`popup/`）：新增「侧边栏打开」按钮，点击执行：
  ```js
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sandbox/index.html?context=panel', enabled: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
  ```
  按钮在 `chrome.sidePanel === undefined`（旧版/Firefox）时隐藏。
- **右键菜单**（`background/`）：新增 `contextMenus` 项「在侧边栏打开」，`onClicked` 中对该 tab 执行同样的 setOptions + open（菜单点击是用户手势，`open()` 允许）。
- 标签页形式（`chrome.tabs.create`）的现有入口与逻辑不变。

### 2. 面板 = 复用 sandbox + 新增「当前页」标签

- `sandbox/sandbox.js` 启动读取 `new URLSearchParams(location.search).get('context') === 'panel'`，得到 `isPanel` 布尔。
- 现有四个工具标签（文本/图片/文档/网页）原样复用——满足「停靠工作台」。
- `isPanel` 时额外：
  - 注入一个 `panel` CSS class 到根元素，触发窄面板响应式样式。
  - 显示一个**「当前页」标签**（标签页形态下隐藏），承载三项页面同步能力：跟随标签、划词联动、翻译当前页。

### 3.「当前页」标签的能力与消息通道

「当前页」标签包含：当前页标题/URL 显示区、划词结果区（原文 + 译文）、「翻译整页」按钮、不可用时的提示区。

- **跟随当前标签**：面板侧监听 `chrome.tabs.onActivated` 与 `chrome.tabs.onUpdated`，`chrome.tabs.query({active:true})` 取当前 tab，更新标题/URL 与上下文。
- **划词联动（tab → 面板）**：
  - content script（`content/selection.js` 或新增小桥接）在选区变化（`selectionchange`/`mouseup`）时，将选中文字 `chrome.runtime.sendMessage({ action: 'panelSelection', text })` 广播。
  - 面板 `chrome.runtime.onMessage` 接收，切到「当前页」标签并翻译显示。
  - **开销门控**：面板加载时向 `chrome.storage.session` 写 `sidePanelOpen=true`，卸载（`pagehide`）时写 `false`；content script 广播前先读该标志，面板没开就不广播（零额外开销）。`storage.session` 需在 manifest 中对内容脚本可见（`chrome.storage.session.setAccessLevel` 或默认；实现时确认 MV3 下 content script 读 session 的可见性，必要时改用 background 中转）。
- **翻译当前页（面板 → tab）**：「翻译整页」按钮向当前 tab 的 content script 发消息（复用现有全页翻译；现有 `toggle` 已存在，必要时加 `translatePage` 明确动作），驱动 `content/content.js` 的全页翻译。

### 4. 布局与边界情况

- 面板宽约 360–400px：`.panel` class 下把工具标签改为更紧凑/竖向排布、缩小内边距，复用 daisyUI 响应式工具类。
- `chrome.sidePanel` 不存在：popup 按钮隐藏；右键菜单项不注册。
- 受限页面（`chrome://`、Chrome Web Store 等）content script 无法注入：面板「翻译整页」/划词联动消息会失败 → 在「当前页」标签显示「当前页面不可翻译」，但工具台四个标签仍可正常使用。
- 划词联动只在「面板已打开」时才由 content script 广播，避免常态开销。

## 单元边界

- **入口层**（popup 按钮 + background 右键菜单）：唯一职责是"对当前 tab 打开侧边栏"，对外只依赖 `chrome.sidePanel`。
- **面板形态适配**（sandbox.js 中 `isPanel` 分支 + `.panel` 样式）：把同一页面渲染成窄面板形态，不改动四个工具标签的内部逻辑。
- **页面同步模块**（「当前页」标签 + 消息收发）：独立于四个工具标签；输入=tabs 事件 + content script 广播，输出=面板内展示 + 向 tab 发翻译指令。可单独验收。
- **content 广播桥**：在选区变化时按 session 标志广播选中文字，单一职责。

## 分阶段实现（每阶段可独立 `npm run build` + 加载 dist 验收）

1. **打开侧边栏**：manifest（sidePanel 权限 + side_panel）+ popup 按钮 + 右键菜单 → 能开出侧边栏并显示现有 sandbox（四工具可用）。
2. **面板形态 + 「当前页」骨架 + 跟随标签**：`?context=panel` 识别、`.panel` 样式、「当前页」标签显示当前页标题/URL 并随标签切换更新。
3. **划词联动**：content 广播桥 + `storage.session` 门控 + 面板接收并翻译显示。
4. **翻译当前页**：「翻译整页」按钮驱动现有全页翻译。
5. **窄面板响应式打磨 + 边界提示**（受限页面提示、按钮可用性）。

## 不在范围内

- Firefox `sidebar_action` 兼容（仅 Chrome/Edge Side Panel API）。
- 工具栏图标点击直接开侧栏（保留 popup）。
- 四个现有工具标签（文本/图片/文档/网页）的内部逻辑改造。
- 标签页打开形式的任何破坏性变更。

## 验收标准

1. `npm run build` 成功，加载 `dist/` 后：popup 出现「侧边栏打开」按钮、右键菜单出现「在侧边栏打开」。
2. 点击任一入口，浏览器右侧打开侧边栏，显示 sandbox（四工具可正常用）。
3. 「当前页」标签随标签切换/导航更新当前页信息。
4. 在网页选中文字，侧边栏「当前页」即时显示并翻译该文字。
5. 「翻译整页」按钮能让当前页进入双语翻译。
6. 受限页面下给出明确提示且工具台仍可用；旧版/Firefox 下入口优雅隐藏。
7. 面板未打开时，content script 不广播选区（无额外开销）。

## 风险

- `chrome.storage.session` 对 content script 的可见性在 MV3 下有约束；若不可直接读，改为 content script 无条件 `sendMessage`（面板没开则无接收者，开销极小）或经 background 中转。阶段 3 验证。
- 窄面板里现有四工具（尤其文档/图片 OCR）布局可能偏挤，需响应式微调。
- `sidePanel.open()` 必须在用户手势内调用；popup 按钮与右键菜单均满足，键盘命令入口本期不做。
