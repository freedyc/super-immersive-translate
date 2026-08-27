/**
 * 设置页各处下拉框的选项表 —— 原来散在 options.html 的手写 <option> 里，
 * 集中到这里避免同一份清单在多个页面各写一遍、改的时候漏掉某处。
 */
import type { Option } from '../options/components/Field.tsx';
import type { EngineField } from '../options/lib/types.ts';

export const ENGINES: readonly Option[] = [
  ['google', 'Google 翻译 (免费)'], ['mymemory', 'MyMemory (免费)'],
  ['lingva', 'Lingva Translate (免费)'], ['libre', 'LibreTranslate (免费)'],
  ['deepl', 'DeepL (需 API Key)'], ['custom', '自定义 API'],
  ['openai', 'OpenAI (需 API Key)'], ['deepseek', 'DeepSeek (需 API Key)'],
  ['gemini', 'Gemini (需 API Key)'],
  ['claude', 'Claude (需 API Key)'], ['ollama', 'Ollama (本地/自定义)'],
  ['webllm', 'WebLLM (本地运行/显卡加速)'],
];

export const ENGINE_NAMES: Record<string, string> = {
  google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
  libre: 'Libre', deepl: 'DeepL', custom: '自定义',
  openai: 'OpenAI', deepseek: 'DeepSeek', gemini: 'Gemini', claude: 'Claude',
  ollama: 'Ollama', webllm: 'WebLLM',
};

export const LANGS: readonly Option[] = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁体中文'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية'],
  ['hi', 'हिन्दी'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'],
  ['tr', 'Türkçe'],
];

export const DISPLAY_MODES: readonly Option[] = [
  ['bilingual', '双语对照'], ['replace', '译文替换'], ['translationOnly', '仅译文'],
];

/**
 * 每个引擎的并发建议值与上限。
 *
 * 此前只有一个全局的三档预设（2/5/10），再和一张硬编码的引擎上限表取较小值——
 * 用户既看不到那张表，也改不了它。现在建议值公开出来，用户可以按自己的
 * 网络、Key 额度、本机性能自行调整。
 *
 * hardMax 是**技术上限**而非礼貌限制，只在真的多开也没用时才设：
 * WebLLM 是浏览器里的单个模型实例，第二路请求只会排队，不会更快。
 * 其余引擎不设硬顶——限流是服务方的策略，用户自己权衡。
 */
export interface ConcurrencyProfile {
  /** 不填时用的建议值 */
  recommended: number;
  /** 技术上不可能超过的值；没有就是不限 */
  hardMax?: number;
  /** 为什么是这个数——设置页直接展示，用户才知道调高的代价 */
  note: string;
}

export const ENGINE_CONCURRENCY: Record<string, ConcurrencyProfile> = {
  google:   { recommended: 5,  note: '免费接口，调太高容易被临时限流' },
  mymemory: { recommended: 1,  note: '本身就是串行限流的接口，多开无效还会触发封禁' },
  lingva:   { recommended: 3,  note: '公共实例，多人共享，建议克制' },
  libre:    { recommended: 2,  note: '不支持批量，每条文本一个请求，并发翻倍即请求翻倍' },
  deepl:    { recommended: 5,  note: '按 Key 的额度和套餐决定，免费版限流较严' },
  custom:   { recommended: 5,  note: '取决于你自己的服务端' },
  openai:   { recommended: 5,  note: '受账号的每分钟请求数/令牌数限制' },
  deepseek: { recommended: 5,  note: '价格便宜、限流宽松，可按需调高' },
  gemini:   { recommended: 5,  note: '免费层每分钟请求数很低，容易 429' },
  claude:   { recommended: 5,  note: '受账号的每分钟请求数/令牌数限制' },
  ollama:   { recommended: 4,  note: '本机推理，不受 API 限流约束。上限取决于显存和 OLLAMA_NUM_PARALLEL，可按机器能力调高' },
  webllm:   { recommended: 1, hardMax: 1, note: '浏览器内的单个模型实例，多开只会排队' },
};

/** 没有单独配置过的引擎用这个 */
export const DEFAULT_CONCURRENCY = 5;

/**
 * 天花板只防手滑（输入 9999 会把页面打死），不代表建议值。
 *
 * 本机引擎（Ollama）的并发受你自己的显存和 OLLAMA_NUM_PARALLEL 决定，
 * 跟"会不会被限流"无关——限流是 API 服务方的事。所以这里给得很宽松，
 * 由你按机器实际能力定。
 */
export const MAX_CONCURRENCY = 64;

/**
 * 解析某个引擎实际该用的并发数。
 *
 * 纯函数，content script 和设置页共用——两边各算一遍必然会在某次改动后分叉。
 */
