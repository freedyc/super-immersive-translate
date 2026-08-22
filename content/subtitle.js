import './subtitle.css';
import { translator } from '../utils/translator.js';
import { SITE_ADAPTERS } from './subtitle-adapters.js';

/**
 * Multi-site Subtitle Translation - Super Immersive Translate
 * Detects live captions on the current site (via a matching adapter) and
 * injects a bilingual translation line.
 */
(function () {
  'use strict';

  const adapter = SITE_ADAPTERS.find(a => a.hostIncludes.some(h => location.hostname.includes(h)));
  if (!adapter) return; // 本任务范围内只有 youtube 一个适配器，等价于原来 youtube.js 的域名判断

  const TRANS_CLASS = 'sit-subtitle-translation';
  let observer = null;
  let lastCaptionText = '';
  let translateTimer = null;

  function init() {
    waitForCaptions();
    listenForNavigation();
  }

  function waitForCaptions() {
    const check = () => {
      const container = document.querySelector(adapter.containerSelector);
      if (container) {
        setupObserver(container);
        return;
      }
      setTimeout(check, 2000);
    };
    check();
  }

  function listenForNavigation() {
    let lastUrl = location.href;
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCaptionText = '';
        cleanup();
        setTimeout(waitForCaptions, 1000);
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function setupObserver(container) {
    cleanup();
    observer = new MutationObserver(handleCaptionChange);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(translateTimer);
    document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
  }

  function handleCaptionChange() {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(processCaption, 150);
  }

  function processCaption() {
    const segments = document.querySelectorAll(adapter.segmentSelector);
    if (segments.length === 0) {
      document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
      lastCaptionText = '';
      return;
    }

    let text = '';
    segments.forEach(s => { text += s.textContent; });
    text = text.trim();

    const parsed = adapter.parseText ? adapter.parseText(text) : text;
    if (!parsed || parsed === lastCaptionText) return;
    lastCaptionText = parsed;

    translateCaption(parsed);
  }

  async function translateCaption(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showTranslation(result);
      }
    } catch (e) {
      console.error('[SIT] Subtitle translation error:', e);
    }
  }

  function showTranslation(text) {
    const captionWindow = document.querySelector(adapter.mountSelector);
    if (!captionWindow) return;

    let el = captionWindow.querySelector('.' + TRANS_CLASS);
    if (!el) {
      el = document.createElement('span');
      el.className = TRANS_CLASS;
      captionWindow.appendChild(el);
    }
    el.textContent = text;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
