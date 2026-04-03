/**
 * Options page - Super Immersive Translate
 */

const DEFAULT_SETTINGS = {
  engine: 'google',
  targetLang: 'zh-CN',
  displayMode: 'bilingual',
  translationColor: '#9b59b6',
  hoverTranslate: false,
  inputTranslate: false,
  selectionMode: 'icon',
  selectionEngines: ['google', 'lingva', 'libre'],
  deeplKey: '',
  customApiUrl: '',
  customApiKey: '',
  libreUrl: 'https://libretranslate.com',
  translationFontSize: '0.92',
  translationLineHeight: '1.6',
  translationBold: false,
  translationShowBorder: true,
  siteRules: { mode: 'blacklist', sites: [] },
  siteEngines: {}
};

const ENGINE_NAMES = {
  google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
  libre: 'Libre', deepl: 'DeepL', custom: '自定义'
};

document.addEventListener('DOMContentLoaded', async () => {
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
  $('hoverTranslate').checked = settings.hoverTranslate;
  $('inputTranslate').checked = settings.inputTranslate;
  $('selectionMode').value = settings.selectionMode;
  $('deeplKey').value = settings.deeplKey;
  $('customApiUrl').value = settings.customApiUrl;
  $('customApiKey').value = settings.customApiKey;
  $('libreUrl').value = settings.libreUrl;

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
  updatePreview(settings);

  // Sites
  $('siteMode').value = settings.siteRules.mode;
  renderSiteList(settings.siteRules.sites);
  renderSiteEngines(settings.siteEngines);

  // ── Shortcuts ───────────────────────────
  try {
    const commands = await chrome.commands.getAll();
    const container = $('shortcutList');
    commands.forEach(cmd => {
      if (!cmd.description) return;
      const item = document.createElement('div');
      item.className = 'shortcut-item';
      item.innerHTML = `
        <span class="shortcut-desc">${cmd.description}</span>
        <span class="shortcut-key">${cmd.shortcut || '未设置'}</span>`;
      container.appendChild(item);
    });
  } catch (e) { /* ignore */ }

  $('openShortcutsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ── Auto-save listeners ─────────────────

  const saveFields = [
    'engine', 'targetLang', 'displayMode', 'selectionMode',
    'hoverTranslate', 'inputTranslate',
    'translationBold', 'translationShowBorder', 'siteMode'
  ];
  saveFields.forEach(id => {
    const el = $(id);
    el.addEventListener('change', saveAll);
  });

  ['deeplKey', 'customApiUrl', 'customApiKey', 'libreUrl'].forEach(id => {
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
      translationColor: getActiveColor(),
      hoverTranslate: $('hoverTranslate').checked,
      inputTranslate: $('inputTranslate').checked,
      selectionMode: $('selectionMode').value,
      selectionEngines: selEngines.length > 0 ? selEngines : ['google'],
      deeplKey: $('deeplKey').value,
      customApiUrl: $('customApiUrl').value,
      customApiKey: $('customApiKey').value,
      libreUrl: $('libreUrl').value,
      translationFontSize: $('fontSize').value,
      translationLineHeight: $('lineHeight').value,
      translationBold: $('translationBold').checked,
      translationShowBorder: $('translationShowBorder').checked,
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
      tag.className = 'tag';
      tag.innerHTML = `${site} <button class="tag-remove" data-site="${site}">&times;</button>`;
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
      item.className = 'site-engine-item';
      item.innerHTML = `
        <span class="site-host">${host}</span>
        <span class="site-eng">${ENGINE_NAMES[eng] || eng}</span>
        <button class="tag-remove" data-host="${host}">&times;</button>`;
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
