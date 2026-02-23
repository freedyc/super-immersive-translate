/**
 * Popup script - Super Immersive Translate
 */
document.addEventListener('DOMContentLoaded', async () => {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusText = document.getElementById('statusText');
  const engineSelect = document.getElementById('engine');
  const targetLangSelect = document.getElementById('targetLang');
  const selectionModeSelect = document.getElementById('selectionMode');
  const selectionEnginesGroup = document.getElementById('selectionEngines');
  const deeplKeyInput = document.getElementById('deeplKey');
  const customApiUrlInput = document.getElementById('customApiUrl');
  const customApiKeyInput = document.getElementById('customApiKey');
  const libreUrlInput = document.getElementById('libreUrl');
  const deeplSettings = document.querySelector('.deepl-settings');
  const customSettings = document.querySelector('.custom-settings');
  const libreSettings = document.querySelector('.libre-settings');

  // Load settings
  const settings = await chrome.storage.sync.get({
    engine: 'google',
    targetLang: 'zh-CN',
    selectionMode: 'icon',
    selectionEngines: ['google', 'lingva', 'libre'],
    deeplKey: '',
    customApiUrl: '',
    customApiKey: '',
    libreUrl: 'https://libretranslate.com'
  });

  engineSelect.value = settings.engine;
  targetLangSelect.value = settings.targetLang;
  selectionModeSelect.value = settings.selectionMode;
  deeplKeyInput.value = settings.deeplKey;
  customApiUrlInput.value = settings.customApiUrl;
  customApiKeyInput.value = settings.customApiKey;
  libreUrlInput.value = settings.libreUrl;

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
        toggleBtn.checked = resp.enabled;
        statusText.textContent = resp.enabled ? '翻译中' : '已关闭';
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

  // All other changes
  targetLangSelect.addEventListener('change', saveSettings);
  selectionModeSelect.addEventListener('change', saveSettings);
  selectionEnginesGroup.addEventListener('change', saveSettings);
  deeplKeyInput.addEventListener('input', debounce(saveSettings, 500));
  customApiUrlInput.addEventListener('input', debounce(saveSettings, 500));
  customApiKeyInput.addEventListener('input', debounce(saveSettings, 500));
  libreUrlInput.addEventListener('input', debounce(saveSettings, 500));

  function updateEngineUI(engine) {
    deeplSettings.style.display = engine === 'deepl' ? 'block' : 'none';
    customSettings.style.display = engine === 'custom' ? 'block' : 'none';
    libreSettings.style.display = engine === 'libre' ? 'block' : 'none';
  }

  async function saveSettings() {
    const selEngines = [];
    selectionEnginesGroup.querySelectorAll('input:checked').forEach(cb => {
      selEngines.push(cb.value);
    });

    const newSettings = {
      engine: engineSelect.value,
      targetLang: targetLangSelect.value,
      selectionMode: selectionModeSelect.value,
      selectionEngines: selEngines.length > 0 ? selEngines : ['google'],
      deeplKey: deeplKeyInput.value,
      customApiUrl: customApiUrlInput.value,
      customApiKey: customApiKeyInput.value,
      libreUrl: libreUrlInput.value
    };
    await chrome.storage.sync.set(newSettings);

    // Notify content script
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'updateSettings' });
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

  // Open wordbook
  document.getElementById('openWordbook').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('wordbook/index.html') });
  });
});
