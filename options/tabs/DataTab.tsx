import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Upload, Download, RotateCcw, CloudSync, Package, PackageOpen } from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { Card, SelectField, TextField, CheckField } from '../components/Field.tsx';
import { DEFAULTS } from '../../utils/defaults.js';
import type { TabProps } from '../lib/types.ts';
import type { SyncStatus } from '../../types/models.ts';

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 「全部数据」备份文件的形状 */
interface BackupBundle {
  type: 'super-immersive-translate-backup';
  version: number;
  exportedAt: string;
  settings: Record<string, unknown>;
  wordbook: unknown[];
  history: unknown[];
}

/** 待确认的危险操作：恢复默认设置，或导入会覆盖现有数据的备份 */
type PendingConfirm = 'reset' | { type: 'importAll'; bundle: BackupBundle } | null;

export function DataTab({ settings, update, reload, notify }: TabProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const settingsFileRef = useRef<HTMLInputElement>(null);
  const bundleFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const read = () => chrome.storage.local.get('githubSyncStatus')
      .then(({ githubSyncStatus }) => setSyncStatus((githubSyncStatus as SyncStatus) || null));
    read();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes.githubSyncStatus) read();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const exportSettings = async () => {
    downloadJson(await chrome.storage.sync.get(null), `sit-settings-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importSettings = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await chrome.storage.sync.set(JSON.parse(await file.text()));
      reload();
    } catch (err) {
      notify({ severity: 'error', message: `导入失败：${(err as Error).message}` });
    }
  };

  const exportAll = async () => {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get({ wordbook: [], translationHistory: [] }),
    ]);
    // GitHub token 是账号级权限（尤其 repo 权限的 PAT），不写进导出文件；
    // 只删副本里的，不影响实际存储。
    const exported = { ...sync };
    delete exported.githubToken;
    delete exported.githubOAuthAccessToken;
    downloadJson({
      type: 'super-immersive-translate-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: exported,
      wordbook: local.wordbook || [],
      history: local.translationHistory || [],
    }, `sit-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const pickBundle = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (bundle.type !== 'super-immersive-translate-backup' || !bundle.settings) {
        throw new Error('不是有效的全部数据备份文件');
      }
      setConfirm({ type: 'importAll', bundle });
    } catch (err) {
      notify({ severity: 'error', message: `导入失败：${(err as Error).message}` });
    }
  };

  const applyBundle = async (bundle: BackupBundle) => {
    await chrome.storage.sync.set(bundle.settings);
    await chrome.storage.local.set({
      wordbook: Array.isArray(bundle.wordbook) ? bundle.wordbook : [],
      translationHistory: Array.isArray(bundle.history) ? bundle.history : [],
    });
    reload();
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await chrome.runtime.sendMessage({ action: 'triggerHistorySync' });
    } finally {
      setSyncing(false);
    }
  };

  const statusLine = () => {
    if (!syncStatus?.lastSyncAt) return <span className="text-xs text-base-content/40">尚未同步</span>;
    const time = new Date(syncStatus.lastSyncAt).toLocaleString();
    return syncStatus.lastError
      ? <span className="text-xs text-error">上次同步失败（{time}）：{syncStatus.lastError}</span>
      : <span className="text-xs text-success">上次同步成功：{time}</span>;
  };

  return (
    <>
      <Card title="GitHub 跨设备同步">
        <CheckField
          label="启用 GitHub 同步"
          checked={settings.githubSyncEnabled}
          onChange={(v) => update({ githubSyncEnabled: v })}
        />

        {settings.githubSyncEnabled && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">认证</h4>
              <TextField
                label="GitHub Personal Access Token"
                type="password"
                placeholder="ghp_..."
                hint="Gist 方式需要 gist 权限；仓库方式需要 repo 权限。Token 不会写进导出文件。"
                value={settings.githubToken}
                onChange={(v) => update({ githubToken: v }, { debounce: true })}
              />
            </div>

            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">同步内容</h4>
              <CheckField
                label="同步单词本（翻译历史始终同步）"
                checked={settings.githubSyncWordbook}
                onChange={(v) => update({ githubSyncWordbook: v })}
              />
            </div>

            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">同步载体</h4>
              <SelectField
                value={settings.githubSyncTargetType}
                options={[['gist', 'Gist（私密，最省事）'], ['repo', '仓库文件（可版本管理）']]}
                onChange={(v) => update({ githubSyncTargetType: v })}
              />
              {settings.githubSyncTargetType === 'repo' && (
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="所有者" placeholder="your-name" value={settings.githubRepoOwner}
                    onChange={(v) => update({ githubRepoOwner: v }, { debounce: true })} />
                  <TextField label="仓库名" placeholder="my-notes" value={settings.githubRepoName}
                    onChange={(v) => update({ githubRepoName: v }, { debounce: true })} />
                  <TextField label="分支" placeholder="main" value={settings.githubRepoBranch}
                    onChange={(v) => update({ githubRepoBranch: v }, { debounce: true })} />
                  <TextField label="文件路径" placeholder="translation-history.json" value={settings.githubRepoPath}
                    onChange={(v) => update({ githubRepoPath: v }, { debounce: true })} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">同步方式</h4>
              <SelectField
                value={settings.githubSyncMode}
                options={[['manual', '手动（只在点「立即同步」时）'], ['auto', '自动（有改动后定时同步）']]}
                onChange={(v) => update({ githubSyncMode: v })}
              />
              {settings.githubSyncMode === 'auto' && (
                <TextField
                  label="同步间隔（分钟）"
                  type="number"
                  value={settings.githubSyncIntervalMinutes}
                  onChange={(v) => update(
                    { githubSyncIntervalMinutes: Math.max(1, parseInt(v, 10) || DEFAULTS.githubSyncIntervalMinutes) },
                    { debounce: true },
                  )}
                />
              )}
            </div>

            <div className="divider my-0" />

            <div className="flex items-center gap-3">
              <button className="btn btn-primary btn-sm gap-1" disabled={syncing} onClick={syncNow}>
                <CloudSync className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                立即同步
              </button>
              {statusLine()}
            </div>
          </div>
        )}
      </Card>

      <Card title="历史记录">
        <TextField
          label="最多保存条数（0 = 不限制）"
          type="number"
          value={settings.historyMaxItems}
          onChange={(v) => update({ historyMaxItems: parseInt(v, 10) || 0 }, { debounce: true })}
        />
      </Card>

      <Card title="设置备份">
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm gap-1" onClick={exportSettings}>
            <Upload className="w-4 h-4" />
            导出设置
          </button>
          <button className="btn btn-outline btn-sm gap-1" onClick={() => settingsFileRef.current?.click()}>
            <Download className="w-4 h-4" />
            导入设置
          </button>
          <input ref={settingsFileRef} type="file" accept=".json" hidden onChange={importSettings} />
        </div>
        <p className="text-xs text-base-content/40">只含设置项，不含单词本和翻译历史。</p>
      </Card>

      <Card title="全部数据备份">
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm gap-1" onClick={exportAll}>
            <Package className="w-4 h-4" />
            导出全部
          </button>
          <button className="btn btn-outline btn-sm gap-1" onClick={() => bundleFileRef.current?.click()}>
            <PackageOpen className="w-4 h-4" />
            导入全部
          </button>
          <input ref={bundleFileRef} type="file" accept=".json" hidden onChange={pickBundle} />
        </div>
        <p className="text-xs text-base-content/40">
          设置 + 单词本 + 翻译历史打包成一个文件。出于安全考虑，GitHub Token 不会被导出。
        </p>
      </Card>

      <Card title="重置">
        <button className="btn btn-error btn-outline btn-sm gap-1 self-start" onClick={() => setConfirm('reset')}>
          <RotateCcw className="w-4 h-4" />
          恢复默认设置
        </button>
        <p className="text-xs text-base-content/40">单词本和翻译历史不受影响。</p>
      </Card>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm === 'reset' ? '恢复默认设置？' : '导入全部数据？'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === 'reset'
              ? '所有设置项会恢复为默认值，此操作不可撤销。单词本和翻译历史不会受影响。'
              : '导入会覆盖当前的设置、单词本和翻译历史，此操作不可撤销。'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>取消</button>
          <button
            className="btn btn-error btn-sm"
            onClick={async () => {
              if (confirm === 'reset') {
                await chrome.storage.sync.set(DEFAULTS);
                reload();
              } else if (confirm?.type === 'importAll') {
                await applyBundle(confirm.bundle);
              }
              setConfirm(null);
            }}
          >
            确认
          </button>
        </DialogActions>
      </Dialog>
    </>
  );
}
