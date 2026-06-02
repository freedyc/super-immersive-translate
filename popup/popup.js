import { createIcons, icons } from 'lucide';
import { applyTheme, initThemeControl } from '../utils/theme.js';

/**
 * Popup script - Super Immersive Translate
 */
document.addEventListener('DOMContentLoaded', async () => {
  createIcons({ icons });
  await applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  const toggleBtn = document.getElementById('toggleBtn');
  const statusText = document.getElementById('statusText');
  const engineSelect = document.getElementById('engine');
  const targetLangSelect = document.getElementById('targetLang');
  const displayModeSelect = document.getElementById('displayMode');
  const selectionModeSelect = document.getElementById('selectionMode');
  const selectionEnginesGroup = document.getElementById('selectionEngines');
  const colorPicker = document.getElementById('colorPicker');
  const hoverTranslateCheckbox = document.getElementById('hoverTranslate');
  const inputTranslateCheckbox = document.getElementById('inputTranslate');
  const deeplKeyInput = document.getElementById('deeplKey');
  const customApiUrlInput = document.getElementById('customApiUrl');
  const customApiKeyInput = document.getElementById('customApiKey');
  const libreUrlInput = document.getElementById('libreUrl');
  const openaiKeyInput = document.getElementById('openaiKey');
  const geminiKeyInput = document.getElementById('geminiKey');
  const claudeKeyInput = document.getElementById('claudeKey');
  const deeplSettings = document.querySelector('.deepl-settings');
  const customSettings = document.querySelector('.custom-settings');
  const libreSettings = document.querySelector('.libre-settings');
  const openaiSettings = document.querySelector('.openai-settings');
  const geminiSettings = document.querySelector('.gemini-settings');
  const claudeSettings = document.querySelector('.claude-settings');
  const ollamaSettings = document.querySelector('.ollama-settings');
  const webllmSettings = document.querySelector('.webllm-settings');
  const engineSettingsContainer = document.getElementById('engineSettingsContainer');

  // Load settings
  const settings = await chrome.storage.sync.get({
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
    openaiKey: '',
    geminiKey: '',
    claudeKey: ''
  });

  engineSelect.value = settings.engine;
  targetLangSelect.value = settings.targetLang;
  displayModeSelect.value = settings.displayMode;
  selectionModeSelect.value = settings.selectionMode;
  hoverTranslateCheckbox.checked = settings.hoverTranslate;
  inputTranslateCheckbox.checked = settings.inputTranslate;

  // Restore color selection
  setActiveColor(settings.translationColor);
  deeplKeyInput.value = settings.deeplKey;
  customApiUrlInput.value = settings.customApiUrl;
  customApiKeyInput.value = settings.customApiKey;
  libreUrlInput.value = settings.libreUrl;
  openaiKeyInput.value = settings.openaiKey;
  geminiKeyInput.value = settings.geminiKey;
  claudeKeyInput.value = settings.claudeKey;

  // Restore selection engine checkboxes
  selectionEnginesGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = settings.selectionEngines.includes(cb.value);
  });

  updateEngineUI(settings.engine);

  // Get current tab status
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
      if (resp) {
        if (resp.blocked) {
          toggleBtn.checked = false;
          toggleBtn.disabled = true;
          statusText.textContent = '站点已屏蔽';
        } else {
          toggleBtn.checked = resp.enabled;
          statusText.textContent = resp.enabled ? '翻译中' : '已关闭';
        }
      }
    }
  } catch (e) { /* content script not ready */ }

  // Toggle
  toggleBtn.addEventListener('change', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
        statusText.textContent = resp.enabled ? '翻译中' : '已关闭';
      } catch (e) {
        statusText.textContent = '页面未就绪';
        toggleBtn.checked = false;
      }
    }
  });

  // Engine change
  engineSelect.addEventListener('change', () => {
    updateEngineUI(engineSelect.value);
    saveSettings();
  });

  // Color picker
  colorPicker.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    setActiveColor(dot.dataset.color);
    saveSettings();
  });

  function setActiveColor(color) {
    colorPicker.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
  }

  // Mode Grid Navigation
  const openTabInSandbox = (tabName) => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`sandbox/index.html?tab=${tabName}`) });
  };

  document.getElementById('navSandboxBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openTabInSandbox('text');
  });

  document.getElementById('navImageBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openTabInSandbox('image');
  });

  document.getElementById('navDocBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openTabInSandbox('doc');
  });

  document.getElementById('navWebBtn').addEventListener('click', (e) => {
    e.preventDefault();
    openTabInSandbox('web');
  });

  // All other changes
  targetLangSelect.addEventListener('change', saveSettings);
  displayModeSelect.addEventListener('change', saveSettings);
  hoverTranslateCheckbox.addEventListener('change', saveSettings);
  inputTranslateCheckbox.addEventListener('change', saveSettings);
  selectionModeSelect.addEventListener('change', saveSettings);
  selectionEnginesGroup.addEventListener('change', saveSettings);
  deeplKeyInput.addEventListener('input', debounce(saveSettings, 500));
  customApiUrlInput.addEventListener('input', debounce(saveSettings, 500));
  customApiKeyInput.addEventListener('input', debounce(saveSettings, 500));
  libreUrlInput.addEventListener('input', debounce(saveSettings, 500));
  openaiKeyInput.addEventListener('input', debounce(saveSettings, 500));
  geminiKeyInput.addEventListener('input', debounce(saveSettings, 500));
  claudeKeyInput.addEventListener('input', debounce(saveSettings, 500));

  function updateEngineUI(engine) {
    const hasSettings = ['deepl', 'custom', 'libre', 'openai', 'gemini', 'claude', 'ollama', 'webllm'].includes(engine);
    if (engineSettingsContainer) {
      engineSettingsContainer.classList.toggle('hidden', !hasSettings);
    }
    deeplSettings.style.display = engine === 'deepl' ? 'block' : 'none';
    customSettings.style.display = engine === 'custom' ? 'block' : 'none';
    libreSettings.style.display = engine === 'libre' ? 'block' : 'none';
    openaiSettings.style.display = engine === 'openai' ? 'block' : 'none';
    geminiSettings.style.display = engine === 'gemini' ? 'block' : 'none';
    claudeSettings.style.display = engine === 'claude' ? 'block' : 'none';
    if (ollamaSettings) ollamaSettings.style.display = engine === 'ollama' ? 'block' : 'none';
    if (webllmSettings) webllmSettings.style.display = engine === 'webllm' ? 'block' : 'none';
  }

  async function saveSettings() {
    const selEngines = [];
    selectionEnginesGroup.querySelectorAll('input:checked').forEach(cb => {
      selEngines.push(cb.value);
    });

    const activeColor = colorPicker.querySelector('.color-dot.active');
    const newSettings = {
      engine: engineSelect.value,
      targetLang: targetLangSelect.value,
      displayMode: displayModeSelect.value,
      translationColor: activeColor ? activeColor.dataset.color : '#9b59b6',
      hoverTranslate: hoverTranslateCheckbox.checked,
      inputTranslate: inputTranslateCheckbox.checked,
      selectionMode: selectionModeSelect.value,
      selectionEngines: selEngines.length > 0 ? selEngines : ['google'],
      deeplKey: deeplKeyInput.value,
      customApiUrl: customApiUrlInput.value,
      customApiKey: customApiKeyInput.value,
      libreUrl: libreUrlInput.value,
      openaiKey: openaiKeyInput.value,
      geminiKey: geminiKeyInput.value,
      claudeKey: claudeKeyInput.value
    };
    await chrome.storage.sync.set(newSettings);

    // Notify content script
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'updateSettings' }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Open pages
  document.getElementById('openWordbook').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('wordbook/index.html') });
  });

  document.getElementById('openHistory').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('history/index.html') });
  });

  document.getElementById('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });
});

