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
  // 全页翻译单独用哪个引擎。留空 = 跟随上面的 engine。
  // 场景：划词用快的在线引擎图即时，整页用本地 Ollama 图不限量不花钱
  fullPageEngine: '',

  // 每引擎并发覆盖值 { engineId: number }。没配过的引擎用
  // utils/translation-options.ts 里的建议值。旧的 translateConcurrency
  // 三档预设已移除——它和硬编码的引擎上限取较小值，用户既看不到也改不了
  engineConcurrency: {},
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

  // subtitle translation
  subtitleTranslate: true,

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
  // DeepSeek 用的是 OpenAI 兼容协议，实现与 openai 共用
  // Translator._openAiCompatibleBatch，只是默认地址和模型不同
  deepseekKey: '',
  deepseekModel: 'deepseek-chat',
  deepseekUrl: 'https://api.deepseek.com/chat/completions',
  geminiKey: '',
  geminiModel: 'gemini-1.5-flash',
  claudeKey: '',
  claudeModel: 'claude-3-haiku-20240307',
  // llama3 是个通用对话模型，而且多数机器上根本没装——默认值指向一个不存在的
  // 模型，403 修好之后紧接着就是 404，等于把「配不通」延后了一步。
  // 换成专做翻译的 translategemma:4b：体积小、跑得动、拿来就能用。
  ollamaModel: 'translategemma:4b',
  ollamaUrl: 'http://localhost:11434/api/chat',
  webllmModel: 'Llama-3-8B-Instruct-q4f32_1-MLC',
  aiPrompt: 'Translate the following text to {targetLang}. Keep the exact separators "\\n\\u2581\\u2581\\u2581\\n" unchanged. Only output the translated text.',

  // sites
  siteRules: { mode: 'blacklist', sites: [] },
  siteEngines: {},

  // TTS
  // 朗读引擎与音色按语种分开：有道只有英文真人录音，Google 的中文更自然，
  // 而系统语音包也是分语种装的——用一套设置同时管中英文必然有一边将就。
  // 旧的 ttsEngine / ttsBrowserVoiceURI 保留，作为未设置时的回退值（见 resolveTts）
  ttsEngine: 'browser',
  ttsBrowserVoiceURI: '',
  ttsEngineEn: '',
  ttsEngineZh: '',
  ttsBrowserVoiceEn: '',
  ttsBrowserVoiceZh: '',
  // 语速音调不分语种：它们是主观偏好，跟语言本身无关，分开只会让设置项翻倍
  ttsBrowserRate: '1.0',
  ttsBrowserPitch: '1.0',
  ttsOpenaiVoice: 'alloy',
  ttsOpenaiSpeed: '1.0',
  ttsYoudaoAccent: 'us', // us | uk

  // 剪贴板历史
  clipboardCapture: true,
  clipboardMaxItems: 200,
  // 图片比文字重得多，条数上限低很多；单张超限的直接不存，
  // 而不是存进去把库撑爆
  clipboardSaveImages: true,
  clipboardMaxImages: 30,
  clipboardMaxImageBytes: 5 * 1024 * 1024,
  // 同步默认关闭：剪贴板内容比翻译历史敏感得多，开不开该由用户明确决定。
  // 打开后没有口令也不会上传（见 github-sync.js 的 syncClipboardNow）。
  // 口令本身存 storage.local，不进 sync——否则等于把密文和钥匙分给两家云
  githubSyncClipboard: false,
  // 设置同步：让你不必依赖 Chrome 的 Google 账号同步。
  // API Key 以密文（secretsEnc）随行；加密口令永远不上传
  githubSyncSettings: false,

  // 单词学习（形状见 types/models.ts 的 StudyConfig；默认值与
  // utils/learning/queue.js 的 DEFAULT_STUDY_CONFIG 保持一致）
  studyConfig: {
    dailyNewLimit: 10,
    dailyReviewLimit: 0,
    enabledExercises: ['en2zh', 'zh2en', 'listening', 'spelling'],
  },
};

// Convenience: return a fresh object with only the named keys (and their default
// values), e.g. pick('engine', 'targetLang'). Useful for narrow reads.
export function pick(...keys) {
  const out = {};
  for (const k of keys) out[k] = DEFAULTS[k];
  return out;
}
