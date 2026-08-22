# 设计：全面架构蓝图 —— 支撑"最强最完整涵盖面最广的浏览器翻译插件"

日期：2026-08-22
状态：待自查 + 用户确认

## 背景与目标

用户目标：把这个插件做成功能最全、覆盖面最广、最好用的浏览器翻译工具。已经通过一次调研（对标 immersivetranslate.com）产出了功能/UI 缺口报告，本次architecture 蓝图的目的是：在动手做具体功能之前，先把内部结构理顺，让后续大量新功能（字幕多平台、文档保留版式渲染、图片/漫画翻译、AI 词典增强等）能够合理地挂进现有架构，而不是每个新功能各自为战、互相打架。

范围决策（brainstorming 阶段已确认）：
- 一次性做全面架构蓝图，覆盖调研报告里的所有类别（而不是先做 1-2 个功能反推架构）。
- 允许为针对性强的子系统引入成熟开源库（如 pdf.js、epub.js），每个新依赖单独评估理由，不滥用。
- 新写的 UI 代码统一走 `t()` 文本查找约定，为以后真正做 i18n 时少一次大量返工（i18n 基础设施本身——`chrome.i18n`/`_locales`、多语言翻译——仍然是独立立项，不在这次范围内）。

## 全局约束

- 新依赖：每个都要有明确、写在本文档里的理由；不因为"可能有用"就引入。
- 新 UI 字符串一律通过 `utils/i18n.js` 的 `t(key)` 查找，不直接写死中文字符串；已有的 400+ 处硬编码字符串不做retrofit。
- 内容脚本（`content/*.js`，注入到用户访问的每个网页）继续保持纯 vanilla JS，不引入 React——体积纪律：内容脚本的代码在用户浏览的每个页面都会加载执行，React 运行时哪怕几十 KB 也是不必要的常驻成本。React 只用于独立页面（popup/options/sandbox/pdf-viewer/wordbook/history 这类只在用户主动打开时才加载的页面）。
- daisyUI 5 继续是 UI 系统的主力（纯 CSS，不依赖任何 JS 框架，React 化之后 className 照用不用换）；`shadcn/ui` 只在 daisyUI 的纯 CSS 组件覆盖不到的复杂无障碍交互场景（虚拟滚动列表、带键盘导航的组合框等）按需引入；`MUI` 排除在外——它自带 CssBaseline 重置和 emotion-in-JS 主题系统，会和 daisyUI 的视觉语言正面冲突，双重重置、双倍体积。
- Manifest V3，无测试框架/linter，验证方式保持 `npm run build` + 手动加载 `dist/` 到 `chrome://extensions/`。

## 架构总览

按依赖方向从下到上：

```
共享基础设施（utils/）
  translator.js（现有）── + 术语表覆盖扩展
  example-sentence.js（现有）── + tokens.role 字段扩展
  toast.js（新）
  i18n.js（新）

网页内容脚本（content/，vanilla JS，体积敏感）
  content.js / selection.js / input-translate.js（现有，不动）
  subtitle.js（现有已批准设计，见下方"字幕平台化"，未实现）
  image-translate.js（新）

独立页面（popup/ options/ sandbox/ pdf→viewer/ wordbook/ history/）
  文档渲染子系统：viewer/ 从纯文本查看器演变为多格式渲染器（新）
  客户端框架：vanilla JS → React，wordbook 试点先行（新，方向性决策，具体迁移计划另立）

独立话题（记录，不并入本蓝图主线）
  「翻译实验室」——sandbox 文本翻译页的可能增强方向，需要单独立项
```

---

## 一、字幕平台化（引用已有设计，本文档只补充扩展）

**这部分的完整设计已经存在**：`docs/superpowers/specs/2026-06-03-multi-site-subtitles-design.md`，状态"已批准设计"，尚未写实现计划、未落地（当前代码仍是仅支持 YouTube 的 `content/youtube.js`）。实现时请直接读那份文档，不要重新设计。

**本次蓝图新增的扩展点**：实时会议字幕翻译（Zoom / Google Meet / Microsoft Teams 的网页版）。这不是一个新子系统——它和视频字幕平台是**同一个能力**：监听某个 DOM 区域里持续更新的字幕/字幕文本，翻译，叠加展示。用已有设计里的适配器契约（`hostIncludes` / `containerSelector` / `segmentSelector` / `mountSelector`）为这三个会议平台各加一条配置即可，不需要给会议字幕单独设计一套机制。

