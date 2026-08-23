/**
 * 一条图片剪贴板记录。
 *
 * 列表里只渲染缩略图（入库时生成）：三十张原图一次性读进内存，
 * 页面会卡住，而列表根本不需要原始分辨率。原图在点「复制」时才按 id 取。
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Pin, PinOff, Trash2 } from 'lucide-react';
import { getImage } from '../../utils/image-store.js';
import type { ClipboardImageMeta } from '../../types/models.ts';

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 把图片写回系统剪贴板。
 *
 * 浏览器剪贴板对图片类型很挑：实际只保证支持 image/png。JPEG/WebP 要先
 * 转成 PNG，否则 write() 直接抛错——这一步不做的话，从网页存下来的 JPEG
 * 有很大概率复制不出去。
 */
async function copyImage(blob: Blob): Promise<void> {
  let out = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转 PNG 失败'))), 'image/png');
    });
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': out })]);
}

export function ImageItem({ meta, onTogglePin, onDelete }: {
  meta: ClipboardImageMeta;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState('');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    const blob = meta.thumb;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setThumbUrl(url);
    // 不撤销的话，翻几次列表就会攒下几十个再也用不到的 blob URL
    return () => URL.revokeObjectURL(url);
  }, [meta.thumb]);

  const copy = async () => {
    try {
      const record = await getImage(meta.id);
      if (!record?.blob) throw new Error('原图已丢失');
      await copyImage(record.blob);
      setState('copied');
      setTimeout(() => setState('idle'), 1400);
    } catch {
      setState('failed');
      setTimeout(() => setState('idle'), 2200);
    }
  };

  const download = async () => {
    const record = await getImage(meta.id);
    if (!record?.blob) return;
    const url = URL.createObjectURL(record.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipboard-${meta.id.slice(0, 8)}.${(meta.type.split('/')[1] || 'png')}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card bg-base-100 shadow-sm rounded-xl">
      <div className="card-body p-4 gap-2">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg overflow-hidden bg-base-200 border border-base-300">
            {thumbUrl
              ? <img src={thumbUrl} alt="" className="block max-w-40 max-h-28 object-contain" />
              : <div className="w-40 h-28 flex items-center justify-center text-xs text-base-content/40">
                  无缩略图
                </div>}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="text-xs text-base-content/50">
              {meta.width && meta.height ? `${meta.width}×${meta.height} · ` : ''}
              {formatSize(meta.size)} · {meta.type.replace('image/', '').toUpperCase()}
            </div>
            {meta.url && (
              <a
                href={meta.url}
                target="_blank"
                rel="noreferrer"
                className="link link-hover text-xs text-base-content/50 truncate"
                title={meta.url}
              >
                {meta.title || meta.url}
              </a>
            )}
            <div className="text-xs text-base-content/40">
              {new Date(meta.timestamp).toLocaleString('zh-CN')}
            </div>
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <button
              className={`btn btn-sm gap-1 ${
                state === 'copied' ? 'btn-success' : state === 'failed' ? 'btn-warning' : 'btn-primary btn-outline'
              }`}
              onClick={copy}
            >
              {state === 'copied' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制'}
            </button>
            <div className="flex gap-1">
              <button className="btn btn-ghost btn-xs btn-circle" title="下载" onClick={download}>
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                title={meta.pinned ? '取消置顶' : '置顶（不会被容量淘汰）'}
                onClick={() => onTogglePin(meta.id)}
              >
                {meta.pinned
                  ? <Pin className="w-3.5 h-3.5 text-primary" />
                  : <PinOff className="w-3.5 h-3.5 opacity-50" />}
              </button>
              <button className="btn btn-ghost btn-xs btn-circle" title="删除" onClick={() => onDelete(meta.id)}>
                <Trash2 className="w-3.5 h-3.5 text-error/60" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
