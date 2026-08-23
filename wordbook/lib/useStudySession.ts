/**
 * 未完成学习会话的存档读写。
 *
 * 存的是**队列位置**，不是学习进度——每答一题 updateRecord 就已经落盘了，
 * 关掉页面不会丢答过的题。这里补的是另一半：重开时别把剩下的题重新洗一遍牌，
 * 那样用户会以为自己刚才白答了。
 *
 * 存 chrome.storage.local（不是 sync）：这是本机的临时进度，跨设备同步它
 * 只会让两台机器互相打断对方的会话。
 *
 * 存档格式与有效性判断在 utils/learning/session.ts（纯函数，有断言覆盖）。
 */
import { useCallback, useEffect, useState } from 'react';
import { isResumable, type SessionSnapshot } from '../../utils/learning/session.ts';

export type { SessionSnapshot };

const KEY = 'studySession';

export function useStudySession() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get({ [KEY]: null }).then(
      (res) => {
        if (!alive) return;
        const raw = res[KEY];
        setSession(isResumable(raw) ? raw : null);
        setLoaded(true);
      },
      // 读不出存档只影响「继续学习」，不该拖垮整个页面
      () => { if (alive) setLoaded(true); },
    );
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (snapshot: SessionSnapshot) => {
    setSession(snapshot);
    await chrome.storage.local.set({ [KEY]: snapshot });
  }, []);

  const clear = useCallback(async () => {
    setSession(null);
    await chrome.storage.local.remove(KEY);
  }, []);

  return { session, hasUnfinished: isResumable(session), loaded, save, clear };
}
