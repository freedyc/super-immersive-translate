/**
 * 设置页外壳：侧边导航 + 窄屏下拉降级 + 六个标签页。
 * 所有设置项都是即改即存（无「保存」按钮），沿用原来的交互。
 */
import { useEffect, useRef, useState } from 'react';
import { Settings2, Palette, Keyboard, Globe2, Mic, Database, Zap } from 'lucide-react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { useSettings } from './lib/useSettings.ts';
import { GeneralTab } from './tabs/GeneralTab.tsx';
import { StyleTab } from './tabs/StyleTab.tsx';
import { ShortcutsTab } from './tabs/ShortcutsTab.tsx';
import { SitesTab } from './tabs/SitesTab.tsx';
import { TtsTab } from './tabs/TtsTab.tsx';
import { DataTab } from './tabs/DataTab.tsx';
import type { Toast } from '../types/models.ts';

const TABS = [
  { id: 'general', label: '常规', Icon: Settings2 },
  { id: 'style', label: '样式', Icon: Palette },
  { id: 'shortcuts', label: '快捷键', Icon: Keyboard },
  { id: 'sites', label: '站点', Icon: Globe2 },
  { id: 'tts', label: '朗读', Icon: Mic },
  { id: 'data', label: '数据', Icon: Database },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const { settings, update, reload } = useSettings();
  const [tab, setTab] = useState<TabId>('general');
  const [toast, setToast] = useState<Toast | null>(null);
  // 窄屏顶栏和宽屏侧栏各挂一个主题控件：两处的容器分别只在各自断点下可见，
  // 只挂一处的话另一个断点下主题切换就没入口了。两个控件都写同一份 storage，
  // 靠 theme.js 的 onChanged 保持一致。
  const themeSlotMobileRef = useRef<HTMLDivElement>(null);
  const themeSlotDesktopRef = useRef<HTMLDivElement>(null);

  useEffect(() => { applyTheme(); }, []);
  useEffect(() => {
    if (themeSlotMobileRef.current) initThemeControl(themeSlotMobileRef.current);
    if (themeSlotDesktopRef.current) initThemeControl(themeSlotDesktopRef.current);
  }, [settings === null]);

  if (!settings) return null;

  const tabProps = { settings, update, reload, notify: setToast };

  return (
    <div className="min-h-screen">
      {/* 窄屏：顶部条 + 下拉导航（侧边栏在 lg 以下隐藏） */}
      <div className="lg:hidden sticky top-0 z-20 bg-base-100 border-b border-base-200 px-4 py-2 flex items-center gap-3">
        <span className="flex items-center gap-1.5 font-bold text-sm shrink-0">
          <Zap className="w-4 h-4 text-primary" />
          超级翻译
        </span>
        <select
          className="select select-sm flex-1"
          value={tab}
          onChange={(e) => setTab(e.target.value as TabId)}
        >
          {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <div ref={themeSlotMobileRef} />
      </div>

      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-52 flex-col bg-base-100 border-r border-base-200">
        <div className="p-5 border-b border-base-200 flex items-center gap-2 font-bold">
          <Zap className="w-5 h-5 text-primary" />
          超级翻译
        </div>
        <nav className="flex-1 py-3 flex flex-col">
          {TABS.map(({ id, label, Icon }) => (
            <a
              key={id}
              href="#"
              className={`nav-item flex items-center gap-2 px-5 py-2.5 text-sm border-l-[3px] transition-colors ${
                tab === id
                  ? 'active border-primary text-primary bg-base-200/40'
                  : 'border-transparent text-base-content/70 hover:bg-base-200/60'
              }`}
              onClick={(e) => { e.preventDefault(); setTab(id); }}
            >
              <Icon className="w-4 h-4" />
              {label}
            </a>
          ))}
        </nav>
        <div className="p-4 border-t border-base-200">
          <div ref={themeSlotDesktopRef} />
        </div>
      </aside>

      <main className="lg:ml-52 p-4 lg:p-8 max-w-3xl">
        {tab === 'general' && <GeneralTab {...tabProps} />}
        {tab === 'style' && <StyleTab {...tabProps} />}
        {/* 快捷键页不吃任何 props：它的数据全部来自 chrome.commands */}
        {tab === 'shortcuts' && <ShortcutsTab />}
        {tab === 'sites' && <SitesTab {...tabProps} />}
        {tab === 'tts' && <TtsTab {...tabProps} />}
        {tab === 'data' && <DataTab {...tabProps} />}
      </main>

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
