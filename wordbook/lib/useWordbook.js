/**
 * 单词本数据的唯一入口 —— 读、写、以及跟后台同步的双向一致性。
 *
 * 关键点（从原来的 wordbook.js 继承过来的约束，不能丢）：
 * 后台自动同步可能在用户复习/浏览期间把远端合并结果写回 chrome.storage.local，
 * 如果不监听 onChanged，内存里的旧快照会在下一次保存时把远端的改动覆盖掉。
 */
import { useCallback, useEffect, useState } from 'react';

export function useWordbook() {
  const [wordbook, setWordbook] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get('wordbook').then(({ wordbook: wb = [] }) => {
      if (!alive) return;
      setWordbook(wb);
      setLoaded(true);
    });

    const onChanged = (changes, area) => {
      if (area === 'local' && changes.wordbook) {
        setWordbook(changes.wordbook.newValue || []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // 写回存储。传入新数组（不要就地改 state 里的那个），存完 onChanged 会再同步回来，
  // 但我们也立刻更新本地 state，避免 UI 等一个来回。
  const persist = useCallback(async (next) => {
    setWordbook(next);
    await chrome.storage.local.set({ wordbook: next });
  }, []);

  // 按单词文本定位并改一条记录，返回改完的新数组（不改原数组）。
  // 用 text 而不是数组下标定位，是因为后台同步可能在用户操作期间重排数组。
  const updateWord = useCallback(async (text, mutate) => {
    const key = text.toLowerCase();
    let found = false;
    const next = wordbook.map((w) => {
      if (w.text.toLowerCase() !== key) return w;
      found = true;
      const copy = { ...w };
      mutate(copy);
      return copy;
    });
    if (!found) return;
    await persist(next);
  }, [wordbook, persist]);

  return { wordbook, loaded, persist, updateWord };
}
