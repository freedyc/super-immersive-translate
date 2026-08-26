/**
 * 跨域请求的统一出口。
 *
 * 为什么需要这一层：**内容脚本发的跨域请求受宿主页面的 CORS 约束**。
 * 从 Chrome 85 起，扩展的 host_permissions 在内容脚本里不再豁免 CORS，
 * 只有扩展页面和 Service Worker 才绕得过去。而 OpenAI、Gemini、Claude 的
 * API 都不给浏览器发 CORS 头，本地 Ollama 默认也只放行 localhost 来源——
 * 于是这些引擎在划词面板里根本发不出请求，只有在 sandbox 这类扩展页面里才好使。
 *
 * 这里按运行环境分流：内容脚本里把请求转交 Service Worker 代发，
 * 扩展页面和 Service Worker 自己直接发。调用方不需要知道自己在哪。
 *
 * 附带好处：所有 AI 请求的 Origin 统一成 chrome-extension://<id>，
 * 用户可以把 OLLAMA_ORIGINS 收窄成只放行这一个来源，
 * 而不必开 "*" 把本地大模型敞开给所有网页。
 */

/**
 * 内容脚本跑在宿主页面的源里；扩展页面是 chrome-extension:；
 * Service Worker 里没有 window。
 */
const IS_CONTENT_SCRIPT = typeof window !== 'undefined'
  && typeof location !== 'undefined'
  && location.protocol !== 'chrome-extension:';

/** 与 fetch 的 Response 保持最小兼容面，调用方改动最小 */
function toResponse({ ok, status, body, error }) {
  if (error) throw new Error(error);
  return {
    ok,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

/**
 * 发一个跨域请求。
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs] 超时；卡住的本地模型不能让请求永远挂着
 * @returns {Promise<{ok:boolean,status:number,json:()=>Promise<any>,text:()=>Promise<string>}>}
 */
export async function request(url, init = {}, timeoutMs = 30000) {
  if (!IS_CONTENT_SCRIPT) {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return resp;
  }

  const reply = await chrome.runtime.sendMessage({
    action: 'proxyFetch',
    url,
    init: {
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    },
    timeoutMs,
  });
  // 通道断了（扩展重载、Service Worker 被回收）没有 reply
  if (!reply) throw new Error('后台无响应，请重试');
  return toResponse(reply);
}
