/**
 * 朗读引擎注册表。
 *
 * 一处定义每个引擎的能力，设置页、TTS 管理器、后台取音频都读这一份，
 * 免得「支持哪些语言」「要不要 key」这类信息散在三个地方各写一遍。
 *
 * 网络引擎的音频统一由 Service Worker 去取（见 background 的 ttsFetch）。
 * 内容脚本自己 fetch 跨域会受宿主页面的 CORS 约束——扩展的 host_permissions
 * 在内容脚本里不生效，只有扩展页面和 Service Worker 才绕得过去。
 */

/** 语种归一：只区分中文和其他，引擎能力差异基本就在这条线上 */
export function isChinese(lang) {
  return /^zh/i.test(String(lang || ''));
}

export const TTS_ENGINES = [
  {
    id: 'browser',
    label: '浏览器内置语音',
    note: '免费 · 离线 · 取决于系统装了哪些语音包',
    needsKey: false,
    network: false,
    langs: 'all',
  },
  {
    id: 'google',
    label: 'Google 翻译语音',
    note: '免费 · 无需 Key · 中英文都自然',
    needsKey: false,
    network: true,
    langs: 'all',
    // 单次请求上限约 200 字符，超了返回 400，所以长文本要分段
    maxChars: 180,
  },
  {
    id: 'youdao',
    label: '有道词典发音',
    note: '免费 · 无需 Key · 真人录音，英式/美式，仅英文',
    needsKey: false,
    network: true,
    langs: 'en',       // 中文请求会返回 500，不是不好听，是根本没有
    maxChars: 120,
  },
  {
    id: 'openai',
    label: 'OpenAI TTS',
    note: '需要 API Key · 音质最好，按字符计费',
    needsKey: true,
    network: true,
    langs: 'all',
    maxChars: 4000,
  },
];

export function getEngine(id) {
  return TTS_ENGINES.find((e) => e.id === id) ?? TTS_ENGINES[0];
}

/** 这个引擎能不能读这段语言 */
export function supportsLang(engineId, lang) {
  const engine = getEngine(engineId);
  return engine.langs === 'all' || !isChinese(lang);
}

/**
 * 构造网络引擎的请求。返回 null 表示这个引擎不该走网络（浏览器语音）。
 *
 * @returns {{url: string, init?: RequestInit} | null}
 */
export function buildRequest(engineId, text, lang, opts = {}) {
  switch (engineId) {
    case 'google': {
      // client=tw-ob 是 Google 翻译网页版自己用的取音频端点，无需鉴权
      const q = new URLSearchParams({
        ie: 'UTF-8', client: 'tw-ob', tl: lang || 'en', q: text,
      });
      return { url: `https://translate.google.com/translate_tts?${q}` };
    }
    case 'youdao': {
      // type=1 英式，type=2 美式
      const q = new URLSearchParams({
        audio: text, type: opts.youdaoAccent === 'uk' ? '1' : '2',
      });
      return { url: `https://dict.youdao.com/dictvoice?${q}` };
    }
    case 'openai':
      return {
        url: opts.openaiUrl,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.openaiKey}`,
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: opts.openaiVoice || 'alloy',
            speed: Number(opts.openaiSpeed) || 1.0,
          }),
        },
      };
    default:
      return null;
  }
}

/**
 * 把长文本切成引擎能接受的片段。
 *
 * 优先在句末切，其次在词间——从中间硬切会把一个词劈成两半，
 * 听起来是两个不存在的词。
 */
export function chunkText(text, maxChars) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // 中英文的句末标点都算
    let cut = Math.max(
      window.lastIndexOf('. '), window.lastIndexOf('。'),
      window.lastIndexOf('! '), window.lastIndexOf('！'),
      window.lastIndexOf('? '), window.lastIndexOf('？'),
      window.lastIndexOf('; '), window.lastIndexOf('；'),
    );
    if (cut > maxChars * 0.4) cut += 1;           // 标点归前一段
    else cut = window.lastIndexOf(' ');            // 退而求其次：词边界
    // 切点太靠前就宁可硬切：「ok. 」后面跟一长串无空格文本时，句末和词边界
    // 都会落在下标 3，切出一个三个字符的片段——那是一次毫无意义的请求，
    // 连读时还多一次停顿。中文没有空格，lastIndexOf 返回 -1 也走这条
    if (cut < maxChars * 0.4) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}


/**
 * 从原始设置里解出某个语种该用的引擎和音色。
 *
 * 旧版本只有一套 ttsEngine / ttsBrowserVoiceURI。这里把它们当作未设置时的
 * 回退值，于是升级上来的用户不需要重新配，也不必写一次存储去做迁移。
 *
 * 音色回退多一层判断：旧的单一音色如果是中文音色，回退给英文就会让英文
 * 用中文嗓子念——那正是分语种之前一直存在的毛病，不能带进新逻辑。
 */
export function resolveTts(settings, lang) {
  const zh = isChinese(lang);
  const engine = (zh ? settings.ttsEngineZh : settings.ttsEngineEn)
    || settings.ttsEngine
    || 'browser';

  const perLang = zh ? settings.ttsBrowserVoiceZh : settings.ttsBrowserVoiceEn;
  let voiceURI = perLang || '';
  if (!voiceURI && settings.ttsBrowserVoiceURI) {
    // 旧值只在语种对得上时才继承。对不上宁可留空走自动匹配
    const legacyIsChinese = /zh[-_]/i.test(settings.ttsBrowserVoiceURI)
      || /Chinese|Mandarin|中文/i.test(settings.ttsBrowserVoiceURI);
    if (legacyIsChinese === zh) voiceURI = settings.ttsBrowserVoiceURI;
  }

  return { engine, voiceURI };
}
