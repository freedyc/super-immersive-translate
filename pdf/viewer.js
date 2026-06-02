import { createIcons, icons } from 'lucide';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { Translator } from '../utils/translator.js';

/**
 * PDF / Document Translation Workspace - Super Immersive Translate
 */
(async function () {
  'use strict';

  const sourceText = document.getElementById('sourceText');
  const translatedText = document.getElementById('translatedText');
  const translateBtn = document.getElementById('translateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyBtn = document.getElementById('copyBtn');
  const fileInput = document.getElementById('fileInput');
  const uploadArea = document.getElementById('uploadArea');
  const workspace = document.getElementById('workspace');
  const charCount = document.getElementById('charCount');
  const engineSelect = document.getElementById('engine');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');

  // Apply theme and init theme control
  applyTheme();
  initThemeControl(document.getElementById('themeControl'));
  createIcons({ icons });

  // Load saved engine
  const settings = await chrome.storage.sync.get({ engine: 'google' });
  engineSelect.value = settings.engine;

  // ── File handling ────────────────────────────────────

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  async function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    try {
      let text = '';
      if (ext === 'pdf') {
        text = await extractPDFText(file);
      } else {
        text = await file.text();
        if (ext === 'html' || ext === 'htm') {
          const doc = new DOMParser().parseFromString(text, 'text/html');
          text = doc.body.textContent || '';
        }
      }

      text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      if (text.length < 2) {
        alert('未能从文件中提取到文本内容。\n请尝试手动复制粘贴文本。');
        return;
      }

      sourceText.value = text;
      showWorkspace();
    } catch (err) {
      alert('文件读取失败: ' + err.message + '\n请尝试手动复制粘贴。');
    }
  }

  // ── Basic PDF text extraction ────────────────────────

  async function extractPDFText(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const raw = new TextDecoder('latin1').decode(bytes);

    let allText = '';

    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    let match;

    while ((match = streamRegex.exec(raw)) !== null) {
      let content = match[1];

      const objStart = raw.lastIndexOf('obj', match.index);
      const objHeader = raw.substring(Math.max(0, objStart - 200), match.index);
      const isFlate = objHeader.includes('/FlateDecode');

      if (isFlate) {
        try {
          const compressed = bytes.slice(
            match.index + match[0].indexOf('\n') + 1,
            match.index + match[0].length - 'endstream'.length
          );
          const decompressed = await inflateData(compressed);
          content = new TextDecoder('latin1').decode(decompressed);
        } catch (e) {
          continue;
        }
      }

      const textParts = extractTextOperators(content);
      if (textParts) allText += textParts + '\n';
    }

    return cleanExtractedText(allText);
  }

  async function inflateData(data) {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();

      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const total = chunks.reduce((a, c) => a + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch (e) {
      const ds = new DecompressionStream('raw');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }
  }

  function extractTextOperators(content) {
    let text = '';
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;

    let m;
    while ((m = tjRegex.exec(content)) !== null) {
      text += decodePDFString(m[1]);
    }

    while ((m = tjArrayRegex.exec(content)) !== null) {
      const inner = m[1];
      const strRegex = /\(([^)]*)\)/g;
      let s;
      while ((s = strRegex.exec(inner)) !== null) {
        text += decodePDFString(s[1]);
      }
    }

    return text;
  }

  function decodePDFString(str) {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\([()])/g, '$1');
  }

  function cleanExtractedText(text) {
    return text
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .replace(/([a-z])-\n([a-z])/g, '$1$2')
      .trim();
  }

  // ── Workspace ────────────────────────────────────────

  function showWorkspace() {
    uploadArea.style.display = 'none';
    workspace.style.display = 'grid';
    updateCharCount();
  }

  sourceText.addEventListener('input', updateCharCount);

  function updateCharCount() {
    const len = sourceText.value.length;
    charCount.textContent = len.toLocaleString() + ' 字';
  }

  sourceText.addEventListener('paste', () => {
    setTimeout(() => {
      if (sourceText.value.trim().length > 0) showWorkspace();
    }, 50);
  });

  sourceText.addEventListener('focus', showWorkspace);

  // ── Translation ──────────────────────────────────────

  translateBtn.addEventListener('click', doTranslate);

  async function doTranslate() {
    const text = sourceText.value.trim();
    if (!text) return;

    const t = new Translator();
    await t.init();
    t.engine = engineSelect.value;

    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const total = paragraphs.length;
    if (total === 0) return;

    translateBtn.disabled = true;
    progressBar.style.display = 'flex';
    translatedText.textContent = '';

    let results = [];

    for (let i = 0; i < total; i++) {
      const pct = Math.round(((i + 1) / total) * 100);
      progressFill.style.width = pct + '%';
      progressLabel.textContent = `翻译中 ${i + 1}/${total}`;

      try {
        const result = await t.translate(paragraphs[i].trim());
        results.push(result || paragraphs[i]);
      } catch (e) {
        results.push('[翻译失败] ' + paragraphs[i].substring(0, 50) + '...');
      }
    }

    translatedText.innerHTML = results.map(r =>
      `<p>${escapeHtml(r)}</p>`
    ).join('');

    progressLabel.textContent = '✓ 翻译完成';
    setTimeout(() => { progressBar.style.display = 'none'; }, 2000);
    translateBtn.disabled = false;
  }

  // ── Actions ──────────────────────────────────────────

  clearBtn.addEventListener('click', () => {
    sourceText.value = '';
    translatedText.textContent = '';
    workspace.style.display = 'none';
    uploadArea.style.display = 'flex';
    updateCharCount();
  });

  copyBtn.addEventListener('click', () => {
    const text = translatedText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text);
    copyBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> 已复制';
    createIcons({ icons });
    setTimeout(() => {
      copyBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> 复制';
      createIcons({ icons });
    }, 1500);
  });

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
})();
