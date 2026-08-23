/**
 * 旧 WordEntry → 新 Word + LearningRecord 的迁移。
 *
 * ⚠️ 本模块目前**只是纯函数，尚未接进应用启动流程**。上线前必须先解决一件事：
 * utils/github-sync.js 的跨设备同步是同步 `wordbook` 这个键的。一旦应用改为读写
 * 新的 `words` / `learningRecords`，单词本的跨设备同步会静默失效。
 * 所以「切换存储」和「更新同步逻辑」必须在同一批改动里完成，不能只做一半。
 *
 * 设计约束：
 * - **幂等**：重复跑不会产生重复数据，也不会覆盖迁移后用户新产生的学习进度。
 * - **不破坏原数据**：旧的 `wordbook` 键保留不动，作为回滚的退路。
 * - **不丢语境**：contexts[] 是这个产品最有价值的资产（用户遇到该词的真实句子），
 *   必须完整搬到 examples[]。
 */
import type {
  Example,
  ExerciseType,
  LearningRecord,
  Meaning,
  ReviewMode,
  Word,
  WordEntry,
} from '../../types/models.ts';

/**
 * 旧的两种复习方向 → 新的四种题型。
 * recall（看释义拼单词）语义上就是 spelling；
 * recognition（看单词选释义）就是 en2zh。另两种题型没有历史数据，从零开始。
 */
const MODE_TO_EXERCISE: Record<ReviewMode, ExerciseType> = {
  recall: 'spelling',
  recognition: 'en2zh',
};

export interface MigrationResult {
  words: Word[];
  records: LearningRecord[];
  /** 有多少条旧数据带着复习进度——用于迁移后核对没丢 */
  migratedWithProgress: number;
}

/** 旧条目的 id 可能缺失（很早期的数据），用文本兜底保证稳定关联 */
function wordIdOf(entry: WordEntry): string {
  return entry.id || `legacy:${entry.text.toLowerCase()}`;
}

function toMeanings(entry: WordEntry): Meaning[] {
  // translations 是「引擎 → 译文」，多个引擎经常给出一模一样的结果，先去重
  const definitions = [...new Set(Object.values(entry.translations || {}).filter(Boolean))];
  if (definitions.length === 0) return [];
  // 没有词性就留空，不要填「未知」这类占位符。占位符是真值，会让
  // applyMeta 的 `!pickPos(word)` 和划词面板的补全判断恒假，
  // 真实词性从此再也写不进来——显示难看只是表象，卡住补全才是要命的
  return [{ partOfSpeech: entry.pos || '', definitions }];
}

function toExamples(entry: WordEntry): Example[] {
  return (entry.contexts ?? [])
    .filter((ctx) => ctx?.sentence)
    .map((ctx) => ({
      sentence: ctx.sentence,
      translation: ctx.translation,
      tokens: ctx.tokens,
      sourceUrl: ctx.url ?? undefined,
      sourceTitle: ctx.title,
      // 旧数据里 AI 生成的标了 source:'ai'，没标的都是页面抓取的真实语境
      origin: ctx.source === 'ai' ? 'ai' : 'context',
      timestamp: ctx.timestamp,
    }));
}

/** 把一条旧记录拆成词典数据 + 学习记录 */
export function convertEntry(entry: WordEntry): { word: Word; record: LearningRecord | null } {
  const id = wordIdOf(entry);

  const word: Word = {
    id,
    word: entry.text,
    // 旧的 ipa 没有标注英美，放进中性的 phonetic 而不是猜成 phoneticUS
    phonetic: entry.ipa,
    meanings: toMeanings(entry),
    examples: toExamples(entry),
    source: 'ai',
    addedAt: entry.timestamp,
    sourceUrl: entry.url,
    sourceTitle: entry.title,
  };

  const byExercise: LearningRecord['byExercise'] = {};
  let correct = 0;
  let wrong = 0;

  for (const [mode, exercise] of Object.entries(MODE_TO_EXERCISE) as [ReviewMode, ExerciseType][]) {
    const card = entry.srs?.[mode];
    if (!card) continue;
    // 旧模型没有分题型的对错计数，只能从 reps 推一个总次数；
    // 具体对错分布已经无从还原，宁可留 0 也不要编一个假的正确率
    byExercise[exercise] = { card, correct: 0, wrong: 0 };
  }

  if (Object.keys(byExercise).length === 0) {
    // 从没学过的词只有词典数据，没有学习记录
    return { word, record: null };
  }

  const reps = Object.values(byExercise).reduce(
    (sum, e) => sum + (typeof e.card.reps === 'number' ? e.card.reps : 0),
    0,
  );

  return {
    word,
    record: {
      wordId: id,
      studyCount: reps,
      correctCount: correct,
      wrongCount: wrong,
      streak: 0,
      byExercise,
      // 旧的 known 字段刻意不迁移：它早已被 FSRS 派生的掌握度取代，
      // 迁过来只会再造一个跟卡片对不上的第二真源
    },
  };
}

/**
 * 全量迁移。
 *
 * `existingRecords` 传入迁移后用户已经产生的学习记录：同一个词如果已经有新记录，
 * 保留新的、跳过旧的——这是幂等性的关键，否则重跑一次会把用户新的复习进度打回去。
 */
export function migrateWordbook(
  entries: WordEntry[],
  existingRecords: LearningRecord[] = [],
): MigrationResult {
  const existing = new Map(existingRecords.map((r) => [r.wordId, r]));
  const words: Word[] = [];
  const records: LearningRecord[] = [];
  const seen = new Set<string>();
  let migratedWithProgress = 0;

  for (const entry of entries) {
    if (!entry?.text) continue; // 远端文件被手动编辑坏的情况，跳过而不是抛异常

    const id = wordIdOf(entry);
    if (seen.has(id)) continue; // 旧数据按 text 去重过，但 id 缺失时可能撞车
    seen.add(id);

    const { word, record } = convertEntry(entry);
    words.push(word);

    const already = existing.get(id);
    if (already) {
      records.push(already); // 用户迁移后的进度优先，不被旧数据覆盖
    } else if (record) {
      records.push(record);
      migratedWithProgress++;
    }
  }

  return { words, records, migratedWithProgress };
}
