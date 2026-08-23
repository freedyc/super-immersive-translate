import { pick } from './defaults.js';
import { chunkText, getEngine, supportsLang } from './tts-engines.js';

class TTSManager {
  constructor() {
    this.audioElement = new Audio();
    this.currentEngine = 'browser';
    
    // Browser settings
    this.browserVoiceURI = '';
    this.browserRate = 1.0;
    this.browserPitch = 1.0;
    
    // OpenAI settings
    this.openaiKey = '';
    this.openaiUrl = 'https://api.openai.com/v1/audio/speech';
    this.openaiVoice = 'alloy';
    this.openaiSpeed = 1.0;

    // 有道：英式 / 美式
    this.youdaoAccent = 'us';
    // 播放长文本时逐段播，中途 stop() 要能把后续段也取消掉
    this.playToken = 0;
  }

  async init() {
    const settings = await chrome.storage.sync.get(pick(
      'ttsEngine', 'ttsBrowserVoiceURI', 'ttsBrowserRate', 'ttsBrowserPitch',
      'openaiKey', 'openaiUrl', 'ttsOpenaiVoice', 'ttsOpenaiSpeed', 'ttsYoudaoAccent'
    ));

    this.currentEngine = settings.ttsEngine;
    this.browserVoiceURI = settings.ttsBrowserVoiceURI;
    this.browserRate = parseFloat(settings.ttsBrowserRate) || 1.0;
    this.browserPitch = parseFloat(settings.ttsBrowserPitch) || 1.0;
    
    this.openaiKey = settings.openaiKey;
    
    // Parse OpenAI URL for audio/speech endpoint
    let baseUrl = settings.openaiUrl || 'https://api.openai.com/v1';
    if (baseUrl.endsWith('/chat/completions')) {
      baseUrl = baseUrl.replace('/chat/completions', '');
    }
    // Remove trailing slash if any
    baseUrl = baseUrl.replace(/\/$/, '');
    this.openaiUrl = baseUrl.endsWith('/audio/speech') ? baseUrl : `${baseUrl}/audio/speech`;

    this.openaiVoice = settings.ttsOpenaiVoice;
    this.openaiSpeed = parseFloat(settings.ttsOpenaiSpeed) || 1.0;
    this.youdaoAccent = settings.ttsYoudaoAccent || 'us';
  }

  stop() {
    this.playToken++; // 让正在排队的后续段自行作废
    window.speechSynthesis.cancel();
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
  }

  get isSpeaking() {
    return window.speechSynthesis.speaking || (!this.audioElement.paused && this.audioElement.currentTime > 0);
  }

  /**
   * 朗读一段文本。念完才 resolve，念不出来 reject。
   *
   * @param {string} text
   * @param {string} lang BCP-47，如 en-US / zh-CN
   * @param {{engine?: string}} [override] 试听用：临时指定引擎，不改用户设置
   */
  async speak(text, lang, override = {}) {
    if (!text) return;
    this.stop();
    const token = this.playToken;

    let engine = override.engine || this.currentEngine;
    // 有道只有英文发音，中文请求会直接失败——与其报错，不如退回浏览器语音
    if (!supportsLang(engine, lang)) engine = 'browser';
    // 没配 Key 的 OpenAI 同理，不该让用户点一次等一次超时
    if (engine === 'openai' && !this.openaiKey) engine = 'browser';

    if (engine === 'browser') {
      await this._speakBrowser(text, lang);
      return;
    }

    const { maxChars } = getEngine(engine);
    const chunks = chunkText(text, maxChars);
    for (const chunk of chunks) {
      if (token !== this.playToken) return; // 期间被 stop() 了
      await this._speakRemote(engine, chunk, lang, token);
    }
  }

  /** 网络引擎：音频由 Service Worker 取回（内容脚本跨域受宿主页 CORS 限制） */
  async _speakRemote(engine, text, lang, token) {
    const res = await chrome.runtime.sendMessage({
      action: 'ttsFetch',
      engine,
      text,
      lang,
      opts: {
        openaiUrl: this.openaiUrl,
        openaiKey: this.openaiKey,
        openaiVoice: this.openaiVoice,
        openaiSpeed: this.openaiSpeed,
        youdaoAccent: this.youdaoAccent,
      },
    }).catch(() => null);

    if (!res?.dataUrl) {
      throw new Error(res?.error || '朗读服务不可用');
    }
    if (token !== this.playToken) return;

    await new Promise((resolve, reject) => {
      const audio = this.audioElement;
      audio.src = res.dataUrl;
      audio.playbackRate = engine === 'openai' ? 1 : this.browserRate;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('音频播放失败'));
      audio.play().catch(reject);
    });
  }

  // speechSynthesis.getVoices() 在页面里第一次调用时经常还是空数组——真正的语音列表
  // 是异步加载的，加载完会触发一次 voiceschanged。不等它加载完就直接 find()，第一次
  // 永远找不到配置的音色，会静默退回浏览器默认音色（跟设置里选的不是同一个声音）。
  _getVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) return Promise.resolve(voices);
    return new Promise((resolve) => {
      const onVoicesChanged = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      // 少数环境永远不触发 voiceschanged，兜底超时避免卡住不发声
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      }, 300);
    });
  }

  // 返回的 Promise 等到真正念完才 resolve，念不出来则 reject。
  // 早期版本在 speak() 排队后就立即 resolve，调用方据此做的「播放中」状态
  // 会瞬间闪过——等于没有状态；「失败」更是永远等不到。
  async _speakBrowser(text, lang) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.browserRate;
    utterance.pitch = this.browserPitch;

    if (lang && lang !== 'auto') {
      utterance.lang = lang;
    }

    if (this.browserVoiceURI) {
      const voices = await this._getVoices();
      const voice = voices.find(v => v.voiceURI === this.browserVoiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }

    return new Promise((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        // 主动 stop() 造成的中断不算失败，否则切换单词就会弹一次错
        if (e.error === 'interrupted' || e.error === 'canceled') resolve();
        else reject(new Error(`浏览器语音失败：${e.error || 'unknown'}`));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

}

window.ttsManager = new TTSManager();
