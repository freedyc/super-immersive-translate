/**
 * 2.1 学习数据的唯一读写入口。
 *
 * 负责三件事：
 * 1. 首次加载时把旧的 wordbook 迁移成 words + learningRecords（幂等，不动旧数据）
 * 2. 监听 chrome.storage.onChanged —— 后台 GitHub 同步会在页面打开时写入这两个键，
 *    不监听就会被内存里的旧快照在下次保存时覆盖掉（这个坑本项目踩过不止一次）
 * 3. 提供按 wordId 更新学习记录的方法，用 wordId 而不是数组下标定位，
 *    因为后台同步可能在用户操作期间重排数组
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LearningRecord, Word, WordEntry } from '../../types/models.ts';
import { migrateWordbook } from '../../utils/learning/migrate.ts';
import { STORAGE_KEYS } from '../../utils/learning/repository.ts';
import { lookupPhonetic } from '../../utils/phonetics-client.js';

interface LearningState {
  words: Word[];
  records: Map<string, LearningRecord>;
  loaded: boolean;
  /** 读取失败的原因；非空时页面显示错误态而不是一直转圈 */
  error: string | null;
  /** 本次加载是否执行了迁移，用于给用户一个「已从旧版本导入」的提示 */
  migratedCount: number;
}

async function loadOrMigrate(): Promise<Omit<LearningState, 'loaded' | 'error'>> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.words,
    STORAGE_KEYS.records,
    STORAGE_KEYS.legacyWordbook,
    STORAGE_KEYS.migratedAt,
  ]);

  const words = (stored[STORAGE_KEYS.words] as Word[]) ?? [];
  const records = (stored[STORAGE_KEYS.records] as LearningRecord[]) ?? [];
  const legacy = (stored[STORAGE_KEYS.legacyWordbook] as WordEntry[]) ?? [];
  const done = new Map(records.map((r) => [r.wordId, r]));

  // 判断迁移跑没跑过要看标记，不能看「words 是否为空」：划词面板现在直接写 words，
  // 用户完全可能先在网页上收藏一个词、再第一次打开单词本页，
  // 那时 words 非空但旧数据一条都还没迁过来，按旧判断会被永久跳过
  if (stored[STORAGE_KEYS.migratedAt] || legacy.length === 0) {
    return { words, records: done, migratedCount: 0 };
  }

  const result = migrateWordbook(legacy, records);
  // 新表里已经有的词不被旧数据覆盖——那些是迁移之前新收藏的，内容更新
  const have = new Set(words.map((w) => w.word.toLowerCase()));
  const added = result.words.filter((w) => !have.has(w.word.toLowerCase()));
  const addedRecords = result.records.filter((r) => !done.has(r.wordId));

  await chrome.storage.local.set({
    [STORAGE_KEYS.words]: [...words, ...added],
    [STORAGE_KEYS.records]: [...records, ...addedRecords],
    [STORAGE_KEYS.migratedAt]: Date.now(),
    // 旧的 wordbook 键刻意保留不动，作为回滚退路
  });

  return {
    words: [...words, ...added],
    records: new Map([...records, ...addedRecords].map((r) => [r.wordId, r])),
    migratedCount: added.length,
  };
}

/** 早期迁移写进数据里的词性占位符。它们是真值，会永久卡住真实词性的补全 */
const FAKE_POS = new Set(['未知', '未知词性', 'unknown', 'n/a', '-']);

/**
 * 修补历史数据：补本地词典里的音标，清掉伪造的词性占位符。
 *
 * 两件事合在一次写入里做——分开写会连着触发两轮 storage 变更和 GitHub 同步。
 * 只在真有东西可改时才写；没有就完全不碰存储，否则每次打开页面都白写一轮。
 */
async function repairWords(words: Word[]): Promise<void> {
  const phonetics = new Map<string, string>();
  await Promise.all(
    words
      .filter((w) => !w.phonetic && !w.phoneticUS && !w.phoneticUK)
      .map(async (w) => {
        const ipa = await lookupPhonetic(w.word);
        if (ipa) phonetics.set(w.id, ipa);
      }),
  );

  const fakePos = new Set(
    words.filter((w) => w.meanings.some((m) => FAKE_POS.has(m.partOfSpeech))).map((w) => w.id),
  );
  if (phonetics.size === 0 && fakePos.size === 0) return;

  // 重新读一次再写：这是后台行为，期间用户可能已经删词或收藏了新词
  const stored = await chrome.storage.local.get(STORAGE_KEYS.words);
  const current = (stored[STORAGE_KEYS.words] as Word[]) ?? [];
  await chrome.storage.local.set({
    [STORAGE_KEYS.words]: current.map((w) => {
      if (!phonetics.has(w.id) && !fakePos.has(w.id)) return w;
      const next = { ...w };
      if (phonetics.has(w.id)) next.phoneticUS = phonetics.get(w.id);
      if (fakePos.has(w.id)) {
        next.meanings = w.meanings.map((m) =>
          (FAKE_POS.has(m.partOfSpeech) ? { ...m, partOfSpeech: '' } : m));
      }
      return next;
    }),
  });
}

