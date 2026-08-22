/**
 * 单词本外壳：侧边导航、顶栏搜索、导入导出、清空确认，以及五个视图的路由。
 *
 * MUI 的使用范围（刻意克制，不铺开）：只用在 daisyUI 纯 CSS 覆盖不到的交互上——
 * Autocomplete（键盘导航 + 候选过滤）、Dialog（焦点陷阱 + Esc 关闭）、
 * Snackbar（统一的操作反馈，替代原来的 alert()）、Tooltip（在 TaggedSentence 里）。
 * 普通按钮/卡片/徽章继续用 daisyUI 的 className，不引入 MUI 的对应组件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, RotateCw, List, Layers, PenLine, BarChart2, Upload, Download, Trash2,
} from 'lucide-react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

import { applyTheme, initThemeControl } from '../utils/theme.js';
import { useWordbook } from './lib/useWordbook.js';
import { ReviewView } from './views/ReviewView.jsx';
import { ListView, regenerateExample } from './views/ListView.jsx';
import { CardsView } from './views/CardsView.jsx';
import { QuizView } from './views/QuizView.jsx';
import { StatsView } from './views/StatsView.jsx';

const NAV = [
  { view: 'review', label: '今日复习', Icon: RotateCw },
  { view: 'list', label: '单词列表', Icon: List },
  { view: 'cards', label: '卡片学习', Icon: Layers },
  { view: 'quiz', label: '拼写测验', Icon: PenLine },
  { view: 'stats', label: '学习统计', Icon: BarChart2 },
];

const VALID_VIEWS = NAV.map((n) => n.view);

export function App() {
  const { wordbook, loaded, persist, updateWord } = useWordbook();
  const [view, setView] = useState(() => {
    const requested = new URLSearchParams(location.search).get('view');
    return VALID_VIEWS.includes(requested) ? requested : 'review';
  });
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState(null); // { message, severity }
  const themeSlotRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { applyTheme(); }, []);

  // 主题下拉仍然是旧的命令式实现（utils/theme.js，六个页面共用），
  // 这里给它留一个挂载点，不为了 React 化单独重写一套。
  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, []);

  // 切页签同步 URL，刷新后能停在原来的页签
  const switchView = useCallback((next) => {
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set('view', next);
    history.replaceState(null, '', url);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return wordbook;
    return wordbook.filter((w) =>
      w.text.toLowerCase().includes(q) ||
      Object.values(w.translations || {}).some((t) => t.toLowerCase().includes(q)),
    );
  }, [wordbook, search]);

  const handleDelete = useCallback(async (word) => {
    await persist(wordbook.filter((w) => w !== word));
  }, [wordbook, persist]);

  const handleRegenerate = useCallback(async (word) => {
    const ok = await regenerateExample(word, updateWord);
    setToast(ok
      ? { message: `已为「${word.text}」生成新例句`, severity: 'success' }
      : { message: '生成失败，请检查是否已配置 AI 引擎或本地 Ollama', severity: 'warning' });
  }, [updateWord]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(wordbook, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `super-translate-wordbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) throw new Error('文件格式不对，应该是一个数组');

      const existing = new Set(wordbook.map((w) => w.text.toLowerCase()));
      const added = imported.filter((w) => w.text && !existing.has(w.text.toLowerCase()));
      if (added.length > 0) await persist([...added, ...wordbook]);
      setToast({ message: `导入成功，新增 ${added.length} 个单词`, severity: 'success' });
    } catch (err) {
      setToast({ message: `导入失败：${err.message}`, severity: 'error' });
    }
    e.target.value = '';
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-base-300 flex flex-col shrink-0 min-h-screen">
        <div className="p-4 border-b border-base-content/10">
          <div className="flex items-center gap-2 font-bold text-base">
            <BookOpen className="w-5 h-5 text-primary" />
            单词本
          </div>
        </div>

        <nav className="flex-1 py-2">
          <ul className="menu menu-md gap-0.5 w-full px-0">
            {NAV.map(({ view: v, label, Icon }) => (
              <li key={v}>
                <a
                  href="#"
                  className={`nav-item ${view === v ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); switchView(v); }}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-3 border-t border-base-content/10 flex gap-2">
          <button className="btn btn-ghost btn-sm flex-1 gap-1" onClick={handleExport}>
            <Upload className="w-4 h-4" />
            导出
          </button>
          <button className="btn btn-ghost btn-sm flex-1 gap-1" onClick={() => fileRef.current?.click()}>
            <Download className="w-4 h-4" />
            导入
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="navbar bg-base-100 shadow px-4 gap-3 sticky top-0 z-10">
          <div className="navbar-start flex-1">
            <Autocomplete
              freeSolo
              size="small"
              sx={{ width: 320 }}
              options={wordbook.map((w) => w.text)}
              inputValue={search}
              onInputChange={(_, v) => setSearch(v)}
              renderInput={(params) => <TextField {...params} placeholder="搜索单词..." />}
            />
          </div>
          <div className="navbar-end flex items-center gap-2">
            <span className="badge badge-ghost">{wordbook.length} 个单词</span>
            <button
              className="btn btn-error btn-sm btn-outline gap-1"
              disabled={wordbook.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 className="w-4 h-4" />
              清空
            </button>
            <div ref={themeSlotRef} />
          </div>
        </header>

        <p className="text-xs text-base-content/40 text-center py-1">
          提示：开启 GitHub 同步后，删除的单词可能会在下次同步时从其他设备恢复
        </p>

        <main className="flex-1 p-6">
          {view === 'review' && <ReviewView wordbook={wordbook} loaded={loaded} updateWord={updateWord} />}
          {view === 'list' && (
            <ListView
              words={filtered}
              totalCount={wordbook.length}
              onDelete={handleDelete}
              onRegenerate={handleRegenerate}
            />
          )}
          {view === 'cards' && <CardsView words={wordbook} />}
          {view === 'quiz' && <QuizView words={wordbook} />}
          {view === 'stats' && <StatsView words={wordbook} />}
        </main>
      </div>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>清空单词本？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将删除全部 {wordbook.length} 个单词及其复习记录，此操作不可撤销。
            如果开启了 GitHub 同步，删除的记录可能会在下次同步时从其他设备恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>取消</button>
          <button
            className="btn btn-error btn-sm"
            onClick={async () => {
              await persist([]);
              setConfirmClear(false);
              setToast({ message: '单词本已清空', severity: 'info' });
            }}
          >
            确认清空
          </button>
        </DialogActions>
      </Dialog>

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
