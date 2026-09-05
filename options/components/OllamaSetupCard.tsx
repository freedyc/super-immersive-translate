/**
 * Ollama 连通性自检。
 *
 * 存在的理由：Ollama 配不通时，扩展侧只能看到一个 HTTP 状态码，而这个码
 * 恰恰对应两个完全不同、且都很隐蔽的原因——
 *
 *   403 → 服务在跑，但 OLLAMA_ORIGINS 没放行本扩展的源。Ollama 默认只信
 *         localhost 来源，扩展的 chrome-extension://<id> 不在其中。
 *   404 → 源放行了，但配置里的模型名本机没装。
 *
 * 两种情况在界面上都表现为「翻译不出结果」，光看译文区分不出来，用户几乎
 * 不可能自己猜到要去设一个环境变量。所以这里主动探一次，把状态码翻译成
 * 「下一步该做什么」，并把命令连同**当前这个安装的真实扩展 ID**一起给出。
 *
 * 扩展 ID 一定要用 chrome.runtime.id 取：未打包扩展的 ID 由安装路径推导，
 * 每个人、每次换目录都不一样，写死在文档里的那个只对作者自己有效。
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import type { SettingsPatchFn } from '../lib/types.ts';

type Probe =
  | { state: 'checking' }
  | { state: 'down' }                                  // 服务没跑
  | { state: 'forbidden' }                             // 403：源没放行
  | { state: 'ok'; models: string[] };

/** 从 /api/chat 这类完整端点回推服务根地址 */
function toBaseUrl(chatUrl: string): string {
  try {
    const u = new URL(chatUrl || 'http://localhost:11434/api/chat');
    return u.origin;
  } catch {
    return 'http://localhost:11434';
  }
}

/** 各平台设置环境变量的方式不同，给当前系统的那一条就够了 */
function originsCommand(extId: string): { cmd: string; after: string } {
  const ua = navigator.userAgent;
  const origin = `chrome-extension://${extId}`;
  if (ua.includes('Windows')) {
    return {
      cmd: `setx OLLAMA_ORIGINS "${origin}"`,
      after: '然后完全退出并重新打开 Ollama（托盘图标右键 → Quit）。',
    };
  }
  if (ua.includes('Mac')) {
    return {
      cmd: `launchctl setenv OLLAMA_ORIGINS "${origin}"`,
      after: '然后必须重启 Ollama.app —— launchctl 设的变量只在进程启动时读一次，不重启不生效。',
    };
  }
  return {
    cmd: `systemctl edit ollama.service\n# 在打开的文件里加入：\n[Service]\nEnvironment="OLLAMA_ORIGINS=${origin}"`,
    after: '保存后执行 sudo systemctl restart ollama。',
  };
}

export function OllamaSetupCard({ settings, update }: {
  settings: Record<string, unknown>;
  update: SettingsPatchFn;
}) {
  const [probe, setProbe] = useState<Probe>({ state: 'checking' });
  const [copied, setCopied] = useState(false);

  const chatUrl = (settings.ollamaUrl as string) || '';
  const model = (settings.ollamaModel as string) || '';
  const extId = chrome.runtime.id;
  const { cmd, after } = originsCommand(extId);

  const check = useCallback(async () => {
    setProbe({ state: 'checking' });
    try {
      // 用 /api/tags 探：它既能验证源是否放行（403），又能顺带拿回已装模型列表，
      // 免得用户再去终端敲一次 ollama list 才知道模型名该填什么。
      const resp = await fetch(`${toBaseUrl(chatUrl)}/api/tags`, {
        signal: AbortSignal.timeout(4000),
      });
      if (resp.status === 403) return setProbe({ state: 'forbidden' });
      if (!resp.ok) return setProbe({ state: 'down' });
      const data = await resp.json();
      const models: string[] = (data.models || []).map((m: { name: string }) => m.name);
      setProbe({ state: 'ok', models });
    } catch {
      // fetch 直接抛 = 连不上（服务没跑 / 地址填错 / 端口不对）
      setProbe({ state: 'down' });
    }
  }, [chatUrl]);

  useEffect(() => { check(); }, [check]);

  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => {});
  };

  const modelMissing = probe.state === 'ok' && model !== '' && !probe.models.includes(model);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">本机 Ollama</span>
        {probe.state === 'checking' && <span className="text-base-content/50">检测中…</span>}
        {probe.state === 'down' && <span className="text-error">连不上</span>}
        {probe.state === 'forbidden' && <span className="text-warning">已启动，但拒绝了本扩展</span>}
        {probe.state === 'ok' && !modelMissing && <span className="text-success">正常</span>}
        {modelMissing && <span className="text-warning">模型未安装</span>}
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1 ml-auto"
          onClick={check}
          disabled={probe.state === 'checking'}
        >
          <RefreshCw className="w-3 h-3" />
          重新检测
        </button>
      </div>

      {probe.state === 'down' && (
        <p className="text-base-content/60">
          没能连上 <code className="text-[11px]">{toBaseUrl(chatUrl)}</code>。
          确认 Ollama 已经在运行（终端执行 <code className="text-[11px]">ollama serve</code>，
          或打开 Ollama 应用），以及上面的「服务地址」填写正确。
        </p>
      )}

      {probe.state === 'forbidden' && (
        <>
          <p className="text-warning flex gap-1.5">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              Ollama 在跑，但只信任 localhost 来源，把本扩展挡掉了（HTTP 403）。
              需要把本扩展的源加进 <code className="text-[11px]">OLLAMA_ORIGINS</code>：
            </span>
          </p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 bg-base-300/60 rounded-lg p-2 overflow-x-auto text-[11px] leading-relaxed whitespace-pre">{cmd}</pre>
            <button type="button" className="btn btn-ghost btn-xs gap-1 shrink-0" onClick={copy}>
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-base-content/60">{after}</p>
          <p className="text-base-content/40">
            这里的 <code className="text-[11px]">{extId}</code> 是 <b>你这个安装</b> 的扩展 ID。
            未打包扩展的 ID 由安装目录推导，换目录或重装都会变，换了要重新设一次。
          </p>
        </>
      )}

      {probe.state === 'ok' && (
        <>
          {modelMissing && (
            <p className="text-warning flex gap-1.5">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
              <span>本机没有 <code className="text-[11px]">{model}</code>，请求会返回 404。
                先 <code className="text-[11px]">ollama pull {model}</code>，或从下面已装的模型里选一个。</span>
            </p>
          )}
          {probe.models.length === 0 ? (
            <p className="text-base-content/60">
              连上了，但一个模型都没装。先执行 <code className="text-[11px]">ollama pull translategemma:4b</code>。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-base-content/50">已安装：</span>
              {probe.models.map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`btn btn-xs ${m === model ? 'btn-primary' : 'btn-ghost bg-base-300/50'}`}
                  onClick={() => update({ ollamaModel: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
