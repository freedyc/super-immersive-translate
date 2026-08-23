/**
 * 设置页内部共享的类型。
 *
 * Settings 用 DEFAULTS 反推：utils/defaults.js 是设置 schema 的唯一真源，
 * 在这里手抄一份字段清单会立刻产生第二个真源、迟早对不上。
 */
import { DEFAULTS } from '../../utils/defaults.js';
import type { Toast } from '../../types/models.ts';

/** 站点规则：黑名单只拦列出的站点，白名单只翻列出的站点 */
export interface SiteRules {
  mode: 'blacklist' | 'whitelist';
  sites: string[];
}

/**
 * 完整设置对象的形状，跟 DEFAULTS 保持同步。
 *
 * 两个字段需要定向修正：DEFAULTS 里它们的默认值是空字面量
 * （siteRules.sites 是 []、siteEngines 是 {}），TS 从 JS 源码推断出来是
 * never[] 和 {}，导致往里塞东西时报错。这里显式覆盖成真实形状。
 * 等 utils/defaults.js 本身迁到 TS 之后，这两行就可以删掉。
 */
export type Settings = Omit<typeof DEFAULTS, 'siteRules' | 'siteEngines'> & {
  siteRules: SiteRules;
  /** 域名 → 引擎 id */
  siteEngines: Record<string, string>;
};

/** 局部更新设置。debounce=true 用于文本输入，避免逐字符写 chrome.storage.sync */
export type SettingsPatchFn = (
  patch: Record<string, unknown>,
  options?: { debounce?: boolean },
) => void;

/** 某个引擎需要在设置页露出的一个配置字段 */
export interface EngineField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  placeholder?: string;
  hint?: string;
}

/** 各标签页统一收到的 props */
export interface TabProps {
  settings: Settings;
  update: SettingsPatchFn;
  reload: () => void;
  notify: (toast: Toast) => void;
}

// Toast 是跨页面共用的（单词本/历史/文档/快捷翻译都在用），定义在 types/models.ts
export type { Toast } from '../../types/models.ts';
