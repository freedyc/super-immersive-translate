import { translator } from '../utils/translator.js';
import overlayCss from './overlay.css?inline';
import { getUiRoot } from './shadow-ui.js';

/**
 * Input Translation Module - Super Immersive Translate
 * Real-time bilingual input: shows translation below text inputs as user types.
 */
(function () {
  'use strict';

  let enabled = false;
  let tooltip = null;
  let activeInput = null;
  let debounceTimer = null;
  let lastTranslated = '';

  chrome.storage.sync.get({ inputTranslate: false }, (s) => {
    enabled = s.inputTranslate;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.inputTranslate) {
      enabled = changes.inputTranslate.newValue;
      if (!enabled) hideTooltip();
    }
  });

  function isTranslatableInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return type === 'text' || type === 'search' || type === 'url';
    }
    return el.isContentEditable;
  }

  function getInputText(el) {
    if (el.isContentEditable) return el.textContent || '';
    return el.value || '';
  }

  document.addEventListener('focusin', (e) => {
    if (!enabled) return;
    if (isTranslatableInput(e.target)) {
      activeInput = e.target;
    }
  });

  document.addEventListener('focusout', (e) => {
    setTimeout(() => {
      if (!activeInput) return;
      if (document.activeElement !== activeInput &&
          !tooltip?.contains(document.activeElement)) {
        hideTooltip();
        activeInput = null;
        lastTranslated = '';
      }
    }, 200);
  });

  document.addEventListener('input', (e) => {
    if (!enabled || !activeInput || e.target !== activeInput) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doTranslate, 500);
  });

  async function doTranslate() {
    if (!activeInput) return;
    const text = getInputText(activeInput).trim();
    if (text.length < 2 || text === lastTranslated) {
      if (text.length < 2) hideTooltip();
      return;
    }

    lastTranslated = text;
    try {
      const result = await translator.translate(text);
      if (result && !result.startsWith('[翻译失败') && activeInput) {
        showTooltip(result);
      }
    } catch (e) {
      console.error('[SIT] Input translate error:', e);
    }
  }

  function showTooltip(text) {
    if (!activeInput) return;

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'sit-input-tooltip';
      getUiRoot(overlayCss).appendChild(tooltip);
    }

    tooltip.textContent = text;
    positionTooltip();
    tooltip.style.display = 'block';
  }

  function positionTooltip() {
    if (!tooltip || !activeInput) return;
    const rect = activeInput.getBoundingClientRect();
    tooltip.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    tooltip.style.left = (rect.left + window.scrollX) + 'px';
    tooltip.style.maxWidth = Math.max(rect.width, 200) + 'px';
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  window.addEventListener('scroll', () => {
    if (tooltip && tooltip.style.display !== 'none') positionTooltip();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (tooltip && tooltip.style.display !== 'none') positionTooltip();
  }, { passive: true });
})();
