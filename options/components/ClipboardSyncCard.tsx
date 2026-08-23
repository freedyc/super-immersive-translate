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
import { generateRecoveryKey } from '../../utils/crypto.js';

export function ClipboardSyncCard({ enabled, onToggle }: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get('clipboardSyncPassphrase').then((s) => {
      setPassphrase((s.clipboardSyncPassphrase as string) || '');
      setLoaded(true);
    });
  }, []);

  const save = async (value: string) => {
    setPassphrase(value);
    await chrome.storage.local.set({ clipboardSyncPassphrase: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
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
        </>
      )}
    </div>
  );
}
