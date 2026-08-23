/**
 * 单词本外壳：侧边导航、顶栏搜索、导入导出，以及各视图的路由。
 *
 * 2.1 起整页统一读写 Word + LearningRecord（见 useLearning）。旧的 wordbook 键
 * 由 useLearning 在首次加载时迁移过来，之后不再读写它——新旧两套并存各写各的
 * 必然分叉，那种 bug 事后没法修。
 *
 * MUI 的使用范围（刻意克制）：只用在 daisyUI 纯 CSS 覆盖不到的交互上——
 * Autocomplete、Dialog、Snackbar、Tooltip。按钮/卡片/徽章继续用 daisyUI。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BookOpen, Home, List, Layers, PenLine, BarChart2, Upload, Download, Trash2, Settings,
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
import { useLearning } from './lib/useLearning.ts';
import { TodayView } from './views/TodayView.tsx';
import { LearnView } from './views/LearnView.tsx';
import { ReviewView } from './views/ReviewView.tsx';
import { ListView, regenerateExample } from './views/ListView.tsx';
import { CardsView } from './views/CardsView.tsx';
import { QuizView } from './views/QuizView.tsx';
import { StatsView } from './views/StatsView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { useStudyConfig } from './lib/useStudyConfig.ts';
import { buildTodayQueue } from '../utils/learning/queue.ts';
import { createRecord, recordAnswer } from '../utils/learning/srsService.ts';
import type { Familiarity, LearningRecord, Toast, Word } from '../types/models.ts';

const NAV = [
  { view: 'today', label: '今日学习', Icon: Home },
  { view: 'list', label: '我的词库', Icon: List },
  { view: 'cards', label: '卡片浏览', Icon: Layers },
  { view: 'quiz', label: '拼写练习', Icon: PenLine },
  { view: 'stats', label: '学习统计', Icon: BarChart2 },
  { view: 'settings', label: '学习设置', Icon: Settings },
] as const;

type ViewId = (typeof NAV)[number]['view'];

const VALID_VIEWS: readonly ViewId[] = NAV.map((n) => n.view);

/** 沉浸式学习会话：先清掉到期复习，再学新词 */
type Session = null | 'review' | 'learn';

