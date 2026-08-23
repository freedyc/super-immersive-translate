/**
 * 学习设置的读写。
 *
 * 存在 chrome.storage.sync 里（跟其他设置一样，跟着账号跨设备走），
 * 默认值在 utils/defaults.js 的 DEFAULTS.studyConfig ——本文件不再复制一份。
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULTS } from '../../utils/defaults.js';
import { DEFAULT_STUDY_CONFIG } from '../../utils/learning/queue.ts';
import type { ExerciseType, StudyConfig } from '../../types/models.ts';

const ALL_EXERCISES: ExerciseType[] = ['en2zh', 'zh2en', 'listening', 'spelling'];

/** 存储里的值可能来自更旧的版本或被同步弄脏，读出来一律先规整 */
function normalize(raw: unknown): StudyConfig {
  const v = (raw ?? {}) as Partial<StudyConfig>;
  const enabled = Array.isArray(v.enabledExercises)
    ? v.enabledExercises.filter((e): e is ExerciseType => ALL_EXERCISES.includes(e))
    : [];
  return {
    dailyNewLimit: Number.isFinite(v.dailyNewLimit) ? Math.max(0, Math.trunc(v.dailyNewLimit!)) : DEFAULT_STUDY_CONFIG.dailyNewLimit,
    dailyReviewLimit: Number.isFinite(v.dailyReviewLimit) ? Math.max(0, Math.trunc(v.dailyReviewLimit!)) : DEFAULT_STUDY_CONFIG.dailyReviewLimit,
    // 一种题型都不剩会让今日队列永远是空的，兜回默认值而不是让页面卡死
    enabledExercises: enabled.length > 0 ? enabled : DEFAULT_STUDY_CONFIG.enabledExercises,
  };
}

export function useStudyConfig() {
  const [config, setConfig] = useState<StudyConfig>(DEFAULT_STUDY_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    chrome.storage.sync.get({ studyConfig: DEFAULTS.studyConfig }).then((res) => {
      if (!alive) return;
      setConfig(normalize(res.studyConfig));
      setLoaded(true);
    });

    // 设置页/其他窗口改了同一项时跟着更新，避免两个标签页各持一份旧配置
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'sync' && changes.studyConfig) {
        setConfig(normalize(changes.studyConfig.newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const update = useCallback(async (patch: Partial<StudyConfig>) => {
    const next = normalize({ ...config, ...patch });
    setConfig(next);
    await chrome.storage.sync.set({ studyConfig: next });
  }, [config]);

  return { config, loaded, update, allExercises: ALL_EXERCISES };
}
