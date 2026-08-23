/**
 * 快捷翻译页各标签页共享的类型。
 */
import type { Toast, Token } from '../../types/models.ts';

/** 各标签页都需要的翻译上下文（顶部选择器决定，标签页只读不写） */
export interface TranslateContext {
  engine: string;
  sourceLang: string;
  targetLang: string;
}

/** 带反馈通道的标签页 props */
export interface TabPropsWithNotify extends TranslateContext {
  notify: (toast: Toast) => void;
}

/** AI 句子分析的结果 */
export interface SentenceAnalysis {
  translation: string;
  tokens: Token[];
  similar: { sentence: string; translation?: string }[];
}

/** 收藏到单词本时暂存的一次翻译结果 */
export interface SaveCandidate {
  source: string;
  target: string;
  engine: string;
}