export function App() {
  const {
    words, records, loaded, migratedCount,
    updateRecord, updateWord, removeWord, replaceAll,
  } = useLearning();
  const { config: studyConfig, update: updateStudyConfig, allExercises } = useStudyConfig();

  const [view, setView] = useState<ViewId>(() => {
    const requested = new URLSearchParams(location.search).get('view');
    return VALID_VIEWS.includes(requested as ViewId) ? (requested as ViewId) : 'today';
  });
  const [session, setSession] = useState<Session>(null);
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const themeSlotRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { applyTheme(); }, []);

  // 主题下拉仍是命令式实现（utils/theme.js，六个页面共用），留个挂载点，
  // 不为了 React 化单独重写一套
  useEffect(() => {
    if (themeSlotRef.current) initThemeControl(themeSlotRef.current);
  }, []);

  // 从旧版本迁移过数据时告知用户一声，否则「词突然多了」会让人疑惑
  useEffect(() => {
    if (migratedCount > 0) {
      setToast({ severity: 'info', message: `已从旧版本导入 ${migratedCount} 个单词` });
    }
  }, [migratedCount]);

  const switchView = useCallback((next: ViewId) => {
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set('view', next);
    history.replaceState(null, '', url);
  }, []);

  const queue = useMemo(
    () => buildTodayQueue(words, records, studyConfig),
    [words, records, studyConfig],
  );

  /** 今日要学的新词（去重后的词，不是题目） */
  const newWords = useMemo(() => {
    const ids = new Set(queue.items.filter((i) => i.kind === 'new').map((i) => i.wordId));
    return words.filter((w) => ids.has(w.id));
  }, [queue, words]);

  const reviewWords = useMemo(() => {
    const ids = new Set(queue.items.filter((i) => i.kind === 'review').map((i) => i.wordId));
    return words.filter((w) => ids.has(w.id));
  }, [queue, words]);

  const startSession = useCallback(() => {
    setSession(reviewWords.length > 0 ? 'review' : 'learn');
  }, [reviewWords.length]);

  /** 学新词时的熟悉度评估。只种下 en2zh 方向——这次测的就是「看词能否想起意思」 */
  const handleFamiliarity = useCallback(async (wordId: string, grade: Familiarity) => {
    await updateRecord(wordId, (prev) =>
      recordAnswer(prev ?? createRecord(wordId), 'en2zh', grade));
  }, [updateRecord]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) =>
      w.word.toLowerCase().includes(q)
      || w.meanings.some((m) => m.definitions.some((d) => d.toLowerCase().includes(q))));
  }, [words, search]);

  const handleRegenerate = useCallback(async (word: Word) => {
    const ok = await regenerateExample(word, updateWord);
    setToast(ok
      ? { message: `已为「${word.word}」生成新例句`, severity: 'success' }
      : { message: '生成失败，请检查是否已配置 AI 引擎或本地 Ollama', severity: 'warning' });
  }, [updateWord]);

  const handleExport = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      words,
      records: [...records.values()],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `super-translate-wordbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      // 兼容两种格式：2.1 的 {version:2, words, records} 和更早导出的纯数组
      const incoming: Word[] = Array.isArray(parsed)
        ? []
        : (parsed.words as Word[] ?? []);
      if (!Array.isArray(parsed) && !Array.isArray(parsed.words)) {
        throw new Error('文件格式不对');
      }
      if (Array.isArray(parsed)) {
        throw new Error('这是旧版本导出的文件，请先在旧版本里导入后再升级');
      }

      const existing = new Set(words.map((w) => w.word.toLowerCase()));
      const added = incoming.filter((w) => w.word && !existing.has(w.word.toLowerCase()));
      const incomingRecords: LearningRecord[] = (parsed.records as LearningRecord[]) ?? [];
      const knownIds = new Set([...records.keys()]);
      const addedRecords = incomingRecords.filter((r) => !knownIds.has(r.wordId));

      if (added.length > 0 || addedRecords.length > 0) {
        await replaceAll([...added, ...words], [...addedRecords, ...records.values()]);
      }
      setToast({ message: `导入成功，新增 ${added.length} 个单词`, severity: 'success' });
    } catch (err) {
      setToast({ message: `导入失败：${(err as Error).message}`, severity: 'error' });
    }
  };

  // 沉浸式流程接管整个视口，不渲染侧边导航
  if (session === 'review' && reviewWords.length > 0) {
    return (
      <ReviewView
        words={reviewWords}
        allWords={words}
        records={records}
        config={studyConfig}
        updateRecord={updateRecord}
        onExit={() => setSession(null)}
        onFinish={() => setSession(newWords.length > 0 ? 'learn' : null)}
        continueLabel={newWords.length > 0 ? '继续学新词' : undefined}
      />
    );
  }

  if (session === 'learn' && newWords.length > 0) {
    return (
      <LearnView
        words={newWords}
        records={records}
        onGrade={handleFamiliarity}
        onExit={() => setSession(null)}
        onFinish={() => setSession(null)}
      />
    );
  }

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
            {view === 'list' && (
              <Autocomplete
                freeSolo
                size="small"
                sx={{ width: 320 }}
                options={words.map((w) => w.word)}
                inputValue={search}
                onInputChange={(_, v) => setSearch(v)}
                renderInput={(params) => <TextField {...params} placeholder="搜索单词..." />}
              />
            )}
          </div>
          <div className="navbar-end flex items-center gap-2">
            <span className="badge badge-ghost">{words.length} 个单词</span>
            <button
              className="btn btn-error btn-sm btn-outline gap-1"
              disabled={words.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 className="w-4 h-4" />
              清空
            </button>
            <div ref={themeSlotRef} />
          </div>
        </header>

        <main className="flex-1 p-6">
          {!loaded ? (
            <div className="flex justify-center py-20">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : (
            <>
              {view === 'today' && (
                <TodayView
                  words={words}
                  records={records}
                  config={studyConfig}
                  hasUnfinished={false}
                  onStart={startSession}
                  onGoToLibrary={() => switchView('list')}
                />
              )}
              {view === 'list' && (
                <ListView
                  words={filtered}
                  records={records}
                  totalCount={words.length}
                  onDelete={removeWord}
                  onRegenerate={handleRegenerate}
                />
              )}
              {view === 'cards' && <CardsView words={words} />}
              {view === 'quiz' && <QuizView words={words} />}
              {view === 'stats' && <StatsView words={words} records={records} />}
              {view === 'settings' && (
                <SettingsView
                  config={studyConfig}
                  allExercises={allExercises}
                  onChange={updateStudyConfig}
                />
              )}
            </>
          )}
        </main>
      </div>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>清空单词本？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将删除全部 {words.length} 个单词及其学习进度，此操作不可撤销。
            如果开启了 GitHub 同步，删除的记录可能会在下次同步时从其他设备恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>取消</button>
          <button
            className="btn btn-error btn-sm"
            onClick={async () => {
              await replaceAll([], []);
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
