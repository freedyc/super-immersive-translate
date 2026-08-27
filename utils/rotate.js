/**
 * 换主密钥时各数据源的「解出来 / 用新密钥写回去」回调。
 *
 * 单独一个模块，是为了让 masterkey.js 不必知道 API Key 和剪贴板分别存在哪、
 * 是什么格式——它只负责密钥本身的生命周期。
 */
import { decryptEnvelope, encryptEnvelope, isEnvelope } from './crypto.js';
import { rotateMasterKey } from './masterkey.js';

const SECRETS_BLOB = 'secretsEnc';

/** API Key：本机 storage.sync 里的一团密文 */
const secretsHandler = {
  remote: false,
  async read(oldDek, pass) {
    const stored = await chrome.storage.sync.get(SECRETS_BLOB);
    if (!isEnvelope(stored[SECRETS_BLOB])) return null;
    return decryptEnvelope(stored[SECRETS_BLOB], pass);
  },
  async write(data, newDek, pass) {
    if (data === null) return;
    await chrome.storage.sync.set({
      [SECRETS_BLOB]: await encryptEnvelope(data, pass, newDek),
    });
  },
};

/**
 * 剪贴板：密文在 GitHub 上。标记 remote 让它排在本地写入之前——
 * 网络这一步是唯一可能失败的，失败时本机应当一切照旧。
 */
function clipboardHandler(sync) {
  return {
    remote: true,
    async read(oldDek, pass) {
      const raw = await sync.pullClipboard().catch(() => null);
      if (!isEnvelope(raw)) return null;
      return decryptEnvelope(raw, pass);
    },
    async write(data, newDek, pass) {
      if (data === null) return;
      await sync.pushClipboard(await encryptEnvelope(data, pass, newDek));
    },
  };
}

/**
 * 换一把新的主密钥并作废旧的恢复密钥。
 *
 * @param {string} passphrase 当前口令
 * @param {object} [opts]
 * @param {object} [opts.clipboardSync] 提供 pullClipboard/pushClipboard 的对象；
 *   不传就只换本机那份（剪贴板同步没开时就是这种情况）
 * @returns {Promise<string>} 新的恢复密钥
 */
export function rotateAll(passphrase, { clipboardSync } = {}) {
  const handlers = { secrets: secretsHandler };
  if (clipboardSync) handlers.clipboard = clipboardHandler(clipboardSync);
  return rotateMasterKey(passphrase, handlers);
}
