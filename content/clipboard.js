/**
 * 剪贴板捕获：把用户在网页上复制的内容记进历史。
 *
 * 记录「用户复制过的一切」天然敏感，所以这里有几条硬约束，
 * 它们比功能本身更重要：
 *
 * 1. **密码框和敏感输入一律不记**。从密码管理器、银行页面复制出来的东西
 *    落进明文历史，是这个功能最可能造成的实际伤害。
 * 2. **只记用户主动发起的复制**。页面自己调 document.execCommand('copy')
 *    （"点击复制链接"那类按钮）也会触发 copy 事件，那类内容照记，
 *    但脚本在后台静默复制的不该被当成用户意图——用 isTrusted 区分。
 * 3. 捕获失败绝不阻断真正的复制动作：整个处理器不抛异常。
 */
import { saveClipboardEntry } from '../utils/clipboard.js';

(function () {
  'use strict';

  /** 这些输入里的内容不进历史 */
  const SENSITIVE_TYPES = new Set(['password']);
  const SENSITIVE_HINTS = /password|passwd|pwd|otp|totp|cvv|cvc|secret|token|api[-_]?key/i;

  function isSensitive(el) {
    if (!el || el.nodeType !== 1) return false;
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (SENSITIVE_TYPES.has(type)) return true;
    // autocomplete="current-password" / "new-password" 是标准写法，比猜 name 可靠
    const auto = (el.getAttribute?.('autocomplete') || '').toLowerCase();
    if (auto.includes('password') || auto === 'one-time-code') return true;
    // 退而求其次：name/id/aria-label 里出现敏感词
    const hint = [el.name, el.id, el.getAttribute?.('aria-label')].filter(Boolean).join(' ');
    return SENSITIVE_HINTS.test(hint);
  }

  /**
   * 取出这次复制的文本。
   *
   * 不读 e.clipboardData：copy 事件里它是**待写入**的内容，只有页面自己
   * setData 过才有值，普通复制读出来是空的。真正可靠的是当前选区；
   * 输入框内的选中文字不在 document selection 里，要单独取。
   */
  function copiedText(target) {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      && typeof el.selectionStart === 'number' && el.selectionStart !== el.selectionEnd) {
      return String(el.value ?? '').slice(el.selectionStart, el.selectionEnd);
    }
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) return sel.toString();
    // 选区已经被页面清掉（部分"复制"按钮的实现）时，退回目标元素的文本
    return target?.innerText?.trim() ? '' : '';
  }

  document.addEventListener('copy', (e) => {
    try {
      // 脚本合成的 copy 事件不代表用户意图
      if (!e.isTrusted) return;

      const target = e.target;
      if (isSensitive(target) || isSensitive(document.activeElement)) return;

      const text = copiedText(target);
      if (!text || !text.trim()) return;

      saveClipboardEntry({
        text,
        url: location.href,
        title: document.title,
      });
    } catch {
      // 捕获失败绝不阻断用户真正的复制动作
    }
  }, true);
})();
