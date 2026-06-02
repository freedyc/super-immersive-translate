/**
 * Translator engine wrapper
 * Free engines: Google, MyMemory, LibreTranslate, Lingva, Yandex(browser)
 * Paid engines: DeepL, Custom API
 */
export class Translator {
  constructor() {
    this.engine = 'google';
    this.targetLang = 'zh-CN';
    this.sourceLang = 'auto';
    this.cache = new Map();
    this.pendingQueue = [];
    this.flushTimer = null;
    this.BATCH_DELAY = 50;
    this.MAX_BATCH = 50;
  }

  static ENGINES = {
    google:   { name: 'Google 翻译', free: true },
    mymemory: { name: 'MyMemory', free: true },
    lingva:   { name: 'Lingva Translate', free: true },
    libre:    { name: 'LibreTranslate', free: true },
    deepl:    { name: 'DeepL', free: false },
    custom:   { name: '自定义 API', free: false },
    openai:   { name: 'OpenAI', free: false },
    gemini:   { name: 'Gemini', free: false },
    claude:   { name: 'Claude', free: false },
    ollama:   { name: 'Ollama', free: true },
    webllm:   { name: 'WebLLM (本地)', free: true }
  };

  async init() {
    const settings = await chrome.storage.sync.get({
      engine: 'google',
      targetLang: 'zh-CN',
      sourceLang: 'auto',
      deeplKey: '',
      customApiUrl: '',
      customApiKey: '',
      libreUrl: 'https://libretranslate.com',
      openaiKey: '',
      openaiModel: 'gpt-3.5-turbo',
      openaiUrl: 'https://api.openai.com/v1/chat/completions',
      geminiKey: '',
      geminiModel: 'gemini-1.5-flash',
      claudeKey: '',
      claudeModel: 'claude-3-haiku-20240307',
      ollamaModel: 'llama3',
      ollamaUrl: 'http://localhost:11434/api/chat',
      webllmModel: 'Llama-3-8B-Instruct-q4f32_1-MLC',
      aiPrompt: 'Translate the following text to {targetLang}. Keep the exact separators "\\n\\u2581\\u2581\\u2581\\n" unchanged. Only output the translated text.'
    });
    Object.assign(this, settings);
  }

  getCacheKey(text) {
    return `${this.engine}:${this.targetLang}:${text}`;
  }

