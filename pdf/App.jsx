/**
 * 文档翻译工作台：上传/拖拽 PDF·TXT·MD·HTML，提取文本，按段落逐段翻译。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Upload, Copy, Check, Languages, Trash2 } from 'lucide-react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { Translator } from '../utils/translator.js';
import { extractTextFromFile } from './lib/pdfExtract.js';

const ENGINES = [
  ['google', 'Google 翻译'],
  ['lingva', 'Lingva'],
  ['libre', 'LibreTranslate'],
  ['mymemory', 'MyMemory'],
  ['deepl', 'DeepL'],
];

export function App() {
  const [engine, setEngine] = useState('google');
  const [source, setSource] = useState('');
  const [paragraphs, setParagraphs] = useState([]);
  const [progress, setProgress] = useState(null); // { done, total, finished }
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState(null);
  const [dragging, setDragging] = useState(false);
  const themeSlotRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { applyTheme(); }, []);
  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, []);

  useEffect(() => {
    chrome.storage.sync.get({ engine: 'google' }).then((s) => setEngine(s.engine));
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await extractTextFromFile(file);
      if (text.length < 2) {
        setToast({ severity: 'warning', message: '未能从文件中提取到文本，请尝试手动粘贴' });
        return;
      }
      setSource(text);
      setParagraphs([]);
    } catch (err) {
      setToast({ severity: 'error', message: `文件读取失败：${err.message}` });
    }
  }, []);

  const doTranslate = async () => {
    const text = source.trim();
    if (!text) return;

    const chunks = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (chunks.length === 0) return;

    const t = new Translator();
    await t.init();
    t.engine = engine;

    setProgress({ done: 0, total: chunks.length, finished: false });
    setParagraphs([]);

    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        results.push(await t.translate(chunks[i]) || chunks[i]);
      } catch {
        results.push(`[翻译失败] ${chunks[i].slice(0, 50)}...`);
      }
      setProgress({ done: i + 1, total: chunks.length, finished: false });
    }

    setParagraphs(results);
    setProgress({ done: chunks.length, total: chunks.length, finished: true });
    setTimeout(() => setProgress(null), 2000);
  };

  const handleCopy = () => {
    const text = paragraphs.join('\n\n');
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasContent = source.trim().length > 0;

  return (
    <>
      <div className="navbar bg-base-100 shadow px-4">
        <div className="navbar-start">
          <span className="flex items-center gap-2 font-semibold text-base">
            <FileText className="w-5 h-5 text-primary" />
            文档翻译
          </span>
        </div>
        <div className="navbar-end flex items-center gap-2">
          <select
            className="select select-bordered select-sm"
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
          >
            {ENGINES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <div ref={themeSlotRef} />
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 flex flex-col gap-4">
        {!hasContent ? (
          <div
            className={`card border-2 border-dashed bg-base-100 flex items-center justify-center min-h-64 cursor-pointer transition-colors ${
              dragging ? 'border-primary' : 'border-base-300'
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          >
            <div className="card-body items-center text-center py-10">
              <Upload className="w-12 h-12 text-base-content/40 mb-3" />
              <p className="text-base text-base-content/60 mb-3">拖拽 PDF / TXT 文件到此处，或</p>
              <span className="btn btn-primary btn-sm">选择文件</span>
              <p className="text-xs text-base-content/40 mt-2">支持 PDF、TXT、Markdown、HTML</p>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card bg-base-100 shadow-sm rounded-xl flex flex-col overflow-hidden">
              <div className="card-body p-0 flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 border-b border-base-200 text-sm font-medium text-base-content/60">
                  <span>原文</span>
                  <span className="badge badge-ghost badge-sm">{source.length.toLocaleString()} 字</span>
                </div>
                <textarea
                  className="flex-1 w-full p-4 text-sm leading-relaxed bg-transparent resize-none outline-none min-h-96 font-sans"
                  placeholder="在此粘贴或编辑文本..."
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>
            </div>

            <div className="card bg-base-100 shadow-sm rounded-xl flex flex-col overflow-hidden">
              <div className="card-body p-0 flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 border-b border-base-200 text-sm font-medium text-base-content/60">
                  <span>译文</span>
                  <button className="btn btn-ghost btn-xs gap-1" onClick={handleCopy}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="flex-1 p-4 text-sm leading-relaxed overflow-y-auto text-secondary break-words min-h-96">
                  {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn btn-primary btn-sm gap-1"
            disabled={!hasContent || (progress && !progress.finished)}
            onClick={doTranslate}
          >
            <Languages className="w-4 h-4" />
            翻译
          </button>
          <button
            className="btn btn-ghost btn-sm gap-1"
            onClick={() => { setSource(''); setParagraphs([]); setProgress(null); }}
          >
            <Trash2 className="w-4 h-4" />
            清空
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.html,.htm"
            hidden
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        {progress && (
          <div className="card bg-base-100 shadow-sm rounded-xl px-4 py-3 flex-row items-center gap-3">
            <div className="flex-1 h-1.5 bg-base-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-base-content/60 whitespace-nowrap">
              {progress.finished ? '✓ 翻译完成' : `翻译中 ${progress.done}/${progress.total}`}
            </span>
          </div>
        )}
      </div>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
