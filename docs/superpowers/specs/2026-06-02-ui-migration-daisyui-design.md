# UI 迁移设计：独立页面统一到 Tailwind 4 + daisyUI 5 + Lucide

日期：2026-06-02
状态：已批准设计，待写实现计划

## 背景与目标

仓库有 6 个独立 HTML 页面。其中 `popup/` 和 `sandbox/` 已使用 Tailwind CSS 4 + daisyUI 5 + Lucide 图标；另外 4 个仍是手写原生 CSS、无 Lucide：

- `history/`（history.css 136 行）
- `pdf/`（viewer.css 203 行）
- `wordbook/`（wordbook.css 373 行）
- `options/`（options.css 373 行）

`content/*.css`（content/selection/youtube）是注入宿主网页的样式，**刻意保持手写**以避免污染宿主页，不在迁移范围内。

目标：把上述 4 个页面迁移到 daisyUI 风格，并引入一套**全局统一、可扩展多主题**的主题系统，使全部 6 个页面观感一致、主题可集中扩展。

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 视觉目标 | 采用 daisyUI 组件默认风格（非 1:1 还原旧样式） |
| 主题机制 | 跟随系统 (`prefers-color-scheme`) + 手动覆盖 |
| 主题持久化 | 全局统一：存 `chrome.storage.sync.theme`，所有页面共享、实时同步 |
| 多主题扩展 | 主题清单为单一数据源，后续加主题只动一处（JS 清单 + 共享 CSS 启用） |
| 推进方式 | 逐页迁移、逐页验收 |
| 迁移顺序 | history → pdf → wordbook → options（先简后繁） |
| 功能 | 保持完全不变，仅改 DOM 结构/类名/图标 |

## 架构

### 1. 共享主题层（先做，作为后续页面的地基）

**`utils/theme.js`** —— 全局主题逻辑的唯一来源，导出：

- `AVAILABLE_THEMES`：可用 daisyUI 主题名数组，初始 `['light', 'dark']`。**这是扩展多主题的单一数据源**——加主题只需往此数组追加，并在共享 CSS 中启用同名主题。
- `THEME_META`（可选）：`{ <themeName>: { label, icon } }`，给下拉项提供中文名与 Lucide 图标；未配置的主题回退为「主题名 + 通用图标」，保证新增主题零额外代码即可显示。
- `DEFAULT_LIGHT = 'light'` / `DEFAULT_DARK = 'dark'`：`system` 模式解析到的明/暗主题。
- `resolveTheme(value)`：`value === 'system'` 时按 `matchMedia('(prefers-color-scheme: dark)')` 返回 `DEFAULT_DARK`/`DEFAULT_LIGHT`，否则原样返回。
- `applyTheme()`：读 `chrome.storage.sync.theme`（默认 `'system'`），写 `document.documentElement[data-theme]`。页面启动尽早调用，避免主题闪烁。
- `setTheme(value)`：写 `chrome.storage.sync.set({ theme: value })`。
- `initThemeControl(container)`：在传入元素内渲染一个 **daisyUI 下拉选择器**，选项为「跟随系统」+ `AVAILABLE_THEMES` 各项，绑定 `setTheme`。
- 监听 `prefers-color-scheme` 变化（仅 `system` 模式时重新应用）与 `chrome.storage.onChanged`（跨页面/跨标签实时同步）。

存储模型：`chrome.storage.sync.theme` 取值 `'system' | <themeName>`，默认 `'system'`。
向后兼容：旧值 `'light'` / `'dark'` 属合法主题名，无需迁移。

**`popup/` 与 `sandbox/` 同步接入**：把 popup 现有的 light/dark 二元 toggle 替换为 `initThemeControl` 渲染的统一控件，复用同一 `theme` key。这是"全局统一"的应有之义。

### 2. 共享 daisyUI 主题启用（CSS 侧单一来源）

daisyUI 5 在 CSS 中通过 `@plugin "daisyui" { themes: ... }` 启用主题。为让"加主题只动一处"在 CSS 侧也成立：

- 新增共享样式片段（例如 `styles/theme.css`），内容为 daisyUI 插件 + 启用的主题清单：
  ```css
  @plugin "daisyui" {
    themes: light --default, dark --prefersdark;
  }
  ```
- 各页面 CSS 改为：`@import "tailwindcss";` + `@import "../styles/theme.css";` + 该页极少量自定义样式。

> 实现注意：需在实现首页（history）时验证 Tailwind v4 是否允许 `@plugin` 出现在被 `@import` 的文件中。若不可行，退化方案为在每页 CSS 内联同一行 `themes:` 配置（清单仍以 `utils/theme.js` 的 `AVAILABLE_THEMES` 为权威，CSS 行作镜像）。此验证作为 history 页迁移的一部分。

### 3. 每页迁移配方

对 history → pdf → wordbook → options 依次执行，每页改完即 `npm run build` 加载验收，再进下一页：

- **CSS**：替换为 `@import "tailwindcss";` + 共享主题片段 + 极少量自定义（滚动条、`min-height` 之类），删除手写 reset 与自定义类。
- **HTML**：用 daisyUI 组件（`navbar`/`card`/`btn`/`input`/`select`/`badge`/`modal`/`tabs` 等）+ Tailwind 工具类重写结构；header 放统一主题控件容器。
- **JS**：**仅改 DOM 构造与类名**；业务逻辑（数据读写、事件绑定、`chrome.storage`/`chrome.runtime` 调用、元素 ID 契约）保持不变。引入 `import { createIcons, icons } from 'lucide';` 并在渲染后调用 `createIcons({ icons })`，用 Lucide 替换 emoji 图标。对用模板字符串拼 DOM 的页面（wordbook/options），类名需与新结构同步修改。
- 引入 `import '../utils/theme.js'` 并在启动时 `applyTheme()` + 对 header 容器 `initThemeControl()`。

## 不在范围内

- `content/content.css`、`content/selection.css`、`content/youtube.css`（注入宿主页，刻意手写）
- `vite.config.js`（4 页已是构建入口，无需改动）
- 任何页面的业务逻辑/数据结构/存储 schema（`theme` key 除外）

## 单元边界

- `utils/theme.js`：输入=存储中的 `theme` 值与系统偏好；输出=`data-theme` 属性 + 一个自渲染的下拉控件。对消费者只暴露 `applyTheme`/`setTheme`/`initThemeControl`/`AVAILABLE_THEMES`，内部解析逻辑可独立替换。
- 每个页面：自身 HTML/CSS/JS 独立，仅通过 `import` 依赖 `utils/theme.js` 与共享主题 CSS，互不影响，可逐页独立验收。

## 验收标准（每页）

1. `npm run build` 成功，`dist/` 可作为未打包扩展加载。
2. 页面所有原有功能正常（按各页清单手动验证）。
3. 主题下拉可切换；选「跟随系统」时随系统明暗变化；切换在该页及其他已打开页面实时生效（全局统一）。
4. 页面无残留手写 CSS 类/reset，图标为 Lucide。

## 风险

- daisyUI 主题色覆盖旧配色，需逐页目视确认对比度/可读性。
- emoji → Lucide 的图标映射需逐个挑选。
- wordbook/options 的 JS 大量模板字符串拼 DOM，类名同步是最易出错处——故排在最后。
- `@plugin` 能否跨 `@import` 共享（见上文实现注意），首页验证。
