/**
 * 文字翻译标签页：输入/译文双栏、语音输入、朗读、收藏、语法分析。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Volume2, Sparkles, Copy, Star, X } from 'lucide-react';
import { saveHistoryEntry } from '../../utils/history.js';
import { collectWord, getWord } from '../../utils/learning/collect.ts';
import { enrichWordWithAi, analyzeSentence } from '../../utils/example-sentence.js';
import { POS_BADGE_CLASS } from '../../wordbook/lib/mastery.ts';
import type { TabPropsWithNotify, SentenceAnalysis, SaveCandidate } from '../lib/types.ts';

export function TextTab({ engine, sourceLang, targetLang, notify }: TabPropsWithNotify) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [listening, setListening] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastSaveDataRef = useRef<SaveCandidate | null>(null);

  const doTranslate = useCallback(async (text?: string) => {
    const trimmed = (text ?? source).trim();
    if (!trimmed) { setTarget(''); return; }

    setLoading(true);
    setSaved(false);
    setAnalysis(null); // 换了原文，之前的语法分析结果不再对应
    lastSaveDataRef.current = null;

    try {
      window.translator.engine = engine;
      window.translator.sourceLang = sourceLang;
      window.translator.targetLang = targetLang;

      const result = await window.translator.translate(trimmed);
      if (result) {
        setTarget(result);
        lastSaveDataRef.current = { source: trimmed, target: result, engine };
        saveHistoryEntry({ text: trimmed, translation: result, engine });
      } else {
        setTarget('翻译返回空结果');
      }
    } catch (err) {
      setTarget(`翻译失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [source, engine, sourceLang, targetLang]);

  // 输入停顿 800ms 自动翻译，跟原来的手感一致
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!source.trim()) { setTarget(''); return; }
    debounceRef.current = setTimeout(() => doTranslate(source), 800);
    return () => clearTimeout(debounceRef.current);
    // doTranslate 依赖 source，这里只在文本或引擎/语言变化时重排定时器
  }, [source, engine, sourceLang, targetLang]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveWord = async () => {
    const data = lastSaveDataRef.current;
    if (!data) return;
    const existing = await getWord(data.source);
    await collectWord({
      text: data.source,
      translations: { [data.engine]: data.target },
    });
    // 这里收藏抓不到页面上下文，异步补一条 AI 例句 + 词性/音标。
    // 已经收藏过的不重复补，否则每点一次都会多生成一条例句
    if (!existing) enrichWordWithAi(data.source, false);
    setSaved(true);
  };

  const handleAnalyze = async () => {
    const text = source.trim();
    if (!text) return;
    setAnalyzing(true);
    try {
      const result = await analyzeSentence(text, window.translator);
      if (!result) {
        notify({ severity: 'warning', message: '分析失败，请检查是否已配置 AI 引擎（OpenAI/Gemini/Claude）或本地 Ollama' });
        return;
      }
      setAnalysis(result);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      notify({ severity: 'warning', message: '当前浏览器不支持语音输入' });
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SR();
    recognition.lang = sourceLang === 'auto' ? 'en-US' : sourceLang;
    recognition.interimResults = false;
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0][0].transcript;
      setSource((prev) => (prev ? `${prev} ${text}` : text));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="flex flex-col md:flex-row md:flex-wrap min-h-[250px]">
      <div className="flex-1 p-6 flex flex-col border-b md:border-b-0 md:border-r border-base-200 relative group">
        <textarea
          className="w-full flex-1 resize-none bg-transparent outline-none text-xl placeholder:text-base-content/30"
          placeholder="输入要翻译的内容..."
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doTranslate(); }}
        />
        {source && (
          <button
            className="btn btn-circle btn-ghost btn-sm absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
            title="清空"
            onClick={() => { setSource(''); setTarget(''); setAnalysis(null); }}
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex justify-between items-center mt-4">
          <div className="flex gap-2">
            <button
              className={`btn btn-circle btn-ghost btn-sm ${listening ? 'text-error' : ''}`}
              title="语音输入"
              onClick={toggleMic}
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              className="btn btn-circle btn-ghost btn-sm"
              title="朗读原文"
              onClick={() => source && window.ttsManager.speak(source, sourceLang === 'auto' ? 'auto' : sourceLang)}
            >
              <Volume2 className="w-5 h-5" />
            </button>
          </div>
          <div className="text-xs text-base-content/40">{source.length} / 5000</div>
        </div>
      </div>

      <div className="flex-1 p-6 flex flex-col bg-base-200/30">
        {loading && (
          <div className="text-primary font-medium text-sm mb-2">
            <span className="loading loading-dots loading-sm" /> 翻译中...
          </div>
        )}
        <div className="w-full flex-1 text-xl break-words translation-result whitespace-pre-wrap">
          {target}
        </div>

        <div className="flex justify-between items-center mt-4 text-base-content/60">
          <div className="flex gap-2">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              title="朗读译文"
              onClick={() => target && window.ttsManager.speak(target, targetLang)}
            >
              <Volume2 className="w-5 h-5" />
            </button>
            <button
              className="btn btn-circle btn-ghost btn-sm"
              title="语法分析"
              disabled={analyzing || !source.trim()}
              onClick={handleAnalyze}
            >
              <Sparkles className={`w-5 h-5 ${analyzing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              title="复制译文"
              onClick={() => target && navigator.clipboard.writeText(target)}
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              className="btn btn-circle btn-ghost btn-sm"
              title="保存到单词本"
              disabled={!lastSaveDataRef.current}
              onClick={handleSaveWord}
            >
              <Star className={`w-5 h-5 ${saved ? 'text-warning' : ''}`} fill={saved ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>

      {analysis && (
        <div className="w-full basis-full border-t border-base-200 p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-base-content/40 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            语法分析
          </h3>

          {analysis.tokens.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {analysis.tokens.map((tok, i) => (
                <span
                  key={`${tok.text}-${i}`}
                  className={`badge ${(tok.pos && POS_BADGE_CLASS[tok.pos]) || 'badge-neutral'} badge-sm`}
                  title={[tok.pos, tok.role].filter(Boolean).join(' · ')}
                >
                  {tok.text}
                </span>
              ))}
            </div>
          )}

          {analysis.similar.length > 0 && (
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">相似句型</h4>
              {analysis.similar.map((s, i) => (
                <div key={i} className="p-3 rounded-lg bg-base-200/50 text-sm">
                  <div className="text-base-content/80">{s.sentence}</div>
                  {s.translation && <div className="text-base-content/50 mt-1">{s.translation}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
