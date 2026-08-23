/**
 * 朗读试听。
 *
 * 光靠「音色」下拉里的名字（Microsoft Huihui - Chinese (Simplified)）根本
 * 判断不出听起来什么样，调语速音调更是纯盲调。这里给中英文各一个按钮，
 * 改完立刻能听。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2, TriangleAlert } from 'lucide-react';

/** 试听文本刻意含标点和多音节词，语速音调的差别在这种句子上才听得出来 */
const SAMPLES: { lang: string; label: string; text: string }[] = [
  { lang: 'en-US', label: '试听英文', text: 'The quick brown fox jumps over the lazy dog.' },
  { lang: 'zh-CN', label: '试听中文', text: '你好，这是一段中文朗读的试听效果。' },
];

type State = { lang: string; kind: 'playing' | 'failed'; message?: string } | null;

export function TtsPreview({ engine }: { engine?: string }) {
  const [state, setState] = useState<State>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const play = useCallback(async (lang: string, text: string) => {
    setState({ lang, kind: 'playing' });
    try {
      // 每次都重新 init：用户很可能刚刚改完设置就点试听，
      // 复用上次的实例会用旧配置发声，听到的不是当前设置
      await window.ttsManager.init();
      await window.ttsManager.speak(text, lang, engine ? { engine } : {});
      if (alive.current) setState(null);
    } catch (err) {
      if (alive.current) {
        setState({ lang, kind: 'failed', message: (err as Error)?.message || '朗读失败' });
      }
    }
  }, [engine]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map(({ lang, label, text }) => {
          const playing = state?.lang === lang && state.kind === 'playing';
          return (
            <button
              key={lang}
              className="btn btn-sm btn-outline gap-1.5"
              disabled={playing}
              onClick={() => play(lang, text)}
            >
              {playing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Play className="w-3.5 h-3.5" />}
              {label}
            </button>
          );
        })}
      </div>
      {state?.kind === 'failed' && (
        <div className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
