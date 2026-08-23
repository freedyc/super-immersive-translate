/**
 * 2.1 学习数据的跨设备三方合并。
 *
 * 沿用 github-sync.js 里既有的约定，不另起一套：
 *   - 标量字段     → 本地优先
 *   - 字典型字段   → 按 key 合并，两边都有同一 key 时整体取较新的一方
 *   - 数组型字段   → 去重取并集（每一项是独立的"事件"，不是会演变的状态）
 *
 * 用 TypeScript 写是有意的：这个文件历史上最常见的 bug 就是"加了新字段但忘了
 * 加进合并函数"，结果同步一次字段就被静默丢掉（pos / ipa 都发生过）。
 * 显式列出字段 + 类型检查能把这类问题挡在编译期。
 */
import type {
  Example,
  ExerciseRecord,
  ExerciseType,
  LearningRecord,
  Meaning,
  SerializedCard,
  Word,
} from '../../types/models.ts';

/** 跨设备同步文件的载荷。带 version 便于以后再次演进格式 */
export interface SyncPayloadV2 {
  version: 2;
  words: Word[];
  records: LearningRecord[];
}

function unionStrings(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

/**
 * 例句取并集。判重用「句子 + 来源页」：同一句话来自不同页面是两条独立的语境，
 * 都值得保留；同一页面的同一句话才是重复。
 */
function mergeExamples(a: Example[] = [], b: Example[] = []): Example[] {
  const seen = new Map<string, Example>();
  for (const ex of [...a, ...b]) {
    if (!ex?.sentence) continue;
    const key = `${ex.sentence}|${ex.sourceUrl ?? ''}`;
    if (!seen.has(key)) seen.set(key, ex);
  }
  return [...seen.values()];
}

/** 释义按词性合并，同词性下的释义去重取并集 */
function mergeMeanings(a: Meaning[] = [], b: Meaning[] = []): Meaning[] {
  const byPos = new Map<string, Set<string>>();
  for (const m of [...a, ...b]) {
    if (!m?.partOfSpeech) continue;
    const set = byPos.get(m.partOfSpeech) ?? new Set<string>();
    (m.definitions ?? []).filter(Boolean).forEach((d) => set.add(d));
    byPos.set(m.partOfSpeech, set);
  }
  return [...byPos.entries()].map(([partOfSpeech, defs]) => ({
    partOfSpeech,
    definitions: [...defs],
  }));
}

/**
 * 词典数据合并。key 用小写单词，跟旧版 mergeWordbook 按 text 去重保持一致。
 * `local` 的字段优先（标量约定），但 id 取远端优先——id 不参与任何展示或业务逻辑，
 * 本地优先会让两台设备互推时 id 在两个随机值之间来回跳，内容没变也产生无意义的提交。
 */
export function mergeWords(local: Word[], remote: Word[]): Word[] {
  const byKey = new Map<string, Word>();

  // remote 在前、local 在后：同一 key 第二次出现（必是 local）时其标量字段覆盖前者
  for (const entry of [...remote, ...local]) {
    const key = entry?.word?.toLowerCase();
    if (!key) continue; // 远端文件可能被手动编辑坏，跳过而不是抛异常

    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, entry);
      continue;
    }

    const priorAdded = prior.addedAt ?? Infinity;
    const entryAdded = entry.addedAt ?? Infinity;
    const earliest = Math.min(priorAdded, entryAdded);

    byKey.set(key, {
      id: prior.id || entry.id,
      word: prior.word,
      phonetic: entry.phonetic || prior.phonetic,
      phoneticUK: entry.phoneticUK || prior.phoneticUK,
      phoneticUS: entry.phoneticUS || prior.phoneticUS,
      audioUK: entry.audioUK || prior.audioUK,
      audioUS: entry.audioUS || prior.audioUS,
      meanings: mergeMeanings(prior.meanings, entry.meanings),
      examples: mergeExamples(prior.examples, entry.examples),
      phrases: unionStrings(prior.phrases, entry.phrases),
      synonyms: unionStrings(prior.synonyms, entry.synonyms),
      antonyms: unionStrings(prior.antonyms, entry.antonyms),
      wordForms: { ...prior.wordForms, ...entry.wordForms },
      roots: entry.roots || prior.roots,
      memoryTip: entry.memoryTip || prior.memoryTip,
      difficulty: entry.difficulty ?? prior.difficulty,
      frequency: entry.frequency ?? prior.frequency,
      tags: unionStrings(prior.tags, entry.tags),
      image: entry.image || prior.image,
      // 词典来源取"更权威"的一方：真实词典数据优于 AI 生成
      source: prior.source === 'ecdict' || entry.source === 'ecdict' ? 'ecdict' : entry.source,
      // 收藏时间取更早的：同一个词在两台设备上都收藏过，第一次遇见它才是有意义的时间
      addedAt: earliest === Infinity ? Date.now() : earliest,
      sourceUrl: entry.sourceUrl || prior.sourceUrl,
      sourceTitle: entry.sourceTitle || prior.sourceTitle,
    });
  }

  return [...byKey.values()].sort((a, b) => b.addedAt - a.addedAt);
}

