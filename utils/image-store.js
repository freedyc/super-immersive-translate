/**
 * 剪贴板图片仓库（IndexedDB）。
 *
 * 为什么不跟文字放一起：文字那套是「读出整个数组 → 改 → 写回整个数组」，
 * 每复制一次文字就全量序列化一遍。数组里一旦有几 MB 的图片，
 * 每次复制文字都要重写那几 MB。这是设计冲突，不是优化问题。
 * 图片按条读写，正是 IndexedDB 擅长的。
 *
 * 存的是 Blob 不是 base64：base64 比原始字节大三分之一，而且要经过一次
 * 字符串化。IndexedDB 原生支持 Blob，没必要绕这一圈。
 *
 * 扩展页面和 Service Worker 同源，共用这个库；**内容脚本不行**——
 * 它跑在宿主页面的源里，看到的是另一个 IndexedDB。所以抓取和写入都在
 * Service Worker 里做。
 */

const DB_NAME = 'sit-clipboard';
const DB_VERSION = 1;
const STORE = 'images';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // 列表按时间倒序，用索引避免把全部记录读出来再排
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putImage(record) {
  const db = await open();
  try { return await tx(db, 'readwrite', (s) => s.put(record)); }
  finally { db.close(); }
}

/**
 * 列出全部记录，按时间倒序。
 *
 * 只取缩略图，不取原图：列表里三十张原图会一次性占满内存，
 * 而列表根本不需要原始分辨率。原图在用户点「复制」或「查看」时按 id 单独取。
 */
export async function listImages() {
  const db = await open();
  try {
    const all = await tx(db, 'readonly', (s) => s.getAll());
    return (all || [])
      .map(({ blob, ...meta }) => meta) // eslint-disable-line no-unused-vars
      .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.timestamp - a.timestamp));
  } finally { db.close(); }
}

export async function getImage(id) {
  const db = await open();
  try { return await tx(db, 'readonly', (s) => s.get(id)); }
  finally { db.close(); }
}

export async function deleteImage(id) {
  const db = await open();
  try { return await tx(db, 'readwrite', (s) => s.delete(id)); }
  finally { db.close(); }
}

export async function updateImage(id, patch) {
  const db = await open();
  try {
    return await tx(db, 'readwrite', (s) => {
      const req = s.get(id);
      req.onsuccess = () => { if (req.result) s.put({ ...req.result, ...patch }); };
      return req;
    });
  } finally { db.close(); }
}

export async function clearImages() {
  const db = await open();
  try { return await tx(db, 'readwrite', (s) => s.clear()); }
  finally { db.close(); }
}

/**
 * 选出超出容量、该被淘汰的 id。
 *
 * 纯函数，跟 IndexedDB 无关，方便断言覆盖。置顶的不参与淘汰——
 * 置顶就是为了留住它，被容量规则默默删掉是最难解释的一种数据丢失。
 */
export function pickEvictions(records, maxItems) {
  const limit = Number(maxItems) > 0 ? Number(maxItems) : 0;
  if (!limit) return [];
  const keepable = records
    .filter((r) => !r.pinned)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const pinnedCount = records.length - keepable.length;
  const room = Math.max(0, limit - pinnedCount);
  return keepable.slice(room).map((r) => r.id);
}

export async function trimImages(maxItems) {
  const records = await listImages();
  const doomed = pickEvictions(records, maxItems);
  for (const id of doomed) await deleteImage(id);
  return doomed.length;
}
