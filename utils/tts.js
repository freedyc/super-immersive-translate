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
    const settings = await chrome.storage.sync.get({
      ttsEngine: 'browser',
      ttsBrowserVoiceURI: '',
      ttsBrowserRate: 1.0,
      ttsBrowserPitch: 1.0,
      openaiKey: '',
      openaiUrl: 'https://api.openai.com/v1/chat/completions',
      ttsOpenaiVoice: 'alloy',
      ttsOpenaiSpeed: 1.0
    });

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
      this._speakBrowser(text, lang);
    }
  }

  _speakBrowser(text, lang) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.browserRate;
    utterance.pitch = this.browserPitch;

    if (lang && lang !== 'auto') {
      utterance.lang = lang;
    }

    if (this.browserVoiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.voiceURI === this.browserVoiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }

    window.speechSynthesis.speak(utterance);
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