扩展所需的具体选择器（`.ytp-caption-segment` 这类）需要在真实会议环境里核对——这跟已有设计里"选择器 best-effort，需要真实站点微调"的风险是同一类，沿用同样的应对方式（配置化集中、注释来源、用户可快速改一行修复）。

**行动项**：把 Zoom/Meet/Teams 三个适配器配置追加进 `docs/superpowers/specs/2026-06-03-multi-site-subtitles-design.md` 的"首批适配器"列表（或作为该文档的一次小修订），然后对整份文档（含扩展）跑 `writing-plans` 生成实现计划。这是本次调研报告里"字幕覆盖面"缺口的完整解决方案。

---

## 二、文档渲染子系统（PDF 保留版式 + EPUB）

### 现状问题

`pdf/` 现在的"PDF 翻译"其实是**文本提取查看器**：把 PDF 里的文字抠出来，翻译，左右对照展示原文/译文纯文本。跟对标产品的"PDF 翻译"完全是两回事——对方是**保留原版式渲染**：译文替换/叠加在原来的分栏、表格、图注位置上，看起来还是那份 PDF，只是文字变了。这是调研报告里被特别标注"容易被低估工作量"的一项：这不是给现有查看器加个开关，是一个全新的渲染子系统。

### 设计

`pdf/` 演变为格式无关的文档查看器外壳（建议改名 `viewer/`，标志它不再只服务 PDF；改名本身风险很低，是纯目录重命名 + manifest/vite 配置更新）：

- **外壳**（`viewer/index.html` + `viewer/viewer.js`）：文件上传/拖拽区、工具栏（语言选择、进度条），一个 `<div id="renderRoot">` 挂载点。
- **渲染器契约**（纯 JS 对象形状，不用 TS interface，跟项目现有风格一致）：
  ```js
  // {
  //   canHandle(file): boolean,        // 按扩展名/MIME 判断能不能处理这个文件
  //   mount(file, root, { targetLang, onProgress }): Promise<void>,
  //   unmount(root): void
  // }
  ```
- **`viewer/renderers/pdf-layout.js`**（新）：用 **pdf.js**（`pdfjs-dist`）把每一页渲染到 canvas，同时拿到它已经算好的文本层（逐字符/逐词坐标，pdf.js 本来就为无障碍访问计算这份数据，这里是复用而不是重新实现版式解析）；把文本层里的字符串走现有 `Translator` 批量翻译，再按坐标把译文叠加/替换到对应位置。**为什么选 pdf.js**：Mozilla 维护、浏览器扩展环境验证充分（Firefox PDF 阅读器同源技术）、文本层坐标数据现成可用，不需要自己写 PDF 解析器——这是"从零自写不现实，必须在成熟库上构建"的典型场景。
- **`viewer/renderers/epub.js`**（新）：用 **epub.js** 渲染 EPUB 的可重排 XHTML 内容到 iframe/容器。EPUB 本质是打包的 HTML，翻译逻辑因此更接近 `content/content.js`（整页翻译）的"走 DOM、分类节点、批量翻译、写回"，值得把这段通用逻辑拆成 `utils/dom-translate.js`，供 `content/content.js` 和 `viewer/renderers/epub.js` 共用（现有 `content/content.js` 的 `SKIP_TAGS`/`INLINE_TAGS`/`BLOCK_TAGS` 分类逻辑是这次可以复用的现成资产）。**为什么选 epub.js**：EPUB 是 zip 打包的 XHTML+CSS+元数据集合，自己写解包/spine 解析/CFI 定位不现实，epub.js 是这个生态里最成熟的开源选择。
- **`viewer/renderers/plain-text.js`**：现有 TXT/MD/HTML 文本提取行为原样保留，只是套进同一个渲染器契约，不回归。

### 不在范围内

- PDF 表单/注释翻译。
- EPUB DRM 内容。
- 扫描版 PDF（图片形态，无文本层）——那是 OCR 的范畴，不是这个子系统解决的问题。

---

## 三、图片/漫画在页翻译

### 设计

`content/image-translate.js`（新内容脚本）。跟字幕平台化不同，**这里不需要站点适配器**——目标是任意网页上的任意图片，不依赖特定站点的 DOM 结构：

