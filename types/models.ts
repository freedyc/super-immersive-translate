/**
 * 跨模块共享的数据模型。
 *
 * 这几个形状是这个扩展里真正的"契约"——它们同时被内容脚本、独立页面、
 * GitHub 同步的合并逻辑读写。本次会话踩过的坑基本都出在这里：
 * mergeWordbook 漏掉新加的字段、srs 卡片序列化前后类型不一致、
 * tokens 加了 role 但消费方没跟上。写成类型就能让 tsc 直接把这类问题挡下来。
 */

/** 词性（十大词类），跟 utils/example-sentence.js 的 POS_LIST 一一对应 */
export type PartOfSpeech =
  | '名词' | '代词' | '动词' | '形容词' | '副词'
  | '介词' | '连词' | '感叹词' | '冠词' | '限定词';

/** 语法角色（这个词在句子里当什么成分），跟 ROLE_LIST 对应 */
export type GrammarRole =
  | '主语' | '谓语' | '宾语' | '定语' | '状语' | '补语' | '其他';

/** 例句里的一个词及其标注 */
export interface Token {
  text: string;
  pos?: PartOfSpeech | string;
  /** 2026-08 新增。历史数据没有这个字段，消费方必须容忍缺失 */
  role?: GrammarRole | string;
}

/** 单词的一条例句上下文。可能来自页面真实抓取，也可能是 AI 生成 */
export interface WordContext {
  sentence: string;
  /** AI 生成的例句才有译文；页面抓取的通常没有 */
  translation?: string;
  tokens?: Token[];
  /** AI 生成的为 null；页面抓取的是来源页地址 */
  url: string | null;
  title?: string;
  timestamp: number;
  source?: 'ai';
}

/** FSRS 卡片存进 storage 的形态：Date 已经序列化成 ISO 字符串 */
export interface SerializedCard {
  due: string;
  last_review?: string;
  stability: number;
  difficulty: number;
  reps: number;
  state: number;
  [key: string]: unknown;
}

/**
 * 复习方向。设计成开放字典的键，将来加新题型不用改数据结构
 * （见 2026-08-21 的 FSRS 设计文档）
 */
export type ReviewMode = 'recall' | 'recognition';

/** 单词本条目 —— chrome.storage.local 的 `wordbook` 数组元素 */
export interface WordEntry {
  id: string;
  text: string;
  /** 引擎 id → 译文 */
  translations: Record<string, string>;
  timestamp: number;
  url?: string;
  title?: string;
  /** 旧字段，已被 srs 派生的掌握度取代，保留是为了兼容历史数据 */
  known?: boolean;
  /** 词性 */
  pos?: string;
  /** 国际音标 */
  ipa?: string;
  contexts?: WordContext[];
  srs?: Partial<Record<ReviewMode, SerializedCard>>;
}

/** 翻译历史条目 —— chrome.storage.local 的 `translationHistory` 数组元素 */
export interface HistoryEntry {
  id?: string;
  text: string;
  translation: string;
  engine?: string;
  url?: string;
  title?: string;
  timestamp: number;
}

/** 字幕站点适配器（content/subtitle-adapters.js 的元素形状） */
export interface SubtitleAdapter {
  name: string;
  hostIncludes: string[];
  containerSelector: string;
  segmentSelector: string;
  mountSelector: string;
  /** 可选钩子：从抓到的原始文本里摘出真正要翻译的部分（如 Zoom 的"发言人: 内容"） */
  parseText?: (raw: string) => string;
}

/** GitHub 同步状态 —— chrome.storage.local 的 `githubSyncStatus` */
export interface SyncStatus {
  lastSyncAt?: number;
  lastError?: string;
}

/** 各页面统一的操作反馈（渲染成 MUI Snackbar） */
export interface Toast {
  severity: 'success' | 'info' | 'warning' | 'error';
  message: string;
}
