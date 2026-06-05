import './content.css';
import { translator } from '../utils/translator.js';
import { DEFAULTS, pick } from '../utils/defaults.js';

/**
 * Content script - Super Immersive Translate
 * Full page bilingual translation only.
 * Selection translation is handled by selection.js
 */
(async function () {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'MATH',
    'NOSCRIPT', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG',
    'BR', 'HR', 'BUTTON'
  ]);

  const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DEL', 'DFN',
    'EM', 'I', 'INS', 'MARK', 'Q', 'S', 'SMALL', 'SPAN',
    'STRONG', 'SUB', 'SUP', 'TIME', 'U'
  ]);

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
    'CAPTION', 'DT', 'DD', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER',
    'ASIDE', 'NAV', 'MAIN', 'DETAILS', 'SUMMARY', 'LABEL',
    'LEGEND', 'FIGURE', 'ADDRESS'
  ]);

  const MIN_TEXT_LENGTH = 2;
  const TRANSLATED_ATTR = 'data-sit-translated';
  const WRAPPER_CLASS = 'sit-wrapper';
  const TRANSLATION_CLASS = 'sit-translation';
  const ORIGINAL_CLASS = 'sit-original';
  const FULLPAGE_BATCH = 20;
  const CONCURRENCY_LEVELS = { low: 2, medium: 5, high: 10 };
  // Per-engine concurrency ceilings — rate-limited / fan-out-heavy engines must not
  // be hit with the full pool (MyMemory is sequential+throttled; Libre already fires
  // one request per text per batch; Lingva is a shared public instance; WebLLM is a
  // single in-browser engine). Engines not listed use the user's chosen level.
  const ENGINE_MAX_CONCURRENCY = { webllm: 1, mymemory: 1, libre: 2, lingva: 3 };

  let isTranslating = false;
  let isEnabled = false;
  let hoverTranslateEnabled = false;
  let hoverTimer = null;
  let currentHoverEl = null;
  let translateAbortId = 0;

  let siteBlocked = false;
  let concurrencySetting = 'medium';

  // ── Settings ─────────────────────────────────────────

  function applyTranslationColor(color) {
    document.documentElement.style.setProperty('--sit-translation-color', color);
  }

  function applyDisplayMode(mode) {
    document.documentElement.setAttribute('data-sit-mode', mode);
  }

  function applyTranslationStyles(s) {
    const root = document.documentElement.style;
    root.setProperty('--sit-font-size', (s.translationFontSize || '0.92') + 'em');
    root.setProperty('--sit-line-height', s.translationLineHeight || '1.6');
    root.setProperty('--sit-font-weight', s.translationBold ? 'bold' : 'normal');
    root.setProperty('--sit-border-width', s.translationShowBorder !== false ? '2px' : '0');
    root.setProperty('--sit-border-padding', s.translationShowBorder !== false ? '8px' : '0');
  }

  function checkSiteBlocked(rules) {
    const host = location.hostname;
    if (rules.mode === 'blacklist') {
      return rules.sites.some(s => host.includes(s));
    }
    return rules.sites.length > 0 && !rules.sites.some(s => host.includes(s));
  }

  const stored = await chrome.storage.sync.get(DEFAULTS);

  applyTranslationColor(stored.translationColor);
  applyDisplayMode(stored.displayMode);
  applyTranslationStyles(stored);
  hoverTranslateEnabled = stored.hoverTranslate;
  siteBlocked = checkSiteBlocked(stored.siteRules);
  concurrencySetting = stored.translateConcurrency;

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.translationColor) {
      applyTranslationColor(changes.translationColor.newValue);
    }
    if (changes.displayMode) {
      applyDisplayMode(changes.displayMode.newValue);
    }
    if (changes.hoverTranslate) {
      hoverTranslateEnabled = changes.hoverTranslate.newValue;
      updateHoverListeners();
    }
    if (changes.translationFontSize || changes.translationLineHeight ||
        changes.translationBold || changes.translationShowBorder) {
      chrome.storage.sync.get(
        pick('translationFontSize', 'translationLineHeight', 'translationBold', 'translationShowBorder')
      ).then(applyTranslationStyles);
    }
    if (changes.siteRules) {
      siteBlocked = checkSiteBlocked(changes.siteRules.newValue);
    }
    if (changes.translateConcurrency) {
      concurrencySetting = changes.translateConcurrency.newValue;
    }
  });

  await translator.init();

  // Per-site engine override
  const siteEngine = stored.siteEngines[location.hostname];
  if (siteEngine) translator.engine = siteEngine;

  // ── Messages ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggle') {
      if (siteBlocked) {
        sendResponse({ enabled: false, blocked: true });
        return true;
      }
      if (isEnabled) {
        cancelTranslation();
        removeTranslations();
      } else {
        translatePage();
      }
      isEnabled = !isEnabled;
      sendResponse({ enabled: isEnabled });
    } else if (msg.action === 'getStatus') {
      sendResponse({ enabled: isEnabled, translating: isTranslating, blocked: siteBlocked });
    } else if (msg.action === 'updateSettings') {
      translator.init().then(() => {
        if (isEnabled) {
          removeTranslations();
          translatePage();
        }
      });
      sendResponse({ ok: true });
    }
    return true;
  });

  // ── Smart content detection ──────────────────────────

  function detectMainContent() {
    const semantic = document.querySelector('article, main, [role="main"]');
    if (semantic && semantic.textContent.trim().length > 200) return semantic;

    const selectors = [
      '.post-content', '.article-content', '.entry-content',
      '.post-body', '.article-body', '.markdown-body',
      '#content', '#main-content', '.content',
      '.post', '.article', '.entry'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) return el;
    }

    let bestDiv = null;
    let bestScore = 0;
    for (const div of document.querySelectorAll('div')) {
      const text = div.textContent.trim();
      if (text.length < 300) continue;
      const rect = div.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) continue;
      const pCount = div.querySelectorAll('p').length;
      const childDivs = div.querySelectorAll(':scope > div').length;
      const score = text.length * (pCount + 1) / (childDivs + 1);
      if (score > bestScore) {
        bestScore = score;
        bestDiv = div;
      }
    }

    return bestDiv || document.body;
  }

  // ── Content extraction ───────────────────────────────

  function isSitElement(node) {
    return node.classList?.contains(TRANSLATION_CLASS) ||
      node.classList?.contains(WRAPPER_CLASS) ||
      node.classList?.contains(ORIGINAL_CLASS) ||
      node.classList?.contains('sit-panel') ||
      node.classList?.contains('sit-icon') ||
      node.classList?.contains('sit-progress-bar') ||
      node.classList?.contains('sit-progress-text');
  }

  function getTranslatableBlocks(root) {
    const searchRoot = root || document.body;
    const blocks = [];
    const walker = document.createTreeWalker(
      searchRoot,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (isSitElement(node)) return NodeFilter.FILTER_REJECT;
          if (node.hasAttribute(TRANSLATED_ATTR)) return NodeFilter.FILTER_REJECT;

          if (!INLINE_TAGS.has(node.tagName)) {
            const text = getDirectText(node);
            if (text.length >= MIN_TEXT_LENGTH) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = getDirectText(node);
      if (text.trim().length >= MIN_TEXT_LENGTH && !isChineseText(text)) {
        blocks.push(node);
      }
    }
    return blocks;
  }

  function getDirectText(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(child.tagName)) {
        text += child.textContent;
      }
    }
    return text.trim();
  }

  function isChineseText(text) {
    if (!translator.targetLang.startsWith('zh')) return false;
    const chinese = text.match(/[\u4e00-\u9fff]/g);
    return chinese && chinese.length / text.length > 0.3;
  }

  // ── Progress bar ─────────────────────────────────────

  let progressBar = null;
  let progressFill = null;
  let progressLabel = null;

  function showProgress(done, total) {
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.className = 'sit-progress-bar';
      progressFill = document.createElement('div');
      progressFill.className = 'sit-progress-fill';
      progressBar.appendChild(progressFill);
      progressLabel = document.createElement('div');
      progressLabel.className = 'sit-progress-text';
      document.body.appendChild(progressBar);
      document.body.appendChild(progressLabel);
    }
    const pct = Math.round((done / total) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = `翻译中 ${done}/${total}`;
    progressBar.classList.remove('sit-hidden');
    progressLabel.classList.remove('sit-hidden');
  }

  function finishProgress() {
    if (!progressBar) return;
    progressFill.style.width = '100%';
    progressLabel.textContent = '✓ 翻译完成';
    setTimeout(() => {
      progressBar?.classList.add('sit-hidden');
      progressLabel?.classList.add('sit-hidden');
    }, 1500);
  }

  function removeProgress() {
    progressBar?.remove();
    progressLabel?.remove();
    progressBar = null;
    progressFill = null;
    progressLabel = null;
  }

  // ── Translation ──────────────────────────────────────

  function cancelTranslation() {
    translateAbortId++;
    if (isTranslating) {
      isTranslating = false;
      removeProgress();
    }
  }

  function resolveConcurrency() {
    const base = CONCURRENCY_LEVELS[concurrencySetting] || CONCURRENCY_LEVELS.medium;
    const cap = ENGINE_MAX_CONCURRENCY[translator.engine];
    return cap ? Math.min(base, cap) : base;
  }

  async function translatePage() {
    if (isTranslating || siteBlocked) return;
    isTranslating = true;
    const myAbortId = ++translateAbortId;

    try {
      const allBlocks = getTranslatableBlocks(document.body);
      if (allBlocks.length === 0) {
        isTranslating = false;
        return;
      }

      // Prioritize main content blocks
      const mainContent = detectMainContent();
      if (mainContent !== document.body) {
        allBlocks.sort((a, b) => {
          const aIn = mainContent.contains(a);
          const bIn = mainContent.contains(b);
          if (aIn && !bIn) return -1;
          if (!aIn && bIn) return 1;
          return 0;
        });
      }

      let completed = 0;
      showProgress(0, allBlocks.length);

      // Split blocks into batches, then translate several batches concurrently.
      const batches = [];
      for (let i = 0; i < allBlocks.length; i += FULLPAGE_BATCH) {
        batches.push(allBlocks.slice(i, i + FULLPAGE_BATCH));
      }

      const concurrency = resolveConcurrency();
      let nextBatch = 0;

      async function worker() {
        while (true) {
          if (myAbortId !== translateAbortId) return;
          const idx = nextBatch++;
          if (idx >= batches.length) return;

          const batch = batches[idx];
          const texts = batch.map(el => getDirectText(el));
          const translations = await translator.translateBatch(texts);
          if (myAbortId !== translateAbortId) return;

          translations.forEach((translated, j) => {
            if (translated && !translated.startsWith('[翻译失败')) {
              insertTranslation(batch[j], translated);
            }
          });

          completed += batch.length;
          showProgress(Math.min(completed, allBlocks.length), allBlocks.length);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(concurrency, batches.length) }, () => worker())
      );

      if (myAbortId !== translateAbortId) return;
      finishProgress();
    } catch (err) {
      if (myAbortId !== translateAbortId) return;
      console.error('[SIT] Translation error:', err);
      finishProgress();
    } finally {
      // Always release the lock, even when aborted early, so future runs aren't blocked.
      isTranslating = false;
    }
  }

  function hasInteractiveContent(el) {
    return el.querySelector('a, button, [onclick], [role="button"], [role="link"], [tabindex]');
  }

  function insertTranslation(el, translatedText) {
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    el.setAttribute(TRANSLATED_ATTR, 'true');

    const interactive = hasInteractiveContent(el);

    if (!interactive) {
      const originalWrapper = document.createElement('span');
      originalWrapper.className = ORIGINAL_CLASS;
      while (el.firstChild) {
        originalWrapper.appendChild(el.firstChild);
      }
      el.appendChild(originalWrapper);
    }

    const translationEl = document.createElement('span');
    translationEl.className = TRANSLATION_CLASS;
    translationEl.textContent = translatedText;

    if (BLOCK_TAGS.has(el.tagName)) {
      const br = document.createElement('br');
      br.className = WRAPPER_CLASS;
      el.appendChild(br);
    }

    el.appendChild(translationEl);
  }

  function removeTranslations() {
    document.querySelectorAll(`.${ORIGINAL_CLASS}`).forEach(wrapper => {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    });

    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach(el => {
      el.removeAttribute(TRANSLATED_ATTR);
    });
    removeProgress();
  }

  // ── Hover translation ────────────────────────────────

  function onHoverMove(e) {
    if (!hoverTranslateEnabled || isTranslating || siteBlocked) return;

    let el = e.target;
    while (el && el !== document.body) {
      if (el.nodeType === Node.ELEMENT_NODE &&
          !INLINE_TAGS.has(el.tagName) &&
          !SKIP_TAGS.has(el.tagName) &&
          !el.hasAttribute(TRANSLATED_ATTR) &&
          !isSitElement(el)) {
        const text = getDirectText(el);
        if (text.length >= MIN_TEXT_LENGTH && !isChineseText(text)) {
          if (el !== currentHoverEl) {
            clearHighlight();
            currentHoverEl = el;
            el.classList.add('sit-hover-highlight');
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => translateSingle(el), 300);
          }
          return;
        }
      }
      el = el.parentElement;
    }

    clearHighlight();
    clearTimeout(hoverTimer);
  }

  function clearHighlight() {
    if (currentHoverEl) {
      currentHoverEl.classList.remove('sit-hover-highlight');
      currentHoverEl = null;
    }
  }

  async function translateSingle(el) {
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    el.classList.remove('sit-hover-highlight');

    const text = getDirectText(el);
    if (!text || text.length < MIN_TEXT_LENGTH) return;

    try {
      const translated = await translator.translate(text);
      if (translated && !translated.startsWith('[翻译失败')) {
        insertTranslation(el, translated);
      }
    } catch (err) {
      console.error('[SIT] Hover translation error:', err);
    }
  }

  function updateHoverListeners() {
    document.body.removeEventListener('mouseover', onHoverMove);
    document.body.removeEventListener('mouseout', onHoverOut);
    if (hoverTranslateEnabled) {
      document.body.addEventListener('mouseover', onHoverMove);
      document.body.addEventListener('mouseout', onHoverOut);
    } else {
      clearHighlight();
    }
  }

  function onHoverOut(e) {
    if (!e.relatedTarget || e.relatedTarget === document.body || !document.body.contains(e.relatedTarget)) {
      clearHighlight();
      clearTimeout(hoverTimer);
    }
  }

  updateHoverListeners();

  // ── Tab visibility: stop translating when tab hidden ─
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isTranslating) {
      cancelTranslation();
      removeTranslations();
      isEnabled = false;
    }
  });

  // ── SPA navigation detection ─────────────────────────

  let lastUrl = location.href;

  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (isEnabled) {
      cancelTranslation();
      removeTranslations();
      isEnabled = false;
    }
  }

  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    onNavigate();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    onNavigate();
  };

  // ── DOM observer (SPA support) ───────────────────────

  const observer = new MutationObserver((mutations) => {
    if (!isEnabled || isTranslating) return;

    let hasNewContent = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !isSitElement(node)) {
          hasNewContent = true;
          break;
        }
      }
      if (hasNewContent) break;
    }

    if (hasNewContent) {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(() => translatePage(), 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
