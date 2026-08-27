/**
 * 剪贴板同步的加密口令。
 *
 * 只有这一处用到加密：剪贴板是你复制过的全部内容，上传到 GitHub 不加密
 * 是真的危险。API Key 没有加密——它防的只是「经 Google 同步」这一条，
 * 而 Key 在本机内存和设置页输入框里本就是明文可见的，
 * 为它引入一整套密钥体系不划算（试过，删了）。
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
