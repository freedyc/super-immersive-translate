# 设计：多站点视频双语字幕（配置化字幕引擎）

日期：2026-06-03
状态：已批准设计，待写实现计划

## 背景与目标

现状：`content/youtube.js` 只在 `youtube.com` 生效，用"DOM 抓字幕"方式（监听 `.ytp-caption-window-container` 的 DOM 变化 → 读 `.ytp-caption-segment` 文本 → `translator.translate()` → 注入 `.sit-subtitle-translation` 译文）。核心逻辑通用，只有**域名判断 + 三个选择器**是 YouTube 专属。

目标：把它重构成**配置化的多站点字幕引擎**，核心逻辑只写一遍，每个站点用一份小配置接入；首批覆盖 YouTube / Netflix / Bilibili / Coursera / Udemy / TED + 一个通用 `<video>` 原生字幕兜底；加一个总开关让用户可关。

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 架构 | 配置化适配器注册表（方案 A），单文件引擎 + `SITE_ADAPTERS` 数组 + 通用 cue 兜底 |
| 文件 | `content/youtube.js` → 重构改名 `content/subtitle.js`；`content/youtube.css` → `content/subtitle.css`（改 manifest） |
| 翻译 | 复用 `utils/translator.js` 单例（现有引擎/缓存/去抖） |
| 开关 | 新增设置 `subtitleTranslate`（默认 `true`），加入 `utils/defaults.js` + options 一个开关；统一原本无条件运行的 YouTube |
| 选择器 | 我提供已知最佳值，**需用户在真实站点微调**；架构保证"改一行配置即可修站点" |

## 架构

### 1. 通用引擎（`content/subtitle.js`）

一个 IIFE 内容脚本（manifest 的 content_scripts 已是 `<all_urls>`，脚本自行按 host 选适配器）：

- **适配器选择**：启动时遍历 `SITE_ADAPTERS`，第一个 `hostIncludes` 命中当前 `location.hostname` 的即为活动适配器；都不命中则用「通用 cue 兜底适配器」。
- **观察循环**（DOM 抓字幕型适配器）：等待 `containerSelector` 出现 → `MutationObserver`（childList+subtree+characterData）监听该容器 → 字幕变化去抖 150ms → 读取 `segmentSelector` 拼出当前字幕文本 → 与 `lastText` 比较去重 → `translator.translate(text)` → 在 `mountSelector` 指定处注入/更新 `.sit-subtitle-translation` 译文节点。
- **SPA 导航**：保留现有的 URL 变化监听（`MutationObserver` on body），切视频时清理并重新等待字幕容器。
- **清理**：断开 observer、清除计时器、移除已注入译文节点。
- **开关**：读 `chrome.storage.sync` 的 `subtitleTranslate`；为 `false` 时不启动、并清理；`chrome.storage.onChanged` 实时响应开关。

### 2. 适配器形状

```js
// DOM 抓字幕型
{
  name: 'youtube',
  hostIncludes: ['youtube.com'],
  containerSelector: '.ytp-caption-window-container', // 要观察的容器
  segmentSelector: '.ytp-caption-segment',            // 取当前字幕文本（可多段，拼接）
  mountSelector: '.ytp-caption-window-bottom, .ytp-caption-window-top, [class*="caption-window"]', // 注入译文的位置
}
```
首批适配器（选择器为已知最佳值，**待真实环境验证**，每条注释标注）：
- **youtube**：迁移现有（上方示例）。
- **netflix**：`hostIncludes:['netflix.com']`，container/segment `.player-timedtext`、`.player-timedtext-text-container`，mount 同容器。
- **bilibili**：`hostIncludes:['bilibili.com']`，`.bpx-player-subtitle-panel`、`.bpx-player-subtitle-panel-text`。
- **coursera**：`hostIncludes:['coursera.org']`，video.js 字幕 `.vjs-text-track-display`、`.vjs-text-track-cue`。
- **udemy**：`hostIncludes:['udemy.com']`，`[class*="captions-display--captions-container"]`。
- **ted**：`hostIncludes:['ted.com']`，原生 `.vjs-text-track-display`（或走兜底）。

