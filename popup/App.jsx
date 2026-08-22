/**
 * 工具栏弹窗。
 *
 * 刻意不引入 MUI：弹窗是每次点扩展图标都要打开的界面，对首屏延迟最敏感，
 * 而它需要的交互（select / checkbox / toggle）daisyUI 的纯 CSS 组件完全够用，
 * 为此拖进上百 KB 的组件库不划算。其它页面（单词本/历史/文档）才用 MUI。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Languages, Image, FileText, Globe, Zap, Settings2, MousePointer2, Info,
  PanelRight, BookOpen, History, Settings,
} from 'lucide-react';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
import { isDue, deserializeCard } from '../utils/srs.js';

const ENGINES = [
  ['google', 'Google 翻译 (免费)'], ['mymemory', 'MyMemory (免费)'],
  ['lingva', 'Lingva Translate (免费)'], ['libre', 'LibreTranslate (免费)'],
  ['deepl', 'DeepL (需 API Key)'], ['custom', '自定义 API'],
  ['openai', 'OpenAI (需 API Key)'], ['gemini', 'Gemini (需 API Key)'],
  ['claude', 'Claude (需 API Key)'], ['ollama', 'Ollama (本地/自定义)'],
  ['webllm', 'WebLLM (本地运行/显卡加速)'],
];

const LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁体中文'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
  ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية'],
  ['hi', 'हिन्दी'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'],
  ['tr', 'Türkçe'],
];

const DISPLAY_MODES = [
  ['bilingual', '双语对照'], ['replace', '译文替换'], ['translationOnly', '仅译文'],
];

const SELECTION_MODES = [
  ['icon', '图标模式 (选中后点击图标)'], ['direct', '直接弹窗 (选中即翻译)'],
  ['dblclick', '双击查词'], ['shortcut', '快捷键 (Alt+S)'], ['off', '关闭划词翻译'],
];

const SELECTION_ENGINES = [
  ['google', 'Google'], ['lingva', 'Lingva'], ['libre', 'Libre'],
  ['mymemory', 'MyMem'], ['deepl', 'DeepL'], ['custom', 'Custom'],
  ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['claude', 'Claude'],
  ['ollama', 'Ollama'], ['webllm', 'WebLLM'],
];

const COLORS = ['#9b59b6', '#4f8ef7', '#7c8aaa', '#27ae60', '#e67e22', '#e74c3c', '#00b894'];

// 每个引擎在弹窗里要露出的最小配置。更完整的模型配置在扩展设置页。
const ENGINE_FIELDS = {
  deepl: [{ key: 'deeplKey', label: 'DeepL API Key', type: 'password', placeholder: '输入 DeepL API Key' }],
  custom: [
    { key: 'customApiUrl', label: 'API 地址', type: 'text', placeholder: 'https://api.example.com/translate' },
    { key: 'customApiKey', label: 'API Key (可选)', type: 'password', placeholder: 'Bearer token' },
  ],
  libre: [{ key: 'libreUrl', label: 'LibreTranslate 地址', type: 'text', placeholder: 'https://libretranslate.com' }],
  openai: [{ key: 'openaiKey', label: 'OpenAI API Key', type: 'password', placeholder: '输入 OpenAI API Key', hint: '更多模型配置请前往扩展设置页' }],
  gemini: [{ key: 'geminiKey', label: 'Gemini API Key', type: 'password', placeholder: '输入 Gemini API Key', hint: '更多模型配置请前往扩展设置页' }],
  claude: [{ key: 'claudeKey', label: 'Claude API Key', type: 'password', placeholder: '输入 Claude API Key', hint: '更多模型配置请前往扩展设置页' }],
};

const ENGINE_NOTES = {
  ollama: 'Ollama 模型配置请前往扩展设置页完成。',
  webllm: 'WebLLM 模型配置请前往扩展设置页或快捷翻译页完成。首次启动需要从 HuggingFace 加载几 GB 的模型文件。',
};

const NAV_TABS = [
  { tab: 'image', label: '图片翻译', Icon: Image, color: 'text-primary', hover: 'hover:border-primary hover:bg-primary/5' },
  { tab: 'doc', label: '文档翻译', Icon: FileText, color: 'text-success', hover: 'hover:border-success hover:bg-success/5' },
  { tab: 'web', label: '网页翻译', Icon: Globe, color: 'text-secondary', hover: 'hover:border-secondary hover:bg-secondary/5' },
  { tab: 'text', label: '快捷翻译', Icon: Zap, color: 'text-warning', hover: 'hover:border-warning hover:bg-warning/5' },
];

const openPage = (path) => chrome.tabs.create({ url: chrome.runtime.getURL(path) });

export function App() {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState({ text: '已关闭', enabled: false, disabled: false });
  const [dueCount, setDueCount] = useState(0);
  const themeSlotRef = useRef(null);
  const saveTimer = useRef(null);

  useEffect(() => { applyTheme(); }, []);
  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, [settings === null]);

  useEffect(() => {
    chrome.storage.sync.get(DEFAULTS).then(setSettings);
  }, []);

  // 当前标签页的翻译开关状态
  useEffect(() => {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
        if (!resp) return;
        if (resp.blocked) setStatus({ text: '站点已屏蔽', enabled: false, disabled: true });
        else setStatus({ text: resp.enabled ? '翻译中' : '已关闭', enabled: resp.enabled, disabled: false });
      } catch { /* content script 还没就绪，保持默认 */ }
    })();
  }, []);

  // 待复习徽章：只数"学过且到期"的，跟单词本默认队列口径一致
  useEffect(() => {
    chrome.storage.local.get('wordbook').then(({ wordbook = [] }) => {
      const now = new Date();
      let count = 0;
      wordbook.forEach((w) => {
        ['recall', 'recognition'].forEach((mode) => {
          const raw = w.srs?.[mode];
          if (!raw) return;
          if (isDue(deserializeCard(raw), now)) count++;
        });
      });
      setDueCount(count);
    });
  }, []);

  // 文本类输入去抖 500ms 再写存储，下拉/勾选立即写
  const update = useCallback((patch, { debounce = false } = {}) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      const flush = async () => {
        await chrome.storage.sync.set(next);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) await chrome.tabs.sendMessage(tab.id, { action: 'updateSettings' }).catch(() => {});
        } catch { /* ignore */ }
      };
      clearTimeout(saveTimer.current);
      if (debounce) saveTimer.current = setTimeout(flush, 500);
      else flush();
      return next;
    });
  }, []);

  const toggleTranslate = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
      setStatus((s) => ({ ...s, enabled: resp.enabled, text: resp.enabled ? '翻译中' : '已关闭' }));
    } catch {
      setStatus({ text: '页面未就绪', enabled: false, disabled: false });
    }
  };

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sandbox/index.html?context=panel', enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  };

  if (!settings) return <div className="flex flex-col h-full" />;

  const engineFields = ENGINE_FIELDS[settings.engine] || [];
  const engineNote = ENGINE_NOTES[settings.engine];
  const selEngines = settings.selectionEngines || [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-primary text-primary-content px-4 py-3 flex justify-between items-center shadow-md shrink-0 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary-focus/80 opacity-95" />
          <div className="absolute -right-8 -top-8 w-24 h-24 bg-white/10 rounded-full blur-xl" />
        </div>
        <h1 className="text-base font-extrabold flex items-center gap-1.5 relative z-10 tracking-wide">
          <Languages className="w-5 h-5 text-warning" /> 超级翻译
        </h1>
        <div className="flex items-center gap-2 relative z-10">
          <div ref={themeSlotRef} className="text-primary-content" />
          <div className="flex items-center gap-2 bg-base-100/10 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 shadow-inner">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-white">{status.text}</span>
            <input
              type="checkbox"
              className="toggle toggle-success toggle-xs border-white/20 bg-white"
              checked={status.enabled}
              disabled={status.disabled}
              onChange={toggleTranslate}
            />
          </div>
        </div>
      </div>

      <div className="p-3 overflow-y-auto flex-1 min-h-0 flex flex-col gap-3 bg-base-200 custom-scrollbar">
        <div className="grid grid-cols-4 gap-2 shrink-0">
          {NAV_TABS.map(({ tab, label, Icon, color, hover }) => (
            <button
              key={tab}
              className={`btn btn-sm btn-outline border-base-300/80 ${hover} flex flex-col gap-1 h-14 py-2 px-1 rounded-xl text-base-content/85 transition-all duration-200`}
              onClick={() => openPage(`sandbox/index.html?tab=${tab}`)}
            >
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-[9px] font-extrabold">{label}</span>
            </button>
          ))}
        </div>

        <div className="card bg-base-100 border border-base-200/60 shadow-sm p-3.5 flex flex-col gap-3 rounded-2xl">
          <h2 className="text-[10px] font-extrabold text-base-content/40 uppercase tracking-widest flex items-center gap-1.5 pb-1.5 border-b border-base-200/60">
            <Settings2 className="w-3.5 h-3.5" /> 全局翻译设置
          </h2>

          <div className="form-control w-full">
            <label className="label py-0.5"><span className="label-text font-bold text-[11px] text-base-content/85">全页翻译引擎</span></label>
            <select
              className="select select-bordered select-sm w-full rounded-xl font-semibold"
              value={settings.engine}
              onChange={(e) => update({ engine: e.target.value })}
            >
              {ENGINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {(engineFields.length > 0 || engineNote) && (
            <div className="bg-base-200/50 border border-base-200/60 rounded-xl p-3 flex flex-col gap-2.5">
              {engineFields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="label py-0"><span className="label-text font-bold text-[10px] text-base-content/75">{f.label}</span></label>
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    className="input input-bordered input-sm w-full rounded-lg"
                    value={settings[f.key] || ''}
                    onChange={(e) => update({ [f.key]: e.target.value }, { debounce: true })}
                  />
                  {f.hint && <div className="text-[9px] text-base-content/40 mt-0.5">{f.hint}</div>}
                </div>
              ))}
              {engineNote && <div className="text-[10px] text-base-content/60 font-medium py-1">{engineNote}</div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label py-0.5"><span className="label-text font-bold text-[11px] text-base-content/85">目标语言</span></label>
              <select
                className="select select-bordered select-sm w-full rounded-xl font-semibold"
                value={settings.targetLang}
                onChange={(e) => update({ targetLang: e.target.value })}
              >
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label className="label py-0.5"><span className="label-text font-bold text-[11px] text-base-content/85">显示模式</span></label>
              <select
                className="select select-bordered select-sm w-full rounded-xl font-semibold"
                value={settings.displayMode}
                onChange={(e) => update({ displayMode: e.target.value })}
              >
                {DISPLAY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="form-control mt-1 pt-2.5 border-t border-base-200/60">
            <label className="label py-0 mb-1.5"><span className="label-text font-bold text-[11px] text-base-content/85">译文高亮颜色</span></label>
            <div className="flex justify-between items-center px-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-5 h-5 rounded-full border border-base-content/10 cursor-pointer hover:scale-115 transition-transform shadow-sm ${
                    settings.translationColor === c ? 'color-dot active' : ''
                  }`}
                  style={{ background: c }}
                  onClick={() => update({ translationColor: c })}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 mt-1.5 bg-base-200/50 p-2.5 rounded-xl border border-base-200/60">
            {[['hoverTranslate', '悬停段落翻译'], ['inputTranslate', '输入框实时翻译']].map(([key, label]) => (
              <label key={key} className="cursor-pointer flex items-center justify-between">
                <span className="label-text font-bold text-[11px] text-base-content/75">{label}</span>
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm rounded-md"
                  checked={!!settings[key]}
                  onChange={(e) => update({ [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="card bg-base-100 border border-base-200/60 shadow-sm p-3.5 flex flex-col gap-3 rounded-2xl">
          <h2 className="text-[10px] font-extrabold text-base-content/40 uppercase tracking-widest flex items-center gap-1.5 pb-1.5 border-b border-base-200/60">
            <MousePointer2 className="w-3.5 h-3.5" /> 划词翻译模式
          </h2>

          <div className="form-control">
            <label className="label py-0.5"><span className="label-text font-bold text-[11px] text-base-content/85">触发方式</span></label>
            <select
              className="select select-bordered select-sm w-full rounded-xl font-semibold"
              value={settings.selectionMode}
              onChange={(e) => update({ selectionMode: e.target.value })}
            >
              {SELECTION_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="form-control border-t border-base-200/60 mt-1 pt-2.5">
            <label className="label py-0.5"><span className="label-text font-bold text-[11px] text-base-content/85">多引擎比对 (划词多选)</span></label>
            <div className="grid grid-cols-3 gap-2 mt-1.5 bg-base-200/30 p-2 rounded-xl border border-base-200/50">
              {SELECTION_ENGINES.map(([v, label]) => (
                <label key={v} className="cursor-pointer flex items-center gap-1.5 p-1 rounded hover:bg-base-200/50 text-[10px] font-semibold text-base-content/80">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-xs rounded-sm"
                    checked={selEngines.includes(v)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selEngines, v]
                        : selEngines.filter((x) => x !== v);
                      // 全部取消会让划词面板没有任何引擎可用，兜底保留 google
                      update({ selectionEngines: next.length > 0 ? next : ['google'] });
                    }}
                  />
                  <span className="truncate">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="alert alert-info alert-soft p-2.5 rounded-2xl flex items-start gap-2 shadow-sm text-[10px] shrink-0 border border-info/20">
          <Info className="w-3.5 h-3.5 shrink-0 text-info mt-0.5" />
          <div className="flex-1 font-semibold text-base-content/75 leading-relaxed">
            <span>快捷键提示：</span><br />
            <span className="font-mono text-base-content/60">
              <kbd className="kbd kbd-xs bg-base-100">Alt + T</kbd> 全页翻译 |{' '}
              <kbd className="kbd kbd-xs bg-base-100">Alt + S</kbd> 划词翻译
            </span>
          </div>
        </div>
      </div>

      <div className="flex border-t border-base-200/60 bg-base-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0 z-20">
        {chrome.sidePanel && (
          <button className="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors" onClick={openSidePanel}>
            <PanelRight className="w-4 h-4" />
            <span className="font-extrabold text-[9px]">侧边栏</span>
          </button>
        )}
        <button
          className="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors relative"
          onClick={() => openPage('wordbook/index.html?view=review')}
        >
          <BookOpen className="w-4 h-4" />
          <span className="font-extrabold text-[9px]">单词本</span>
          {dueCount > 0 && (
            <span className="badge badge-error badge-xs absolute top-0.5 right-3">
              {dueCount > 99 ? '99+' : dueCount}
            </span>
          )}
        </button>
        <button className="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors" onClick={() => openPage('history/index.html')}>
          <History className="w-4 h-4" />
          <span className="font-extrabold text-[9px]">历史</span>
        </button>
        <button className="flex-1 flex flex-col items-center gap-0.5 py-2 hover:text-primary transition-colors" onClick={() => openPage('options/options.html')}>
          <Settings className="w-4 h-4" />
          <span className="font-extrabold text-[9px]">设置</span>
        </button>
      </div>
    </div>
  );
}
