/**
 * Options page - Super Immersive Translate
 */
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';

const DEFAULT_SETTINGS = DEFAULTS;

const ENGINE_NAMES = {
  google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
  libre: 'Libre', deepl: 'DeepL', custom: '自定义',
  openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', ollama: 'Ollama'
};

document.addEventListener('DOMContentLoaded', async () => {
  // ── Theme ────────────────────────────────
  applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  createIcons({ icons });

  // ── Tab navigation ──────────────────────
  const navItems = document.querySelectorAll('.nav-item');
  const tabs = document.querySelectorAll('.tab');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(n => n.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`tab-${item.dataset.tab}`).classList.add('active');
    });
  });

  // ── Load settings ───────────────────────
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  const $ = id => document.getElementById(id);

  $('engine').value = settings.engine;
  $('targetLang').value = settings.targetLang;
  $('displayMode').value = settings.displayMode;
  $('translateConcurrency').value = settings.translateConcurrency;
  $('hoverTranslate').checked = settings.hoverTranslate;
  $('inputTranslate').checked = settings.inputTranslate;
  $('selectionMode').value = settings.selectionMode;
  $('deeplKey').value = settings.deeplKey;
  $('customApiUrl').value = settings.customApiUrl;
  $('customApiKey').value = settings.customApiKey;
  $('libreUrl').value = settings.libreUrl;
  $('openaiKey').value = settings.openaiKey;
  $('openaiModel').value = settings.openaiModel;
  $('openaiUrl').value = settings.openaiUrl;
  $('geminiKey').value = settings.geminiKey;
  $('geminiModel').value = settings.geminiModel;
  $('claudeKey').value = settings.claudeKey;
  $('claudeModel').value = settings.claudeModel;
  const ollamaModel = document.getElementById('ollamaModel');
  const ollamaUrl = document.getElementById('ollamaUrl');
  const webllmModel = document.getElementById('webllmModel');
  const aiPrompt = document.getElementById('aiPrompt');
  ollamaModel.value = settings.ollamaModel;
  ollamaUrl.value = settings.ollamaUrl;
  webllmModel.value = settings.webllmModel;
  aiPrompt.value = settings.aiPrompt;

  document.querySelectorAll('#selectionEngines input').forEach(cb => {
    cb.checked = settings.selectionEngines.includes(cb.value);
  });

  // Style
  setActiveColor(settings.translationColor);
  $('fontSize').value = settings.translationFontSize;
  $('fontSizeValue').textContent = settings.translationFontSize + 'em';
  $('lineHeight').value = settings.translationLineHeight;
  $('lineHeightValue').textContent = settings.translationLineHeight;
  $('translationBold').checked = settings.translationBold;
  $('translationShowBorder').checked = settings.translationShowBorder;
  
  $('ttsEngine').value = settings.ttsEngine;
  $('ttsBrowserRate').value = settings.ttsBrowserRate;
  $('ttsBrowserRateValue').textContent = settings.ttsBrowserRate;
  $('ttsBrowserPitch').value = settings.ttsBrowserPitch;
  $('ttsBrowserPitchValue').textContent = settings.ttsBrowserPitch;
  $('ttsOpenaiVoice').value = settings.ttsOpenaiVoice;
  $('ttsOpenaiSpeed').value = settings.ttsOpenaiSpeed;
  $('ttsOpenaiSpeedValue').textContent = settings.ttsOpenaiSpeed;
  updateTTSUI(settings.ttsEngine);
  updatePreview(settings);

  // Sites
  $('siteMode').value = settings.siteRules.mode;
  renderSiteList(settings.siteRules.sites);
  renderSiteEngines(settings.siteEngines);

  // Load voices for browser TTS
  function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    const select = $('ttsBrowserVoiceURI');
    if (!select) return;
    select.innerHTML = '<option value="">自动匹配 (默认)</option>';
    voices.forEach(v => {
      const option = document.createElement('option');
      option.value = v.voiceURI;
      option.textContent = `${v.name} (${v.lang})`;
      select.appendChild(option);
    });
    if (settings.ttsBrowserVoiceURI) {
      select.value = settings.ttsBrowserVoiceURI;
    }
  }
  loadVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  $('ttsEngine').addEventListener('change', (e) => {
    updateTTSUI(e.target.value);
    saveAll();
  });

  function updateTTSUI(engine) {
    $('ttsBrowserSettings').style.display = engine === 'browser' ? 'block' : 'none';
    $('ttsOpenAISettings').style.display = engine === 'openai' ? 'block' : 'none';
  }

  ['ttsBrowserVoiceURI', 'ttsOpenaiVoice'].forEach(id => {
    $(id).addEventListener('change', saveAll);
  });

  $('ttsBrowserRate').addEventListener('input', () => {
    $('ttsBrowserRateValue').textContent = $('ttsBrowserRate').value;
    debouncedSave();
  });
  $('ttsBrowserPitch').addEventListener('input', () => {
    $('ttsBrowserPitchValue').textContent = $('ttsBrowserPitch').value;
    debouncedSave();
  });
  $('ttsOpenaiSpeed').addEventListener('input', () => {
    $('ttsOpenaiSpeedValue').textContent = $('ttsOpenaiSpeed').value;
    debouncedSave();
  });

  // ── Shortcuts ───────────────────────────
  try {
    const commands = await chrome.commands.getAll();
    const container = $('shortcutList');
    commands.forEach(cmd => {
      if (!cmd.description) return;
      const item = document.createElement('div');
      item.className = 'shortcut-item flex justify-between items-center px-3 py-2.5 bg-base-200 rounded-lg';
      item.innerHTML = `
        <span class="shortcut-desc text-sm text-base-content/70">${cmd.description}</span>
        <span class="shortcut-key font-mono text-xs px-2.5 py-1 bg-base-100 border border-base-300 rounded">${cmd.shortcut || '未设置'}</span>`;
      container.appendChild(item);
    });
  } catch (e) { /* ignore */ }

  $('openShortcutsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ── Auto-save listeners ─────────────────

  const saveFields = [
    'engine', 'targetLang', 'displayMode', 'translateConcurrency', 'selectionMode',
    'hoverTranslate', 'inputTranslate',
    'translationBold', 'translationShowBorder', 'siteMode'
  ];
  saveFields.forEach(id => {
    const el = $(id);
    el.addEventListener('change', saveAll);
  });

  ['deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl', 
   'openaiKey', 'openaiModel', 'openaiUrl', 
   'geminiKey', 'geminiModel', 'claudeKey', 'claudeModel', 
   'ollamaModel', 'ollamaUrl', 'aiPrompt'
  ].forEach(id => {
    $(id).addEventListener('input', debounce(saveAll, 500));
  });

  $('selectionEngines').addEventListener('change', saveAll);

  // Color picker
  $('colorPicker').addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    setActiveColor(dot.dataset.color);
    saveAll();
  });

  // Range sliders
  $('fontSize').addEventListener('input', () => {
    $('fontSizeValue').textContent = $('fontSize').value + 'em';
    updatePreview();
    debouncedSave();
  });

  $('lineHeight').addEventListener('input', () => {
    $('lineHeightValue').textContent = $('lineHeight').value;
    updatePreview();
    debouncedSave();
  });

  $('translationBold').addEventListener('change', () => { updatePreview(); saveAll(); });
  $('translationShowBorder').addEventListener('change', () => { updatePreview(); saveAll(); });

  // ── Site rules ──────────────────────────

  $('addSiteBtn').addEventListener('click', () => addSite());
  $('siteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSite();
  });

  async function addSite() {
    const host = $('siteInput').value.trim().toLowerCase();
    if (!host) return;
    const s = await chrome.storage.sync.get({ siteRules: DEFAULT_SETTINGS.siteRules });
    if (!s.siteRules.sites.includes(host)) {
      s.siteRules.sites.push(host);
      await chrome.storage.sync.set({ siteRules: s.siteRules });
      renderSiteList(s.siteRules.sites);
    }
    $('siteInput').value = '';
  }

  $('addSiteEngineBtn').addEventListener('click', addSiteEngine);
  $('siteEngineHost').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSiteEngine();
  });

  async function addSiteEngine() {
    const host = $('siteEngineHost').value.trim().toLowerCase();
    const engine = $('siteEngineEngine').value;
    if (!host) return;
    const s = await chrome.storage.sync.get({ siteEngines: {} });
    s.siteEngines[host] = engine;
    await chrome.storage.sync.set({ siteEngines: s.siteEngines });
    renderSiteEngines(s.siteEngines);
    $('siteEngineHost').value = '';
  }

  // ── Data management ─────────────────────

  $('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.sync.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sit-settings-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await chrome.storage.sync.set(data);
      location.reload();
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
  });

  $('resetBtn').addEventListener('click', async () => {
    if (!confirm('确定要恢复所有设置为默认值吗？单词本和翻译历史不会受影响。')) return;
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    location.reload();
  });

  // Full backup: settings (sync) + wordbook + history (local) in one file.
  $('exportAllBtn').addEventListener('click', async () => {
    const [settings, local] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get({ wordbook: [], translationHistory: [] })
    ]);
    const bundle = {
      type: 'super-immersive-translate-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      wordbook: local.wordbook || [],
      history: local.translationHistory || []
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('importAllFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (bundle.type !== 'super-immersive-translate-backup' || !bundle.settings) {
        throw new Error('不是有效的全部数据备份文件');
      }
      if (!confirm('导入将覆盖当前的设置、单词本和翻译历史，确定继续吗？')) {
        e.target.value = '';
        return;
      }
      await chrome.storage.sync.set(bundle.settings);
      await chrome.storage.local.set({
        wordbook: Array.isArray(bundle.wordbook) ? bundle.wordbook : [],
        translationHistory: Array.isArray(bundle.history) ? bundle.history : []
      });
      location.reload();
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
  });

  // ── Helpers ─────────────────────────────

  function setActiveColor(color) {
    document.querySelectorAll('#colorPicker .color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
    updatePreview();
  }

  function getActiveColor() {
    const active = document.querySelector('#colorPicker .color-dot.active');
    return active ? active.dataset.color : '#9b59b6';
  }

  function updatePreview(s) {
    const el = $('previewText');
    if (!el) return;
    const color = getActiveColor();
    const size = $('fontSize').value;
    const lh = $('lineHeight').value;
    const bold = $('translationBold').checked;
    const border = $('translationShowBorder').checked;

    el.style.color = color;
    el.style.fontSize = size + 'em';
    el.style.lineHeight = lh;
    el.style.fontWeight = bold ? 'bold' : 'normal';
    el.style.borderLeftWidth = border ? '2px' : '0';
    el.style.paddingLeft = border ? '8px' : '0';
  }

  async function saveAll() {
    const selEngines = [];
    document.querySelectorAll('#selectionEngines input:checked').forEach(cb => selEngines.push(cb.value));

    const current = await chrome.storage.sync.get({ siteRules: DEFAULT_SETTINGS.siteRules, siteEngines: {} });

    const newSettings = {
      engine: $('engine').value,
      targetLang: $('targetLang').value,
      displayMode: $('displayMode').value,
      translateConcurrency: $('translateConcurrency').value,
      translationColor: getActiveColor(),
      hoverTranslate: $('hoverTranslate').checked,
      inputTranslate: $('inputTranslate').checked,
      selectionMode: $('selectionMode').value,
      selectionEngines: selEngines.length > 0 ? selEngines : ['google'],
      deeplKey: $('deeplKey').value,
      customApiUrl: $('customApiUrl').value,
      customApiKey: $('customApiKey').value,
      libreUrl: $('libreUrl').value,
      openaiKey: $('openaiKey').value,
      openaiModel: $('openaiModel').value,
      openaiUrl: $('openaiUrl').value,
      geminiKey: $('geminiKey').value,
      geminiModel: $('geminiModel').value,
      claudeKey: $('claudeKey').value,
      claudeModel: $('claudeModel').value,
      ollamaModel: ollamaModel.value,
      ollamaUrl: ollamaUrl.value,
      webllmModel: webllmModel.value,
      aiPrompt: aiPrompt.value,
      translationFontSize: $('fontSize').value,
      translationLineHeight: $('lineHeight').value,
      translationBold: $('translationBold').checked,
      translationShowBorder: $('translationShowBorder').checked,
      ttsEngine: $('ttsEngine').value,
      ttsBrowserVoiceURI: $('ttsBrowserVoiceURI').value,
      ttsBrowserRate: $('ttsBrowserRate').value,
      ttsBrowserPitch: $('ttsBrowserPitch').value,
      ttsOpenaiVoice: $('ttsOpenaiVoice').value,
      ttsOpenaiSpeed: $('ttsOpenaiSpeed').value,
      siteRules: { mode: $('siteMode').value, sites: current.siteRules.sites },
      siteEngines: current.siteEngines
    };
    await chrome.storage.sync.set(newSettings);
  }

  function renderSiteList(sites) {
    const container = $('siteList');
    container.innerHTML = '';
    sites.forEach(site => {
      const tag = document.createElement('span');
      tag.className = 'tag badge badge-outline gap-1 py-3 px-2.5';
      tag.innerHTML = `${site} <button class="tag-remove btn btn-ghost btn-xs h-4 min-h-0 px-0.5 text-base-content/40 hover:text-error" data-site="${site}">&times;</button>`;
      container.appendChild(tag);
    });
    container.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = await chrome.storage.sync.get({ siteRules: DEFAULT_SETTINGS.siteRules });
        s.siteRules.sites = s.siteRules.sites.filter(x => x !== btn.dataset.site);
        await chrome.storage.sync.set({ siteRules: s.siteRules });
        renderSiteList(s.siteRules.sites);
      });
    });
  }

  function renderSiteEngines(engines) {
    const container = $('siteEngineList');
    container.innerHTML = '';
    Object.entries(engines).forEach(([host, eng]) => {
      const item = document.createElement('div');
      item.className = 'site-engine-item flex items-center justify-between px-3 py-2 bg-base-200 rounded-lg text-sm';
      item.innerHTML = `
        <span class="site-host font-medium text-base-content">${host}</span>
        <span class="site-eng text-xs text-primary font-semibold">${ENGINE_NAMES[eng] || eng}</span>
        <button class="tag-remove btn btn-ghost btn-xs text-base-content/40 hover:text-error" data-host="${host}">&times;</button>`;
      container.appendChild(item);
    });
    container.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const s = await chrome.storage.sync.get({ siteEngines: {} });
        delete s.siteEngines[btn.dataset.host];
        await chrome.storage.sync.set({ siteEngines: s.siteEngines });
        renderSiteEngines(s.siteEngines);
      });
    });
  }

  const debouncedSave = debounce(saveAll, 300);

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
});
