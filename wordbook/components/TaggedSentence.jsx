/**
 * 例句渲染：有 AI 词性标注就渲染成彩色词块（悬浮显示词性），没有就退回纯文本斜体。
 * 悬浮提示用 MUI Tooltip 而不是原生 title 属性——原生 title 有约 1 秒延迟、
 * 样式不受控、触屏上完全出不来，逐词标注这种需要快速扫读的场景体验差别很明显。
 */
import Tooltip from '@mui/material/Tooltip';
import { POS_BADGE_CLASS } from '../lib/mastery.js';

export function TaggedSentence({ sentence, tokens, className = '' }) {
  if (!tokens || tokens.length === 0) {
    return <span className={`italic ${className}`}>{sentence}</span>;
  }

  return (
    <span className={`inline-flex flex-wrap gap-1 items-center ${className}`}>
      {tokens
        .filter((tok) => tok?.text)
        .map((tok, i) => (
          <Tooltip
            key={`${tok.text}-${i}`}
            title={[tok.pos, tok.role].filter(Boolean).join(' · ')}
            arrow
            placement="top"
            disableHoverListener={!tok.pos && !tok.role}
          >
            <span className={`badge ${POS_BADGE_CLASS[tok.pos] || 'badge-neutral'} badge-sm align-middle`}>
              {tok.text}
            </span>
          </Tooltip>
        ))}
    </span>
  );
}
