/**
 * 设置页的状态钩子。
 *
 * 写入策略：下拉/勾选类改动立即落盘，文本框类改动去抖 500ms 再落盘
 * （沿用原来 options.js 的手感，避免每敲一个字符就写一次 chrome.storage.sync，
 * 那个 API 有每分钟写入次数配额）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULTS } from '../../utils/defaults.js';

export function useSettings() {
  const [settings, setSettings] = useState(null);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    chrome.storage.sync.get(DEFAULTS).then(setSettings);
    return () => clearTimeout(timerRef.current);
  }, []);

  const update = useCallback((patch, { debounce = false } = {}) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      pendingRef.current = next;
      clearTimeout(timerRef.current);
      if (debounce) {
        timerRef.current = setTimeout(() => chrome.storage.sync.set(pendingRef.current), 500);
      } else {
        chrome.storage.sync.set(next);
      }
      return next;
    });
  }, []);

  // 恢复默认值 / 导入配置之后要整体重载，直接刷新页面最省事也最不容易漏状态
  const reload = useCallback(() => location.reload(), []);

  return { settings, update, reload };
}
