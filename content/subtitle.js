import './subtitle.css';
import { translator } from '../utils/translator.js';
import { pick } from '../utils/defaults.js';
import { SITE_ADAPTERS } from './subtitle-adapters.js';
import overlayCss from './overlay.css?inline';
import { getUiRoot } from './shadow-ui.js';

(function () {
  'use strict';

  // 用 hostname 精确匹配/后缀匹配，不用 includes 子串匹配——否则 united.com、
  // limited.com 这类域名会因为字符串里含 "ted.com" 而误命中 TED 适配器。
  const hostname = location.hostname;
  const adapter = SITE_ADAPTERS.find(a =>
    a.hostIncludes.some(d => hostname === d || hostname.endsWith('.' + d))
  );

  const TRANS_CLASS = 'sit-subtitle-translation';
  const OVERLAY_CLASS = 'sit-subtitle-overlay';

  // 段落选择器额外排除自己注入的译文节点，防止 mountSelector 与 segmentSelector
  // 重叠（或选择器写得过泛）时，把上一轮注入的译文当成本轮的原文再翻一遍，
  // 形成自我投喂的无限循环（Zoom 曾经就是这样：segmentSelector 里混了裸 `span`）。
  const SEGMENT_QUERY = adapter
    ? adapter.segmentSelector.split(',').map(s => `${s.trim()}:not(.${TRANS_CLASS})`).join(', ')
    : null;

  // querySelectorAll 只匹配调用它的元素的后代，不包括元素自身——多数适配器里
  // containerSelector 和 segmentSelector 是不同的选择器，这不是问题；但像 Udemy
  // 那样容器本身就是唯一的字幕文本节点（containerSelector === segmentSelector
  // === mountSelector）时，纯 querySelectorAll 永远查不到任何东西，字幕翻译会
  // 悄无声息地失效。这里额外判断容器自身是否也命中同一个选择器，命中就把容器
  // 本身补进结果里（放最前面，保持文档顺序语义）。
  function queryScoped(container, selector) {
    const found = Array.from(container.querySelectorAll(selector));
    if (container.matches(selector)) found.unshift(container);
    return found;
  }

  let cueUnsubscribers = [];
  let observer = null;
  let navObserver = null;
  let activeContainer = null;
  let lastCaptionText = '';
  let translateTimer = null;
  let waitTimer = null;
  let running = false;

  // Cue 兜底路径自己的去抖/去重/时序状态，跟适配器路径的完全分开，互不影响。
  let lastCueText = '';
  let cueTranslateTimer = null;
  let cueSeq = 0;

  function start() {
    if (running) return;
    running = true;
    if (adapter) {
      waitForCaptions();
      listenForNavigation();
    } else {
      startCueFallback();
    }
  }

  function stop() {
    if (!running) return;
    running = false;
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
        cleanup();
        waitTimer = setTimeout(waitForCaptions, 1000);
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function setupObserver(container) {
    cleanup();
    activeContainer = container;
    observer = new MutationObserver(handleCaptionChange);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    // 容器刚接上时，当前画面上可能已经有一行字幕在显示（比如视频是暂停状态，
    // 不会再触发新的 DOM 变化）——立即跑一次，别等下一次变化事件才翻译。
    processCaption();
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(translateTimer);
    clearTimeout(waitTimer);
    if (activeContainer) {
      activeContainer.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
    }
    activeContainer = null;
    lastCaptionText = '';
  }

  function handleCaptionChange() {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(processCaption, 150);
  }

  function processCaption() {
    if (!activeContainer) return;

    // 只在被观察的容器内查询，不查整个 document——否则 mountSelector 命中多个
    // 同类容器时可能翻错地方，且选择器写得稍泛就会把整页文本都抓进来送翻译引擎。
    const segments = queryScoped(activeContainer, SEGMENT_QUERY);
    if (segments.length === 0) {
      activeContainer.querySelectorAll('.' + TRANS_CLASS).forEach(el => el.remove());
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
    if (!activeContainer) return;
    // 挂载点同样限定在被观察的容器内；找不到就直接挂在容器本身上，
    // 而不是退回 document 查询（那样可能挂到别的同类容器里）。
    const captionWindow = activeContainer.querySelector(adapter.mountSelector) || activeContainer;

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
          if (!cues || cues.length === 0) {
            // 这一行字幕结束了（或播放结束）——清掉覆盖层，别让最后一行译文
            // 一直挂在屏幕上。同时让任何还在飞的旧翻译请求作废，防止它稍后
            // resolve 时把刚清掉的覆盖层又画回来。
            clearTimeout(cueTranslateTimer);
            lastCueText = '';
            cueSeq++;
            removeCueOverlay();
            return;
          }
          const text = Array.from(cues).map(c => c.text).join(' ').trim();
          if (!text || text === lastCueText) return;
          lastCueText = text;

          clearTimeout(cueTranslateTimer);
          cueTranslateTimer = setTimeout(() => translateCueText(text), 150);
        };
        track.addEventListener('cuechange', onCueChange);
        cueUnsubscribers.push(() => track.removeEventListener('cuechange', onCueChange));
      });
    });
  }

  function stopCueFallback() {
    cueUnsubscribers.forEach(fn => fn());
    cueUnsubscribers = [];
    clearTimeout(cueTranslateTimer);
    lastCueText = '';
    cueSeq++;
    removeCueOverlay();
  }

  async function translateCueText(text) {
    // 每次调用盖一个序号；结果回来时只有序号仍是最新的才允许生效，防止两次
    // 重叠的翻译请求乱序 resolve，把新的一行盖成旧的一行。
    const seq = ++cueSeq;
    try {
      const result = await translator.translate(text);
      if (seq !== cueSeq) return;
      if (result && !result.startsWith('[翻译失败')) {
        showCueOverlay(result);
      }
    } catch (e) {
      console.error('[SIT] Cue fallback translation error:', e);
    }
  }

  // 浮层在影子树里，document.querySelector 找不到它，用模块级引用持有
  let cueOverlay = null;

  function showCueOverlay(text) {
    if (!cueOverlay) {
      cueOverlay = document.createElement('div');
      cueOverlay.className = OVERLAY_CLASS;
      getUiRoot(overlayCss).appendChild(cueOverlay);
    }
    cueOverlay.textContent = text;
  }

  function removeCueOverlay() {
    cueOverlay?.remove();
    cueOverlay = null;
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
