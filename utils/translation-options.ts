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
  ['openai', 'OpenAI (需 API Key)'], ['gemini', 'Gemini (需 API Key)'],
  ['claude', 'Claude (需 API Key)'], ['ollama', 'Ollama (本地/自定义)'],
  ['webllm', 'WebLLM (本地运行/显卡加速)'],
];

export const ENGINE_NAMES: Record<string, string> = {
  google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
  libre: 'Libre', deepl: 'DeepL', custom: '自定义',
  openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude',
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

export const CONCURRENCY: readonly Option[] = [
  ['low', '低 (2 路并发，最稳，较慢)'],
  ['medium', '中 (5 路并发，推荐)'],
  ['high', '高 (10 路并发，最快，可能触发限流)'],
];

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
      hint: '兼容 OpenAI 接口的服务都能填在这里，比如 DeepSeek：https://api.deepseek.com/chat/completions（模型填 deepseek-chat）',
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