- 鼠标悬浮在页面里足够大的 `<img>`/`<canvas>` 上时，显示一个小的"翻译此图"按钮（悬浮出现，不常驻打扰阅读）。
- 点击后用 **tesseract.js**（项目已有依赖，`sandbox/` 的图片 OCR 功能已经在用）跑 OCR，识别出文字块的位置和内容。
- 把识别出的文字批量走现有 `Translator` 翻译，按每个文字块的坐标生成绝对定位的译文覆盖层叠加在原图对应位置上。
- OCR 调用逻辑目前只存在于 `sandbox/sandbox.js` 内部，建议提取成 `utils/ocr.js` 共享给这个新内容脚本，避免两处各写一套 tesseract.js 初始化/调用代码。

### 不在范围内

- 漫画站点专属优化（气泡框识别、竖排文字方向）——首版按通用图片处理，效果对规整排版的漫画会打折扣，作为已知限制记录，不为此单独适配。
- 视频里的贴片文字翻译（不同于字幕，是烧录进画面的文字）。

---

## 四、共享 UI 反馈层（toast.js）

### 现状问题

调研报告指出：同步、AI 生成、保存这些异步操作现在各写各的反馈方式（星标变 emoji、按钮转圈、文字直接替换），没有统一模式。

### 设计

`utils/toast.js`，单一调用入口：

```js
export function showToast(message, { type = 'info', duration = 3000 } = {}) { ... }
```

内部按运行环境自动选择两套渲染后端之一，调用方不用关心：

- **独立页面后端**：六个标准页面各自的 HTML 里加一个 `<div id="toast-root" class="toast toast-end"></div>`，`showToast` 检测到这个容器存在时，往里面插入 daisyUI 的 `alert` 元素，用 daisyUI 原生 `toast` 定位/动画。
- **内容脚本后端**：`content/*.js` 不加载 daisyUI，`showToast` 检测不到 `#toast-root` 时，退回到手写 CSS 的轻量提示条（复用现有 `content/*.css` 那套 `--sit-*` CSS 自定义属性系统，视觉上跟划词面板保持一致），直接挂到 `document.body`，定时自动移除。

这个模块不需要新依赖——两套后端都是现有技术（daisyUI 类名 / 手写 CSS），只是把"往哪插入、用什么风格"的判断收敛到一个函数里。

---

## 五、i18n 就绪约定（不等于做 i18n）

`utils/i18n.js`：

```js
const DICT = { 'wordbook.save': '收藏单词', /* ... */ };
export function t(key) { return DICT[key] || key; }
```

今天只是一层薄薄的直通查找，字典只有中文一套，**不引入 `chrome.i18n`/`_locales`，不做多语言翻译**——那是明确的独立立项。这里唯一的产出是一个约定：**新写的 UI 代码用 `t('some.key')` 而不是直接写死中文字符串**。以后真要做多语言时，只需要把 `DICT` 换成按 `chrome.i18n.getMessage` 查找，调用方代码完全不用改。已有的 400+ 处硬编码字符串不做 retrofit，只约束新代码的写法习惯。

---

## 六、术语表（AI 翻译自定义术语覆盖）

### 设计

扩展 `utils/translator.js` 的 `_getAiPrompt()`：读一个新设置 `glossary`（`{term, translation}[]`，加入 `utils/defaults.js` 的 `DEFAULTS`），非空时把术语表拼进 AI 引擎的 system prompt，要求模型遇到这些词时使用指定译法。**只对 AI 引擎生效**（openai/gemini/claude/ollama/custom 里支持自定义 prompt 的那些）——Google/DeepL 这类引擎不接受自由指令，术语表覆盖对它们没有意义，需要在 UI 上说明这个限制（比如术语表设置区在选了非 AI 引擎时给个提示，不是禁用，只是提示"当前引擎不支持"）。

options 页新增一个术语表编辑区（增删 term/translation 对），走现有 `saveAll`/字段读取模式接入，不需要新的存储机制。

这是调研报告里标注"对我们来说成本很低"的一项——`_getAiPrompt()` 本来就是模板字符串拼接，加一段术语表不是架构级改动。

---

## 七、词类标注扩展：语法角色（tokens.role）

### 背景

单词本 AI 例句生成（`utils/example-sentence.js`）现在给例句里每个词标了**词性**（名词/动词/形容词……），但没有**语法角色**（这个词在句子里是主语、谓语还是宾语）。词性和语法角色是两个不同维度——"develop" 在不同句子里词性总是动词，但语法角色可能是谓语也可能是其他成分。

这个缺口是在设计单词本复习页的"语法提示侧栏"时发现的：如果只是把已经展示过的词性徽章原样搬到侧栏，没有增加任何信息量，是个空壳功能，不值得做。

### 设计