  translate(text) {
    if (!text || !text.trim()) return Promise.resolve('');
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey)) return Promise.resolve(this.cache.get(cacheKey));

    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ text, resolve, reject });
      if (this.pendingQueue.length >= this.MAX_BATCH) {
        this._flushQueue();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this._flushQueue(), this.BATCH_DELAY);
      }
    });
  }

  async _flushQueue() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pendingQueue.length === 0) return;

    const batch = this.pendingQueue.splice(0, this.MAX_BATCH);
    const texts = batch.map(b => b.text);

    try {
      const results = await this._dispatchBatch(texts);
      batch.forEach((item, i) => {
        const translated = results[i] || '';
        this.cache.set(this.getCacheKey(item.text), translated);
        item.resolve(translated);
      });
    } catch (err) {
      console.warn('[Translator] Batch error:', err.message, '— falling back to Google');
      // Fallback: retry with Google if current engine fails
      if (this.engine !== 'google') {
        try {
          const results = await this._googleBatch(texts);
          batch.forEach((item, i) => {
            const translated = results[i] || '';
            this.cache.set(this.getCacheKey(item.text), translated);
            item.resolve(translated);
          });
          return;
        } catch (fallbackErr) {
          console.error('[Translator] Fallback also failed:', fallbackErr);
        }
      }
      batch.forEach(item => item.resolve(`[翻译失败: ${err.message}]`));
    }

    if (this.pendingQueue.length > 0) this._flushQueue();
  }

  // Route a batch of texts to the current engine's batch method.
  _dispatchBatch(texts) {
    switch (this.engine) {
      case 'google':   return this._googleBatch(texts);
      case 'mymemory': return this._mymemoryBatch(texts);
      case 'lingva':   return this._lingvaBatch(texts);
      case 'libre':    return this._libreBatch(texts);
      case 'deepl':    return this._deeplBatch(texts);
      case 'custom':   return this._customBatch(texts);
      case 'openai':   return this._openaiBatch(texts);
      case 'gemini':   return this._geminiBatch(texts);
      case 'claude':   return this._claudeBatch(texts);
      case 'ollama':   return this._ollamaBatch(texts);
      case 'webllm':   return this._webllmBatch(texts);
      default:         return this._googleBatch(texts);
    }
  }

  // Translate an explicit array of texts in one call (used by the full-page
  // concurrency pool). Reuses the cache, sends uncached texts as one batch via
  // the current engine, and falls back to Google on error. Result is aligned to
  // the input array.
  async translateBatch(texts) {
    const results = new Array(texts.length);
    const uncached = [];
    const uncachedIdx = [];

    texts.forEach((text, i) => {
      if (!text || !text.trim()) { results[i] = ''; return; }
      const key = this.getCacheKey(text);
      if (this.cache.has(key)) { results[i] = this.cache.get(key); return; }
      uncached.push(text);
      uncachedIdx.push(i);
    });

    if (uncached.length === 0) return results;

    let out;
    try {
      out = await this._dispatchBatch(uncached);
    } catch (err) {
      console.warn('[Translator] translateBatch error:', err.message, '— falling back to Google');
      if (this.engine !== 'google') {
        try {
          out = await this._googleBatch(uncached);
        } catch (fallbackErr) {
          out = uncached.map(() => `[翻译失败: ${err.message}]`);
        }
      } else {
        out = uncached.map(() => `[翻译失败: ${err.message}]`);
      }
    }

    uncached.forEach((text, k) => {
      const translated = out[k] || '';
      this.cache.set(this.getCacheKey(text), translated);
      results[uncachedIdx[k]] = translated;
    });
    return results;
  }

  // --- Google (free, batch via separator) ---
  async _googleBatch(texts) {
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const url = 'https://translate.googleapis.com/translate_a/single?' +
      new URLSearchParams({ client: 'gtx', sl: this.sourceLang, tl: this.targetLang, dt: 't', q: merged });
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Google API ${resp.status}`);
    const data = await resp.json();
    const full = data[0].map(item => item[0]).join('');
    const parts = full.split(/\s*▁▁▁\s*|\s*\u2581\u2581\u2581\s*/);
    if (parts.length === texts.length) return parts.map(p => p.trim());
    return Promise.all(texts.map(t => this._googleSingle(t)));
  }

  async _googleSingle(text) {
    const url = 'https://translate.googleapis.com/translate_a/single?' +
      new URLSearchParams({ client: 'gtx', sl: this.sourceLang, tl: this.targetLang, dt: 't', q: text });
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Google API ${resp.status}`);
    const data = await resp.json();
    return data[0].map(item => item[0]).join('');
  }

  // --- MyMemory (free, 5000 chars/day without key, rate limited) ---
  async _mymemoryBatch(texts) {
    // Sequential with delay to avoid 429
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(await this._mymemorySingle(texts[i]));
      if (i < texts.length - 1) await this._delay(300);
    }
    return results;
  }

  async _mymemorySingle(text, retries = 2) {
    const sl = this.sourceLang === 'auto' ? 'en' : this.sourceLang;
    const tl = this.targetLang;
    const url = 'https://api.mymemory.translated.net/get?' +
      new URLSearchParams({ q: text, langpair: `${sl}|${tl}` });
    const resp = await fetch(url);
    if (resp.status === 429 && retries > 0) {
      await this._delay(1500);
      return this._mymemorySingle(text, retries - 1);
    }
    if (!resp.ok) throw new Error(`MyMemory API ${resp.status}`);
    const data = await resp.json();
    return data.responseData?.translatedText || '';
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // --- Lingva Translate (free, open source Google frontend) ---
  async _lingvaBatch(texts) {
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const sl = this.sourceLang === 'auto' ? 'auto' : this.sourceLang;
    const tl = this.targetLang.split('-')[0]; // lingva uses simple codes
    const url = `https://lingva.ml/api/v1/${sl}/${tl}/${encodeURIComponent(merged)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Lingva API ${resp.status}`);
    const data = await resp.json();
    const full = data.translation || '';
    const parts = full.split(/\s*▁▁▁\s*|\s*\u2581\u2581\u2581\s*/);
    if (parts.length === texts.length) return parts.map(p => p.trim());
    return Promise.all(texts.map(t => this._lingvaSingle(t)));
  }

  async _lingvaSingle(text) {
    const sl = this.sourceLang === 'auto' ? 'auto' : this.sourceLang;
    const tl = this.targetLang.split('-')[0];
    const url = `https://lingva.ml/api/v1/${sl}/${tl}/${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Lingva API ${resp.status}`);
    const data = await resp.json();
    return data.translation || '';
  }

  // --- LibreTranslate (free, self-hostable) ---
  async _libreBatch(texts) {
    const baseUrl = this.libreUrl || 'https://libretranslate.com';
    const sl = this.sourceLang === 'auto' ? 'auto' : this.sourceLang;
    // LibreTranslate doesn't support batch natively, parallel requests
    return Promise.all(texts.map(async text => {
      const resp = await fetch(`${baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: sl, target: this.targetLang.split('-')[0] })
      });
      if (!resp.ok) throw new Error(`Libre API ${resp.status}`);
      const data = await resp.json();
      return data.translatedText || '';
    }));
  }

  // --- DeepL (needs API key) ---
  async _deeplBatch(texts) {
    if (!this.deeplKey) throw new Error('DeepL API key not set');
    const url = 'https://api-free.deepl.com/v2/translate';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_key: this.deeplKey,
        text: texts,
        target_lang: this.targetLang.toUpperCase().replace('-', '')
      })
    });
    if (!resp.ok) throw new Error(`DeepL API ${resp.status}`);
    const data = await resp.json();
    return data.translations.map(t => t.text);
  }

  // --- Custom API ---
  async _customBatch(texts) {
    if (!this.customApiUrl) throw new Error('Custom API URL not set');
    const resp = await fetch(this.customApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.customApiKey ? { 'Authorization': `Bearer ${this.customApiKey}` } : {})
      },
      body: JSON.stringify({ text: texts, source: this.sourceLang, target: this.targetLang })
    });
    if (!resp.ok) throw new Error(`Custom API ${resp.status}`);
    const data = await resp.json();
    if (Array.isArray(data.translations)) return data.translations.map(t => t.text || t);
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.text)) return data.text;
    return texts.map(() => data.translation || data.text || data.result || '');
  }

  // --- AI Engines ---

  _getAiPrompt() {
    const promptTemplate = this.aiPrompt || 'Translate the following text to {targetLang}. Keep the exact separators "\\n\\u2581\\u2581\\u2581\\n" unchanged. Only output the translated text.';
    const langMap = { 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'en': 'English', 'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German', 'es': 'Spanish', 'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian', 'ar': 'Arabic', 'hi': 'Hindi', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'tr': 'Turkish' };
    return promptTemplate.replace('{targetLang}', langMap[this.targetLang] || this.targetLang);
  }

  _parseAiResult(result, originalCount) {
    let text = result.trim();
    // Sometimes LLMs wrap output in markdown
    if (text.startsWith('```')) {
      text = text.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
    }
    const parts = text.split(/\s*▁▁▁\s*|\s*\u2581\u2581\u2581\s*/);
    if (parts.length === originalCount) return parts.map(p => p.trim());
    
    // Fallback: if lengths don't match, just return the first chunk or duplicate
    console.warn(`[Translator] AI batch parts mismatch. Expected ${originalCount}, got ${parts.length}`);
    return Array(originalCount).fill(parts[0] || '');
  }

  async _openaiBatch(texts) {
    if (!this.openaiKey) throw new Error('OpenAI API key not set');
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const url = this.openaiUrl || 'https://api.openai.com/v1/chat/completions';
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiKey}`
      },
      body: JSON.stringify({
        model: this.openaiModel || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: this._getAiPrompt() },
          { role: 'user', content: merged }
        ],
        temperature: 0.3
      })
    });
    if (!resp.ok) throw new Error(`OpenAI API ${resp.status}`);
    const data = await resp.json();
    const resultText = data.choices?.[0]?.message?.content || '';
    return this._parseAiResult(resultText, texts.length);
  }

  async _geminiBatch(texts) {
    if (!this.geminiKey) throw new Error('Gemini API key not set');
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const model = this.geminiModel || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`;
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: this._getAiPrompt() }] },
        contents: [{ parts: [{ text: merged }] }],
        generationConfig: { temperature: 0.3 }
      })
    });
    if (!resp.ok) throw new Error(`Gemini API ${resp.status}`);
    const data = await resp.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return this._parseAiResult(resultText, texts.length);
  }

  async _ollamaBatch(texts) {
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const url = this.ollamaUrl || 'http://localhost:11434/api/chat';
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel || 'llama3',
        messages: [
          { role: 'system', content: this._getAiPrompt() },
          { role: 'user', content: merged }
        ],
        stream: false,
        options: { temperature: 0.3 }
      })
    });
    if (!resp.ok) throw new Error(`Ollama API ${resp.status}`);
    const data = await resp.json();
    const resultText = data.message?.content || '';
    return this._parseAiResult(resultText, texts.length);
  }

  async _claudeBatch(texts) {
    if (!this.claudeKey) throw new Error('Claude API key not set');
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    const url = 'https://api.anthropic.com/v1/messages';
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerously-allow-custom-urls': 'true' // Allow requests from browser extension
      },
      body: JSON.stringify({
        model: this.claudeModel || 'claude-3-haiku-20240307',
        max_tokens: 4000,
        temperature: 0.3,
        system: this._getAiPrompt(),
        messages: [{ role: 'user', content: merged }]
      })
    });
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
    const data = await resp.json();
    const resultText = data.content?.[0]?.text || '';
    return this._parseAiResult(resultText, texts.length);
  }

  async _webllmBatch(texts) {
    const SEP = '\n\u2581\u2581\u2581\n';
    const merged = texts.join(SEP);
    
    if (!this.webllmEngine) {
      const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
      this.webllmEngine = await CreateWebWorkerMLCEngine(
        new Worker(new URL('./webllm-worker.js', import.meta.url), { type: "module" }),
        this.webllmModel || "Llama-3-8B-Instruct-q4f32_1-MLC",
        {
          initProgressCallback: (progress) => {
            console.log('[WebLLM]', progress.text);
            // Store progress so UI can read it if needed
            this.webllmProgress = progress.text;
            // Dispatch a custom event on window for UI to hook into
            window.dispatchEvent(new CustomEvent('webllm-progress', { detail: progress.text }));
          }
        }
      );
    }

    const messages = [
      { role: "system", content: this._getAiPrompt() },
      { role: "user", content: merged }
    ];

    const reply = await this.webllmEngine.chat.completions.create({
      messages,
      temperature: 0.3
    });

    const resultText = reply.choices[0].message.content || '';
    return this._parseAiResult(resultText, texts.length);
  }
}

export const translator = new Translator();
window.translator = translator;
