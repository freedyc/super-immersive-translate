/**
 * 文档翻译标签页。
 *
 * 迁移时重写了这一块：原来的实现是个假功能——它跑一个 setInterval 假进度条，
 * 完全不读用户上传的文件，只翻译一句写死的英文示例，然后显示"文档翻译成功"。
 * 现在改成真的：复用 pdf/lib/pdfExtract.js 的提取实现（跟文档翻译页同一套），
 * 按段落逐段翻译，进度是真实进度，导出的也是真实译文。
 */
import { useRef, useState } from 'react';
import { FileText, Download, X } from 'lucide-react';
import { extractTextFromFile } from '../../pdf/lib/pdfExtract.ts';
import type { TranslateContext } from '../lib/types.ts';

export function DocTab({ engine, sourceLang, targetLang }: TranslateContext) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [translated, setTranslated] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    setTranslated('');
    setError(null);
    setProgress(0);
    setStatus('正在解析文档...');

    try {
      const text = await extractTextFromFile(picked);
      if (text.length < 2) throw new Error('未能从文件中提取到文本内容');

      const chunks = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (chunks.length === 0) throw new Error('文档里没有可翻译的段落');

      window.translator.engine = engine;
      window.translator.sourceLang = sourceLang;
      window.translator.targetLang = targetLang;

      setStatus(`解析成功，共 ${chunks.length} 段，开始翻译...`);
      const results: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        try {
          results.push(await window.translator.translate(chunks[i]) || chunks[i]);
        } catch {
          results.push(`[翻译失败] ${chunks[i].slice(0, 50)}...`);
        }
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
        setStatus(`翻译中 ${i + 1}/${chunks.length}`);
      }

      // 导出成原文/译文段落交替的对照文本，比只给译文更有用
      setTranslated(chunks.map((src, i) => `${src}\n${results[i]}`).join('\n\n'));
      setStatus('文档翻译完成');
    } catch (err) {
      setError((err as Error).message || String(err));
      setStatus('');
    }
  };

  const reset = () => {
    setFile(null);
    setTranslated('');
    setError(null);
    setProgress(0);
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = () => {
    if (!translated || !file) return;
    const blob = new Blob([translated], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[双语]_${file.name.replace(/\.[^/.]+$/, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!file) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div
          className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-base-300'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
        >
          <FileText className="w-12 h-12 text-base-content/40" />
          <p className="text-base text-base-content/60">拖拽文档到此处，或点击选择</p>
          <p className="text-xs text-base-content/40">支持 PDF、TXT、Markdown、HTML</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,.html,.htm"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-4 min-h-[300px]">
      <div className="flex items-center gap-3">
        <FileText className="w-8 h-8 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{file.name}</div>
          <div className="text-xs text-base-content/50">{(file.size / 1024).toFixed(1)} KB</div>
        </div>
        <button className="btn btn-ghost btn-sm btn-circle" title="移除" onClick={reset}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {progress > 0 && <progress className="progress progress-primary w-full" value={progress} max="100" />}
      {status && <p className="text-sm text-base-content/60">{status}</p>}
      {error && <p className="text-error text-sm font-semibold">{error}</p>}

      {translated && (
        <>
          <button className="btn btn-primary btn-sm gap-1 self-start" onClick={download}>
            <Download className="w-4 h-4" />
            下载双语文本
          </button>
          <div className="text-sm leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto bg-base-200/40 rounded-xl p-4">
            {translated}
          </div>
        </>
      )}
    </div>
  );
}
