import { pick } from './defaults.js';
import { chunkText, getEngine, resolveTts, supportsLang } from './tts-engines.js';
import { loadSecretsSafe } from './secrets.js';

class TTSManager {
  constructor() {
    this.audioElement = new Audio();
    /** 原始设置；引擎和音色按语种在 speak() 时解析 */
    this.settings = null;
    /** init() 的 in-flight Promise。speak() 等它，调用方不必记得先 init() */
    this.ready = null;
    
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

  /**
   * 读取设置。可以反复调用——设置变更时会重新读一次。
   *
   * 返回同一个 in-flight Promise，避免页面刚打开时几个发音按钮
   * 各触发一次 storage 读取。
   */
  init() {
    this.ready = this._loadSettings();
    return this.ready;
  }

  async _loadSettings() {
    const settings = await chrome.storage.sync.get(pick(
      'ttsEngine', 'ttsBrowserVoiceURI', 'ttsEngineEn', 'ttsEngineZh',
      'ttsBrowserVoiceEn', 'ttsBrowserVoiceZh', 'ttsBrowserRate', 'ttsBrowserPitch',
      'openaiKey', 'openaiUrl', 'ttsOpenaiVoice', 'ttsOpenaiSpeed', 'ttsYoudaoAccent'
    ));

    // 引擎和音色按语种解析，所以整份设置留着，speak() 时再按 lang 取
    this.settings = settings;
    // OpenAI TTS 复用同一个 Key，它可能是加密存储的
    const secrets = await loadSecretsSafe();
    settings.openaiKey = secrets.openaiKey || settings.openaiKey;
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
   * @param {{engine?: string, voiceURI?: string}} [override]
   *   试听用：临时指定引擎/音色，不改用户设置
   */
  async speak(text, lang, override = {}) {
    if (!text) return;
    // 懒初始化。此前单词本页只 import 了本文件、从不调用 init()，
    // 于是那一页的发音永远用构造函数默认值——改设置完全不生效。
    // 让 speak() 自己保证就绪，比要求每个调用方都记得 init() 可靠
    if (!this.ready) this.init();
    await this.ready;
    this.stop();
    const token = this.playToken;

    // 引擎和音色都按被朗读文本的语种取——中英文各配各的
    const resolved = resolveTts(this.settings || {}, lang);
    this.browserVoiceURI = override.voiceURI ?? resolved.voiceURI;

    let engine = override.engine || resolved.engine;
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

const manager = new TTSManager();
window.ttsManager = manager;

// 设置改了就重读。没有这个监听，已经打开的页面会一直用旧配置——
// 用户在选项页改完引擎，回到单词本点喇叭还是老声音，且没有任何迹象说明为什么。
// 项目里其他跨页面状态（主题、单词本、历史）都是这么同步的。
// 监听里认准 manager 这个实例，不走 window.ttsManager——后者可能被替换掉
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const touchesTts = Object.keys(changes).some(
    (k) => k.startsWith('tts') || k === 'openaiKey' || k === 'openaiUrl',
  );
  if (touchesTts) manager.init();
});

export { TTSManager };
