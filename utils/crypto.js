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
/** 信封格式：数据用随机 DEK 加密，DEK 再被口令派生的 KEK 包起来 */
const ENVELOPE_VERSION = 2;

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


// ─────────────────────────────────────────────────────────────────────────────
// 信封加密（v2）
//
// v1 直接用口令派生的密钥加密数据，于是**换口令就意味着旧密文再也解不开**——
// 已经同步到 GitHub 的剪贴板密文会就此搁浅。这不是可以接受的取舍：
// 「以前上传的数据永远解得开」才是正确行为。
//
// 信封的做法：数据始终用一把随机生成的数据密钥（DEK）加密；口令派生的
// 密钥（KEK）只负责把 DEK 包起来。换口令时只需用新 KEK 重新包一次 DEK，
// 数据密文一个字节都不用动，历史数据自然仍然可读。
//
// 这也是密码管理器的通行做法。
// ─────────────────────────────────────────────────────────────────────────────

/** 从口令派生包装密钥。只用来包/解 DEK，不直接碰数据 */
async function deriveKek(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

function newDek() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * 用信封加密数据。
 *
 * @param {any} data
 * @param {string} passphrase
 * @param {CryptoKey} [dek] 复用已有的数据密钥；不传就新生成一把。
 *   同一份数据源的后续写入应当复用，否则每次换 DEK，
 *   旧密文就又变成解不开的了——那等于没解决问题
 */
export async function encryptEnvelope(data, passphrase, dek) {
  if (!passphrase) throw new Error('没有设置加密口令');
  const key = dek || await newDek();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const wrapIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(passphrase, salt, ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv: wrapIv });

  const dataIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dataIv }, key, enc.encode(JSON.stringify(data)),
  );

  return {
    v: ENVELOPE_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    wrappedKey: { iv: toBase64(wrapIv), key: toBase64(wrapped) },
    data: { iv: toBase64(dataIv), ciphertext: toBase64(ciphertext) },
  };
}

/** 从信封里取出数据密钥。换口令、追加写入都需要它 */
export async function unwrapDek(envelope, passphrase) {
  if (!passphrase) throw new Error('没有设置加密口令');
  const kek = await deriveKek(
    passphrase,
    fromBase64(envelope.salt),
    Number(envelope.iterations) || ITERATIONS,
  );
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromBase64(envelope.wrappedKey.key),
      kek,
      { name: 'AES-GCM', iv: fromBase64(envelope.wrappedKey.iv) },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  } catch {
    const err = new Error('口令不正确，或密文已被修改');
    err.name = 'WrongPassphraseError';
    throw err;
  }
}

/**
 * 解开信封。同时兼容 v1 旧密文——老用户的数据不能因为升级就打不开。
 */
export async function decryptEnvelope(envelope, passphrase) {
  if (!envelope || typeof envelope !== 'object') throw new Error('密文格式不对');
  if (envelope.v === FORMAT_VERSION) return decryptJson(envelope, passphrase);
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`不认识的加密格式版本 ${envelope.v}`);
  }

  const dek = await unwrapDek(envelope, passphrase);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.data.iv) },
      dek,
      fromBase64(envelope.data.ciphertext),
    );
    return JSON.parse(dec.decode(plain));
  } catch {
    const err = new Error('密文已被修改');
    err.name = 'WrongPassphraseError';
    throw err;
  }
}

/**
 * 换口令：只把 DEK 重新包一遍，**数据密文原样保留**。
 *
 * 这正是信封存在的意义——历史数据不需要重新加密，也就不存在
 * 「换了口令旧数据就打不开」这件事。
 */
export async function rewrapEnvelope(envelope, oldPassphrase, newPassphrase) {
  if (!newPassphrase) throw new Error('新口令不能为空');
  // v1 没有 DEK 可包，只能整体解密后重新用信封封一次
  if (envelope?.v === FORMAT_VERSION) {
    const data = await decryptJson(envelope, oldPassphrase);
    return encryptEnvelope(data, newPassphrase);
  }

  const dek = await unwrapDek(envelope, oldPassphrase);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const wrapIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(newPassphrase, salt, ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: wrapIv });

  return {
    ...envelope,
    salt: toBase64(salt),
    iterations: ITERATIONS,
    wrappedKey: { iv: toBase64(wrapIv), key: toBase64(wrapped) },
  };
}

/** 是不是本模块产出的密文（v1 或 v2 都算） */
export function isEnvelope(payload) {
  return !!payload
    && typeof payload === 'object'
    && (payload.v === ENVELOPE_VERSION || payload.v === FORMAT_VERSION);
}


/** 只包装一把密钥，不带数据负载——主密钥用这个形态保存 */
export async function wrapDek(dek, passphrase) {
  if (!passphrase) throw new Error('没有设置加密口令');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveKek(passphrase, salt, ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return {
    v: ENVELOPE_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    wrappedKey: { iv: toBase64(iv), key: toBase64(wrapped) },
  };
}

export function exportRawKey(key) {
  return crypto.subtle.exportKey('raw', key);
}

export function importRawKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true,
    ['encrypt', 'decrypt']);
}
