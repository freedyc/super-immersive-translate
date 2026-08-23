/**
 * 用已配置的 AI 引擎为单词生成一个带翻译、带逐词词类标注的例句，并识别单词本身的词类。
 * 不复用 Translator 类的批量翻译管道 —— 那是为翻译分隔符协议设计的，
 * 这里是单条生成，走独立的 fetch 请求，但复用同样的 key/模型设置。
 */
import { Translator } from './translator.js';
import { getWord, patchWord } from './learning/collect.ts';
import { pickPhonetic, pickPos } from './learning/wordMeta.ts';

const AI_ENGINES = ['openai', 'gemini', 'claude', 'ollama'];

const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'en': 'English',
  'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German', 'es': 'Spanish',
  'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian', 'ar': 'Arabic', 'hi': 'Hindi',
  'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'tr': 'Turkish'
};

// 十大词类，跟目标语言无关，用中文名标注，直接展示给用户
const SENTENCE_PATTERNS = [
  { name: '主谓宾', desc: '主语 + 及物动词 + 宾语' },
  { name: '主系表', desc: '主语 + 系动词 + 表语' },
  { name: '主谓双宾', desc: '主语 + 及物动词 + 间接宾语 + 直接宾语' },
  { name: '主谓宾宾补', desc: '主语 + 及物动词 + 宾语 + 宾语补足语' },
  { name: 'There be 句型', desc: 'There + be + 主语 + 地点/时间状语' }
];

const POS_LIST = '名词、代词、动词、形容词、副词、介词、连词、感叹词、冠词、限定词';

// 语法角色（这个词在句子里当什么成分），跟词性是两个不同维度——
// 词性是词本身的类别，语法角色是它在这句话里的功能
const ROLE_LIST = '主语、谓语、宾语、定语、状语、补语、其他';

function pickEngine(t) {
  if (AI_ENGINES.includes(t.engine)) {
    if (t.engine === 'ollama') return 'ollama';
    if (t[`${t.engine}Key`]) return t.engine;
  }
  if (t.openaiKey) return 'openai';
  if (t.geminiKey) return 'gemini';
  if (t.claudeKey) return 'claude';
  // 都没配 key 时兜底试一次本地 Ollama（不需要 key）；没启动的话 fetch 会失败，
  // 上层 generateExampleSentence/detectWordPos 的 try/catch 会静默吞掉，不影响保存单词
  return 'ollama';
}

function buildPrompt(word, targetLangName) {
  const pattern = SENTENCE_PATTERNS[Math.floor(Math.random() * SENTENCE_PATTERNS.length)];
  return `You are an English teacher. Write ONE natural English example sentence that correctly uses the word "${word}", following the "${pattern.name}" pattern (${pattern.desc}).
Then:
1. Translate that sentence into ${targetLangName}.
2. List every word in the sentence in order (excluding punctuation), and for each one give:
   - its part of speech — exactly one of these ten Chinese categories: ${POS_LIST}
   - its grammatical role in THIS sentence — exactly one of these seven Chinese categories: ${ROLE_LIST}
3. Separately state the primary part of speech of the headword "${word}" itself (as commonly used), using the same ten categories.
4. Give the IPA phonetic transcription of the headword "${word}" itself, wrapped in slashes (e.g. "/wɜːrd/").

Respond with STRICT JSON only, no markdown, no extra text, in exactly this shape:
{"sentence": "...", "translation": "...", "tokens": [{"text": "...", "pos": "...", "role": "..."}, ...], "pos": "...", "ipa": "..."}`;
}

function buildAnalysisPrompt(text, targetLangName) {
  return `Analyze this English text: "${text}"
1. Translate it into ${targetLangName}.
2. List every word in it, in order (excluding punctuation), and for each one give:
   - its part of speech — exactly one of these ten Chinese categories: ${POS_LIST}
   - its grammatical role in this sentence — exactly one of these seven Chinese categories: ${ROLE_LIST}
3. Give TWO other natural English example sentences that follow a similar grammatical structure to this one (different vocabulary, same underlying pattern), each with its ${targetLangName} translation.

Respond with STRICT JSON only, no markdown, no extra text, in exactly this shape:
{"translation": "...", "tokens": [{"text": "...", "pos": "...", "role": "..."}, ...], "similar": [{"sentence": "...", "translation": "..."}, {"sentence": "...", "translation": "..."}]}`;
}

