/**
 * 加密与同步内容设置。
 *
 * 一条不能动摇的原则：**口令永远只存在本地**（chrome.storage.local），
 * 既不进 chrome.storage.sync（那会经 Google），也不进 GitHub 同步
 * （那会跟密文一起走，加密就白做了）。代价是换设备要手输一次口令。
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Eye, EyeOff, KeyRound, Lock, ShieldCheck, TriangleAlert, Wand2 } from 'lucide-react';
import { generateRecoveryKey } from '../../utils/crypto.js';
import {
  disableEncryption, enableEncryption, getPassphrase, isEncryptedNow,
} from '../../utils/secrets.js';
import { exportRecoveryKey, restoreFromRecoveryKey } from '../../utils/masterkey.js';
import { rotateAll } from '../../utils/rotate.js';
import { clipboardCiphertext } from '../../utils/github-sync.js';

export function EncryptionCard({ settings, update }: {
  settings: Record<string, unknown>;
  update: (patch: Record<string, unknown>) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /** 恢复密钥只在用户主动点击后显示——它等同于全部数据的解密能力 */
  const [recovery, setRecovery] = useState('');
  const [restoreKey, setRestoreKey] = useState('');

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

  const showRecovery = async () => {
    setBusy(true);
    try {
      setRecovery(await exportRecoveryKey(passphrase.trim()));
      setMsg('');
    } catch (err) {
      setMsg((err as Error)?.message || '导出失败');
    } finally { setBusy(false); }
  };

  const downloadRecovery = () => {
    const blob = new Blob([
      '超级翻译 · 恢复密钥\n',
      '════════════════════════════════════════\n\n',
      `${recovery}\n\n`,
      '这串密钥可以解开你全部的加密数据（API Key、剪贴板同步内容），\n',
      '即使忘记口令、或换到一台从未输过口令的设备也能恢复。\n\n',
      '· 请离线保存：密码管理器、打印出来、或存进加密的本地文件\n',
      '· 不要放进会被同步的位置——那等于把钥匙和密文一起交出去\n',
      '· 拿到它的人可以解开你的全部数据\n\n',
      `生成时间：${new Date().toLocaleString('zh-CN')}\n`,
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '超级翻译-恢复密钥.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const restore = async () => {
    if (!restoreKey.trim()) { setMsg('请先粘贴恢复密钥'); return; }
    if (!passphrase.trim()) { setMsg('请同时设置一个新口令'); return; }
    setBusy(true);
    try {
      await restoreFromRecoveryKey(restoreKey.trim(), passphrase.trim());
      await refresh();
      setRestoreKey('');
      setMsg('已用恢复密钥恢复访问，历史数据现在可以解密了');
    } catch (err) {
      setMsg((err as Error)?.message || '恢复失败，请检查密钥是否完整');
    } finally { setBusy(false); }
  };

  /**
   * 换一把新主密钥。旧的恢复密钥立刻作废——泄露时用这个。
   * 跟换口令不同：所有数据都要重新加密一遍，所以要用户明确确认。
   */
  const rotate = async () => {
    if (!confirm(
      '将生成新的恢复密钥，旧的立刻作废。\n\n'
      + '所有加密数据会用新密钥重新加密一遍。'
      + '若已开启剪贴板同步，需要能连上 GitHub，否则本次不做任何改动。\n\n'
      + '确定继续？',
    )) return;

    setBusy(true);
    try {
      const next = await rotateAll(passphrase.trim(), {
        // 只有开了剪贴板同步才需要连远端；没开就只换本机那份
        clipboardSync: settings.githubSyncClipboard ? clipboardCiphertext : undefined,
      });
      setRecovery(next);
      setMsg('已换新密钥。请立刻保存下面这串新的恢复密钥，旧的已作废');
    } catch (err) {
      setMsg(`换密钥失败，未做任何改动：${(err as Error)?.message || ''}`);
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

      {encrypted && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
          <div className="flex items-start gap-1.5 text-xs">
            <KeyRound className="w-3.5 h-3.5 shrink-0 mt-px text-warning" />
            <span className="text-base-content/70">
              <b>恢复密钥</b>是全局唯一的一把主密钥，
              你的 API Key 和剪贴板同步内容都由它加密。
              <b className="text-warning">拿到它就能恢复全部数据</b>——
              即使忘了口令、或换到一台从没输过口令的设备。
              务必离线保存一份；换口令不会让它失效。
            </span>
          </div>

          {recovery ? (
            <>
              <code className="block text-xs font-mono break-all bg-base-200 rounded p-2 select-all">
                {recovery}
              </code>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-xs btn-primary gap-1" onClick={downloadRecovery}>
                  <Download className="w-3 h-3" />
                  下载为文件
                </button>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => navigator.clipboard.writeText(recovery)}
                >
                  复制
                </button>
                <button className="btn btn-xs btn-ghost" onClick={() => setRecovery('')}>
                  我已保存，隐藏
                </button>
                <button className="btn btn-xs btn-ghost text-warning" disabled={busy} onClick={rotate}>
                  重新生成
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-xs btn-outline" disabled={busy} onClick={showRecovery}>
                显示恢复密钥
              </button>
              <button className="btn btn-xs btn-ghost text-warning" disabled={busy} onClick={rotate}>
                重新生成（旧的作废）
              </button>
            </div>
          )}
        </div>
      )}

      <details className="collapse collapse-arrow bg-base-200/40 rounded-lg">
        <summary className="collapse-title min-h-0 py-2 text-xs font-medium">
          忘记口令？用恢复密钥找回
        </summary>
        <div className="collapse-content flex flex-col gap-2">
          <p className="text-xs text-base-content/50">
            粘贴之前保存的恢复密钥，并在上面填一个新口令。
            恢复后全部历史数据（含已上传的）立刻可读。
          </p>
          <textarea
            className="textarea textarea-sm font-mono text-xs"
            rows={2}
            placeholder="粘贴恢复密钥…"
            value={restoreKey}
            onChange={(e) => setRestoreKey(e.target.value)}
          />
          <button className="btn btn-sm btn-outline self-start" disabled={busy} onClick={restore}>
            用恢复密钥恢复
          </button>
        </div>
      </details>

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
