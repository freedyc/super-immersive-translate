/**
 * API Key 的加密存储。
 *
 * 问题：所有 Key 都放在 chrome.storage.sync 里，也就是明文经过 Google 的服务器
 * 同步到你其他设备。OpenAI / Claude 的 Key 是能直接花钱的凭证，
 * 导出的备份文件里也是明文躺着（代码里刻意删了 githubToken，却漏了这些）。
 *
 * 做法：Key 不再各自占一个 sync 键，而是打包成一团密文存在 secretsEnc 下。
 * 口令存 storage.local，**永不进 sync**——否则密文和钥匙都交给 Google，
 * 加密就没有意义了。这跟剪贴板同步是同一条原则。
 *
 * 读取方一处不动：translator.init() 解密后照常 Object.assign 到实例上，
 * 那 37 处 `t.openaiKey` 之类的属性访问完全不受影响。
 *
 * 没设口令时保持明文（当前行为），只是设置页会提示。不强制加密的理由：
 * 用户在新设备上没输口令之前，翻译会直接不可用——那比明文更糟。
 */
import { decryptEnvelope, encryptEnvelope, isEnvelope, rewrapEnvelope, unwrapDek } from './crypto.js';

/** 需要保护的键。加了新引擎记得同步加进来，verify 有断言盯着 */
export const SECRET_KEYS = [
  'openaiKey', 'deepseekKey', 'geminiKey', 'claudeKey',
  'deeplKey', 'customApiKey', 'githubToken', 'githubOAuthAccessToken',
];

const BLOB_KEY = 'secretsEnc';
const PASSPHRASE_KEY = 'syncPassphrase';
/** 剪贴板同步先用了这个键；老用户不该被要求重新设一遍口令 */
const LEGACY_PASSPHRASE_KEY = 'clipboardSyncPassphrase';

export async function getPassphrase() {
  const s = await chrome.storage.local.get([PASSPHRASE_KEY, LEGACY_PASSPHRASE_KEY]);
  return s[PASSPHRASE_KEY] || s[LEGACY_PASSPHRASE_KEY] || '';
}

export async function setPassphrase(value) {
  // 同时写兼容键：整个扩展只有一个口令的概念，但剪贴板同步先落地、
  // 用的是旧键名。两边各写各的会出现「在这个界面设了，那个功能却说没设」
  await chrome.storage.local.set({
    [PASSPHRASE_KEY]: value,
    [LEGACY_PASSPHRASE_KEY]: value,
  });
}

/**
 * 读出全部密钥。
 *
 * 三种状态：
 *  - 有密文 + 有口令 → 解密返回
 *  - 有密文 + 没口令（新设备刚同步过来）→ 抛 LockedError，
 *    调用方据此提示用户输口令，而不是当成「没配 Key」静默失败
 *  - 没密文 → 读明文（尚未启用加密）
 */
export async function loadSecrets() {
  const stored = await chrome.storage.sync.get([BLOB_KEY, ...SECRET_KEYS]);
  const blob = stored[BLOB_KEY];

  if (!isEnvelope(blob)) {
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, stored[k] || '']));
  }

  const passphrase = await getPassphrase();
  if (!passphrase) {
    const err = new Error('API Key 已加密，请先在设置里输入加密口令');
    err.name = 'LockedError';
    throw err;
  }
  const plain = await decryptEnvelope(blob, passphrase);
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, plain[k] || '']));
}

/** 解不开时不要让整个流程崩掉——没有 Key 只是这些引擎不可用 */
export async function loadSecretsSafe() {
  try {
    return await loadSecrets();
  } catch {
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, '']));
  }
}

/**
 * 写入一个或多个密钥。已启用加密就整团重新加密，否则按老样子写明文。
 */
export async function saveSecrets(patch) {
  const passphrase = await getPassphrase();
  const current = await loadSecretsSafe();
  const next = { ...current, ...patch };

  if (!passphrase) {
    await chrome.storage.sync.set(
      Object.fromEntries(SECRET_KEYS.map((k) => [k, next[k] || ''])),
    );
    return;
  }
  // 复用信封里已有的数据密钥：每次换一把新 DEK 的话，旧密文又会变成
  // 解不开的，那就等于没用信封
  const stored = await chrome.storage.sync.get(BLOB_KEY);
  const dek = isEnvelope(stored[BLOB_KEY]) && stored[BLOB_KEY].v === 2
    ? await unwrapDek(stored[BLOB_KEY], passphrase).catch(() => undefined)
    : undefined;
  await chrome.storage.sync.set({
    [BLOB_KEY]: await encryptEnvelope(next, passphrase, dek),
  });
  // 明文副本必须清掉，否则加密等于没做
  await chrome.storage.sync.remove(SECRET_KEYS);
}

/** 当前是不是已经加密存储 */
export async function isEncryptedNow() {
  const stored = await chrome.storage.sync.get(BLOB_KEY);
  return isEnvelope(stored[BLOB_KEY]);
}

/**
 * 启用加密：把现有明文 Key 搬进密文，并删掉明文副本。
 * 幂等——已经加密过再调一次只是用新口令重新封一遍。
 */
/**
 * 启用加密，或换成新口令。
 *
 * 已经加密过时走 rewrapEnvelope：只把数据密钥重新包一遍，**数据密文不动**。
 * 这样换口令不会让任何历史密文失效——包括别处（比如剪贴板）用同一把
 * 数据密钥加密的内容。
 *
 * 首次启用时才做一次真正的加密。
 */
export async function enableEncryption(passphrase) {
  if (!passphrase) throw new Error('口令不能为空');
  const stored = await chrome.storage.sync.get(BLOB_KEY);
  const blob = stored[BLOB_KEY];

  if (isEnvelope(blob)) {
    const oldPassphrase = await getPassphrase();
    if (!oldPassphrase) {
      // 这台机器没有旧口令，解不出现有密钥。若继续，loadSecretsSafe 会返回
      // 一堆空串并被当成"新内容"封进去，用户的 Key 就此丢失——必须拦住
      const err = new Error('本机没有当前口令，无法换新口令。请先输入现有口令，或关闭加密后重新设置');
      err.name = 'LockedError';
      throw err;
    }
    await chrome.storage.sync.set({
      [BLOB_KEY]: await rewrapEnvelope(blob, oldPassphrase, passphrase),
    });
    await setPassphrase(passphrase);
    await chrome.storage.sync.remove(SECRET_KEYS);
    return;
  }

  const current = await loadSecretsSafe();
  await setPassphrase(passphrase);
  await chrome.storage.sync.set({ [BLOB_KEY]: await encryptEnvelope(current, passphrase) });
  await chrome.storage.sync.remove(SECRET_KEYS);
}

/** 关闭加密：解回明文。用户忘了口令时也是这条路（会丢 Key，需重填） */
export async function disableEncryption() {
  const current = await loadSecretsSafe();
  await chrome.storage.sync.set(
    Object.fromEntries(SECRET_KEYS.map((k) => [k, current[k] || ''])),
  );
  await chrome.storage.sync.remove(BLOB_KEY);
}
