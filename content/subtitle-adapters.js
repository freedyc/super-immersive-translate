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
