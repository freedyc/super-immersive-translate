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
    'BR', 'HR'
  ]);

  const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DEL', 'DFN',
    'EM', 'I', 'INS', 'MARK', 'Q', 'S', 'SMALL', 'SPAN',
    'STRONG', 'SUB', 'SUP', 'TIME', 'U'
  ]);

  const MIN_TEXT_LENGTH = 2;
  const TRANSLATED_ATTR = 'data-sit-translated';
  const WRAPPER_CLASS = 'sit-wrapper';
  const TRANSLATION_CLASS = 'sit-translation';

  let isTranslating = false;
  let isEnabled = false;

  await translator.init();

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggle') {
      if (isEnabled) {
        removeTranslations();
      } else {
        translatePage();
      }
      isEnabled = !isEnabled;
      sendResponse({ enabled: isEnabled });
    } else if (msg.action === 'getStatus') {
      sendResponse({ enabled: isEnabled, translating: isTranslating });
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

  function getTranslatableBlocks() {
    const blocks = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.classList?.contains(TRANSLATION_CLASS)) return NodeFilter.FILTER_REJECT;
          if (node.classList?.contains(WRAPPER_CLASS)) return NodeFilter.FILTER_REJECT;
          if (node.hasAttribute(TRANSLATED_ATTR)) return NodeFilter.FILTER_REJECT;
          // Skip selection panel elements
          if (node.classList?.contains('sit-panel')) return NodeFilter.FILTER_REJECT;
          if (node.classList?.contains('sit-icon')) return NodeFilter.FILTER_REJECT;

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

  async function translatePage() {
    if (isTranslating) return;
    isTranslating = true;

    try {
      const blocks = getTranslatableBlocks();
      if (blocks.length === 0) {
        isTranslating = false;
        return;
      }

      const promises = blocks.map(el => translator.translate(getDirectText(el)));
      const translations = await Promise.all(promises);

      translations.forEach((translated, i) => {
        if (translated && !translated.startsWith('[翻译失败')) {
          insertTranslation(blocks[i], translated);
        }
      });
    } catch (err) {
      console.error('[SIT] Translation error:', err);
    }

    isTranslating = false;
  }

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
    'CAPTION', 'DT', 'DD', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER'
  ]);

  function insertTranslation(el, translatedText) {
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    el.setAttribute(TRANSLATED_ATTR, 'true');

    const translationEl = document.createElement('span');
    translationEl.className = TRANSLATION_CLASS;
    translationEl.textContent = translatedText;

    if (BLOCK_TAGS.has(el.tagName)) {
      const br = document.createElement('br');
      br.className = WRAPPER_CLASS;
      el.appendChild(br);
      el.appendChild(translationEl);
    } else {
      el.parentNode.insertBefore(translationEl, el.nextSibling);
    }
  }

  function removeTranslations() {
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach(el => {
      el.removeAttribute(TRANSLATED_ATTR);
    });
  }

  // Observe DOM changes for SPA support
  const observer = new MutationObserver((mutations) => {
    if (!isEnabled || isTranslating) return;

    let hasNewContent = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE &&
            !node.classList?.contains(TRANSLATION_CLASS) &&
            !node.classList?.contains(WRAPPER_CLASS) &&
            !node.classList?.contains('sit-panel') &&
            !node.classList?.contains('sit-icon')) {
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
