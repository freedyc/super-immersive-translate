/**
 * Translator engine wrapper
 * Free engines: Google, MyMemory, LibreTranslate, Lingva, Yandex(browser)
 * Paid engines: DeepL, Custom API
 */
class Translator {
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
    custom:   { name: '自定义 API', free: false }
  };

  async init() {
    const settings = await chrome.storage.sync.get({
      engine: 'google',
      targetLang: 'zh-CN',
      sourceLang: 'auto',
      deeplKey: '',
      customApiUrl: '',
      customApiKey: '',
      libreUrl: 'https://libretranslate.com'
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
      let results;
      switch (this.engine) {
        case 'google':   results = await this._googleBatch(texts); break;
        case 'mymemory': results = await this._mymemoryBatch(texts); break;
        case 'lingva':   results = await this._lingvaBatch(texts); break;
        case 'libre':    results = await this._libreBatch(texts); break;
        case 'deepl':    results = await this._deeplBatch(texts); break;
        case 'custom':   results = await this._customBatch(texts); break;
        default:         results = await this._googleBatch(texts);
      }
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
}

const translator = new Translator();
