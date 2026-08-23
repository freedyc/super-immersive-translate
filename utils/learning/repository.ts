/**
 * 数据访问层。
 *
 * 三个概念要分清：
 * - WordRepository    用户收藏的词库（语料本身，CRUD）
 * - LearningRepository 学习进度（FSRS 卡片、对错统计、笔记）
 * - WordSource        词典数据来源（补充释义/音标/词频等，可插拔：AI / ECDICT / 服务端）
 *
 * 分成三个接口而不是一个，是为了让「换词典数据源」这件事不碰到用户的学习进度，
 * 也让「换存储后端」不碰到词典查询逻辑。
 *
 * 存储后端沿用 chrome.storage.local 而不是 localStorage：
 * localStorage 在扩展的各个页面之间不共享、用户清理站点数据会丢，
 * 而且现有的 GitHub 跨设备同步就建在 chrome.storage 上。
 */
import type { LearningRecord, Word } from '../../types/models.ts';

export interface WordRepository {
  getAll(): Promise<Word[]>;
  get(id: string): Promise<Word | null>;
  save(word: Word): Promise<void>;
  saveMany(words: Word[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface LearningRepository {
  getAll(): Promise<LearningRecord[]>;
  get(wordId: string): Promise<LearningRecord | null>;
  save(record: LearningRecord): Promise<void>;
  saveMany(records: LearningRecord[]): Promise<void>;
  remove(wordId: string): Promise<void>;
}

/** 词典数据来源。MVP 由 AI 生成，第二阶段换成 ECDICT 时只加一个实现 */
export interface WordSource {
  /** 查一个词的词典数据；查不到返回 null，调用方要能接受缺失 */
  lookup(word: string): Promise<Partial<Word> | null>;
  /** 按前缀/关键字搜索。ECDICT 接入后才有实际意义，AI 源可以直接返回空数组 */
  search(query: string, limit: number): Promise<Partial<Word>[]>;
}

export const STORAGE_KEYS = {
  words: 'words',
  records: 'learningRecords',
  /** 2.1 之前的单词本，迁移后保留不动作为回滚退路 */
  legacyWordbook: 'wordbook',
} as const;

/** 从 chrome.storage.local 读一个数组键，任何异常都退化成空数组而不是让页面崩掉 */
async function readArray<T>(key: string): Promise<T[]> {
  try {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** 按 id 更新数组里的一项，不存在则追加 */
function upsert<T>(list: T[], item: T, idOf: (x: T) => string): T[] {
  const id = idOf(item);
  const index = list.findIndex((x) => idOf(x) === id);
  if (index < 0) return [item, ...list];
  const next = [...list];
  next[index] = item;
  return next;
}

export class ChromeWordRepository implements WordRepository {
  async getAll(): Promise<Word[]> {
    return readArray<Word>(STORAGE_KEYS.words);
  }

  async get(id: string): Promise<Word | null> {
    const all = await this.getAll();
    return all.find((w) => w.id === id) ?? null;
  }

  async save(word: Word): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEYS.words]: upsert(all, word, (w) => w.id),
    });
  }

  async saveMany(words: Word[]): Promise<void> {
    let all = await this.getAll();
    for (const word of words) all = upsert(all, word, (w) => w.id);
    await chrome.storage.local.set({ [STORAGE_KEYS.words]: all });
  }

  async remove(id: string): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEYS.words]: all.filter((w) => w.id !== id),
    });
  }
}

export class ChromeLearningRepository implements LearningRepository {
  async getAll(): Promise<LearningRecord[]> {
    return readArray<LearningRecord>(STORAGE_KEYS.records);
  }

  async get(wordId: string): Promise<LearningRecord | null> {
    const all = await this.getAll();
    return all.find((r) => r.wordId === wordId) ?? null;
  }

  async save(record: LearningRecord): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEYS.records]: upsert(all, record, (r) => r.wordId),
    });
  }

  async saveMany(records: LearningRecord[]): Promise<void> {
    let all = await this.getAll();
    for (const record of records) all = upsert(all, record, (r) => r.wordId);
    await chrome.storage.local.set({ [STORAGE_KEYS.records]: all });
  }

  async remove(wordId: string): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEYS.records]: all.filter((r) => r.wordId !== wordId),
    });
  }
}

/** 便于在组件里取到同一组实例，也便于测试时整体替换 */
export const repositories = {
  words: new ChromeWordRepository(),
  learning: new ChromeLearningRepository(),
};
