/**
 * 图片翻译标签页：上传/拖拽/粘贴图片 → OCR 识别文字 → 翻译。
 *
 * 隐私提示：OCR 走的是第三方服务 api.ocr.space（用的是它的公开演示 key），
 * 图片会以 base64 上传到该服务，不是在本地识别。界面上必须把这一点告诉用户，
 * 否则用户可能拿它处理含敏感信息的截图。
 * （架构蓝图里"用 tesseract.js 做本地 OCR"是另一件事，尚未实施。）
 */
import { useCallback, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { OCR_LANG_MAP } from '../../utils/langs.ts';
import type { TranslateContext } from '../lib/types.ts';

/** OCR 到翻译的阶段，null 表示空闲 */
type Stage = 'reading' | 'ocr' | 'translating' | null;

interface OcrResult {
  extracted: string;
  translated: string;
}

const OCR_ENDPOINT = 'https://api.ocr.space/parse/image';

export function ImageTab({ engine, sourceLang, targetLang }: TranslateContext) {
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleImage = useCallback(async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;

    setError(null);
    setResult(null);
    setStage('reading');

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('读取图片文件失败'));
      reader.readAsDataURL(file);
    }).catch((err: Error) => { setError(err.message); setStage(null); return null; });
    if (!base64) return;

    setPreview(base64);
    setStage('ocr');

    try {
      const form = new FormData();
      form.append('base64Image', base64);
      form.append('language', (sourceLang !== 'auto' && OCR_LANG_MAP[sourceLang]) || 'eng');
      form.append('apikey', 'helloworld'); // OCR.space 的公开演示 key，有速率限制

      const resp = await fetch(OCR_ENDPOINT, { method: 'POST', body: form });
      if (!resp.ok) throw new Error(`OCR 接口返回错误: ${resp.status}`);

      const data = await resp.json();
      if (data.IsErroredOnProcessing) {
        throw new Error(data.ErrorMessage ? data.ErrorMessage.join(', ') : '识别服务出错');
      }

      const extracted = data.ParsedResults?.[0]?.ParsedText?.trim();
      if (!extracted) throw new Error('未能在图片中检测到文字，请上传包含清晰文字的图片。');

      setStage('translating');
      window.translator.engine = engine;
      window.translator.sourceLang = sourceLang;
      window.translator.targetLang = targetLang;
      const translated = await window.translator.translate(extracted);

      setResult({ extracted, translated });
    } catch (err) {
      setError((err as Error).message || String(err));
    } finally {
      setStage(null);
    }
  }, [engine, sourceLang, targetLang]);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setStage(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const STAGE_TEXT: Record<Exclude<Stage, null>, string> = {
    reading: '正在读取图片...',
    ocr: '正在通过云端进行 OCR 文字识别...',
    translating: '文字识别完成，正在翻译...',
  };
  const stageText = stage ? STAGE_TEXT[stage] : '';

  if (!preview) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div
          className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-base-300'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleImage(e.dataTransfer.files?.[0]); }}
        >
          <ImageIcon className="w-12 h-12 text-base-content/40" />
          <p className="text-base text-base-content/60">拖拽图片到此处，或点击选择</p>
          <p className="text-xs text-base-content/40">也可以直接在页面上按 Ctrl/Cmd + V 粘贴截图</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handleImage(e.target.files?.[0])}
          />
        </div>
        <p className="text-xs text-base-content/40 mt-4 max-w-lg text-center">
          文字识别由第三方服务 ocr.space 完成，图片会上传到该服务，请勿用于含敏感信息的图片。
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 grid md:grid-cols-2 gap-6 min-h-[300px]">
      <div className="flex flex-col gap-3">
        <img src={preview} alt="待识别图片" className="w-full rounded-xl border border-base-200 object-contain max-h-80" />
        <button className="btn btn-ghost btn-sm gap-1 self-start" onClick={reset}>
          <X className="w-4 h-4" />
          换一张
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {stage && (
          <div className="text-xs text-base-content/50 flex items-center gap-2">
            <span className="loading loading-spinner loading-xs" />
            {stageText}
          </div>
        )}

        {error && <p className="text-error text-sm font-semibold">{error}</p>}

        {result && (
          <>
            <div>
              <span className="badge badge-sm badge-outline mb-1">OCR 识别原文</span>
              <p className="text-sm font-medium leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                {result.extracted}
              </p>
            </div>
            <div className="pt-4 border-t border-base-200">
              <span className="badge badge-sm badge-primary mb-1">译文</span>
              <p className="text-sm font-bold text-primary leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                {result.translated}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
