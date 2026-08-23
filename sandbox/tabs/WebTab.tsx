/**
 * 网站翻译标签页：输入网址，在新标签页打开。
 *
 * 这里只负责"把页面打开"——真正的翻译由注入到该页面的 content/content.js 完成，
 * 所以这个标签页本身不调用任何翻译接口。
 */
import { useState } from 'react';
import { Globe, ArrowRight } from 'lucide-react';

const QUICK_LINKS = [
  ['Hacker News', 'news.ycombinator.com'],
  ['Reddit', 'reddit.com'],
  ['GitHub Trending', 'github.com/trending'],
  ['arXiv', 'arxiv.org'],
] as const;

function openSite(raw: string) {
  const url = raw.trim();
  if (!url) return;
  chrome.tabs.create({ url: /^https?:\/\//i.test(url) ? url : `https://${url}` });
}

export function WebTab() {
  const [url, setUrl] = useState('');

  return (
    <div className="p-8 flex flex-col items-center gap-6 min-h-[300px]">
      <div className="w-full max-w-lg flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            className="input input-bordered flex-1"
            placeholder="输入网址，例如 example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') openSite(url); }}
          />
          <button className="btn btn-primary gap-1" onClick={() => openSite(url)}>
            <ArrowRight className="w-4 h-4" />
            打开
          </button>
        </div>
        <p className="text-xs text-base-content/40">
          页面会在新标签页打开，按 Alt + T 或点击扩展图标即可开始整页双语翻译。
        </p>
      </div>

      <div className="w-full max-w-lg">
        <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40 mb-2">常用站点</h4>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map(([label, host]) => (
            <button
              key={host}
              className="btn btn-outline btn-sm gap-1"
              onClick={() => openSite(host)}
            >
              <Globe className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
