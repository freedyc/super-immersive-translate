/**
 * 全局唯一的数据密钥（主密钥）。
 *
 * 为什么必须只有一把：如果 API Key 一把、剪贴板另一把，那「保存好这串密钥
 * 就能恢复数据」这句话就是假的——你得保存好几串，而且哪串对应什么
 * 用户根本无从知道。一把主密钥意味着一份恢复凭证覆盖全部加密内容。
 *
 * 存储形态：主密钥本身**从不明文落盘**，而是被口令派生的 KEK 包装后
 * 存在 masterKeyEnc 里。换口令只重新包装它，所有用它加密过的数据
 * （包括已经上传到 GitHub 的）继续可读。
 *
 * 恢复密钥就是这把主密钥的可读编码。拿到它 = 拿到全部数据的解密能力，
 * 所以它值得被郑重地保存一次，也因此绝不能上传到任何地方。
 */
import { exportRawKey, importRawKey, unwrapDek, wrapDek } from './crypto.js';
import { getPassphrase } from './secrets-store.js';

const MASTER_KEY = 'masterKeyEnc';

/** base32 字母表去掉了 I/O/0/1——抄写时最容易认错的几个 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.replace(/(.{5})(?=.)/g, '$1-');
}

function fromBase32(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-9]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('恢复密钥含有无效字符');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (out.length !== 32) throw new Error('恢复密钥长度不对');
  return new Uint8Array(out);
}

/**
 * 取主密钥。
 *
 * 顺序很关键：**先找现成的，最后才新建**。
 *  1. 本机已保存的主密钥
 *  2. adoptFrom 给的信封里的密钥——比如远端已有的剪贴板密文。
 *     另一台设备先启用了加密，这台设备必须认领同一把，
 *     否则同一个口令会长出两把互不相认的主密钥，两边都读不了对方的数据
 *  3. 都没有才生成新的
 *
 * @param {string} [passphrase]
 * @param {object} [opts]
 * @param {object} [opts.adoptFrom] 一个已有的信封，能解开就认领它的密钥
 */
export async function getMasterDek(passphrase, { adoptFrom } = {}) {
  const pass = passphrase ?? await getPassphrase();
  if (!pass) throw new Error('没有设置加密口令');

  const stored = await chrome.storage.sync.get(MASTER_KEY);
  if (stored[MASTER_KEY]) return unwrapDek(stored[MASTER_KEY], pass);

  if (adoptFrom?.wrappedKey) {
    // 解不开说明口令不对，让错误冒上去——静默新建会把两边彻底劈开
    const adopted = await unwrapDek(adoptFrom, pass);
    await chrome.storage.sync.set({ [MASTER_KEY]: await wrapDek(adopted, pass) });
    return adopted;
  }

  const dek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
  await chrome.storage.sync.set({ [MASTER_KEY]: await wrapDek(dek, pass) });
  return dek;
}

export async function hasMasterKey() {
  const stored = await chrome.storage.sync.get(MASTER_KEY);
  return !!stored[MASTER_KEY];
}

/** 换口令：只重新包装主密钥，数据密文全都不动 */
export async function rewrapMaster(oldPassphrase, newPassphrase) {
  const stored = await chrome.storage.sync.get(MASTER_KEY);
  if (!stored[MASTER_KEY]) return;
  const dek = await unwrapDek(stored[MASTER_KEY], oldPassphrase);
  await chrome.storage.sync.set({ [MASTER_KEY]: await wrapDek(dek, newPassphrase) });
}

/**
 * 导出恢复密钥。
 *
 * 这串东西等同于全部加密数据的解密能力——保存进密码管理器或打印出来，
 * 但**永远不要**放进会被同步的地方，那等于把钥匙和密文一起交出去。
 */
export async function exportRecoveryKey(passphrase) {
  const dek = await getMasterDek(passphrase);
  return toBase32(new Uint8Array(await exportRawKey(dek)));
}

/**
 * 用恢复密钥重新取得访问权：把它当作主密钥，用新口令重新包装。
 *
 * 口令忘了、或换到一台从没输过口令的设备时走这条路。
 * 之后所有历史密文（含已上传的）立刻恢复可读。
 */
export async function restoreFromRecoveryKey(recoveryKey, newPassphrase) {
  if (!newPassphrase) throw new Error('请同时设置一个新口令');
  const dek = await importRawKey(fromBase32(recoveryKey));
  await chrome.storage.sync.set({ [MASTER_KEY]: await wrapDek(dek, newPassphrase) });
  return dek;
}
