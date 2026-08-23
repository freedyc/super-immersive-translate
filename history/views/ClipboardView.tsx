/**
 * 剪贴板历史。
 *
 * 复制回剪贴板是这个页面存在的理由，所以「复制」按钮给了明确的成功反馈——
 * 点完没有任何变化的话，用户没法确认到底复制成功没有，只能再点一次。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardPaste, Copy, Image as ImageIcon, Inbox, Pin, PinOff, SearchX, Trash2 } from 'lucide-react';
import {
  deleteImage, listImages, putImage, trimImages, updateImage,
} from '../../utils/image-store.js';
import { ImageItem } from './ImageItem.tsx';
import type { ClipboardEntry, ClipboardImageMeta } from '../../types/models.ts';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Item({ entry, onCopy, onTogglePin, onDelete }: {
  entry: ClipboardEntry;
  onCopy: (entry: ClipboardEntry) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    onCopy(entry);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl">
      <div className="card-body p-4 gap-2">
        <div className="flex items-start gap-2">
          {/* 整段用 pre-wrap：复制下来的常常是代码或多行文本，压成一行就没法看了 */}
          <pre className="flex-1 min-w-0 whitespace-pre-wrap break-words text-sm font-sans max-h-40 overflow-y-auto m-0">
            {entry.text}
          </pre>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              className={`btn btn-sm gap-1 ${copied ? 'btn-success' : 'btn-primary btn-outline'}`}
              onClick={copy}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已复制' : '复制'}
            </button>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost btn-xs btn-circle"
                title={entry.pinned ? '取消置顶' : '置顶（不会被容量裁剪）'}
                onClick={() => onTogglePin(entry.id)}
              >
                {entry.pinned
                  ? <Pin className="w-3.5 h-3.5 text-primary" />
                  : <PinOff className="w-3.5 h-3.5 opacity-50" />}
              </button>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                title="删除"
                onClick={() => onDelete(entry.id)}
              >
                <Trash2 className="w-3.5 h-3.5 text-error/60" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-base-content/40 flex-wrap">
          <span>{relativeTime(entry.timestamp)}</span>
          <span>· {entry.text.length} 字</span>
          {entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="link link-hover truncate max-w-xs"
              title={entry.url}
            >
              {entry.title || entry.url}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

type Kind = 'all' | 'text' | 'image';

export function ClipboardView({ entries, search, onChange }: {
  entries: ClipboardEntry[];
  search: string;
  onChange: (next: ClipboardEntry[]) => void;
}) {
  const [kind, setKind] = useState<Kind>('all');
  const [images, setImages] = useState<ClipboardImageMeta[]>([]);
  const [pasteHint, setPasteHint] = useState('');

  const reloadImages = useCallback(() => {
    listImages().then(setImages).catch(() => setImages([]));
  }, []);

  useEffect(() => {
    reloadImages();
    // 图片是在 Service Worker 里入库的（右键菜单），这一页收不到 IndexedDB 的
    // 变更通知，只能靠后台发消息
    const onMsg = (msg: { action?: string }) => {
      if (msg?.action === 'clipboardImagesChanged') reloadImages();
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [reloadImages]);

  /**
   * 从系统剪贴板读一张图存进来。
   *
   * navigator.clipboard.read() 需要用户手势和页面焦点——所以这是个按钮，
   * 不可能做成自动轮询。右键菜单那条路负责网页上的图片，这条负责截图工具
   * 之类"图片已经在剪贴板里"的情况。
   */
  const pasteFromClipboard = useCallback(async () => {
    setPasteHint('');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        await putImage({
          id: crypto.randomUUID(),
          blob,
          thumb: blob, // 页面里没有 OffscreenCanvas 的必要，原图当缩略图，列表用 CSS 限制尺寸
          type: blob.type,
          size: blob.size,
          width: 0,
          height: 0,
          timestamp: Date.now(),
        });
        await trimImages(30);
        reloadImages();
        setKind('image');
        return;
      }
      setPasteHint('剪贴板里没有图片');
    } catch {
      setPasteHint('读不到剪贴板——浏览器要求先授予权限，且页面需处于焦点');
    }
  }, [reloadImages]);

  const togglePinImage = useCallback(async (id: string) => {
    const target = images.find((i) => i.id === id);
    await updateImage(id, { pinned: !target?.pinned });
    reloadImages();
  }, [images, reloadImages]);

  const removeImage = useCallback(async (id: string) => {
    await deleteImage(id);
    reloadImages();
  }, [reloadImages]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries;
    // 置顶的排前面，其余按时间倒序
    return [...list].sort((a, b) =>
      (Number(!!b.pinned) - Number(!!a.pinned)) || (b.timestamp - a.timestamp));
  }, [entries, search]);

  const copy = useCallback((entry: ClipboardEntry) => {
    navigator.clipboard.writeText(entry.text).catch(() => {
      // 少数环境下 clipboard 权限被拒，退回 execCommand
      const ta = document.createElement('textarea');
      ta.value = entry.text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }, []);

  const togglePin = useCallback((id: string) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e)));
  }, [entries, onChange]);

  const remove = useCallback((id: string) => {
    onChange(entries.filter((e) => e.id !== id));
  }, [entries, onChange]);

  const visibleImages = useMemo(() => {
    if (kind === 'text') return [];
    const q = search.trim().toLowerCase();
    if (!q) return images;
    // 图片没有正文可搜，只能按来源页面匹配
    return images.filter((i) =>
      (i.title || '').toLowerCase().includes(q) || (i.url || '').toLowerCase().includes(q));
  }, [images, kind, search]);

  const visibleText = kind === 'image' ? [] : filtered;

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      <div role="tablist" className="tabs tabs-box tabs-sm">
        {([['all', '全部'], ['text', '文字'], ['image', '图片']] as [Kind, string][]).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            className={`tab ${kind === k ? 'tab-active' : ''}`}
            onClick={() => setKind(k)}
          >
            {label}
            <span className="badge badge-ghost badge-xs ml-1.5 tabular-nums">
              {k === 'text' ? entries.length : k === 'image' ? images.length : entries.length + images.length}
            </span>
          </button>
        ))}
      </div>
      <button className="btn btn-sm btn-outline gap-1.5" onClick={pasteFromClipboard}>
        <ClipboardPaste className="w-3.5 h-3.5" />
        粘贴图片
      </button>
      {pasteHint && <span className="text-xs text-warning">{pasteHint}</span>}
      <span className="text-xs text-base-content/40">
        网页上的图片：右键 →「保存图片到剪贴板历史」
      </span>
    </div>
  );

  if (entries.length === 0 && images.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
          <Inbox className="w-10 h-10 text-base-content/25" />
          <h3 className="text-lg font-semibold text-base-content/60">还没有复制记录</h3>
          <p className="text-sm text-base-content/50 max-w-sm">
            在任意网页上复制文字会自动记到这里；图片用右键菜单保存。
            密码框里的内容不会被记录。
          </p>
        </div>
      </div>
    );
  }

  const empty = visibleText.length === 0 && visibleImages.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      {empty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
          {kind === 'image' && images.length === 0
            ? <ImageIcon className="w-10 h-10 text-base-content/25" />
            : <SearchX className="w-10 h-10 text-base-content/25" />}
          <p className="text-sm text-base-content/50">
            {kind === 'image' && images.length === 0
              ? '还没有图片。在网页图片上右键选「保存图片到剪贴板历史」'
              : '没有匹配的记录'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleImages.map((meta) => (
            <ImageItem
              key={meta.id}
              meta={meta}
              onTogglePin={togglePinImage}
              onDelete={removeImage}
            />
          ))}
          {visibleText.map((entry) => (
            <Item
              key={entry.id}
              entry={entry}
              onCopy={copy}
              onTogglePin={togglePin}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
