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
  {
    name: 'google-meet',
    hostIncludes: ['meet.google.com'],
    containerSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
    segmentSelector: '.ygicle.VbkSUe, .iTTPOb',
    mountSelector: '[jsname="dsyhDe"], [role="region"][aria-label*="caption" i]',
  },
  {
    name: 'teams',
    hostIncludes: ['teams.microsoft.com', 'teams.live.com'],
    containerSelector: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
    segmentSelector: '[data-tid="closed-caption-text"]',
    mountSelector: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
  },
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
];
