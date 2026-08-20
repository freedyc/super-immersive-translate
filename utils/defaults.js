// Canonical default values for every chrome.storage.sync setting.
//
// This is the single source of truth for the settings schema that popup, options,
// the content scripts, the sandbox, background, the TTS helper and the translator
// all share. When you add a setting, add it here once — consumers that read the
// whole object via `chrome.storage.sync.get(DEFAULTS)` pick it up automatically.
//
// Note: tts rate/pitch/speed are stored as strings (that's what the options inputs
// write, and what ends up in storage after any save); speechSynthesis coerces them.
export const DEFAULTS = {
  // core
  engine: 'google',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  displayMode: 'bilingual',
  translateConcurrency: 'medium',
  theme: 'system',

  // history
  historyMaxItems: 0, // 0 = 不限制

  // GitHub 跨设备同步
  githubSyncEnabled: false,
  githubSyncAuthMethod: 'pat', // 'pat' | 'oauth'（oauth 暂未实现，预留）
  githubToken: '',
  githubOAuthAccessToken: '', // 预留给未来的 Device Flow 登录
  githubSyncTargetType: 'gist', // 'gist' | 'repo'
  githubGistId: '',
  githubRepoOwner: '',
  githubRepoName: '',
  githubRepoBranch: 'main',
  githubRepoPath: 'translation-history.json',
  githubSyncMode: 'manual', // 'auto' | 'manual'
  githubSyncIntervalMinutes: 30,
  githubSyncWordbook: true, // 单词本是否跟着一起同步，默认开，受 githubSyncEnabled 总开关约束

  // selection translation
  selectionMode: 'icon',
  selectionEngines: ['google', 'lingva', 'libre'],

  // full-page behavior / style
  translationColor: '#9b59b6',
  hoverTranslate: false,
  inputTranslate: false,
  translationFontSize: '0.92',
  translationLineHeight: '1.6',
  translationBold: false,
  translationShowBorder: true,

  // engines / keys / endpoints / models
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
  aiPrompt: 'Translate the following text to {targetLang}. Keep the exact separators "\\n\\u2581\\u2581\\u2581\\n" unchanged. Only output the translated text.',

  // sites
  siteRules: { mode: 'blacklist', sites: [] },
  siteEngines: {},

  // TTS
  ttsEngine: 'browser',
  ttsBrowserVoiceURI: '',
  ttsBrowserRate: '1.0',
  ttsBrowserPitch: '1.0',
  ttsOpenaiVoice: 'alloy',
  ttsOpenaiSpeed: '1.0',
};

// Convenience: return a fresh object with only the named keys (and their default
// values), e.g. pick('engine', 'targetLang'). Useful for narrow reads.
export function pick(...keys) {
  const out = {};
  for (const k of keys) out[k] = DEFAULTS[k];
  return out;
}
