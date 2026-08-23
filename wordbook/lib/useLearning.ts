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
  ]);

  const words = (stored[STORAGE_KEYS.words] as Word[]) ?? [];
  const records = (stored[STORAGE_KEYS.records] as LearningRecord[]) ?? [];
  const legacy = (stored[STORAGE_KEYS.legacyWordbook] as WordEntry[]) ?? [];

  // 已经有新数据就直接用。只有「新数据为空但旧数据有内容」才迁移，
  // 避免迁移把用户在新版本里的进度覆盖回去
  if (words.length > 0 || records.length > 0) {
    return { words, records: new Map(records.map((r) => [r.wordId, r])), migratedCount: 0 };
  }

  if (legacy.length === 0) {
    return { words: [], records: new Map(), migratedCount: 0 };
  }

  const result = migrateWordbook(legacy, records);
  await chrome.storage.local.set({
    [STORAGE_KEYS.words]: result.words,
    [STORAGE_KEYS.records]: result.records,
    // 旧的 wordbook 键刻意保留不动，作为回滚退路
  });

  return {
    words: result.words,
    records: new Map(result.records.map((r) => [r.wordId, r])),
    migratedCount: result.words.length,
  };
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
      (next) => { if (alive) setState({ ...next, loaded: true, error: null }); },
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
