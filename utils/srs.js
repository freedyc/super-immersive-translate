// FSRS（Free Spaced Repetition Scheduler）间隔重复算法的唯一入口：
// 其他文件只调用这里导出的函数，不直接 import 'ts-fsrs'，方便以后换算法
// 实现或调整参数时只改这一个文件。
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

const scheduler = fsrs();

const GRADE_TO_RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function createCard(now = new Date()) {
  return createEmptyCard(now);
}

export function scheduleNext(card, grade, now = new Date()) {
  const rating = GRADE_TO_RATING[grade];
  if (!rating) throw new Error(`未知的评分档位: ${grade}`);
  const result = scheduler.next(card, now, rating);
  return result.card;
}

export function isDue(card, now = new Date()) {
  if (!card) return true; // 还没初始化过的卡视为"待学习"，纳入复习队列
  return card.due <= now;
}

// chrome.storage 的写入、以及 GitHub 同步里的 JSON.stringify，都不能安全往返 Date 对象，
// 存储前统一转成 ISO 字符串，取出来后再用 deserializeCard 转回 Date 供 ts-fsrs 使用。
export function serializeCard(card) {
  if (!card) return card ?? null;
  return {
    ...card,
    due: card.due instanceof Date ? card.due.toISOString() : card.due,
    last_review: card.last_review instanceof Date ? card.last_review.toISOString() : card.last_review,
  };
}

export function deserializeCard(raw) {
  if (!raw) return raw ?? null;
  return {
    ...raw,
    due: raw.due ? new Date(raw.due) : raw.due,
    last_review: raw.last_review ? new Date(raw.last_review) : raw.last_review,
  };
}