export function resolveEngineConcurrency(
  engine: string,
  overrides: Record<string, number> | undefined,
): number {
  const profile = ENGINE_CONCURRENCY[engine];
  const raw = overrides?.[engine];
  const value = Number.isFinite(raw) && Number(raw) > 0
    ? Math.floor(Number(raw))
    : (profile?.recommended ?? DEFAULT_CONCURRENCY);
  const ceiling = Math.min(profile?.hardMax ?? MAX_CONCURRENCY, MAX_CONCURRENCY);
  return Math.max(1, Math.min(value, ceiling));
}

export const SELECTION_MODES: readonly Option[] = [
  ['icon', '图标模式 (选中后点击图标)'], ['direct', '直接弹窗 (选中即翻译)'],
  ['dblclick', '双击查词'], ['shortcut', '快捷键'], ['off', '关闭划词翻译'],
];

export const SELECTION_ENGINE_OPTIONS: readonly Option[] = [
  ['google', 'Google'], ['lingva', 'Lingva'], ['libre', 'Libre'],
  ['mymemory', 'MyMemory'], ['deepl', 'DeepL'], ['custom', '自定义'],
  ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['claude', 'Claude'],
  ['ollama', 'Ollama'], ['webllm', 'WebLLM'],
];

export const COLORS: readonly string[] = ['#9b59b6', '#4f8ef7', '#7c8aaa', '#27ae60', '#e67e22', '#e74c3c', '#00b894'];

export const OPENAI_VOICES: readonly string[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// 各引擎在设置页要展示的字段。type 为 password 的会渲染成密码框。
export const ENGINE_FIELDS: Record<string, readonly EngineField[]> = {
  deepl: [{ key: 'deeplKey', label: 'DeepL API Key', type: 'password', placeholder: '输入 DeepL API Key' }],
  custom: [
    { key: 'customApiUrl', label: 'API 地址', type: 'text', placeholder: 'https://api.example.com/translate' },
    { key: 'customApiKey', label: 'API Key (可选)', type: 'password', placeholder: 'Bearer token' },
  ],
  libre: [{ key: 'libreUrl', label: 'LibreTranslate 地址', type: 'text', placeholder: 'https://libretranslate.com' }],
  openai: [
    { key: 'openaiKey', label: 'OpenAI API Key', type: 'password', placeholder: 'sk-...' },
    { key: 'openaiModel', label: '模型', type: 'text', placeholder: 'gpt-3.5-turbo' },
    {
      key: 'openaiUrl',
      label: 'API 地址',
      type: 'text',
      placeholder: 'https://api.openai.com/v1/chat/completions',
      hint: '兼容 OpenAI 接口的第三方服务（中转、自建）也能填在这里',
    },
  ],
  deepseek: [
    { key: 'deepseekKey', label: 'DeepSeek API Key', type: 'password', placeholder: 'sk-...' },
    {
      key: 'deepseekModel',
      label: '模型',
      type: 'text',
      placeholder: 'deepseek-chat',
      hint: 'deepseek-chat 通用且快；deepseek-reasoner 会先输出思维链，翻译场景反而更慢',
    },
    {
      key: 'deepseekUrl',
      label: 'API 地址',
      type: 'text',
      placeholder: 'https://api.deepseek.com/chat/completions',
      hint: '官方地址，一般不用改',
    },
  ],
  gemini: [
    { key: 'geminiKey', label: 'Gemini API Key', type: 'password', placeholder: '输入 Gemini API Key' },
    { key: 'geminiModel', label: '模型', type: 'text', placeholder: 'gemini-1.5-flash' },
  ],
  claude: [
    { key: 'claudeKey', label: 'Claude API Key', type: 'password', placeholder: 'sk-ant-...' },
    { key: 'claudeModel', label: '模型', type: 'text', placeholder: 'claude-3-haiku-20240307' },
  ],
  ollama: [
    { key: 'ollamaModel', label: '模型', type: 'text', placeholder: 'llama3' },
    { key: 'ollamaUrl', label: '服务地址', type: 'text', placeholder: 'http://localhost:11434/api/chat' },
  ],
  webllm: [
    {
      key: 'webllmModel',
      label: '模型',
      type: 'text',
      placeholder: 'Llama-3-8B-Instruct-q4f32_1-MLC',
      hint: '完全在本地显卡上运行，首次使用需要从 HuggingFace 下载几 GB 的模型文件。',
    },
  ],
};

export const AI_ENGINES: readonly string[] = ['openai', 'gemini', 'claude', 'ollama', 'webllm', 'custom'];
