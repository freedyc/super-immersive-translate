/**
 * 端到端加密：剪贴板历史同步到 GitHub 前先在本地加密。
 *
 * 威胁模型很具体：Gist / 仓库对 GitHub 是可读的，剪贴板里可能有任何东西。
 * 所以密文之外的一切（GitHub、网络中间人、拿到你仓库的人）都不该能还原内容。
 *
 * 为什么是口令派生对称密钥，而不是 RSA 公私钥：
 * 非对称方案里私钥必须出现在**每一台**要读取历史的设备上，于是你还是得把
 * 私钥导出、传输、并用某种口令保护它——最终仍然回到"记住一个秘密"，
 * 却多了三个能弄丢数据的环节。这里把两种诉求合成一个机制：
 * 你可以自己想一个口令，也可以让它生成一串高熵恢复密钥当口令用
 * （generateRecoveryKey），存进密码管理器，在别的设备粘贴即可——
 * 那就是"持有密钥才能解密"，只是密钥的形态是一串字符。
 *
 * 参数选择：PBKDF2-HMAC-SHA256 60 万次迭代（OWASP 现行建议），
 * 每次加密都用新的随机盐和随机 IV，AES-256-GCM 自带完整性校验——
 * 密文被改过一个字节，解密就会失败而不是给出错误明文。
 */

const ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;   // GCM 的标准 IV 长度，不要改
const FORMAT_VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 加密任意可 JSON 序列化的数据。
 *
 * 盐和 IV 随密文一起明文保存——它们本来就不需要保密，需要保密的只有口令。
 * 每次加密都重新随机：同一份数据两次加密得到不同密文，
 * 观察者无法从"密文没变"推断"内容没变"。
 */
export async function encryptJson(data, passphrase) {
  if (!passphrase) throw new Error('没有设置加密口令');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)),
  );
  return {
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * 解密。口令不对、或密文被篡改过，都会抛 WrongPassphraseError——
 * AES-GCM 的认证标签让这两种情况无法产生"看起来像样的错误明文"。
 */
export async function decryptJson(payload, passphrase) {
  if (!payload || typeof payload !== 'object') throw new Error('密文格式不对');
  if (payload.v !== FORMAT_VERSION) {
    throw new Error(`不认识的加密格式版本 ${payload.v}`);
  }
  if (!passphrase) throw new Error('没有设置加密口令');

  const key = await deriveKey(
    passphrase,
    fromBase64(payload.salt),
    // 迭代次数跟着密文走，将来调高参数时旧密文仍然解得开
    Number(payload.iterations) || ITERATIONS,
  );
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.ciphertext),
    );
  } catch {
    const err = new Error('口令不正确，或密文已被修改');
    err.name = 'WrongPassphraseError';
    throw err;
  }
  return JSON.parse(dec.decode(plain));
}

/** 这团数据是不是本模块产出的密文 */
export function isEncrypted(payload) {
  return !!payload
    && typeof payload === 'object'
    && payload.v === FORMAT_VERSION
    && typeof payload.ciphertext === 'string'
    && typeof payload.salt === 'string'
    && typeof payload.iv === 'string';
}

/**
 * 生成一串高熵恢复密钥当口令用。
 *
 * 256 位随机量，按 base32 分组便于抄写和肉眼核对。
 * 用它就等于"持有密钥才能解密"——密钥的形态是一串字符，
 * 存进密码管理器、在别的设备粘贴即可。
 */
export function generateRecoveryKey() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉了 I/O/0/1，抄错的常见来源
  // 字母表 32 个字符 = 每个字符 5 bit，所以要 52 个字符才够 256 位
  // （不是 32 个——32 个字符只有 160 位）。字母表长度整除 256，
  // 取模不会引入偏置
  const CHARS = Math.ceil(256 / 5);
  const bytes = crypto.getRandomValues(new Uint8Array(CHARS));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return chars.join('').replace(/(.{5})(?=.)/g, '$1-');
}