function buildMetaPrompt(word) {
  return `For the English word "${word}" (as commonly used), give:
1. Its primary part of speech — exactly one of these ten Chinese categories: ${POS_LIST}.
2. Its IPA phonetic transcription, wrapped in slashes (e.g. "/wɜːrd/").

Respond with STRICT JSON only, no markdown, no extra text, in exactly this shape:
{"pos": "...", "ipa": "..."}`;
}

function parseJsonResult(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const match = t.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

async function callOpenAI(t, prompt) {
  const url = t.openaiUrl || 'https://api.openai.com/v1/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t.openaiKey}` },
    body: JSON.stringify({
      model: t.openaiModel || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    })
  });
  if (!resp.ok) throw new Error(`OpenAI API ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(t, prompt) {
  const model = t.geminiModel || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${t.geminiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });
  if (!resp.ok) throw new Error(`Gemini API ${resp.status}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callClaude(t, prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': t.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerously-allow-custom-urls': 'true'
    },
    body: JSON.stringify({
      model: t.claudeModel || 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callOllama(t, prompt) {
  const url = t.ollamaUrl || 'http://localhost:11434/api/chat';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: t.ollamaModel || 'llama3',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.7 }
    })
  });
  if (!resp.ok) throw new Error(`Ollama API ${resp.status}`);
  const data = await resp.json();
  return data.message?.content || '';
}

async function callEngine(engine, t, prompt) {
  switch (engine) {
    case 'openai': return callOpenAI(t, prompt);
    case 'gemini': return callGemini(t, prompt);
    case 'claude': return callClaude(t, prompt);
    case 'ollama': return callOllama(t, prompt);
    default: return '';
  }
}

/**
 * @param {string} word
 * @param {object} t - 已经 init() 过的 Translator 实例，用到它的 engine/targetLang 和各引擎的 key/model/url 字段
 * @returns {Promise<{sentence: string, translation: string, tokens: Array<{text:string, pos:string, role?:string}>, pos: string, ipa: string} | null>}
 */
export async function generateExampleSentence(word, t) {
  const engine = pickEngine(t);
  if (!engine) return null;

  const targetLangName = LANG_NAMES[t.targetLang] || t.targetLang || 'Simplified Chinese';
  const prompt = buildPrompt(word, targetLangName);

  try {
    const raw = await callEngine(engine, t, prompt);
    const parsed = parseJsonResult(raw);
    if (!parsed || typeof parsed.sentence !== 'string' || !parsed.sentence.trim()) return null;
    return {
      sentence: parsed.sentence.trim(),
      translation: typeof parsed.translation === 'string' ? parsed.translation.trim() : '',
      tokens: Array.isArray(parsed.tokens)
        ? parsed.tokens.filter(tok => tok && typeof tok.text === 'string' && typeof tok.pos === 'string')
        : [],
      pos: typeof parsed.pos === 'string' ? parsed.pos.trim() : '',
      ipa: typeof parsed.ipa === 'string' ? parsed.ipa.trim() : ''
    };
  } catch (err) {
    console.warn('[ExampleSentence] 生成失败:', err.message || err);
    return null;
  }
}

/**
 * 分析一段任意用户输入的英文文本（不是从某个词生成的例句）：翻译 + 逐词词性/语法角色标注 +
 * 两条句型相似的例句。用于 sandbox 的"语法分析"功能，跟 generateExampleSentence 的区别是
 * 这里的句子是用户给定的，不是 AI 现编的。
 * @param {string} text
 * @param {object} t - 已经 init() 过的 Translator 实例
 * @returns {Promise<{translation: string, tokens: Array<{text:string, pos:string, role:string}>, similar: Array<{sentence:string, translation:string}>} | null>}
 */
export async function analyzeSentence(text, t) {
  const engine = pickEngine(t);
  if (!engine) return null;

  const targetLangName = LANG_NAMES[t.targetLang] || t.targetLang || 'Simplified Chinese';

  try {
    const raw = await callEngine(engine, t, buildAnalysisPrompt(text, targetLangName));
    const parsed = parseJsonResult(raw);
    if (!parsed) return null;
    return {
      translation: typeof parsed.translation === 'string' ? parsed.translation.trim() : '',
      tokens: Array.isArray(parsed.tokens)
        ? parsed.tokens.filter(tok => tok && typeof tok.text === 'string' && typeof tok.pos === 'string')
        : [],
      similar: Array.isArray(parsed.similar)
        ? parsed.similar.filter(s => s && typeof s.sentence === 'string').slice(0, 2)
        : []
    };
  } catch (err) {
    console.warn('[ExampleSentence] 句子分析失败:', err.message || err);
    return null;
  }
}

