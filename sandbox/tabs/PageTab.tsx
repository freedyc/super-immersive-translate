/**
 * 「当前页」标签页 —— 只在侧边栏模式（?context=panel）下出现。
 *
 * 两件事：显示/切换当前标签页的整页翻译，以及联动划词——
 * content/selection.js 在用户选中文字时会广播 panelSelection 消息，
 * 这里收到后直接翻译并展示，不用切回网页。
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe2, Languages } from 'lucide-react';
import type { TranslateContext } from '../lib/types.ts';

/** chrome:// 等受限页面无法注入内容脚本，也就无法翻译 */
const RESTRICTED = /^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/;

interface PageInfo {
  title: string;
  url: string;
  restricted: boolean;
}

export function PageTab({ engine, targetLang }: Pick<TranslateContext, 'engine' | 'targetLang'>) {
  const [page, setPage] = useState<PageInfo | null>(null);
  const [selection, setSelection] = useState<{ text: string; result: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const url = tab.url || '';
      setPage({ title: tab.title || '(无标题)', url, restricted: !url || RESTRICTED.test(url) });
    } catch { /* 拿不到就保持上一次的显示 */ }
  }, []);

  useEffect(() => {
    refresh();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === 'complete' || info.title || info.url) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh]);

  // 划词联动：网页里选中文字 → 内容脚本广播 → 这里翻译并展示
  useEffect(() => {
    const onMessage = (msg: { action?: string; text?: string }) => {
      if (msg.action !== 'panelSelection' || !msg.text) return;
      const text = msg.text;
      setSelection({ text, result: '翻译中…' });
      window.translator.engine = engine;
      window.translator.targetLang = targetLang;
      window.translator.translate(text)
        .then((result) => setSelection({ text, result }))
        .catch(() => setSelection({ text, result: '翻译失败' }));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [engine, targetLang]);

  const togglePage = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
      setUnavailable(false);
    } catch {
      // 内容脚本没注入（受限页面，或页面在扩展安装前就已打开）
      setUnavailable(true);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-4 min-h-[300px]">
      <div className="card bg-base-100 shadow-sm rounded-xl">
        <div className="card-body p-4 gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Globe2 className="w-4 h-4 text-primary" />
            <span className="truncate">{page?.title ?? '（未获取到当前页）'}</span>
          </div>
          {page?.url && (
            <a href={page.url} target="_blank" rel="noreferrer" className="link link-primary text-xs truncate">
              {page.url}
            </a>
          )}
          <button className="btn btn-primary btn-sm w-fit mt-1 gap-1" onClick={togglePage}>
            <Languages className="w-4 h-4" />
            翻译/还原当前页
          </button>
          {(unavailable || page?.restricted) && (
            <p className="text-xs text-warning">当前页面不可翻译（受限页面）。</p>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm rounded-xl flex-1">
        <div className="card-body p-4 gap-2">
          <div className="text-xs font-semibold text-base-content/50">划词联动</div>
          <div className="text-sm font-medium break-words">
            {selection?.text ?? '在网页中选中文字即可在此翻译'}
          </div>
          <div className="divider my-1" />
          <div className="text-sm text-secondary break-words">{selection?.result ?? ''}</div>
        </div>
      </div>
    </div>
  );
}
