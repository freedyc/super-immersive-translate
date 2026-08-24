import selectionCss from './selection.css?inline';
import { Translator } from '../utils/translator.js';
// 显式导入而不是依赖 manifest 里的顺序：@crxjs 把每个内容脚本包成异步加载的
// 模块，两个条目之间的执行顺序**不保证**。此前这里靠 manifest 顺序拿
// window.ttsManager，结果是随机地 Cannot read properties of undefined。
// 二者共用同一个打包 chunk，模块体只会执行一次，不会有两个实例
import '../utils/tts.js';
import { pick } from '../utils/defaults.js';
import { saveHistoryEntry } from '../utils/history.js';
import {
  analyzeWordSenses, enrichWordWithAi, generateExampleSentence, translateMissingExamples,
} from '../utils/example-sentence.js';
import { collectWord, getWord } from '../utils/learning/collect.ts';
import { formatPhonetic, formatPos, pickExample, pickPhonetic, pickPos } from '../utils/learning/wordMeta.ts';
import { getUiRoot, isInsideUi, isNodeInsideUi } from './shadow-ui.js';
import { lookupWordMeta } from '../utils/dictionary-client.js';

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
    libre: '🟣', deepl: '🔷', custom: '⚙️',
    openai: '⚪', gemini: '✨', claude: '🔶',
    ollama: '🦙', webllm: '💻'
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
  let pendingSentence = '';
  let currentSentence = '';

  // Load settings
  async function loadSettings() {
    try {
      const s = await chrome.storage.sync.get(pick('selectionMode', 'selectionEngines', 'deeplKey'));
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
    // 不再在这里 init()：speak() 会自己保证就绪，且 tts.js 现在监听设置变更
  }

  loadSettings();

  // Listen for settings updates
  chrome.storage.onChanged.addListener(() => {
    loadSettings();
  });

  // Listen for shortcuts and settings updates from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'translateSelection') {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || msg.text;
      if (text && text.length >= 1) {
        const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const rect = range ? range.getBoundingClientRect() : {
          bottom: window.innerHeight / 2,
          right: window.innerWidth / 2,
          left: window.innerWidth / 2,
          top: window.innerHeight / 2
        };
        pendingSentence = range ? extractSentenceContext(range, text) : '';
        showPanel(text, rect);
      }
      sendResponse({ ok: true });
    } else if (msg.action === 'updateSettings') {
      loadSettings();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ========== Trigger Icon ==========
  function createIcon(rect) {
    removeIcon();
    icon = document.createElement('div');
    icon.className = ICON_CLASS;
    // 图标走 web_accessible_resources 而不是内联 data URI：
    // 这段脚本注入到每一个访问过的页面，一张 72px 的 PNG 内联成 base64 要
    // 7000 多字符，是原来那段 SVG 的六倍。走 URL 只多一个字符串
    icon.innerHTML = `<img src="${chrome.runtime.getURL('icons/trigger.png')}" alt="翻译">`;
    icon.title = '点击翻译';
    const top = rect.bottom + window.scrollY + 4;
    const left = rect.right + window.scrollX + 4;
    icon.style.top = top + 'px';
    icon.style.left = left + 'px';
    getUiRoot(selectionCss).appendChild(icon);

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
    getUiRoot(selectionCss).appendChild(panel);
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

  async function checkAlreadySaved(text, btn) {
    if (!btn) return;
    if (await getWord(text)) {
      btn.textContent = '✅';
      btn.title = '已收藏';
    }
  }

  // 只有形如一个英文单词的选中内容才查词典信息，短语/句子没有 IPA/词性这回事
  function isSingleWord(text) {
    return /^[A-Za-z](?:[A-Za-z'-]*[A-Za-z])?$/.test(text);
  }

  function renderDictionaryInfo(els, ipa, pos, sentence, translation) {
    // 音标带不带方括号在数据里不统一，显示时统一补齐（与各 React 页面同一套规则）
    if (ipa && els.ipaEl) { els.ipaEl.textContent = formatPhonetic(ipa); els.ipaEl.style.display = ''; }
    if (pos && els.posEl) { els.posEl.textContent = pos; els.posEl.style.display = ''; }
    if (sentence && els.exampleWrap) {
      if (els.enTextEl) els.enTextEl.textContent = sentence;
      if (els.zhTextEl) els.zhTextEl.textContent = translation || '';
      els.exampleWrap.style.display = '';
    }
  }

  /**
   * 渲染词条区：多义项 + 例句 + 主释义 + 一句话说明。
   *
   * 放在输入框下面、引擎结果上面：查词的人最想先看到「这个词几个意思」，
   * 各引擎的译文是用来相互印证的，排在后面。
   */
  function renderEntry(el, data) {
    if (!el || !data?.senses?.length) return;

    const senses = data.senses.map((s) => `
      <div class="sit-sense">
        <div class="sit-sense-head">
          ${s.pos ? `<span class="sit-sense-pos">${escapeHtml(s.pos)}</span>` : ''}
          <span class="sit-sense-def">${escapeHtml(s.definition)}</span>
        </div>
        ${s.example ? `
        <div class="sit-sense-ex">
          <span class="sit-sense-en">${escapeHtml(s.example)}</span>
          <span class="sit-example-speak" data-lang="en-US" title="朗读例句">🔊</span>
        </div>` : ''}
        ${s.translation ? `
        <div class="sit-sense-ex">
          <span class="sit-sense-zh">${escapeHtml(s.translation)}</span>
          <span class="sit-example-speak" data-lang="zh-CN" title="朗读译文">🔊</span>
        </div>` : ''}
      </div>`).join('');

    const primary = data.primary ? `
      <div class="sit-entry-primary">
        <span class="sit-primary-text">${escapeHtml(data.primary)}</span>
        <span class="sit-example-speak" data-lang="zh-CN" title="朗读">🔊</span>
        <span class="sit-primary-copy" title="复制">📋</span>
      </div>` : '';

    const note = data.note
      ? `<div class="sit-entry-note">${escapeHtml(data.note)}</div>`
      : '';

    el.innerHTML = senses + primary + note;
    el.style.display = '';

    // 朗读按钮取同一行里的文本；主释义那一行的文本在 .sit-primary-text
    el.querySelectorAll('.sit-example-speak').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.parentElement;
        const text = row?.querySelector('.sit-sense-en, .sit-sense-zh, .sit-primary-text')
          ?.textContent?.trim();
        if (text) window.ttsManager.speak(text, btn.dataset.lang);
      });
    });

    const copyBtn = el.querySelector('.sit-primary-copy');
    copyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(data.primary).then(() => {
        copyBtn.textContent = '✅';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
      }).catch(() => {
        copyBtn.textContent = '✕';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
      });
    });
  }

  // 单词已经收藏过就直接用现成的 ipa/pos/例句，不重复调用 AI；
  // 没收藏过才生成一次（不写回存储 —— 真正收藏时 enrichWordWithAi 会单独再生成一次，
  // 两次调用不共享缓存，属于已知的可接受浪费，不为此增加复杂度）
  async function loadDictionaryInfo(sourceText, els) {
    if (!isSingleWord(sourceText)) return;

    const existing = await getWord(sourceText);
    let phonetic = existing ? pickPhonetic(existing) : '';
    let pos = existing ? pickPos(existing) : '';

    // 音标和词性先查本地词典。它不依赖 AI 引擎，也不要求这个词已经收藏过——
    // 划词看一眼读音和词性是最常见的需求，不该先收藏才能看到
    if (!phonetic || !pos) {
      const meta = await lookupWordMeta(sourceText);
      phonetic = phonetic || meta.phonetic;
      pos = pos || formatPos(meta.pos);
    }

    if (existing || phonetic || pos) {
      const ex = existing ? pickExample(existing) : null;
      renderDictionaryInfo(els, phonetic, pos, ex?.sentence, ex?.translation);
      // 两样都齐、且例句也有了，就不必再调 AI
      if (phonetic && pos && ex?.sentence) return;
    }

    // 剩下的都要 AI：多义项词条、例句，以及本地词典查不到的词的音标/词性
    const t = new Translator();
    await t.init();

    // 词条与例句并行发起：它们是两次独立请求，串行会让面板多等一轮
    const [entry, generated] = await Promise.all([
      analyzeWordSenses(sourceText, t),
      generateExampleSentence(sourceText, t),
    ]);

    if (entry) renderEntry(els.entryEl, entry);

    if (generated) {
      renderDictionaryInfo(
        els,
        phonetic || generated.ipa,
        pos || generated.pos,
        generated.sentence,
        generated.translation,
      );
    }
    // 已收藏的词顺手把补到的信息写回去，否则下次打开还是空的
    if (existing && generated) await enrichWordWithAi(sourceText, true);
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
        <span class="sit-ipa" style="display:none"></span>
        <span class="sit-pos-badge" style="display:none"></span>
      </div>
      <div class="sit-example" style="display:none">
        <div class="sit-example-row">
          <span class="sit-example-text sit-example-en"></span>
          <span class="sit-example-speak" data-lang="en-US" title="朗读例句">🔊</span>
        </div>
        <div class="sit-example-row">
          <span class="sit-example-text sit-example-zh"></span>
          <span class="sit-example-speak" data-lang="zh-CN" title="朗读译文">🔊</span>
        </div>
      </div>
      <div class="sit-input-wrap">
        <input type="text" class="sit-input" placeholder="输入新单词或句子..." value="">
        <button class="sit-input-btn" title="翻译">→</button>
      </div>
      <div class="sit-entry" style="display:none"></div>
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

    // 面板刚打开时就查一下这个词是否已经收藏过，是的话把星标直接换成已收藏状态，
    // 不用等用户点一次才知道。捕获的是这次渲染出来的具体元素，即使后续又选了新词、
    // innerHTML 被整体替换，更新一个已经被替换掉的旧节点也不会影响当前画面。
    checkAlreadySaved(sourceText, p.querySelector('.sit-save'));

    // 单个单词才查词典信息（音标/词性/双语例句），短语/句子不查，避免每次划句子都触发 AI 调用
    loadDictionaryInfo(sourceText, {
      ipaEl: p.querySelector('.sit-ipa'),
      posEl: p.querySelector('.sit-pos-badge'),
      entryEl: p.querySelector('.sit-entry'),
      exampleWrap: p.querySelector('.sit-example'),
      enTextEl: p.querySelector('.sit-example-en'),
      zhTextEl: p.querySelector('.sit-example-zh')
    });
    p.querySelectorAll('.sit-example-speak').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.sit-example-row');
        const text = row?.querySelector('.sit-example-text')?.textContent?.trim();
        if (text) window.ttsManager.speak(text, btn.dataset.lang);
      });
    });

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

      // 写进统一的 words 表（collectWord 负责去重、追加语境、保留已有释义）。
      // 旧的 wordbook 键不再写——两张表各写各的，正是「词库里没有音标」的成因
      const saved = await collectWord({
        text: sourceText,
        translations,
        sentence: currentSentence || undefined,
        url: window.location.href,
        title: document.title,
      });

      const hasContext = saved.examples.some(e => e.origin === 'context');
      // 没有真实例句就用 AI 补一个；有真实例句就只在缺音标/词性时轻量识别一次
      enrichWordWithAi(sourceText, hasContext);
      // 抓到的原句还要补中文译文——词库里例句下面要显示双语。
      // 收藏本身已经完成，这一步失败也不影响
      if (hasContext) {
        const t = new Translator();
        t.init().then(() => translateMissingExamples(sourceText, t)).catch(() => {});
      }

      // 已经真的存进单词本了，保持"已收藏"状态，不再像临时提示那样几秒后跳回去
      btn.textContent = '✅';
      btn.title = '已收藏';
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

    // Speak button (TTS) —— 走共享的 ttsManager，尊重设置里配置的音色/OpenAI TTS
    p.querySelector('.sit-speak').addEventListener('click', (e) => {
      const sourceEl = p.querySelector('.sit-source');
      const text = sourceEl?.textContent?.trim();
      if (!text) return;
      window.ttsManager.speak(text, 'en-US');
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
        saveHistoryEntry({
          text: historyPendingText,
          translation: result,
          engine: engineId,
          url: location.href,
          title: document.title,
        });
        historyPendingText = null;
      }
    }
  }

  async function translateWithEngine(engineId, text) {
    const t = new Translator();
    await t.init();
    t.engine = engineId;

    try {
      const result = await t.translate(text);
      updateEngineResult(engineId, result, null);
    } catch (err) {
      updateEngineResult(engineId, null, `失败: ${err.message || err}`);
    }
  }

  // 从一个 Range 所在的最近块级祖先元素里，找出包含选中文字的那一句话，
  // 作为收藏单词时的记忆上下文。找不到就返回空字符串，不影响主流程。
  const SENTENCE_BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FIGCAPTION'
  ]);

  function extractSentenceContext(range, selectedText) {
    try {
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

      let block = node;
      while (block && block !== document.body && !SENTENCE_BLOCK_TAGS.has(block.tagName)) {
        block = block.parentElement;
      }
      if (!block || block === document.body) return '';

      const blockText = block.textContent.replace(/\s+/g, ' ').trim();
      const needle = selectedText.trim();
      const idx = blockText.indexOf(needle);
      if (idx === -1) return '';

      const sentences = blockText.match(/[^。！？.!?]+[。！？.!?]?/g) || [blockText];
      let pos = 0;
      for (const s of sentences) {
        const start = pos;
        const end = pos + s.length;
        if (idx >= start && idx < end) {
          return s.trim().slice(0, 200);
        }
        pos = end;
      }
      return blockText.slice(0, 200);
    } catch (e) {
      return '';
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
    currentSentence = pendingSentence;
    renderPanel(text, engineResults);
    positionPanel(rect);

    // Fire all engines in parallel
    selectionEngines.forEach(id => translateWithEngine(id, text));
  }

  // ========== Event Listeners ==========

  // Mouse up → selection detection
  document.addEventListener('mouseup', (e) => {
    if (selectionMode === 'off') return;
    if (isInsideUi(e)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (!text || text.length < 1 || text.length > 5000) {
        if (!isPinned) { removeIcon(); }
        return;
      }

      // 在面板里选中文字不该再触发一次划词
      if (isNodeInsideUi(sel.anchorNode)) return;

      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingText = text;
      pendingRect = rect;
      pendingSentence = extractSentenceContext(range, text);

      if (selectionMode === 'icon') {
        createIcon(rect);
      } else if (selectionMode === 'direct') {
        showPanel(text, rect);
      }
      // dblclick and shortcut handled separately
    }, 10);
  });

  // Broadcast any text selection to the side panel (independent of selection-translate mode).
  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length >= 1 && text.length <= 5000) {
        // No receiver when the panel is closed → ignore the rejection.
        chrome.runtime.sendMessage({ action: 'panelSelection', text }).catch(() => {});
      }
    }, 10);
  });

  // Double click → dblclick mode
  document.addEventListener('dblclick', (e) => {
    if (selectionMode !== 'dblclick') return;
    if (isInsideUi(e)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 1) return;

      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      pendingSentence = extractSentenceContext(range, text);
      showPanel(text, rect);
    }, 10);
  });

  // Click elsewhere → dismiss
  document.addEventListener('mousedown', (e) => {
    if (isInsideUi(e)) return;
    // Only remove icon on mousedown, panel dismissal handled after mouseup
    removeIcon();
  });

  // Click on empty area (no selection) → dismiss panel
  document.addEventListener('click', (e) => {
    if (isInsideUi(e)) return;

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