export function useLearning() {
  const [state, setState] = useState<LearningState>({
    words: [],
    records: new Map(),
    loaded: false,
    error: null,
    migratedCount: 0,
  });

  useEffect(() => {
    let alive = true;

    // 没有 catch 的话，storage 读失败会让页面永远停在加载转圈上——
    // 那是最难排查的一种坏掉：用户看不出是坏了还是慢
    loadOrMigrate().then(
      (next) => {
        if (!alive) return;
        setState({ ...next, loaded: true, error: null });
        // 修补历史数据：音标此前只能由 AI 生成，没配 AI 的用户攒下的词全是空的；
        // 早期迁移还往词性里写过「未知」占位符，它会卡住真实词性的补全
        repairWords(next.words);
      },
      (err: unknown) => {
        console.error('[wordbook] 读取学习数据失败', err);
        if (alive) {
          setState((prev) => ({
            ...prev,
            loaded: true,
            error: (err as Error)?.message || '未知错误',
          }));
        }
      },
    );

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (!changes[STORAGE_KEYS.words] && !changes[STORAGE_KEYS.records]) return;

      setState((prev) => {
        const words = changes[STORAGE_KEYS.words]
          ? ((changes[STORAGE_KEYS.words].newValue as Word[]) ?? [])
          : prev.words;
        const records = changes[STORAGE_KEYS.records]
          ? new Map(
              ((changes[STORAGE_KEYS.records].newValue as LearningRecord[]) ?? [])
                .map((r) => [r.wordId, r]),
            )
          : prev.records;
        return { ...prev, words, records };
      });
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** 写入一条学习记录。传函数是为了基于最新值计算，避免拿到过期快照 */
  const updateRecord = useCallback(async (
    wordId: string,
    mutate: (prev: LearningRecord | undefined) => LearningRecord,
  ) => {
    // 从存储里重新读一次而不是用内存 state：这中间可能有后台同步写入过
    const stored = await chrome.storage.local.get(STORAGE_KEYS.records);
    const list = ((stored[STORAGE_KEYS.records] as LearningRecord[]) ?? []);
    const index = list.findIndex((r) => r.wordId === wordId);
    const next = mutate(index >= 0 ? list[index] : undefined);

    const updated = index >= 0
      ? list.map((r, i) => (i === index ? next : r))
      : [next, ...list];

    await chrome.storage.local.set({ [STORAGE_KEYS.records]: updated });
    setState((prev) => ({ ...prev, records: new Map(updated.map((r) => [r.wordId, r])) }));
  }, []);

  /** 删除一个词，连同它的学习记录一起 —— 留着孤儿记录只会让统计对不上 */
  const removeWord = useCallback(async (wordId: string) => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.words, STORAGE_KEYS.records]);
    const words = ((stored[STORAGE_KEYS.words] as Word[]) ?? []).filter((w) => w.id !== wordId);
    const records = ((stored[STORAGE_KEYS.records] as LearningRecord[]) ?? [])
      .filter((r) => r.wordId !== wordId);
    await chrome.storage.local.set({
      [STORAGE_KEYS.words]: words,
      [STORAGE_KEYS.records]: records,
    });
    setState((prev) => ({
      ...prev,
      words,
      records: new Map(records.map((r) => [r.wordId, r])),
    }));
  }, []);

  /** 更新一个词的词典数据（比如重新生成例句之后） */
  const updateWord = useCallback(async (wordId: string, mutate: (w: Word) => Word) => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.words);
    const list = (stored[STORAGE_KEYS.words] as Word[]) ?? [];
    const index = list.findIndex((w) => w.id === wordId);
    if (index < 0) return;
    const updated = list.map((w, i) => (i === index ? mutate(w) : w));
    await chrome.storage.local.set({ [STORAGE_KEYS.words]: updated });
    setState((prev) => ({ ...prev, words: updated }));
  }, []);

  /** 整体替换（导入 / 清空用） */
  const replaceAll = useCallback(async (words: Word[], records: LearningRecord[]) => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.words]: words,
      [STORAGE_KEYS.records]: records,
    });
    setState((prev) => ({
      ...prev,
      words,
      records: new Map(records.map((r) => [r.wordId, r])),
    }));
  }, []);

  const wordById = useMemo(
    () => new Map(state.words.map((w) => [w.id, w])),
    [state.words],
  );

  return {
    words: state.words,
    records: state.records,
    wordById,
    loaded: state.loaded,
    error: state.error,
    migratedCount: state.migratedCount,
    updateRecord,
    updateWord,
    removeWord,
    replaceAll,
  };
}
