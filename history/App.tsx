/**
 * 翻译历史页。
 *
 * 迁移时顺带补了 chrome.storage.onChanged 监听：GitHub 同步会在后台把远端合并结果
 * 写回 translationHistory，原来的实现只在打开页面时读一次，同步进来的记录不会出现，
 * 而且用户在页面上删一条时会拿内存里的旧快照整体覆盖回去、把同步下来的记录抹掉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Inbox, SearchX, Trash2, X } from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { ClipboardList } from 'lucide-react';
import { ClipboardView } from './views/ClipboardView.tsx';
import type { ClipboardEntry, HistoryEntry } from '../types/models.ts';

function formatTime(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

type Tab = 'translation' | 'clipboard';

export function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>([]);
  const [tab, setTab] = useState<Tab>(
    () => (new URLSearchParams(location.search).get('tab') === 'clipboard' ? 'clipboard' : 'translation'),
  );
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const themeSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => { applyTheme(); }, []);
  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, []);

  useEffect(() => {
    chrome.storage.local.get(['translationHistory', 'clipboardHistory']).then((stored) => {
      setHistory((stored.translationHistory as HistoryEntry[]) ?? []);
      setClipboard((stored.clipboardHistory as ClipboardEntry[]) ?? []);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes.translationHistory) {
        setHistory((changes.translationHistory.newValue as HistoryEntry[]) || []);
      }
      // 剪贴板是在别的标签页复制时写入的，不监听的话这一页会一直是打开时的快照
      if (changes.clipboardHistory) {
        setClipboard((changes.clipboardHistory.newValue as ClipboardEntry[]) || []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const persist = useCallback(async (next: HistoryEntry[]) => {
    setHistory(next);
    await chrome.storage.local.set({ translationHistory: next });
  }, []);

  const persistClipboard = useCallback(async (next: ClipboardEntry[]) => {
    setClipboard(next);
    await chrome.storage.local.set({ clipboardHistory: next });
  }, []);

  const current = tab === 'translation' ? history : clipboard;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((item) =>
      (item.text || '').toLowerCase().includes(q) ||
      (item.translation || '').toLowerCase().includes(q),
    );
  }, [history, search]);

  return (
    <>
      <div className="navbar bg-base-100 shadow px-4">
        <div className="navbar-start">
          <div role="tablist" className="tabs tabs-box">
            <button
              role="tab"
              className={`tab gap-1.5 ${tab === 'translation' ? 'tab-active' : ''}`}
              onClick={() => { setTab('translation'); setSearch(''); }}
            >
              <History className="w-4 h-4" />
              翻译历史
            </button>
            <button
              role="tab"
              className={`tab gap-1.5 ${tab === 'clipboard' ? 'tab-active' : ''}`}
              onClick={() => { setTab('clipboard'); setSearch(''); }}
            >
              <ClipboardList className="w-4 h-4" />
              剪贴板
            </button>
          </div>
        </div>
        <div className="navbar-end flex items-center gap-2">
          <input
            type="text"
            placeholder="搜索历史..."
            className="input input-sm w-44"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="badge badge-ghost">{current.length} 条记录</span>
          <button
            className="btn btn-error btn-outline btn-sm gap-1"
            disabled={current.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="w-4 h-4" />
            清空
          </button>
          <div ref={themeSlotRef} />
        </div>
      </div>

      <p className="text-xs text-base-content/40 text-center py-1">
        提示：开启 GitHub 同步后，删除的记录可能会在下次同步时从其他设备恢复
      </p>

      <main className="container mx-auto p-4">
        {tab === 'clipboard' ? (
          <ClipboardView entries={clipboard} search={search} onChange={persistClipboard} />
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-base-content/50">
            <Inbox className="w-16 h-16 mb-4 text-base-content/30" />
            <h3 className="text-lg font-semibold mb-1">暂无翻译历史</h3>
            <p className="text-sm">划词翻译时会自动记录到这里</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-base-content/50">
            <SearchX className="w-10 h-10 mb-3 text-base-content/30" />
            <p className="text-sm">没有匹配的记录</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((item, i) => (
              <div key={item.id || `${item.timestamp}-${i}`} className="card bg-base-100 shadow-sm">
                <div className="card-body p-4 gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-base-content text-sm leading-relaxed break-words flex-1">
                      {item.text}
                    </span>
                    <button
                      className="btn btn-ghost btn-xs shrink-0"
                      title="删除"
                      onClick={() => persist(history.filter((h) => h !== item))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-sm text-secondary leading-relaxed break-words">
                    {item.translation || ''}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/50">
                    {item.engine && <span className="badge badge-ghost badge-sm">{item.engine}</span>}
                    <span>{formatTime(item.timestamp)}</span>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" title={item.url} className="link link-primary">
                        {item.title || '来源页面'}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>
          清空{tab === 'clipboard' ? '剪贴板记录' : '翻译历史'}？
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            将删除全部 {current.length} 条记录，此操作不可撤销。
            如果开启了 GitHub 同步，删除的记录可能会在下次同步时从其他设备恢复。
            {tab === 'clipboard' && ' 置顶的记录也会一并删除。'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>取消</button>
          <button
            className="btn btn-error btn-sm"
            onClick={async () => {
              if (tab === 'clipboard') await persistClipboard([]);
              else await persist([]);
              setConfirmClear(false);
            }}
          >
            确认清空
          </button>
        </DialogActions>
      </Dialog>
    </>
  );
}
