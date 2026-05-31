import './youtube.css';

/**
 * YouTube Subtitle Translation - Super Immersive Translate
 * Detects YouTube captions and adds bilingual subtitles.
 */
(function () {
  'use strict';

  if (!location.hostname.includes('youtube.com')) return;

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
      const container = document.querySelector('.ytp-caption-window-container');
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
    const segments = document.querySelectorAll('.ytp-caption-segment');
    if (segments.length === 0) {
      document.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
      lastCaptionText = '';
      return;
    }

    let text = '';
    segments.forEach(s => { text += s.textContent; });
    text = text.trim();

    if (!text || text === lastCaptionText) return;
    lastCaptionText = text;

    translateCaption(text);
  }

  async function translateCaption(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showTranslation(result);
      }
    } catch (e) {
      console.error('[SIT] YouTube subtitle error:', e);
    }
  }

  function showTranslation(text) {
    const captionWindow = document.querySelector(
      '.ytp-caption-window-bottom, .ytp-caption-window-top, [class*="caption-window"]'
    );
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
