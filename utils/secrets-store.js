/**
 * 加密口令的存取。单独成一个模块，是为了打断循环依赖：
 * secrets.js 需要 masterkey.js 取主密钥，而 masterkey.js 需要读口令——
 * 口令留在 secrets.js 里的话两者会互相 import。
 *
 * 口令**只存 chrome.storage.local**：进了 sync 会经 Google，
 * 上传 GitHub 会跟密文一起走，两种都让加密失去意义。
 */
const PASSPHRASE_KEY = 'syncPassphrase';
/** 剪贴板同步先落地、用的是这个键名；老用户不该被要求重设 */
const LEGACY_PASSPHRASE_KEY = 'clipboardSyncPassphrase';

export async function getPassphrase() {
  const s = await chrome.storage.local.get([PASSPHRASE_KEY, LEGACY_PASSPHRASE_KEY]);
  return s[PASSPHRASE_KEY] || s[LEGACY_PASSPHRASE_KEY] || '';
}

export async function setPassphrase(value) {
  // 同时写兼容键：整个扩展只有一个口令的概念，两边各写各的会出现
  // 「在这个界面设了，那个功能却说没设」
  await chrome.storage.local.set({
    [PASSPHRASE_KEY]: value,
    [LEGACY_PASSPHRASE_KEY]: value,
  });
}