扩展 `utils/example-sentence.js` 的 AI 生成 JSON schema，给 `tokens` 数组每一项加一个 `role` 字段：

```js
// tokens: [{ text: "We", pos: "代词", role: "主语" }, { text: "develop", pos: "动词", role: "谓语" }, ...]
```

角色取值用固定的中文语法术语集合（主语/谓语/宾语/定语/状语/补语/其他），跟词性标注走同一个 prompt 里的同一次 AI 调用，不增加额外请求。

这是**加字段，不是破坏性改动**——已经存的历史 `contexts[].tokens` 没有 `role` 字段，展示时对缺失 `role` 的词优雅降级（不显示语法角色分组，但词性徽章照常显示），用户点"生成更多例句"按钮时新生成的例句会带上 `role`。

`wordbook/wordbook.js` 复习视图新增语法提示侧栏：桌面宽屏下和题目卡片左右布局，窄屏下堆叠在下方（沿用 options 页已经验证过的响应式降级模式）。侧栏内容按 `role` 分组展示 `tokens`（主语一行、谓语一行……），跟例句正文里已有的词性彩色词块是互补关系，不是重复。

---

## 八、客户端框架：vanilla JS → React（方向性决策）

### 范围与顺序

六个独立页面（popup / options / sandbox / viewer / wordbook / history）现在是同一套 vanilla JS + daisyUI 写法。决策：**最终六个页面一起迁移到 React**（避免长期两套技术栈并存、共享逻辑要写两份的维护成本），但**分批实施，wordbook 先做试点**——它是交互最复杂的页面（多视图切换、FSRS 状态、多处异步 AI 生成），最能验证迁移方式是否合理，出问题成本也最低（先在一个页面踩坑，再决定怎么套用到其余五个）。

具体到六个页面的迁移顺序、每页面的任务拆分，**留给专门的实现计划**，本文档只确立方向和约束，不是任务清单。

### 组件库

- **daisyUI 5 保留**：纯 CSS 组件，不依赖任何 JS 框架，React 里 `className="btn btn-primary"` 照用，迁移不需要重新设计视觉系统。
- **shadcn/ui 按需引入**：不是整体替换，只在 daisyUI 的纯 CSS 方案覆盖不到的复杂无障碍交互场景引入（虚拟滚动长列表、带键盘导航的组合框/下拉搜索等）——这类交互需要 JS 状态管理和无障碍属性联动，纯 CSS 组件做不到。
- **MUI 排除**：自带 CssBaseline 全局重置和 emotion-in-JS 主题系统，会跟 daisyUI 现有的视觉语言和 CSS 变量主题系统（`utils/theme.js`）正面冲突，双重重置、双倍体积，不采用。

### 构建

`@crxjs/vite-plugin` 本身是框架无关的，React + Vite 走标准的 `@vitejs/plugin-react`，不存在构建层面的障碍。每个迁移后的页面用 `ReactDOM.createRoot` 挂载到现有页面 HTML 的挂载点，**内容脚本（`content/*.js`）不迁移到 React**——理由见"全局约束"一节的体积纪律。

---

## 九、独立话题：翻译实验室（记录，不并入本蓝图）

调研参考页里出现的"双栏输入输出 + 语法拆解 + 相似句型推荐"设计，定位上更接近 `sandbox/` 文本翻译页的加强版，不是单词本或本蓝图任何一个子系统的自然延伸。记录在这里，作为将来的候选项，需要单独走一轮 brainstorming（购买/立项决策、跟 sandbox 现有功能的关系需要单独厘清），不在本次蓝图的实现范围内。

---

## 实现顺序建议

不是强制顺序，供后续 `writing-plans` 参考：

1. **字幕平台化扩展**（引用现有设计 + 补 Zoom/Meet/Teams）——设计已经批准，是"现在就能开始写计划"的一项，投入产出比最高。
2. **共享基础设施小件**（toast.js、i18n.js、术语表、tokens.role）——都是对现有文件的扩展，不需要新子系统，风险低，见效快。
3. **文档渲染子系统**（PDF 保留版式 + EPUB）——最大的新增子系统，需要独立的 writing-plans 周期，建议拆成"PDF 渲染器"和"EPUB 渲染器"两个子计划。
4. **图片/漫画翻译**——中等规模新内容脚本，可独立于文档渲染子系统并行推进。
5. **React 迁移（wordbook 试点）**——建议放在功能类工作大致告一段落之后再启动，避免功能迭代和框架迁移在同一批文件上互相冲突。