### 3. 通用 `<video>` cue 兜底适配器

当无站点适配器命中时启用：

- 扫描页面 `<video>`，对其 `textTracks` 监听 `cuechange`；当某 track `mode!=='disabled'` 且有 `activeCues` 时，取 cue 文本 → 翻译 → 用一个固定定位的覆盖层（叠在视频底部）显示双语。
- 覆盖层用 `.sit-subtitle-overlay`，相对最近的 `<video>` 定位（或固定在视口底部居中，简化版）。
- 仅 best-effort：很多站点禁用原生 track 渲染、走自定义 DOM，此兜底只对真正用 WebVTT track 的页面（如部分 HTML5 播放器/TED）有效。

### 4. 设置

- `utils/defaults.js` 的 `DEFAULTS` 新增 `subtitleTranslate: true`。
- `options/` 常规区新增一个开关 `#subtitleTranslate`（接入现有 saveAll/saveFields 模式）。
- `content/subtitle.js` 读取并响应该开关。

### 5. 样式（`content/subtitle.css`）

- 通用化原 `youtube.css`：`.sit-subtitle-translation`（注入到站点字幕窗内的译文行）保留；新增 `.sit-subtitle-overlay`（兜底覆盖层）。手写 CSS（注入宿主页，不用 Tailwind），与现有注入样式一致。

## 单元边界

- **引擎**（observe/debounce/translate/inject/cleanup/开关）：与具体站点解耦，只依赖"当前适配器"接口。
- **适配器注册表**：纯数据 + 少量可选钩子；加站点/改选择器只动这里。
- **兜底适配器**：独立的 cue 监听逻辑，与 DOM 抓字幕型并列。
- 三者可分别理解与替换；引擎不需要知道任何具体站点。

## 分阶段实现（每阶段 `npm run build` + 可加载验收）

1. **重构**：`youtube.js` → `content/subtitle.js`，抽出通用引擎 + `SITE_ADAPTERS`（仅含 youtube 适配器，行为与现状等价）；`youtube.css`→`subtitle.css`；改 manifest。验收：YouTube 字幕翻译与改造前一致。
2. **开关**：`subtitleTranslate` 加入 DEFAULTS + options 开关 + 引擎读取/响应。验收：关掉后 YouTube 不再翻译、开启恢复。
3. **加站点适配器**：Netflix / Bilibili / Coursera / Udemy / TED 各加一条配置。验收：构建通过；逐站点由用户真实环境核对选择器（注明待验证）。
4. **通用 cue 兜底**：`<video>` textTrack 监听 + 覆盖层。验收：在一个用原生 track 的页面出双语。
5. **收尾**：更新 CLAUDE.md（字幕从 YouTube 专属 → 多站点配置化引擎 + 开关）。

## 不在范围内

- 解析/下载字幕轨文件（仍是抓渲染中的字幕，不碰 m3u8/vtt 下载）。
- 保证每个站点开箱即灵（选择器需真实环境微调，明确告知）。
- 字幕样式深度自定义（沿用现有注入样式，最小改动）。
- DRM/受保护内容的绕过（只读已渲染 DOM）。

## 验收标准

1. `npm run build` 成功，加载 `dist/` 后 YouTube 字幕双语与重构前一致（阶段 1）。
2. options 有「视频双语字幕」开关，关/开实时生效（阶段 2）。
3. 各站点适配器存在且选择器有注释来源；用户在真实站点能据此快速微调（阶段 3）。
4. 通用 cue 兜底在使用原生 `<video>` track 的页面能显示双语（阶段 4）。
5. 加新站点/修选择器只需改 `SITE_ADAPTERS` 一处。

## 风险

- **选择器易失效/无法预先验证**：核心风险。缓解：配置化集中、注释来源、用户可快速改；首批仅保证 YouTube（迁移自现有可用代码）确定可用，其余 best-effort。
- **性能**：多 `<video>`/频繁 cuechange 可能高频触发；用 150ms 去抖 + `lastText` 去重 + translator 缓存控制。
- **站点 CSP/DOM 变动**：内容脚本读 DOM 不受 CSP 阻挡；DOM 结构变动靠配置化快速修。
