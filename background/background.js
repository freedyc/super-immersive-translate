/**
 * Background service worker - Super Immersive Translate
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-page',
    title: '⚡ 翻译此页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '⚡ 翻译选中文本',
    contexts: ['selection']
  });

  if (chrome.sidePanel) {
    chrome.contextMenus.create({
      id: 'open-side-panel',
      title: '⚡ 在侧边栏打开快捷翻译',
      contexts: ['page', 'selection']
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
  } else if (info.menuItemId === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { action: 'translateSelection', text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === 'open-side-panel') {
    if (!chrome.sidePanel) return;
    // sidePanel.open() must be called synchronously within the user gesture.
    // Awaiting setOptions first consumes the gesture and makes open() fail, so
    // fire setOptions without await and call open() in the same tick.
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sandbox/index.html?context=panel',
      enabled: true
    });
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-translate') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
  } else if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { action: 'translateSelection' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getSettings') {
    chrome.storage.sync.get({
      engine: 'google',
      targetLang: 'zh-CN',
      sourceLang: 'auto',
      selectionMode: 'icon',
      selectionEngines: ['google', 'lingva', 'libre'],
      deeplKey: '',
      customApiUrl: '',
      customApiKey: '',
      libreUrl: 'https://libretranslate.com'
    }).then(sendResponse);
    return true;
  }
});
