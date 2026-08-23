/**
 * 单词本视图共用的展示辅助。
 *
 * 掌握度/状态的计算已经搬到 utils/learning/srsService.ts（deriveStatus / masteryPercent），
 * 这里只留跟「怎么显示」有关的东西——判断逻辑和展示样式分开，
 * 换算法时不用动这个文件。
 */

/**
 * 词类 → daisyUI badge 语义色。十个词类复用八种语义色（部分虚词共用同一色）。
 * 索引签名放宽成 string：AI 返回的词性不保证落在这十类里，取不到就退回中性色。
 */
export const POS_BADGE_CLASS: Record<string, string> = {
  '名词': 'badge-primary', '代词': 'badge-neutral', '动词': 'badge-secondary',
  '形容词': 'badge-accent', '副词': 'badge-info', '介词': 'badge-neutral',
  '连词': 'badge-neutral', '感叹词': 'badge-warning', '冠词': 'badge-neutral',
  '限定词': 'badge-neutral',
};

/** 语法角色的展示顺序：按句子成分的自然次序排，不按 AI 返回的随机顺序 */
export const ROLE_ORDER = ['主语', '谓语', '宾语', '定语', '状语', '补语', '其他'];

/** Fisher–Yates 洗牌，返回新数组不改原数组 */
export function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
