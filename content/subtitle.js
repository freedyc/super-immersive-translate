import './subtitle.css';
import { translator } from '../utils/translator.js';
import { pick } from '../utils/defaults.js';
import { SITE_ADAPTERS } from './subtitle-adapters.js';

(function () {
  'use strict';

  const adapter = SITE_ADAPTERS.find(a => a.hostIncludes.some(h => location.hostname.includes(h)));

  const TRANS_CLASS = 'sit-subtitle-translation';
  const OVERLAY_CLASS = 'sit-subtitle-overlay';
  let cueUnsubscribers = [];
  let observer = null;
  let navObserver = null;
  let lastCaptionText = '';
  let translateTimer = null;
  let waitTimer = null;

  function start() {
    if (adapter) {
      waitForCaptions();
      listenForNavigation();
    } else {
      startCueFallback();
    }
  }

  function stop() {
    cleanup();
    stopCueFallback();
    if (navObserver) {
      navObserver.disconnect();
      navObserver = null;
    }
  }

  function waitForCaptions() {
    const check = () => {
      const container = document.querySelector(adapter.containerSelector);
      if (container) {
        setupObserver(container);
        return;
      }
      waitTimer = setTimeout(check, 2000);
    };
    check();
  }

  function listenForNavigation() {
    let lastUrl = location.href;
    navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCaptionText = '';
        cleanup();
        waitTimer = setTimeout(waitForCaptions, 1000);
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
    clearTimeout(waitTimer);
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

  // 通用兜底：没有专属适配器命中时，扫描页面 <video> 的原生字幕轨（WebVTT track），
  // 监听 cuechange 取当前激活字幕文本翻译，用固定定位覆盖层展示。只对真正用 <track>
  // 渲染字幕的页面有效——很多站点自定义 DOM 渲染字幕，不会触发这个（那些站点应该走
  // 专属适配器，不是这个兜底要解决的问题）。
  function startCueFallback() {
    document.querySelectorAll('video').forEach((video) => {
      if (!video.textTracks) return;
      Array.from(video.textTracks).forEach((track) => {
        const onCueChange = () => {
          if (track.mode === 'disabled') return;
          const cues = track.activeCues;
          if (!cues || cues.length === 0) return;
          const text = Array.from(cues).map(c => c.text).join(' ').trim();
          if (!text) return;
          translateCueText(text);
        };
        track.addEventListener('cuechange', onCueChange);
        cueUnsubscribers.push(() => track.removeEventListener('cuechange', onCueChange));
      });
    });
  }

  function stopCueFallback() {
    cueUnsubscribers.forEach(fn => fn());
    cueUnsubscribers = [];
    document.querySelectorAll('.' + OVERLAY_CLASS).forEach(el => el.remove());
  }

  async function translateCueText(text) {
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败')) {
        showCueOverlay(result);
      }
    } catch (e) {
      console.error('[SIT] Cue fallback translation error:', e);
    }
  }

  function showCueOverlay(text) {
    let el = document.querySelector('.' + OVERLAY_CLASS);
    if (!el) {
      el = document.createElement('div');
      el.className = OVERLAY_CLASS;
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  async function boot() {
    const { subtitleTranslate } = await chrome.storage.sync.get(pick('subtitleTranslate'));
    if (subtitleTranslate) start();

    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.subtitleTranslate) return;
      if (changes.subtitleTranslate.newValue) start(); else stop();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
