/**
 * Selection Translation Module - Saladict-style
 * Modes: icon, direct, dblclick, shortcut, off
 */
(function () {
  'use strict';

  const PANEL_CLASS = 'sit-panel';
  const ICON_CLASS = 'sit-icon';
  const PINNED_CLASS = 'sit-pinned';

  const ENGINE_ICONS = {
    google: '🔵', mymemory: '🟡', lingva: '🟢',
    libre: '🟣', deepl: '🔷', custom: '⚙️'
  };

  const DEFAULT_SELECTION_ENGINES = ['google', 'lingva', 'libre'];

  let panel = null;
  let icon = null;
  let isPinned = false;
  let dragState = null;
  let selectionMode = 'icon'; // icon | direct | dblclick | shortcut | off
  let selectionEngines = DEFAULT_SELECTION_ENGINES;
  let pendingText = '';
  let pendingRect = null;

  // Load settings
  async function loadSettings() {
    try {
      const s = await chrome.storage.sync.get({
        selectionMode: 'icon',
        selectionEngines: DEFAULT_SELECTION_ENGINES,
        deeplKey: ''
      });
      selectionMode = s.selectionMode || 'icon';
      selectionEngines = (s.selectionEngines && s.selectionEngines.length > 0)
        ? s.selectionEngines : DEFAULT_SELECTION_ENGINES;
      if (s.deeplKey && !selectionEngines.includes('deepl')) {
        selectionEngines = [...selectionEngines, 'deepl'];
      }
    } catch (e) {
      console.warn('[SIT] Failed to load settings, using defaults');
      selectionMode = 'icon';
      selectionEngines = DEFAULT_SELECTION_ENGINES;
    }
  }

  loadSettings();

  // Listen for settings updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.selectionMode || changes.selectionEngines || changes.deeplKey) {
      loadSettings();
    }
  });

  // Listen for shortcut from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'translateSelection') {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length >= 1) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showPanel(text, rect);
      }
      sendResponse({ ok: true });
    }
    return true;
  });

  // ========== Trigger Icon ==========
  function createIcon(rect) {
    removeIcon();
    icon = document.createElement('div');
    icon.className = ICON_CLASS;
    icon.innerHTML = `<svg viewBox="0 0 32 32" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sitBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#5a9cf7"/>
          <stop offset="100%" style="stop-color:#7c5ce7"/>
        </linearGradient>
        <linearGradient id="sitGloss" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(255,255,255,0.45)"/>
          <stop offset="50%" style="stop-color:rgba(255,255,255,0)"/>
        </linearGradient>
        <filter id="sitShadow"><feDropShadow dx="0" dy="0.5" stdDeviation="0.5" flood-opacity="0.25"/></filter>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#sitBg)"/>
      <rect width="32" height="17" rx="7" fill="url(#sitGloss)"/>
      <g filter="url(#sitShadow)">
        <text x="8" y="22" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="800" fill="#fff" letter-spacing="-0.5">S</text>
        <text x="17.5" y="22" font-family="Georgia,serif" font-size="15" font-weight="700" fill="rgba(255,255,255,0.88)" font-style="italic" letter-spacing="-0.5">T</text>
      </g>
    </svg>`;
    icon.title = '点击翻译';
    const top = rect.bottom + window.scrollY + 4;
    const left = rect.right + window.scrollX + 4;
    icon.style.top = top + 'px';
    icon.style.left = left + 'px';
    document.body.appendChild(icon);

    icon.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeIcon();
      if (pendingText) showPanel(pendingText, pendingRect);
    });
  }

  function removeIcon() {
    if (icon) { icon.remove(); icon = null; }
  }

  // ========== Translation Panel ==========
  function createPanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    document.body.appendChild(panel);
    return panel;
  }

  function removePanel() {
    if (isPinned) return;
    if (panel) { panel.remove(); panel = null; }
    dragState = null;
  }

  function forceRemovePanel() {
    isPinned = false;
    if (panel) { panel.remove(); panel = null; }
    dragState = null;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderPanel(sourceText, engineResults) {
    const p = createPanel();

    const pinnedIcon = isPinned ? '📌' : '📍';
    const pinnedTitle = isPinned ? '取消固定' : '固定面板';

    let html = `
      <div class="sit-header">
        <span class="sit-title">⚡ 超级翻译</span>
        <div class="sit-header-actions">
          <span class="sit-speak" title="朗读">🔊</span>
          <span class="sit-save" title="收藏单词">⭐</span>
          <span class="sit-pin" title="${pinnedTitle}">${pinnedIcon}</span>
          <span class="sit-close" title="关闭">✕</span>
        </div>
      </div>
      <div class="sit-source-wrap">
        <div class="sit-source">${escapeHtml(sourceText)}</div>
      </div>
      <div class="sit-input-wrap">
        <input type="text" class="sit-input" placeholder="输入新单词或句子..." value="">
        <button class="sit-input-btn" title="翻译">→</button>
      </div>
      <div class="sit-engines">
    `;

    engineResults.forEach(e => {
      html += `
        <div class="sit-engine" data-engine="${e.id}">
          <div class="sit-engine-head">
            <span class="sit-engine-icon">${ENGINE_ICONS[e.id] || '🔘'}</span>
            <span class="sit-engine-name">${escapeHtml(e.name)}</span>
            ${e.loading ? '<span class="sit-spinner"></span>' : ''}
            <span class="sit-engine-copy" title="复制" data-text="">📋</span>
          </div>
          <div class="sit-engine-result ${e.error ? 'sit-error' : ''}">
            ${e.loading ? '<span class="sit-loading-text">翻译中...</span>' : (e.error ? escapeHtml(e.error) : escapeHtml(e.result || ''))}
          </div>
        </div>
      `;
    });

    html += '</div>';
    p.innerHTML = html;

    // Bind events
    p.querySelector('.sit-close').addEventListener('click', forceRemovePanel);
    p.querySelector('.sit-pin').addEventListener('click', () => {
      isPinned = !isPinned;
      p.classList.toggle(PINNED_CLASS, isPinned);
      p.querySelector('.sit-pin').textContent = isPinned ? '📌' : '📍';
      p.querySelector('.sit-pin').title = isPinned ? '取消固定' : '固定面板';
    });

    // Save word button
    p.querySelector('.sit-save').addEventListener('click', async (e) => {
      const btn = e.target;
      // Collect translations from all engines
      const translations = {};
      p.querySelectorAll('.sit-engine').forEach(el => {
        const engineId = el.dataset.engine;
        const resultEl = el.querySelector('.sit-engine-result');
        const text = resultEl?.textContent?.trim();
        if (text && !text.startsWith('翻译中') && !text.startsWith('失败')) {
          translations[engineId] = text;
        }
      });

      const word = {
        text: sourceText,
        translations,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      };

      // Save to storage
      const { wordbook = [] } = await chrome.storage.local.get('wordbook');
      // Avoid duplicates
      const exists = wordbook.findIndex(w => w.text.toLowerCase() === sourceText.toLowerCase());
      if (exists >= 0) {
        wordbook[exists] = { ...wordbook[exists], ...word };
      } else {
        wordbook.unshift(word);
      }
      await chrome.storage.local.set({ wordbook });

      btn.textContent = '✅';
      btn.title = '已收藏';
      setTimeout(() => { btn.textContent = '⭐'; btn.title = '收藏单词'; }, 1500);
    });

    // Copy buttons
    p.querySelectorAll('.sit-engine-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const engineEl = e.target.closest('.sit-engine');
        const resultEl = engineEl?.querySelector('.sit-engine-result');
        if (resultEl?.textContent) {
          navigator.clipboard.writeText(resultEl.textContent.trim());
          e.target.textContent = '✅';
          setTimeout(() => e.target.textContent = '📋', 1200);
        }
      });
    });

    // Speak button (TTS)
    p.querySelector('.sit-speak').addEventListener('click', (e) => {
      const btn = e.target;
      // Cancel any ongoing speech
      speechSynthesis.cancel();

      const sourceEl = p.querySelector('.sit-source');
      const text = sourceEl?.textContent?.trim();
      if (!text) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.pitch = 1;

      // Try to find an English voice
      const voices = speechSynthesis.getVoices();
      const enVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
        || voices.find(v => v.lang.startsWith('en'));
      if (enVoice) utterance.voice = enVoice;

      btn.textContent = '🔉';
      utterance.onend = () => { btn.textContent = '🔊'; };
      utterance.onerror = () => { btn.textContent = '🔊'; };
      speechSynthesis.speak(utterance);
    });

    // Input box: translate new word/sentence
    const inputEl = p.querySelector('.sit-input');
    const inputBtn = p.querySelector('.sit-input-btn');

    function translateInput() {
      const text = inputEl.value.trim();
      if (!text || text.length < 1) return;

      // Update source display
      const sourceEl = p.querySelector('.sit-source');
      sourceEl.textContent = text;

      // Reset all engine results to loading
      p.querySelectorAll('.sit-engine').forEach(el => {
        const resultEl = el.querySelector('.sit-engine-result');
        resultEl.className = 'sit-engine-result';
        resultEl.innerHTML = '<span class="sit-loading-text">翻译中...</span>';
        // Re-add spinner
        const head = el.querySelector('.sit-engine-head');
        if (!head.querySelector('.sit-spinner')) {
          const spinner = document.createElement('span');
          spinner.className = 'sit-spinner';
          head.querySelector('.sit-engine-name').after(spinner);
        }
      });

      // Fire all engines
      selectionEngines.forEach(id => translateWithEngine(id, text));
    }

    inputBtn.addEventListener('click', translateInput);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); translateInput(); }
      // Prevent panel from closing when typing
      e.stopPropagation();
    });
    // Prevent mousedown on input from dismissing panel
    inputEl.addEventListener('mousedown', (e) => e.stopPropagation());

    // Drag
    enableDrag(p);

    return p;
  }

  function positionPanel(rect) {
    const p = createPanel();
    let top = rect.bottom + window.scrollY + 10;
    let left = rect.left + window.scrollX;
    p.style.top = top + 'px';
    p.style.left = left + 'px';
    p.style.display = 'block';

    requestAnimationFrame(() => {
      const pr = p.getBoundingClientRect();
      // Overflow right
      if (pr.right > window.innerWidth - 12) {
        p.style.left = Math.max(8, window.innerWidth - pr.width - 12) + 'px';
      }
      // Overflow bottom → show above
      if (pr.bottom > window.innerHeight - 12) {
        p.style.top = Math.max(8, rect.top + window.scrollY - pr.height - 10) + 'px';
      }
    });
  }

  function enableDrag(el) {
    const header = el.querySelector('.sit-header');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sit-close') || e.target.closest('.sit-pin')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      dragState = {
        sx: e.clientX, sy: e.clientY,
        ox: r.left + window.scrollX,
        oy: r.top + window.scrollY
      };
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (!dragState || !panel) return;
    panel.style.left = (dragState.ox + e.clientX - dragState.sx) + 'px';
    panel.style.top = (dragState.oy + e.clientY - dragState.sy) + 'px';
  });

  document.addEventListener('mouseup', () => { dragState = null; });

  // ========== History ==========
  let historyPendingText = null;

  async function saveToHistory(text, translation, engine) {
    try {
      const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');
      translationHistory.unshift({
        text, translation, engine,
        url: location.href,
        title: document.title,
        timestamp: Date.now()
      });
      if (translationHistory.length > 500) translationHistory.length = 500;
      await chrome.storage.local.set({ translationHistory });
    } catch (e) { /* ignore */ }
  }

  // ========== Engine Translation ==========
  function updateEngineResult(engineId, result, error) {
    if (!panel) return;
    const el = panel.querySelector(`.sit-engine[data-engine="${engineId}"]`);
    if (!el) return;
    const spinner = el.querySelector('.sit-spinner');
    if (spinner) spinner.remove();
    const resultEl = el.querySelector('.sit-engine-result');
    if (error) {
      resultEl.className = 'sit-engine-result sit-error';
      resultEl.textContent = error;
    } else {
      resultEl.className = 'sit-engine-result';
      resultEl.textContent = result;

      if (historyPendingText && result) {
        saveToHistory(historyPendingText, result, engineId);
        historyPendingText = null;
      }
    }
  }

  async function translateWithEngine(engineId, text) {
    const t = new Translator();
    await t.init();
    t.engine = engineId;

    try {
      let result;
      switch (engineId) {
        case 'google':  result = await t._googleSingle(text); break;
        case 'mymemory': result = await t._mymemorySingle(text); break;
        case 'lingva':  result = await t._lingvaSingle(text); break;
        case 'libre': {
          const sl = t.sourceLang === 'auto' ? 'auto' : t.sourceLang;
          const baseUrl = t.libreUrl || 'https://libretranslate.com';
          const resp = await fetch(`${baseUrl}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text, source: sl, target: t.targetLang.split('-')[0] })
          });
          if (!resp.ok) throw new Error(`${resp.status}`);
          const data = await resp.json();
          result = data.translatedText || '';
          break;
        }
        case 'deepl': {
          if (!t.deeplKey) throw new Error('未设置 API Key');
          const resp = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              auth_key: t.deeplKey, text: [text],
              target_lang: t.targetLang.toUpperCase().replace('-', '')
            })
          });
          if (!resp.ok) throw new Error(`${resp.status}`);
          const data = await resp.json();
          result = data.translations[0].text;
          break;
        }
        default: result = '';
      }
      updateEngineResult(engineId, result, null);
    } catch (err) {
      updateEngineResult(engineId, null, `失败: ${err.message}`);
    }
  }

  function showPanel(text, rect) {
    removeIcon();
    if (panel && !isPinned) forceRemovePanel();

    const engineResults = selectionEngines.map(id => ({
      id,
      name: Translator.ENGINES[id]?.name || id,
      loading: true, result: '', error: null
    }));

    historyPendingText = text;
    renderPanel(text, engineResults);
    positionPanel(rect);

    // Fire all engines in parallel
    selectionEngines.forEach(id => translateWithEngine(id, text));
  }

  // ========== Event Listeners ==========

  // Mouse up → selection detection
  document.addEventListener('mouseup', (e) => {
    if (selectionMode === 'off') return;
    if (e.target.closest('.' + PANEL_CLASS)) return;
    if (e.target.closest('.' + ICON_CLASS)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (!text || text.length < 1 || text.length > 5000) {
        if (!isPinned) { removeIcon(); }
        return;
      }

      const anchor = sel.anchorNode?.parentElement;
      if (anchor?.closest('.' + PANEL_CLASS)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingText = text;
      pendingRect = rect;

      if (selectionMode === 'icon') {
        createIcon(rect);
      } else if (selectionMode === 'direct') {
        showPanel(text, rect);
      }
      // dblclick and shortcut handled separately
    }, 10);
  });

  // Double click → dblclick mode
  document.addEventListener('dblclick', (e) => {
    if (selectionMode !== 'dblclick') return;
    if (e.target.closest('.' + PANEL_CLASS)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 1) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPanel(text, rect);
    }, 10);
  });

  // Click elsewhere → dismiss
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.' + PANEL_CLASS)) return;
    if (e.target.closest('.' + ICON_CLASS)) return;
    // Only remove icon on mousedown, panel dismissal handled after mouseup
    removeIcon();
  });

  // Click on empty area (no selection) → dismiss panel
  document.addEventListener('click', (e) => {
    if (e.target.closest('.' + PANEL_CLASS)) return;
    if (e.target.closest('.' + ICON_CLASS)) return;

    // If there's no active selection, dismiss panel
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text && !isPinned) {
        removePanel();
      }
    }, 20);
  });

  // Esc → dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      removeIcon();
      forceRemovePanel();
    }
  });
})();
