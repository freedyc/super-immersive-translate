import { pick } from './defaults.js';

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
  }

  async init() {
    const settings = await chrome.storage.sync.get(pick(
      'ttsEngine', 'ttsBrowserVoiceURI', 'ttsBrowserRate', 'ttsBrowserPitch',
      'openaiKey', 'openaiUrl', 'ttsOpenaiVoice', 'ttsOpenaiSpeed'
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
  }

  stop() {
    window.speechSynthesis.cancel();
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
  }

  get isSpeaking() {
    return window.speechSynthesis.speaking || (!this.audioElement.paused && this.audioElement.currentTime > 0);
  }

  async speak(text, lang) {
    if (!text) return;
    this.stop();

    if (this.currentEngine === 'openai' && this.openaiKey) {
      await this._speakOpenAI(text);
    } else {
      await this._speakBrowser(text, lang);
    }
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

  async _speakOpenAI(text) {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(this.openaiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiKey}`
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: this.openaiVoice,
            speed: this.openaiSpeed
          })
        });

        if (!response.ok) {
          throw new Error(`OpenAI TTS API error: ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        this.audioElement.src = url;
        
        this.audioElement.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };

        this.audioElement.onerror = (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        };

        await this.audioElement.play();
      } catch (err) {
        console.error('[TTS] OpenAI speak failed:', err);
        // Fallback to browser if OpenAI fails
        this._speakBrowser(text, 'auto');
        resolve(); // resolve anyway so caller doesn't hang
      }
    });
  }
}

window.ttsManager = new TTSManager();
