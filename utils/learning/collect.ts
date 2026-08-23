/**
 * 收藏单词的统一入口 —— 划词面板、sandbox、单词本页共用这一条写入路径。
 *
 * 2.1 把单词本页切到了 Word + LearningRecord 分表模型，但划词面板、popup 徽章、
 * sandbox 仍在读写旧的 `wordbook` 键。结果是：单词本页首次打开时把旧数据迁移进
 * `words`，此后新收藏的词全部落在 `wordbook` 里，再也不会出现在词库中；
 * enrichWordWithAi 事后补的音标同样补进了旧表，永远到不了新表——
 * 「我的词库没有音标」就是这么来的。
 *
 * 所以这里只认一个存储：`words`。旧的 `wordbook` 键仍然保留不动（回滚退路），
 * 但没有任何代码再往里写。
 */
import type { Example, Meaning, Word } from '../../types/models.ts';
import { STORAGE_KEYS } from './repository.ts';

export async function loadWords(): Promise<Word[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.words);
  return (stored[STORAGE_KEYS.words] as Word[]) ?? [];
}

async function saveWords(words: Word[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.words]: words });
  // 单词本页、popup 靠这个消息刷新；storage.onChanged 也会独立触发一次，
  // 两条路都留着——onChanged 在部分场景下不会跨上下文送达
  chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
}

/** 大小写不敏感查找。用户在正文里选到的可能是句首大写的同一个词 */
export function findWord(words: Word[], text: string): Word | undefined {
  const key = text.trim().toLowerCase();
  return words.find((w) => w.word.toLowerCase() === key);
}

export async function getWord(text: string): Promise<Word | undefined> {
  return findWord(await loadWords(), text);
}

export interface CollectInput {
  text: string;
  /** 各引擎的译文，用来兜出一条释义——AI 补全前至少让用户看得到意思 */
  translations?: Record<string, string>;
  /** 用户阅读时抓到的真实句子 */
  sentence?: string;
  sentenceTranslation?: string;
  url?: string;
  title?: string;
}

/**
 * 收藏一个词：已存在就追加语境、补齐缺失字段，不存在就新建。
 *
 * 刻意**不覆盖**已有的释义/音标——用户可能已经手动改过，
 * 每次划词都拿引擎译文盖一遍会让积累的内容不断被冲掉。
 */
export async function collectWord(input: CollectInput): Promise<Word> {
  const words = await loadWords();
  const existing = findWord(words, input.text);

  const example: Example | null = input.sentence
    ? {
        sentence: input.sentence,
        translation: input.sentenceTranslation,
        sourceUrl: input.url,
        sourceTitle: input.title,
        origin: 'context',
        timestamp: Date.now(),
      }
    : null;

  if (existing) {
    const next: Word = { ...existing };
    if (example && !next.examples.some((e) => e.sentence === example.sentence)) {
      next.examples = [...next.examples, example];
    }
    if (next.meanings.length === 0) {
      next.meanings = meaningsFromTranslations(input.translations);
    }
    words[words.indexOf(existing)] = next;
    await saveWords(words);
    return next;
  }

  const created: Word = {
    id: crypto.randomUUID(),
    word: input.text.trim(),
    meanings: meaningsFromTranslations(input.translations),
    examples: example ? [example] : [],
    source: 'ai',
    addedAt: Date.now(),
    sourceUrl: input.url,
    sourceTitle: input.title,
  };
  await saveWords([created, ...words]);
  return created;
}

/** 就地修改一个词。找不到就什么都不做——词可能已经被删了 */
export async function patchWord(
  text: string,
  mutate: (word: Word) => void,
): Promise<void> {
  const words = await loadWords();
  const existing = findWord(words, text);
  if (!existing) return;
  const next = { ...existing };
  mutate(next);
  words[words.indexOf(existing)] = next;
  await saveWords(words);
}

/**
 * 引擎译文兜底成释义。
 *
 * 词性留空而不是瞎标——真实词性要等 AI 或词典数据，
 * 这里编一个会让「词类标识」显示错误信息，比空着更糟。
 */
function meaningsFromTranslations(
  translations: Record<string, string> | undefined,
): Meaning[] {
  if (!translations) return [];
  const seen = new Set<string>();
  const definitions: string[] = [];
  for (const text of Object.values(translations)) {
    const clean = text?.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    definitions.push(clean);
  }
  return definitions.length > 0 ? [{ partOfSpeech: '', definitions }] : [];
}
