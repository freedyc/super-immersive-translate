// 站点字幕适配器注册表 —— 纯数据，加站点/改选择器只改这里，不用碰引擎逻辑。
// 每条：{ name, hostIncludes, containerSelector, segmentSelector, mountSelector, parseText? }
// parseText 可选：不填就是恒等函数，segmentSelector 抓到的原始文本直接送翻译；
// 需要先从原始文本里摘取要翻译的部分（比如 Zoom 的 "发言人: 内容"）才定义它。
export const SITE_ADAPTERS = [
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'youtube',
    hostIncludes: ['youtube.com'],
    containerSelector: '.ytp-caption-window-container',
    segmentSelector: '.ytp-caption-segment',
    mountSelector: '.ytp-caption-window-bottom, .ytp-caption-window-top, [class*="caption-window"]',
  },
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'netflix',
    hostIncludes: ['netflix.com'],
    containerSelector: '.player-timedtext',
    segmentSelector: '.player-timedtext-text-container',
    mountSelector: '.player-timedtext',
  },
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'bilibili',
    hostIncludes: ['bilibili.com'],
    containerSelector: '.bpx-player-subtitle-panel',
    segmentSelector: '.bpx-player-subtitle-panel-text',
    mountSelector: '.bpx-player-subtitle-panel',
  },
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'coursera',
    hostIncludes: ['coursera.org'],
    containerSelector: '.vjs-text-track-display',
    segmentSelector: '.vjs-text-track-cue',
    mountSelector: '.vjs-text-track-display',
  },
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'udemy',
    hostIncludes: ['udemy.com'],
    containerSelector: '[class*="captions-display--captions-container"]',
    segmentSelector: '[class*="captions-display--captions-container"]',
    mountSelector: '[class*="captions-display--captions-container"]',
  },
  // 待真实环境验证，选择器来自 2026-06-03 设计文档。
  {
    name: 'ted',
    hostIncludes: ['ted.com'],
    containerSelector: '.vjs-text-track-display',
    segmentSelector: '.vjs-text-track-cue',
    mountSelector: '.vjs-text-track-display',
  },
  // 参考 yunho0130/google-meet-cc-to-srt（content/meet-cc-simple.js），置信度高。
  // jsname 是 Google 内部测试钩子，比同层的混淆 CSS 模块类名更抗改版，优先信
  // jsname/aria-label，.ygicle/.iTTPOb 这类 class 名只当兜底。
  {
    name: 'google-meet',
    hostIncludes: ['meet.google.com'],
    containerSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
    segmentSelector: '.ygicle.VbkSUe, .iTTPOb',
    mountSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
  },
  // 参考 Zerg00s/Live-Captions-Saver（teams-captions-saver/content_script.js，
  // MIT，持续维护中），置信度高。data-tid 是微软自己的测试 id 约定，三个会议
  // 平台里最抗改版；上游历史上遇到过更新后字幕唯一 id 消失的情况，所以保留了
  // [data-tid*='closed-caption'] 通配兜底，照抄不要丢。
  {
    name: 'teams',
    hostIncludes: ['teams.microsoft.com', 'teams.live.com'],
    containerSelector: '[data-tid="closed-caption-v2-window-wrapper"], [data-tid="closed-captions-renderer"], [data-tid*="closed-caption"]',
    segmentSelector: '[data-tid="closed-caption-text"]',
    mountSelector: '[data-tid="closed-caption-v2-window-wrapper"], [data-tid="closed-captions-renderer"], [data-tid*="closed-caption"]',
  },
  // 参考 aalemoro/meetrecap（src/content/zoom.js），置信度中——三个会议适配器
  // 里最容易跟真实页面不符，验证时优先核对这条。Zoom 常见的更新方式是复用同一
  // 个覆盖层节点、每句话整体替换文本，且文本形如 "发言人: 内容"，所以额外需要
  // parseText 把发言人前缀摘掉，只翻译发言内容本身。
  {
    name: 'zoom',
    hostIncludes: ['zoom.us'],
    containerSelector: '#live-transcription-subtitle, [class*="live-transcription-subtitle"], [class*="live-transcription"]',
    segmentSelector: '.live-transcription-subtitle__item',
    mountSelector: '#live-transcription-subtitle, [class*="live-transcription-subtitle"], [class*="live-transcription"]',
    parseText(raw) {
      // "张三: 今天的进度..." → 去掉发言人前缀，只翻译发言内容。
      // 冒号出现在前 30 个字符内才当作发言人前缀处理，避免把正文里偶然出现的
      // 冒号（比如引用的时间 "3:00"）误判成前缀分隔符。
      const idx = raw.indexOf(': ');
      return idx > -1 && idx < 30 ? raw.slice(idx + 2) : raw;
    },
  },
];
