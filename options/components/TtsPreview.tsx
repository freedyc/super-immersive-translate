/**
 * 朗读试听。
 *
 * 十句备选而不是固定一句：引擎之间的差距体现在多音字、数字、语调这些地方，
 * 拿「你好世界」试听四个引擎听起来都一样。句库见 utils/tts-samples.js。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2, TriangleAlert } from 'lucide-react';
import { TTS_SAMPLES } from '../../utils/tts-samples.js';

type Sample = { label: string; text: string };
type State = 'idle' | 'playing' | 'failed';

export function TtsPreview({ lang, engine, voiceURI }: {
  lang: string;
  /** 试听当前这一栏正在配的引擎，而不是用户存下来的那个 */
  engine: string;
  voiceURI?: string;
}) {
  const samples: Sample[] = TTS_SAMPLES[lang as keyof typeof TTS_SAMPLES] ?? [];
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const sample = samples[index];

  const play = useCallback(async () => {
    if (!sample || state === 'playing') return;
    setState('playing');
    setError('');
    try {
      // 每次都重新 init：用户很可能刚改完设置就点试听，
      // 复用上次的实例会用旧配置发声，听到的不是当前设置
      await window.ttsManager.init();
      await window.ttsManager.speak(sample.text, lang, { engine, voiceURI });
      if (alive.current) setState('idle');
    } catch (err) {
      if (alive.current) {
        setState('failed');
        setError((err as Error)?.message || '朗读失败');
      }
    }
  }, [sample, lang, engine, voiceURI, state]);

  if (!sample) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-base-content/60">试听</span>
      <div className="flex gap-2">
        <select
          className="select select-sm flex-1 min-w-0"
          value={index}
          onChange={(e) => { setIndex(Number(e.target.value)); setState('idle'); }}
        >
          {samples.map((s, i) => (
            <option key={i} value={i}>{`${s.label} — ${s.text}`}</option>
          ))}
        </select>
        <button
          className="btn btn-sm btn-outline gap-1.5 shrink-0"
          disabled={state === 'playing'}
          onClick={play}
        >
          {state === 'playing'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Play className="w-3.5 h-3.5" />}
          播放
        </button>
      </div>
      <p className="text-xs text-base-content/40 break-words">{sample.text}</p>
      {state === 'failed' && (
        <div className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
