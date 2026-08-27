/**
 * 加密与同步内容设置。
 *
 * 一条不能动摇的原则：**口令永远只存在本地**（chrome.storage.local），
 * 既不进 chrome.storage.sync（那会经 Google），也不进 GitHub 同步
 * （那会跟密文一起走，加密就白做了）。代价是换设备要手输一次口令。
 */
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, TriangleAlert, Wand2 } from 'lucide-react';
import { generateRecoveryKey } from '../../utils/crypto.js';
import {
  disableEncryption, enableEncryption, getPassphrase, isEncryptedNow,
} from '../../utils/secrets.js';

export function EncryptionCard({ settings, update }: {
  settings: Record<string, unknown>;
  update: (patch: Record<string, unknown>) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setPassphrase((await getPassphrase()) as string);
    setEncrypted(await isEncryptedNow());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    if (!passphrase.trim()) { setMsg('请先填写或生成一个口令'); return; }
    setBusy(true);
    try {
      await enableEncryption(passphrase.trim());
      await refresh();
      setMsg('已加密。明文副本已从存储中删除');
    } catch (err) {
      setMsg((err as Error)?.message || '启用失败');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableEncryption();
      await refresh();
      setMsg('已解回明文');
    } catch (err) {
      setMsg((err as Error)?.message || '关闭失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">
        加密与同步内容
      </h4>

      <div className="flex items-start gap-1.5 text-xs text-base-content/50">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-success" />
        <span>
          启用后，API Key 以 AES-256-GCM 密文保存，明文副本会从存储中删除。
          密钥由口令经 PBKDF2（60 万次迭代）派生。
          <b className="text-base-content/70">口令只存在本机</b>，不进 Chrome 账号同步、
          也不上传 GitHub —— 否则密文和钥匙一起走，加密就没有意义。换设备需手动输入一次。
        </span>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 pb-1">
          <span className="text-xs text-base-content/60">加密口令</span>
          <span className={`badge badge-sm ${encrypted ? 'badge-success' : 'badge-ghost'}`}>
            {encrypted ? '已加密' : '明文存储'}
          </span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={reveal ? 'text' : 'password'}
              className="input input-sm w-full pr-9 font-mono"
              placeholder="输入口令，或点右侧生成一串"
              value={passphrase}
              onChange={(e) => { setPassphrase(e.target.value); setMsg(''); }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            className="btn btn-sm btn-outline gap-1 shrink-0"
            onClick={() => { setReveal(true); setPassphrase(generateRecoveryKey()); setMsg(''); }}
          >
            <Wand2 className="w-3.5 h-3.5" />
            生成
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn btn-sm btn-primary gap-1" disabled={busy} onClick={enable}>
          <Lock className="w-3.5 h-3.5" />
          {encrypted ? '用新口令重新加密' : '启用加密'}
        </button>
        {encrypted && (
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={disable}>
            关闭加密
          </button>
        )}
        {msg && <span className="text-xs text-base-content/60">{msg}</span>}
      </div>

      <div className="flex items-start gap-1.5 text-xs text-base-content/50">
        <KeyRound className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          「生成」会造一串 260 位随机密钥当口令用。存进密码管理器，
          在别的设备粘贴同一串即可。<b className="text-warning">口令遗失则密钥无法恢复</b>，
          需要重新填写各引擎的 Key。
        </span>
      </div>

      {encrypted && !passphrase && (
        <div className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>本机没有口令，当前无法解密 API Key，需要 Key 的引擎会不可用。</span>
        </div>
      )}

      <label className="cursor-pointer flex items-center gap-2 text-sm mt-1">
        <input
          type="checkbox"
          className="checkbox checkbox-primary checkbox-sm"
          checked={!!settings.githubSyncSettings}
          onChange={(e) => update({ githubSyncSettings: e.target.checked })}
        />
        <span>同步设置（API Key 以密文随行，口令不上传）</span>
      </label>
    </div>
  );
}