function cardTime(card: SerializedCard | undefined): number {
  if (!card?.last_review) return 0;
  const t = new Date(card.last_review).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 各题型的调度卡片按 key 合并，两边都有同一题型时取 last_review 较新的**整张卡**。
 * 不拆开卡内部字段混合——FSRS 的 stability/difficulty/reps 彼此关联，
 * 各取一半会得到一张算法意义上不自洽的卡。
 */
function mergeByExercise(
  a: LearningRecord['byExercise'] = {},
  b: LearningRecord['byExercise'] = {},
): LearningRecord['byExercise'] {
  const result: LearningRecord['byExercise'] = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<ExerciseType>;

  for (const key of keys) {
    const ra = a[key];
    const rb = b[key];
    if (!ra) { result[key] = rb; continue; }
    if (!rb) { result[key] = ra; continue; }

    const newer: ExerciseRecord = cardTime(ra.card) >= cardTime(rb.card) ? ra : rb;
    result[key] = {
      card: newer.card,
      // 对错次数取较大值而不是本地优先：两台设备各练过一些，
      // 本地优先会把另一台的练习次数抹掉；求和又会在多次同步后重复累加
      correct: Math.max(ra.correct, rb.correct),
      wrong: Math.max(ra.wrong, rb.wrong),
    };
  }

  return result;
}

/** 学习记录合并，key 用 wordId */
export function mergeLearningRecords(
  local: LearningRecord[],
  remote: LearningRecord[],
): LearningRecord[] {
  const byId = new Map<string, LearningRecord>();

  for (const entry of [...remote, ...local]) {
    const id = entry?.wordId;
    if (!id) continue;

    const prior = byId.get(id);
    if (!prior) {
      byId.set(id, entry);
      continue;
    }

    // 谁最后学过，谁的"当下状态"更可信（streak / note / suspended 这类）
    const entryIsNewer = (entry.lastStudiedAt ?? 0) >= (prior.lastStudiedAt ?? 0);
    const fresher = entryIsNewer ? entry : prior;

    const firstTimes = [prior.firstStudiedAt, entry.firstStudiedAt].filter(
      (t): t is number => typeof t === 'number',
    );

    byId.set(id, {
      wordId: id,
      firstStudiedAt: firstTimes.length ? Math.min(...firstTimes) : undefined,
      lastStudiedAt: Math.max(prior.lastStudiedAt ?? 0, entry.lastStudiedAt ?? 0) || undefined,
      // 同上：取较大值，避免抹掉另一台设备的练习量
      studyCount: Math.max(prior.studyCount ?? 0, entry.studyCount ?? 0),
      correctCount: Math.max(prior.correctCount ?? 0, entry.correctCount ?? 0),
      wrongCount: Math.max(prior.wrongCount ?? 0, entry.wrongCount ?? 0),
      // 连对次数是"最近一段的状态"，跟着最后学过的那台设备走
      streak: fresher.streak ?? 0,
      byExercise: mergeByExercise(prior.byExercise, entry.byExercise),
      // 收藏过就算收藏：任一端标记了就保留，避免另一端的旧快照把它取消掉
      favorite: prior.favorite || entry.favorite || undefined,
      // 笔记是用户手写内容，丢了不可恢复；两端都有且不同时保留较新那条，
      // 但把另一条附在后面，宁可让用户自己删也不要替他丢掉
      note: mergeNote(prior, entry, fresher),
      suspended: fresher.suspended || undefined,
    });
  }

  return [...byId.values()];
}

function mergeNote(
  a: LearningRecord,
  b: LearningRecord,
  fresher: LearningRecord,
): string | undefined {
  const notes = [a.note, b.note].filter((n): n is string => !!n?.trim());
  if (notes.length === 0) return undefined;
  if (notes.length === 1) return notes[0];
  if (notes[0] === notes[1]) return notes[0];

  const other = notes.find((n) => n !== fresher.note);
  return other ? `${fresher.note}\n---\n${other}` : fresher.note;
}

/** 合并两份同步载荷 */
export function mergeSyncPayload(local: SyncPayloadV2, remote: SyncPayloadV2): SyncPayloadV2 {
  return {
    version: 2,
    words: mergeWords(local.words ?? [], remote.words ?? []),
    records: mergeLearningRecords(local.records ?? [], remote.records ?? []),
  };
}
