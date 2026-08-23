/**
 * 剪贴板历史的唯一写入口。
 *
 * 与 utils/history.js 同一套约定：整个函数体兜底 try/catch，保证 promise 永远
 * 不 reject——调用方是 copy 事件处理器，记录失败绝不该影响用户真正的复制动作。
 *
 * 容量裁剪按**条数**而不是字节：字节裁剪要先序列化整个数组才知道大小，
 * 而这个函数在每次复制时都会跑一遍。
 */
import { pick } from './defaults.js';

const KEY = 'clipboardHistory';

/** 单条上限。超长的复制（整页文本、代码文件）留个头部就够回溯，不必全存 */
const MAX_TEXT_LENGTH = 20000;

export async function saveClipboardEntry({ text, url = '', title = '' }) {
  try {
    const clean = String(text || '').trim();
    if (!clean) return;

    const { clipboardCapture, clipboardMaxItems } = await chrome.storage.sync.get(
      pick('clipboardCapture', 'clipboardMaxItems'),
    );
    if (!clipboardCapture) return;

    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);

    // 连续复制同一段文字（用户重按快捷键、页面自己也调了 copy）只留一条，
    // 但把时间刷新成最近一次——列表按时间排，否则它会停在旧位置
    const head = list[0];
    if (head && head.text === clean) {
      head.timestamp = Date.now();
      await chrome.storage.local.set({ [KEY]: list });
      return;
    }

    list.unshift({
      id: crypto.randomUUID(),
      text: clean.length > MAX_TEXT_LENGTH ? clean.slice(0, MAX_TEXT_LENGTH) : clean,
      url,
      title,
      timestamp: Date.now(),
    });

    await chrome.storage.local.set({ [KEY]: trim(list, clipboardMaxItems) });
    chrome.runtime.sendMessage({ action: 'clipboardChanged' }).catch(() => {});
  } catch {
    // storage 满了、扩展正在重载等：静默降级，绝不影响用户的复制动作
  }
}

/**
 * 裁到容量上限。置顶的条目永不裁掉——用户置顶就是为了留住它，
 * 被容量规则默默删掉是最难解释的一种数据丢失。
 */
export function trim(list, maxItems) {
  const limit = Number(maxItems) > 0 ? Number(maxItems) : 0;
  if (!limit || list.length <= limit) return list;

  const pinned = list.filter((e) => e.pinned);
  const rest = list.filter((e) => !e.pinned);
  const keep = Math.max(0, limit - pinned.length);
  const kept = new Set(rest.slice(0, keep).map((e) => e.id));
  // 保持原顺序，不要把置顶的挪到最前面——用户看到的顺序不该因为裁剪而重排
  return list.filter((e) => e.pinned || kept.has(e.id));
}
