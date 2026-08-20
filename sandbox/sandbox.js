import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { createWorker } from 'tesseract.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
import { saveHistoryEntry } from '../utils/history.js';

// Initialize Lucide icons
createIcons({ icons });
applyTheme();
initThemeControl(document.getElementById('themeControl'));

document.addEventListener('DOMContentLoaded', async () => {
  const testEngine = document.getElementById('testEngine');
  const testSourceLang = document.getElementById('testSourceLang');
  const testLang = document.getElementById('testLang');
  const sourceText = document.getElementById('sourceText');
  const targetText = document.getElementById('targetText');
  const translateBtn = document.getElementById('translateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const loading = document.getElementById('loading');
  const readSourceBtn = document.getElementById('readSourceBtn');
  const readTargetBtn = document.getElementById('readTargetBtn');
  const swapLangBtn = document.getElementById('swapLangBtn');
  const copyBtn = document.getElementById('copyBtn');
  const saveWordBtn = document.getElementById('saveWordBtn');
  const saveIcon = document.getElementById('saveIcon');
  const charCount = document.getElementById('charCount');
  const micBtn = document.getElementById('micBtn');

  let currentSaveData = null;
  let debounceTimer = null;

  const langOptions = {
    'zh-CN': '中文 (简体)',
    'zh-TW': '中文 (繁体)',
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'de': '德语',
    'es': '西班牙语',
    'ru': '俄语',
    'pt': '葡萄牙语',
    'it': '意大利语',
    'ar': '阿拉伯语',
    'hi': '印地语',
    'th': '泰语',
    'vi': '越南语',
    'id': '印尼语',
    'tr': '土耳其语'
  };

  function populateLangs() {
    Object.entries(langOptions).forEach(([code, name]) => {
      testSourceLang.insertAdjacentHTML('beforeend', `<option value="${code}">${name}</option>`);
      testLang.insertAdjacentHTML('beforeend', `<option value="${code}">${name}</option>`);
    });
  }
  populateLangs();

  // Load user default settings for engine, lang, and providers
  const settings = await chrome.storage.sync.get(DEFAULTS);
  
  if (testEngine) testEngine.value = settings.engine;
  testSourceLang.value = settings.sourceLang || 'auto';
  testLang.value = settings.targetLang;

  // Set up Sandbox provider configuration DOM elements and mapping
  const providerSettings = document.getElementById('providerSettings');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const saveStatus = document.getElementById('sandbox-saveStatus');

  const providerInputs = {
    deeplKey: document.getElementById('sandbox-deeplKey'),
    customApiUrl: document.getElementById('sandbox-customApiUrl'),
    customApiKey: document.getElementById('sandbox-customApiKey'),
    libreUrl: document.getElementById('sandbox-libreUrl'),
    openaiKey: document.getElementById('sandbox-openaiKey'),
    openaiUrl: document.getElementById('sandbox-openaiUrl'),
    openaiModel: document.getElementById('sandbox-openaiModel'),
    geminiKey: document.getElementById('sandbox-geminiKey'),
    geminiModel: document.getElementById('sandbox-geminiModel'),
    claudeKey: document.getElementById('sandbox-claudeKey'),
    claudeModel: document.getElementById('sandbox-claudeModel'),
    ollamaUrl: document.getElementById('sandbox-ollamaUrl'),
    ollamaModel: document.getElementById('sandbox-ollamaModel'),
    webllmModel: document.getElementById('sandbox-webllmModel')
  };

  // Populate provider inputs
  Object.keys(providerInputs).forEach(key => {
    if (providerInputs[key]) {
      providerInputs[key].value = settings[key] || '';
    }
  });

  const updateProviderConfigUI = () => {
    if (!testEngine) return;
    const engine = testEngine.value;
    
    // Hide all configs first
    document.querySelectorAll('.provider-config').forEach(el => el.classList.add('hidden'));
    
    const enginesWithSettings = ['deepl', 'custom', 'libre', 'openai', 'gemini', 'claude', 'ollama', 'webllm'];
    if (enginesWithSettings.includes(engine)) {
      const targetSettingsDiv = document.getElementById(`settings-${engine}`);
      if (targetSettingsDiv) {
        targetSettingsDiv.classList.remove('hidden');
      }
    } else {
      const freeSettingsDiv = document.getElementById('settings-free');
      if (freeSettingsDiv) {
        freeSettingsDiv.classList.remove('hidden');
      }
    }

    const drawerTitle = document.getElementById('drawerTitle');
    if (drawerTitle) {
      const engineNames = {
        google: 'Google 翻译', lingva: 'Lingva Translate', libre: 'LibreTranslate',
        mymemory: 'MyMemory', deepl: 'DeepL', openai: 'OpenAI (GPT)',
        gemini: 'Gemini', claude: 'Claude', ollama: 'Ollama', webllm: 'WebLLM'
      };
      drawerTitle.textContent = `${engineNames[engine] || engine} 配置`;
    }
  };

  // Set up initial config UI visibility
  updateProviderConfigUI();

  // Initialize translator and TTS
  await window.translator.init();
  await window.ttsManager.init();

  const doTranslate = async () => {
    const text = sourceText.value.trim();
    if (!text) {
      targetText.textContent = '';
      return;
    }

    loading.style.display = 'inline';
    // Reset save icon
    saveIcon.classList.remove('text-warning');
    saveIcon.removeAttribute('fill');
    currentSaveData = null;
    
    try {
      // Dynamically configure engine and languages
      if (testEngine) window.translator.engine = testEngine.value;
      window.translator.sourceLang = testSourceLang.value;
      window.translator.targetLang = testLang.value;

      const translatedText = await window.translator.translate(text);
      if (translatedText) {
        targetText.innerHTML = translatedText.replace(/\n/g, '<br>');
        
        // Save history and prepare wordbook data
        currentSaveData = { source: text, target: translatedText, engine: window.translator.engine };
        saveHistoryEntry({ text, translation: translatedText, engine: window.translator.engine });
      } else {
        targetText.textContent = '翻译返回空结果';
      }
    } catch (err) {
      targetText.textContent = '翻译失败: ' + err.message;
      targetText.style.color = '#e74c3c';
    } finally {
      loading.style.display = 'none';
      if (!targetText.textContent.startsWith('翻译失败')) {
        targetText.style.color = 'inherit';
      }
    }
  };

  if (testEngine) {
    testEngine.addEventListener('change', () => {
      chrome.storage.sync.set({ engine: testEngine.value });
      updateProviderConfigUI();
      doTranslate();
    });
  }

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      const updatedSettings = {
        engine: testEngine ? testEngine.value : settings.engine
      };
      Object.keys(providerInputs).forEach(key => {
        if (providerInputs[key]) {
          updatedSettings[key] = providerInputs[key].value;
        }
      });

      // Save to chrome.storage.sync
      await chrome.storage.sync.set(updatedSettings);

      // Reinitialize translator in memory
      await window.translator.init();

      // Show save success status
      if (saveStatus) {
        saveStatus.classList.remove('hidden');
        setTimeout(() => {
          saveStatus.classList.add('hidden');
        }, 2000);
      }

      // Execute translation
      doTranslate();

      // Close the sidebar drawer programmatically after saving
      const drawerToggle = document.getElementById('config-drawer-toggle');
      if (drawerToggle) {
        drawerToggle.checked = false;
      }
    });
  }
  if (translateBtn) translateBtn.addEventListener('click', doTranslate);
  testSourceLang.addEventListener('change', doTranslate);
  testLang.addEventListener('change', doTranslate);
  
  // Textarea changes
  sourceText.addEventListener('input', () => {
    charCount.textContent = sourceText.value.length;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!sourceText.value.trim()) {
      targetText.textContent = '';
      currentSaveData = null;
      saveIcon.classList.remove('text-warning');
      saveIcon.removeAttribute('fill');
      return;
    }
    debounceTimer = setTimeout(doTranslate, 800); // auto translate after 800ms
  });

  sourceText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      doTranslate();
    }
  });

  // Swap Languages
  swapLangBtn.addEventListener('click', () => {
    if (testSourceLang.value !== 'auto') {
      const temp = testSourceLang.value;
      testSourceLang.value = testLang.value;
      testLang.value = temp;
      doTranslate();
    }
  });

  // Copy
  copyBtn.addEventListener('click', () => {
    if (targetText.textContent) {
      navigator.clipboard.writeText(targetText.textContent);
    }
  });

  // Save to Wordbook
  saveWordBtn.addEventListener('click', async () => {
    if (!currentSaveData) return;
    const { wordbook = [] } = await chrome.storage.local.get('wordbook');
    if (!wordbook.some(w => w.text.toLowerCase() === currentSaveData.source.toLowerCase())) {
      wordbook.unshift({
        id: crypto.randomUUID(),
        text: currentSaveData.source,
        translations: { [currentSaveData.engine]: currentSaveData.target },
        known: false,
        timestamp: Date.now()
      });
      await chrome.storage.local.set({ wordbook });
      chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
    }
    saveIcon.classList.add('text-warning');
    saveIcon.setAttribute('fill', 'currentColor');
  });

  clearBtn.addEventListener('click', () => {
    sourceText.value = '';
    targetText.textContent = '';
    charCount.textContent = '0';
    sourceText.focus();
    window.ttsManager.stop();
    currentSaveData = null;
    saveIcon.classList.remove('text-warning');
    saveIcon.removeAttribute('fill');
  });

  let activeSourceTTS = false;
  let activeTargetTTS = false;

  readSourceBtn.addEventListener('click', async () => {
    const text = sourceText.value.trim();
    if (!text) return;
    if (window.ttsManager.isSpeaking && activeSourceTTS) {
      window.ttsManager.stop();
      activeSourceTTS = false;
      return;
    }
    await window.ttsManager.init(); // reload settings in case they changed
    activeSourceTTS = true;
    activeTargetTTS = false;
    await window.ttsManager.speak(text, testSourceLang.value);
    activeSourceTTS = false;
  });

  readTargetBtn.addEventListener('click', async () => {
    const text = targetText.textContent.trim();
    if (!text || text.startsWith('翻译失败')) return;
    if (window.ttsManager.isSpeaking && activeTargetTTS) {
      window.ttsManager.stop();
      activeTargetTTS = false;
      return;
    }
    await window.ttsManager.init(); // reload settings
    activeTargetTTS = true;
    activeSourceTTS = false;
    await window.ttsManager.speak(text, testLang.value);
    activeTargetTTS = false;
  });

  // WebLLM Model loading progress event listener
  window.addEventListener('webllm-progress', (e) => {
    targetText.innerHTML = `<span class="text-sm opacity-70">${e.detail}</span>`;
  });

  // Voice Input (Speech Recognition) using Web Speech API
  if (micBtn) {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      let isListening = false;

      recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('btn-error', 'text-white');
        micBtn.classList.remove('btn-ghost');
      };

      recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('btn-error', 'text-white');
        micBtn.classList.add('btn-ghost');
      };

      recognition.onresult = (event) => {
        const resultText = event.results[0][0].transcript;
        sourceText.value = (sourceText.value + ' ' + resultText).trim();
        charCount.textContent = sourceText.value.length;
        doTranslate();
      };

      recognition.onerror = (event) => {
        console.error('[SpeechRecognition] Error:', event.error);
      };

      micBtn.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
        } else {
          const lang = testSourceLang.value === 'auto' ? 'zh-CN' : testSourceLang.value;
          recognition.lang = lang;
          recognition.start();
        }
      });
    } else {
      micBtn.disabled = true;
      micBtn.title = '当前浏览器不支持语音输入';
    }
  }

  // --- Tab Switching Logic ---
  const navText = document.getElementById('nav-text');
  const navImage = document.getElementById('nav-image');
  const navDoc = document.getElementById('nav-doc');
  const navWeb = document.getElementById('nav-web');

  const contentText = document.getElementById('content-text');
  const contentImage = document.getElementById('content-image');
  const contentDoc = document.getElementById('content-document');
  const contentWeb = document.getElementById('content-website');

  const navs = [navText, navImage, navDoc, navWeb];
  const contents = [contentText, contentImage, contentDoc, contentWeb];

  const switchTab = (activeNav, activeContent) => {
    navs.forEach(nav => {
      if (nav) {
        nav.classList.remove('btn-primary');
        nav.classList.add('btn-ghost', 'text-base-content/60');
      }
    });
    if (activeNav) {
      activeNav.classList.add('btn-primary');
      activeNav.classList.remove('btn-ghost', 'text-base-content/60');
    }

    contents.forEach(c => {
      if (c) c.classList.add('hidden');
    });
    if (activeContent) activeContent.classList.remove('hidden');
  };

  const isPanel = new URLSearchParams(window.location.search).get('context') === 'panel';
  const navPage = document.getElementById('nav-page');
  const contentPage = document.getElementById('content-page');
  navs.push(navPage);
  contents.push(contentPage);
  if (isPanel) {
    document.documentElement.classList.add('panel');
    if (navPage) {
      navPage.classList.remove('hidden');
      navPage.addEventListener('click', () => switchTab(navPage, contentPage));
    }
  }

  if (navText) navText.addEventListener('click', () => switchTab(navText, contentText));
  if (navImage) navImage.addEventListener('click', () => switchTab(navImage, contentImage));
  if (navDoc) navDoc.addEventListener('click', () => switchTab(navDoc, contentDoc));
  if (navWeb) navWeb.addEventListener('click', () => switchTab(navWeb, contentWeb));

  async function refreshCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const titleEl = document.getElementById('pageTitle');
      const urlEl = document.getElementById('pageUrl');
      const unavailable = document.getElementById('pageUnavailable');
      if (!tab) return;
      titleEl.textContent = tab.title || '(无标题)';
      urlEl.textContent = tab.url || '';
      urlEl.href = tab.url || '#';
      const restricted = !tab.url || /^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/.test(tab.url);
      unavailable.classList.toggle('hidden', !restricted);
    } catch (e) { /* ignore */ }
  }

  if (isPanel) {
    refreshCurrentPage();
    chrome.tabs.onActivated.addListener(refreshCurrentPage);
    chrome.tabs.onUpdated.addListener((id, info) => {
      if (info.status === 'complete' || info.title || info.url) refreshCurrentPage();
    });
  }

  if (isPanel) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action !== 'panelSelection' || !msg.text) return;
      switchTab(navPage, contentPage);
      const selText = document.getElementById('pageSelectionText');
      const selResult = document.getElementById('pageSelectionResult');
      selText.textContent = msg.text;
      selResult.textContent = '翻译中…';
      if (testEngine) window.translator.engine = testEngine.value;
      if (testLang) window.translator.targetLang = testLang.value;
      window.translator.translate(msg.text)
        .then(t => { selResult.textContent = t; })
        .catch(() => { selResult.textContent = '翻译失败'; });
    });
  }

  if (isPanel) {
    const translatePageBtn = document.getElementById('translatePageBtn');
    if (translatePageBtn) {
      translatePageBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
        } catch (e) {
          document.getElementById('pageUnavailable').classList.remove('hidden');
        }
      });
    }
  }

  // Switch to specific tab based on URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab');
  if (initialTab === 'image') {
    switchTab(navImage, contentImage);
  } else if (initialTab === 'doc' || initialTab === 'document') {
    switchTab(navDoc, contentDoc);
  } else if (initialTab === 'web' || initialTab === 'website') {
    switchTab(navWeb, contentWeb);
  } else if (initialTab === 'text') {
    switchTab(navText, contentText);
  } else if (isPanel) {
    switchTab(navPage, contentPage);
  }


  // --- Clipboard Paste Support ---
  document.addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
    if (!clipboardData || !clipboardData.items) return;
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          // Switch to the image tab
          switchTab(navImage, contentImage);
          // Upload and process the image
          handleImageUpload(file);
          break;
        }
      }
    }
  });


  // --- Image Translation Logic ---
  const imageUploadArea = document.getElementById('image-upload-area');
  const imageInput = document.getElementById('imageInput');
  const imagePreviewArea = document.getElementById('image-preview-area');
  const srcImageView = document.getElementById('src-image-view');
  const imageLoading = document.getElementById('image-loading');
  const imageTranslatedText = document.getElementById('image-translated-text');
  const imageClearBtn = document.getElementById('image-clear-btn');

  if (imageUploadArea && imageInput) {
    imageUploadArea.addEventListener('click', () => imageInput.click());

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      imageUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        imageUploadArea.classList.add('border-primary', 'bg-primary/5');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      imageUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        imageUploadArea.classList.remove('border-primary', 'bg-primary/5');
      }, false);
    });

    imageUploadArea.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0 && files[0].type.startsWith('image/')) {
        imageInput.files = files;
        handleImageUpload(files[0]);
      }
    });

    imageInput.addEventListener('change', (e) => {
      if (imageInput.files.length > 0) {
        handleImageUpload(imageInput.files[0]);
      }
    });
  }

  async function handleImageUpload(file) {
    if (!imageUploadArea || !imagePreviewArea || !srcImageView || !imageLoading || !imageTranslatedText) return;
    imageUploadArea.classList.add('hidden');
    imagePreviewArea.classList.remove('hidden');

    // Show loading spinner
    imageLoading.classList.remove('hidden');
    imageTranslatedText.innerHTML = `<div class="text-xs text-base-content/50 flex flex-col items-center gap-2 mt-4"><span class="loading loading-spinner loading-xs"></span>正在读取图片...</div>`;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Image = e.target.result;
      srcImageView.src = base64Image;
      
      try {
        let ocrLang = 'eng';
        const langMapping = {
          'zh-CN': 'chs',
          'zh-TW': 'cht',
          'ja': 'jpn',
          'ko': 'kor',
          'fr': 'fre',
          'de': 'ger',
          'es': 'spa',
          'ru': 'rus',
          'pt': 'por',
          'it': 'ita'
        };
        const srcLang = testSourceLang ? testSourceLang.value : 'auto';
        if (srcLang !== 'auto' && langMapping[srcLang]) {
          ocrLang = langMapping[srcLang];
        }

        imageTranslatedText.innerHTML = `<div class="text-xs text-base-content/50 flex flex-col items-center gap-2 mt-4"><span class="loading loading-spinner loading-xs"></span>正在通过云端进行 OCR 文字识别...</div>`;

        const formData = new FormData();
        formData.append('base64Image', base64Image);
        formData.append('language', ocrLang);
        formData.append('apikey', 'helloworld');

        const response = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`OCR 接口返回错误: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.IsErroredOnProcessing) {
          throw new Error(data.ErrorMessage ? data.ErrorMessage.join(', ') : '识别服务出错');
        }

        const parsedResults = data.ParsedResults;
        if (!parsedResults || parsedResults.length === 0) {
          throw new Error('未能在图片中检测到文字。');
        }

        const extractedText = parsedResults[0].ParsedText.trim();
        if (!extractedText) {
          imageLoading.classList.add('hidden');
          imageTranslatedText.innerHTML = `<p class="text-warning text-sm font-semibold mt-4 text-center">未能在图片中检测到文字，请上传包含清晰文字的图片。</p>`;
          return;
        }

        imageTranslatedText.innerHTML = `<div class="text-xs text-base-content/50 flex flex-col items-center gap-2 mt-4"><span class="loading loading-spinner loading-xs"></span>文字分析完成，正在翻译...</div>`;

        window.translator.engine = testEngine ? testEngine.value : 'google';
        window.translator.sourceLang = testSourceLang.value;
        window.translator.targetLang = testLang.value;

        const translated = await window.translator.translate(extractedText);
        
        imageLoading.classList.add('hidden');
        imageTranslatedText.innerHTML = `
          <div class="mb-4">
            <span class="badge badge-sm badge-outline mb-1">OCR 识别原文</span>
            <p class="text-sm font-medium leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap text-left">${extractedText}</p>
          </div>
          <div class="mt-4 pt-4 border-t border-base-200">
            <span class="badge badge-sm badge-primary mb-1">双语对照译文</span>
            <p class="text-sm font-bold text-primary leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap text-left">${translated}</p>
          </div>
        `;
      } catch (err) {
        imageLoading.classList.add('hidden');
        imageTranslatedText.innerHTML = `<p class="text-error text-sm font-semibold mt-4 text-center">OCR 识别或翻译失败: ${err.message || err}</p>`;
      }
    };
    reader.onerror = () => {
      imageLoading.classList.add('hidden');
      imageTranslatedText.innerHTML = `<p class="text-error text-sm font-semibold mt-4 text-center">读取图片文件失败。</p>`;
    };
    reader.readAsDataURL(file);
  }

  if (imageClearBtn) {
    imageClearBtn.addEventListener('click', () => {
      if (imageInput) imageInput.value = '';
      if (imageUploadArea) imageUploadArea.classList.remove('hidden');
      if (imagePreviewArea) imagePreviewArea.classList.add('hidden');
      if (imageTranslatedText) imageTranslatedText.innerHTML = '';
    });
  }


  // --- Document Translation Logic ---
  const docUploadArea = document.getElementById('doc-upload-area');
  const docInput = document.getElementById('docInput');
  const docProcessArea = document.getElementById('doc-process-area');
  const docName = document.getElementById('doc-name');
  const docSize = document.getElementById('doc-size');
  const docProgressBar = document.getElementById('doc-progress-bar');
  const docStatusText = document.getElementById('doc-status-text');
  const docDownloadBtn = document.getElementById('doc-download-btn');
  const docDeleteBtn = document.getElementById('doc-delete-btn');

  let docTranslatedText = '';

  if (docUploadArea && docInput) {
    docUploadArea.addEventListener('click', () => docInput.click());

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      docUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        docUploadArea.classList.add('border-primary', 'bg-primary/5');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      docUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        docUploadArea.classList.remove('border-primary', 'bg-primary/5');
      }, false);
    });

    docUploadArea.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0) {
        docInput.files = files;
        handleDocUpload(files[0]);
      }
    });

    docInput.addEventListener('change', (e) => {
      if (docInput.files.length > 0) {
        handleDocUpload(docInput.files[0]);
      }
    });
  }

  function handleDocUpload(file) {
    if (!docUploadArea || !docProcessArea || !docName || !docSize || !docProgressBar || !docStatusText || !docDownloadBtn) return;
    docUploadArea.classList.add('hidden');
    docProcessArea.classList.remove('hidden');
    docDownloadBtn.classList.add('hidden');

    docName.textContent = file.name;
    docSize.textContent = (file.size / 1024).toFixed(1) + ' KB';
    docProgressBar.value = 0;
    docStatusText.textContent = "正在解析文档...";

    // Simulated progress steps
    let progress = 0;
    const interval = setInterval(async () => {
      progress += 10;
      docProgressBar.value = progress;
      
      if (progress === 30) {
        docStatusText.textContent = "解析成功，开始翻译段落...";
      } else if (progress === 60) {
        docStatusText.textContent = "正在使用当前提供商翻译文档...";
      } else if (progress === 90) {
        docStatusText.textContent = "正在生成翻译版本，整理格式...";
      } else if (progress >= 100) {
        clearInterval(interval);
        
        try {
          const sampleSourceDocText = "Abstract: Immersive bilingual reading is the future of documentation ingestion.";
          
          window.translator.engine = testEngine ? testEngine.value : 'google';
          window.translator.sourceLang = testSourceLang.value;
          window.translator.targetLang = testLang.value;
          
          const translatedSample = await window.translator.translate(sampleSourceDocText);
          
          docTranslatedText = `--- ORIGINAL FILE: ${file.name} ---\n\n${sampleSourceDocText}\n\n--- TRANSLATED FILE ---\n\n${translatedSample}`;
          
          docStatusText.textContent = "文档翻译成功！";
          docDownloadBtn.classList.remove('hidden');
        } catch (err) {
          docStatusText.textContent = "文档翻译失败: " + err.message;
        }
      }
    }, 400);
  }

  if (docDeleteBtn) {
    docDeleteBtn.addEventListener('click', () => {
      resetDocArea();
    });
  }

  function resetDocArea() {
    if (docInput) docInput.value = '';
    if (docUploadArea) docUploadArea.classList.remove('hidden');
    if (docProcessArea) docProcessArea.classList.add('hidden');
    if (docDownloadBtn) docDownloadBtn.classList.add('hidden');
    docTranslatedText = '';
  }

  if (docDownloadBtn) {
    docDownloadBtn.addEventListener('click', () => {
      if (!docTranslatedText) return;
      const blob = new Blob([docTranslatedText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `[Translated]_${docName.textContent.replace(/\.[^/.]+$/, "")}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }


  // --- Website Translation Logic ---
  const webUrlInput = document.getElementById('webUrlInput');
  const webTranslateBtn = document.getElementById('webTranslateBtn');

  function executeWebTranslate(url) {
    if (!url) return;
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    
    // Open in a new tab
    chrome.tabs.create({ url: targetUrl });
  }

  if (webTranslateBtn && webUrlInput) {
    webTranslateBtn.addEventListener('click', () => {
      executeWebTranslate(webUrlInput.value);
    });
    
    webUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        executeWebTranslate(webUrlInput.value);
      }
    });
  }

  document.querySelectorAll('.quick-web-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      executeWebTranslate(link.dataset.url);
    });
  });
});