/**
 * 只识别单词本身的词性 + IPA 音标，不生成例句 —— 用于单词已经有真实例句上下文、
 * 只是还缺这两项标注的情况，避免为了两个标签重新生成一整句例句。
 * @param {string} word
 * @param {object} t - 已经 init() 过的 Translator 实例
 * @returns {Promise<{pos: string, ipa: string} | null>}
 */
export async function detectWordMeta(word, t) {
  const engine = pickEngine(t);
  if (!engine) return null;

  try {
    const raw = await callEngine(engine, t, buildMetaPrompt(word));
    const parsed = parseJsonResult(raw);
    if (!parsed || typeof parsed.pos !== 'string' || !parsed.pos.trim()) return null;
    return {
      pos: parsed.pos.trim(),
      ipa: typeof parsed.ipa === 'string' ? parsed.ipa.trim() : ''
    };
  } catch (err) {
    console.warn('[ExampleSentence] 词性/音标识别失败:', err.message || err);
    return null;
  }
}

/**
 * 单词收藏后的一次性异步收尾：按需补一条 AI 例句、按需补词类标签，
 * 直接读写统一的 words 表，不阻塞收藏本身。
 * @param {string} wordText
 * @param {boolean} hasRealContext - 这次保存后单词是否已经有真实例句上下文
 *   （有真实例句就不再额外生成 AI 例句，只在缺词类标签时单独轻量请求一次）
 */
export async function enrichWordWithAi(wordText, hasRealContext) {
  const t = new Translator();
  await t.init();

  if (!hasRealContext) {
    const example = await generateExampleSentence(wordText, t);
    if (!example) return;
    await patchWord(wordText, (word) => {
      word.examples = [...word.examples, {
        sentence: example.sentence,
        translation: example.translation,
        tokens: example.tokens,
        origin: 'ai',
        timestamp: Date.now()
      }];
      applyMeta(word, example);
    });
    return;
  }

  const existing = await getWord(wordText);
  if (!existing) return;
  // 音标和词性都齐了就不用再调 AI
  if (pickPhonetic(existing) && pickPos(existing)) return;

  const meta = await detectWordMeta(wordText, t);
  if (!meta) return;
  await patchWord(wordText, (word) => applyMeta(word, meta));
}

/**
 * 把 AI 给的音标/词性写进 Word。
 *
 * 音标进 phonetic 而不是 phoneticUS —— AI 没说自己给的是英音还是美音，
 * 硬塞进美音字段是替数据做了它没有的断言（见 types/models.ts 的注释）。
 * 词性挂到第一条释义上；一条释义都没有时不新建空释义，那会在词库里
 * 显示成一个没有内容的词性徽章。
 */
function applyMeta(word, meta) {
  if (meta.ipa && !pickPhonetic(word)) word.phonetic = meta.ipa;
  if (meta.pos && !pickPos(word) && word.meanings.length > 0) {
    word.meanings = [
      { ...word.meanings[0], partOfSpeech: meta.pos },
      ...word.meanings.slice(1)
    ];
  }
}


/**
 * 给缺译文的例句补上中文翻译。
 *
 * 从阅读里抓到的例句只存了原句——collectWord 的 sentenceTranslation 从来没有
 * 调用方传过，于是「我的词库」里真实语境例句下面一直是空的。语境例句是这个
 * 产品相对 Anki 的差异点，只给原句不给译文等于把差异点做废了一半。
 *
 * 用普通翻译引擎，不用 AI：句子翻译是 Translator 的本行，而 AI 引擎在默认
 * 配置下根本不可用（音标和词性之前永远为空就是这么来的）。
 *
 * @param {string} wordText
 * @param {object} t 已经 init() 过的 Translator 实例
 */
export async function translateMissingExamples(wordText, t) {
  const word = await getWord(wordText);
  if (!word) return;

  const pending = word.examples.filter((e) => e.sentence && !e.translation);
  if (pending.length === 0) return;

  const results = new Map();
  await Promise.all(pending.map(async (e) => {
    try {
      const translated = await t.translate(e.sentence);
      // 引擎偶尔原样返回（识别成目标语言了），那种"译文"没有意义
      if (translated && translated !== e.sentence) results.set(e.sentence, translated);
    } catch {
      // 单句失败不影响其他句子，也不该让收藏流程感知到
    }
  }));
  if (results.size === 0) return;

  await patchWord(wordText, (w) => {
    // patchWord 会重新读一次存储，对象引用变了，按句子文本匹配
    w.examples = w.examples.map((e) =>
      (!e.translation && results.has(e.sentence)
        ? { ...e, translation: results.get(e.sentence) }
        : e));
  });
}
