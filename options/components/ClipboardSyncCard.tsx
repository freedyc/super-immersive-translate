/**
 * 剪贴板加密同步的设置。
 *
 * 这一块的规则跟别的设置项不同，因为它是整个插件里唯一涉及密钥的地方：
 * 口令存 chrome.storage.local 而不是 sync——sync 会同步到 Google 账号，
 * 把密文交给 GitHub、把钥匙交给 Google，就谈不上端到端加密了。
 * 代价是换设备要重输一次，这是应该付的代价。
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, TriangleAlert, Wand2 } from 'lucide-react';
import { generateRecoveryKey, isEnvelope, rewrapEnvelope } from '../../utils/crypto.js';
import { clipboardCiphertext } from '../../utils/github-sync.js';
// 起别名：组件里的 useState setter 也叫 setPassphrase，直接导入会被它遮住
import { getPassphrase, setPassphrase as persistPassphrase } from '../../utils/passphrase.js';

export function ClipboardSyncCard({ enabled, onToggle }: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 走统一入口：全扩展只有一个口令，跟「加密与同步内容」那张卡是同一个
    getPassphrase().then((v) => {
      setPassphrase(v as string);
      setLoaded(true);
    });
  }, []);

  const save = async (value: string) => {
    setPassphrase(value);
    await persistPassphrase(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  /**
   * 换口令。
   *
   * 远端那份密文是用旧口令包装的，只改本地口令的话下次同步就解不开了。
   * 信封把「包装」和「数据」分开，所以这里只需把包装换掉——
   * 数据密文一个字节都不用动，历史记录照常可读。
   *
   * 远端拉不到或解不开就中止，本地口令保持原样：宁可这次没换成，
   * 也不能让本地和远端对不上（那会让同步永久坏掉）。
   */
  const changePassphrase = async () => {
    const next = draft.trim();
    if (!next) { setHint('请先填写新口令'); return; }
    const current = await getPassphrase();
    if (!current) { await save(next); return; }
    if (next === current) { setHint('新口令与当前相同'); return; }

    setBusy(true);
    try {
      const remote = await clipboardCiphertext.pullClipboard().catch(() => null);
      if (isEnvelope(remote)) {
        await clipboardCiphertext.pushClipboard(
          await rewrapEnvelope(remote, current, next),
        );
      }
      await save(next);
      setDraft('');
      setHint('已换新口令，历史记录仍可解密');
    } catch (err) {
      setHint(`换口令失败，未做任何改动：${(err as Error)?.message || ''}`);
    } finally { setBusy(false); }
  };

  const generate = () => { setReveal(true); save(generateRecoveryKey()); };

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/40">
        剪贴板（端到端加密）
      </h4>

      <label className="cursor-pointer flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-primary checkbox-sm"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>同步剪贴板记录</span>
      </label>

      {enabled && (
        <>
          <div className="flex items-start gap-1.5 text-xs text-base-content/50">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-success" />
            <span>
              内容在本机用 AES-256-GCM 加密后才上传，密钥由下面的口令经
              PBKDF2（60 万次迭代）派生。GitHub 上只有密文，没有口令谁都解不开——
              包括你自己，所以请务必保存好。
            </span>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2 pb-1">
              <span className="text-xs text-base-content/60">加密口令</span>
              {saved && <span className="text-xs text-success">已保存</span>}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={reveal ? 'text' : 'password'}
                  className="input input-sm w-full pr-9 font-mono"
                  placeholder={loaded ? '输入口令，或点右侧生成一串' : '读取中…'}
                  value={passphrase}
                  onChange={(e) => save(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-circle absolute right-1 top-1/2 -translate-y-1/2"
                  title={reveal ? '隐藏' : '显示'}
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button className="btn btn-sm btn-outline gap-1 shrink-0" onClick={generate}>
                <Wand2 className="w-3.5 h-3.5" />
                生成
              </button>
            </div>
          </div>

          <div className="flex items-start gap-1.5 text-xs text-base-content/50">
            <KeyRound className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              「生成」会造一串 256 位随机密钥当口令用——这就是「持有密钥才能解密」，
              只是密钥的形态是一串字符。存进密码管理器，在别的设备粘贴同一串即可。
            </span>
          </div>

          {!passphrase && (
            <div className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>还没设置口令。在设好之前剪贴板不会上传——绝不会退化成明文同步。</span>
            </div>
          )}

          {passphrase && (
            <details className="collapse collapse-arrow bg-base-200/40 rounded-lg">
              <summary className="collapse-title min-h-0 py-2 text-xs font-medium">
                换一个口令
              </summary>
              <div className="collapse-content flex flex-col gap-2">
                <p className="text-xs text-base-content/50">
                  换口令时会把远端那份密文重新包装一次，
                  <b className="text-base-content/70">历史记录不会因此丢失</b>。
                  远端拉不到或解不开就中止，本地口令保持原样。
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input input-sm flex-1 font-mono"
                    placeholder="新口令"
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); setHint(''); }}
                  />
                  <button
                    className="btn btn-sm btn-outline shrink-0"
                    onClick={() => setDraft(generateRecoveryKey())}
                  >
                    生成
                  </button>
                </div>
                <button
                  className="btn btn-sm btn-primary self-start"
                  disabled={busy}
                  onClick={changePassphrase}
                >
                  换口令
                </button>
                {hint && <span className="text-xs text-base-content/60">{hint}</span>}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
