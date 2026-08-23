/**
 * 给词库里缺译文的例句补上中文翻译。
 *
 * 从阅读里抓到的例句此前只存了原句（collectWord 的 sentenceTranslation
 * 从来没有调用方传过），所以老数据里真实语境例句下面都是空的。
 *
 * 用普通翻译引擎而不是 AI：句子翻译是 Translator 的本行，AI 引擎在默认配置下
 * 根本不可用。Translator 自带 50ms / 50 条的批量合并，两百个词也就几次请求。
 */
import { useEffect, useRef } from 'react';
import { Translator } from '../../utils/translator.js';
import { STORAGE_KEYS } from '../../utils/learning/repository.ts';
import type { Word } from '../../types/models.ts';

/** 一次最多补多少条，避免刚导入几千词时一次打出去太多请求 */
const MAX_PER_RUN = 60;

export function useExampleTranslations(words: Word[], loaded: boolean) {
  // 只在本次会话跑一次：补完会写存储，storage 变更又会让 words 变，
  // 不设防会变成「补一条→重渲染→再补一条」的循环
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || done.current || words.length === 0) return;

    const pending: { wordId: string; sentence: string }[] = [];
    for (const w of words) {
      for (const e of w.examples) {
        if (e.sentence && !e.translation) pending.push({ wordId: w.id, sentence: e.sentence });
        if (pending.length >= MAX_PER_RUN) break;
      }
      if (pending.length >= MAX_PER_RUN) break;
    }
    if (pending.length === 0) return;
    done.current = true;

    let alive = true;
    (async () => {
      try {
        const t = new Translator();
        await t.init();
        const results = new Map<string, string>();
        await Promise.all(pending.map(async ({ sentence }) => {
          try {
            const translated = await t.translate(sentence);
            // 引擎偶尔原样返回（把英文识别成了目标语言），那不算译文
            if (translated && translated !== sentence) results.set(sentence, translated);
          } catch { /* 单句失败不影响其余 */ }
        }));
        if (!alive || results.size === 0) return;

        // 重新读一次再写：翻译期间用户可能已经删词或收藏了新词
        const stored = await chrome.storage.local.get(STORAGE_KEYS.words);
        const current = (stored[STORAGE_KEYS.words] as Word[]) ?? [];
        await chrome.storage.local.set({
          [STORAGE_KEYS.words]: current.map((w) => ({
            ...w,
            examples: w.examples.map((e) =>
              (!e.translation && results.has(e.sentence)
                ? { ...e, translation: results.get(e.sentence) }
                : e)),
          })),
        });
      } catch {
        // 没有可用翻译引擎时安静退出——例句照常显示，只是没有译文
      }
    })();

    return () => { alive = false; };
  }, [words, loaded]);
}
