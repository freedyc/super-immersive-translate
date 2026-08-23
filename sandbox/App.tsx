/**
 * 快捷翻译工作台外壳：顶部引擎/语言选择 + 标签页 + 引擎配置抽屉。
 *
 * 两种打开方式：
 *  - 普通标签页（?tab=text|image|doc|web）
 *  - Chrome 侧边栏（?context=panel），此时多出一个「当前页」标签页
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, Image, FileText, Globe, Globe2, Settings, ArrowLeftRight, X } from 'lucide-react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

import { applyTheme, initThemeControl } from '../utils/theme.js';
import { DEFAULTS } from '../utils/defaults.js';
import { LANGS, SOURCE_LANGS } from '../utils/langs.ts';
import { ENGINES, ENGINE_FIELDS } from '../utils/translation-options.ts';
import { TextTab } from './tabs/TextTab.tsx';
import { ImageTab } from './tabs/ImageTab.tsx';
import { DocTab } from './tabs/DocTab.tsx';
import { WebTab } from './tabs/WebTab.tsx';
import { PageTab } from './tabs/PageTab.tsx';
import type { Toast } from '../types/models.ts';
// 起别名避开跟 lucide-react 的 Settings 图标组件重名
import type { Settings as SettingsShape } from '../options/lib/types.ts';

const TABS = [
  { id: 'page', label: '当前页', Icon: Globe2, panelOnly: true },
  { id: 'text', label: '文字', Icon: Languages, panelOnly: false },
  { id: 'image', label: '图片', Icon: Image, panelOnly: false },
  { id: 'doc', label: '文档', Icon: FileText, panelOnly: false },
  { id: 'web', label: '网站', Icon: Globe, panelOnly: false },
] as const;

type TabId = (typeof TABS)[number]['id'];

const isPanel = new URLSearchParams(location.search).get('context') === 'panel';

function initialTab(): TabId {
  const requested = new URLSearchParams(location.search).get('tab');
  const alias: Record<string, TabId> = {
    text: 'text', image: 'image', doc: 'doc', document: 'doc', web: 'web', website: 'web',
  };
  if (requested && alias[requested]) return alias[requested];
  return isPanel ? 'page' : 'text';
}

export function App() {
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [engine, setEngine] = useState('google');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedTip, setSavedTip] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const themeSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme();
    if (isPanel) document.documentElement.classList.add('panel');
  }, []);

  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, [settings === null]);

  useEffect(() => {
    (async () => {
      const s = (await chrome.storage.sync.get(DEFAULTS)) as unknown as SettingsShape;
      setSettings(s);
      setEngine(s.engine);
      setSourceLang(s.sourceLang);
      setTargetLang(s.targetLang);
      await window.translator.init();
      await window.ttsManager.init();
    })();
  }, []);

  // 引擎配置改动只存进 state，点「保存并应用」才写 storage 并重建 translator
  const patchSetting = useCallback((key: string, value: string) => {
    setSettings((prev: SettingsShape | null) => (prev ? { ...prev, [key]: value } as SettingsShape : prev));
  }, []);

  const saveConfig = async () => {
    if (!settings) return;
    const patch: Record<string, string> = { engine };
    (ENGINE_FIELDS[engine] || []).forEach((f) => {
      patch[f.key] = (settings as unknown as Record<string, string>)[f.key] ?? '';
    });
    await chrome.storage.sync.set(patch);
    await window.translator.init();
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 2000);
    setDrawerOpen(false);
  };

  const swapLangs = () => {
    if (sourceLang === 'auto') return; // 自动检测没有具体语言可换
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  const visibleTabs = TABS.filter((t) => !t.panelOnly || isPanel);
  const ctx = { engine, sourceLang, targetLang };

  if (!settings) return null;

  return (
    <div className="flex flex-col items-center py-10 px-4 min-h-screen bg-base-200">
      <div className="w-full max-w-5xl flex flex-wrap justify-between items-center mb-6 px-4 gap-4">
        <div className="flex gap-2">
          {visibleTabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`btn btn-sm rounded-full px-4 gap-1 ${
                tab === id ? 'btn-primary' : 'btn-ghost text-base-content/60'
              }`}
              onClick={() => setTab(id)}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div ref={themeSlotRef} />
          <select
            className="select select-sm rounded-full font-semibold shadow-sm"
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
          >
            {ENGINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button
            className="btn btn-sm btn-circle btn-ghost"
            title="配置当前引擎"
            onClick={() => setDrawerOpen(true)}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl w-full max-w-5xl rounded-3xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-base-200">
          <div className="flex-1 flex items-center gap-4">
            <span className="text-sm text-base-content/60 font-semibold hidden sm:inline">检测语言</span>
            <select
              className="select select-sm text-primary font-bold shadow-sm rounded-xl"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {SOURCE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <button className="btn btn-circle btn-ghost btn-sm mx-4" title="交换语言" onClick={swapLangs}>
            <ArrowLeftRight className="w-4 h-4" />
          </button>

          <div className="flex-1 flex items-center gap-4 justify-start">
            <select
              className="select select-sm text-primary font-bold shadow-sm rounded-xl"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {tab === 'page' && <PageTab engine={engine} targetLang={targetLang} />}
        {tab === 'text' && <TextTab {...ctx} notify={setToast} />}
        {tab === 'image' && <ImageTab {...ctx} />}
        {tab === 'doc' && <DocTab {...ctx} />}
        {tab === 'web' && <WebTab />}
      </div>

      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setDrawerOpen(false)} />
          <aside className="fixed right-0 top-0 h-full w-80 bg-base-100 shadow-xl z-50 p-5 overflow-y-auto flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">引擎配置</h3>
              <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setDrawerOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {(ENGINE_FIELDS[engine] || []).map((f) => (
              <div key={f.key}>
                <label className="label pb-1">
                  <span className="text-xs text-base-content/60">{f.label}</span>
                </label>
                <input
                  type={f.type}
                  className="input input-sm w-full"
                  placeholder={f.placeholder}
                  value={(settings as unknown as Record<string, string>)[f.key] ?? ''}
                  onChange={(e) => patchSetting(f.key, e.target.value)}
                />
                {f.hint && <p className="text-xs text-base-content/40 mt-1">{f.hint}</p>}
              </div>
            ))}

            {(ENGINE_FIELDS[engine] || []).length === 0 && (
              <p className="text-sm text-base-content/50">当前引擎不需要额外配置。</p>
            )}

            <div className="mt-auto flex flex-col gap-2">
              {savedTip && <span className="text-xs text-success font-medium">保存成功！</span>}
              <button className="btn btn-success btn-sm text-white w-full rounded-xl" onClick={saveConfig}>
                保存并应用
              </button>
            </div>
          </aside>
        </>
      )}

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
    </div>
  );
}
