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

/**
 * 单词本条目 —— 2.1 之前的形态，chrome.storage.local 的 `wordbook` 数组元素。
 *
 * 2.1 起改用 Word + LearningRecord 分表（见下方）。这个类型保留下来只为迁移读取旧数据，
 * 新代码不要再往里加字段。迁移逻辑见 wordbook/lib/migrate.ts。
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// 2.1 学习闭环的数据模型
//
// 核心决策：**词典数据（Word）与学习记录（LearningRecord）分表**。
// 词典数据的来源将来会换（现在是 AI 生成，第二阶段接 ECDICT），
// 分表之后换来源不会碰到用户的学习进度。
// 设计依据见 docs/superpowers/specs/2026-08-23-vocabulary-learning-design.md
// ─────────────────────────────────────────────────────────────────────────────

/** 一个词性下的若干条释义。一个单词可以有多个 Meaning */
export interface Meaning {
  partOfSpeech: string;
  /** 同一词性下可能有多条释义，不要退化成单个字符串 */
  definitions: string[];
}

/** 例句。来自阅读语境的会带来源页面，AI 生成的不带 */
export interface Example {
  sentence: string;
  translation?: string;
  /** 词性/语法角色标注（现有 AI 生成能力的产物） */
  tokens?: Token[];
  sourceUrl?: string;
  sourceTitle?: string;
  /** context = 用户阅读时抓到的真实句子；ai = 生成的 */
  origin: 'context' | 'ai';
  timestamp: number;
}

/**
 * 词典数据 —— 只读。来源可以是 AI 生成、ECDICT、或将来的服务端。
 * 字段大多可选：MVP 阶段只有 AI 能提供的那几项，其余留给第二阶段的词典数据集填充，
 * UI 必须对缺失字段做渐进降级，而不是假定它们存在。
 */
export interface Word {
  id: string;
  word: string;
  /**
   * 未标注英美的音标。现有 AI 生成的 IPA 就是这种——它没说自己是英音还是美音，
   * 硬塞进 phoneticUS 是替数据做了它没有的断言。接入词典数据集后再填下面两个。
   */
  phonetic?: string;
  phoneticUK?: string;
  phoneticUS?: string;
  audioUK?: string;
  audioUS?: string;
  meanings: Meaning[];
  examples: Example[];
  phrases?: string[];
  synonyms?: string[];
  antonyms?: string[];
  /** 词形变化：复数/过去式/比较级等，键为变化类型 */
  wordForms?: Record<string, string>;
  roots?: string;
  memoryTip?: string;
  /** 难度，数值越大越难。ECDICT 接入后可由 Collins 星级/Oxford 3000 推导 */
  difficulty?: number;
  /** 词频排名，数值越小越常见。需要真实语料统计，AI 编的不可信 */
  frequency?: number;
  /** 考试分类：cet4 / cet6 / ky / toefl / ielts / gre 等 */
  tags?: string[];
  image?: string;
  source: 'ai' | 'ecdict' | 'user';
  /** 用户收藏这个词的时间。「今日新增」统计依赖它，迁移时不能丢 */
  addedAt: number;
  /** 收藏时所在的页面——这是语境驱动产品的核心资产，不要在迁移中丢弃 */
  sourceUrl?: string;
  sourceTitle?: string;
}

/** 四种核心题型 */
export type ExerciseType =
  /** 看英文选中文释义 */
  | 'en2zh'
  /** 看中文释义选英文单词 */
  | 'zh2en'
  /** 听发音选正确单词 */
  | 'listening'
  /** 看释义拼写单词 */
  | 'spelling';

/** 熟悉度四档，映射到 FSRS 的四个评分 */
export type Familiarity = 'again' | 'hard' | 'good' | 'easy';

/** 单个题型的调度卡片与统计 */
export interface ExerciseRecord {
  card: SerializedCard;
  correct: number;
  wrong: number;
}

/**
 * 学习记录 —— 与 Word 分离，按 wordId 关联。
 *
 * 注意这里**没有** learningStatus 字段：掌握程度全部可以从 FSRS 卡片派生，
 * 存两份必然不一致（旧的 WordEntry.known 就是这么变成兼容包袱的）。
 * 唯一需要存储的状态是 suspended——那是用户的主动意图，推导不出来。
 */
export interface LearningRecord {
  wordId: string;
  firstStudiedAt?: number;
  lastStudiedAt?: number;
  studyCount: number;
  correctCount: number;
  wrongCount: number;
  /** 连续答对次数 */
  streak: number;
  /** 各题型各自调度：开放字典，加题型不用改数据结构 */
  byExercise: Partial<Record<ExerciseType, ExerciseRecord>>;
  favorite?: boolean;
  note?: string;
  /** 用户主动暂停学习这个词 */
  suspended?: boolean;
}

/**
 * 展示用的学习状态 —— 派生值，不存储。
 * 给用户看的只有这几档，不暴露 Stability/Difficulty/Retrievability 这些算法术语。
 */
export type LearningStatus =
  | 'new'
  | 'learning'
  | 'reviewing'
  | 'difficult'
  | 'mastered'
  | 'suspended';

/** 每日学习计划 */
export interface StudyConfig {
  /** 每日新词上限 */
  dailyNewLimit: number;
  /** 每日复习上限，0 = 不限制 */
  dailyReviewLimit: number;
  /** 启用的题型；至少要有一种 */
  enabledExercises: ExerciseType[];
}

/** 今日队列里的一项：某个词的某个题型 */
export interface QueueItem {
  wordId: string;
  exercise: ExerciseType;
  /** 是首次学习还是到期复习 */
  kind: 'new' | 'review';
}

/** 今日任务队列 */
export interface StudyQueue {
  items: QueueItem[];
  /** 涉及的**单词**数量——对用户展示这个，不是 items.length
      （一个词可能有多个题型，展示卡片数会让人困惑） */
  newWordCount: number;
  reviewWordCount: number;
}
