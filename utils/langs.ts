/**
 * 语言清单 —— 弹窗、设置页、快捷翻译页共用。
 * 原来这份清单在三个页面各手写了一遍 <option>，加语言时容易漏改其中一处。
 */
export const LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁体中文'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية'],
  ['hi', 'हिन्दी'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'],
  ['tr', 'Türkçe'],
];

/** 带「自动检测」的源语言清单 */
export const SOURCE_LANGS = [['auto', '自动检测'], ...LANGS];

/** OCR.space 的语言代码跟我们的 BCP-47 代码不是一套，需要映射 */
export const OCR_LANG_MAP: Record<string, string> = {
  'zh-CN': 'chs', 'zh-TW': 'cht', ja: 'jpn', ko: 'kor', fr: 'fre',
  de: 'ger', es: 'spa', ru: 'rus', pt: 'por', it: 'ita',
};
