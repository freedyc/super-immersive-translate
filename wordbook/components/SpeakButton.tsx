/**
 * 带播放中/失败状态的发音按钮。
 *
 * 直接 onClick={ttsManager.speak(...)} 的写法有两个问题：点下去没有任何反馈，
 * 以及没有语音包时彻底静默——用户会以为是自己没点到。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, Loader2, VolumeX } from 'lucide-react';

type State = 'idle' | 'playing' | 'failed';

export function SpeakButton({ text, lang, title, size = 'xs', className = '' }: {
  text: string;
  lang: string;
  title: string;
  /** daisyUI 按钮尺寸后缀 */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const [state, setState] = useState<State>('idle');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const speak = useCallback(async (e: React.MouseEvent) => {
    // 卡片、列表项常常自己也响应点击，发音不该顺带触发它们
    e.stopPropagation();
    if (state === 'playing') return;
    setState('playing');
    try {
      await window.ttsManager.speak(text, lang);
      if (alive.current) setState('idle');
    } catch {
      if (alive.current) setState('failed');
    }
  }, [text, lang, state]);

  const icon = state === 'playing'
    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : state === 'failed'
      ? <VolumeX className="w-3.5 h-3.5" />
      : <Volume2 className="w-3.5 h-3.5" />;

  return (
    <button
      className={`btn btn-ghost btn-${size} btn-circle shrink-0 ${
        state === 'failed' ? 'text-warning' : ''
      } ${className}`}
      title={state === 'failed' ? '这段文字念不出来，可能缺少对应语言的语音包' : title}
      onClick={speak}
    >
      {icon}
    </button>
  );
}
