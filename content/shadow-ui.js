/**
 * 注入宿主页面的**浮层 UI** 的 Shadow DOM 容器。
 *
 * 为什么需要它：此前浮层直接挂在 document.body 上，只靠 `sit-` 类名前缀隔离。
 * 那只挡住了一个方向——我们不污染宿主页，但宿主页会污染我们。面板内部全是
 * 0,1,0 特异性的类选择器，宿主页一条 `* { box-sizing: content-box }`、
 * `button { font: inherit }` 或者任何带 !important 的重置都能穿进来，
 * 在不同网站上把面板打得七零八落。Shadow DOM 是唯一双向隔离的机制。
 *
 * 适用范围只有**浮层**：划词面板、触发图标、进度条这类自成一体、
 * 覆盖在页面之上的东西。双语译文和字幕译文必须跟宿主内容一起排版，
 * 只能留在宿主 DOM 里继续用前缀类名——那不是疏忽，是它们的位置决定的。
 */

let host = null;
let root = null;
const injected = new Set();

/**
 * 影子树内的地基样式。
 *
 * host 上的 `all: initial` 已经切断了继承（宿主页的 font/color/line-height
 * 进不来），这里补的是不继承的那些——box-sizing 尤其重要，
 * 面板所有尺寸都是按 border-box 算的。
 */
const BASE_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  div, span, p, button, input, svg { margin: 0; padding: 0; }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
`;

/**
 * 取得浮层的影子根，按需创建。
 *
 * @param {string} [cssText] 要注入影子树的样式文本（用 `?inline` 导入 CSS 得到）。
 *   同一段样式重复传入只注入一次，多个内容脚本可以各自带自己的那份。
 */
export function getUiRoot(cssText) {
  if (!root) {
    host = document.createElement('div');
    // 宿主页可能对任意选择器定样式，host 自身用行内样式钉死，优先级最高的那一层
    host.style.cssText = [
      'all: initial',        // 切断宿主页的继承，必须放在最前
      'display: block',      // all:initial 会把 display 变成 inline
      'position: absolute',  // 浮层用的是页面坐标（含 scrollY），保持同一个坐标系
      'top: 0', 'left: 0', 'width: 0', 'height: 0',
      'z-index: 2147483647',
    ].join(';');
    root = host.attachShadow({ mode: 'open' });
    addCss(BASE_CSS);
    // 挂在 documentElement 而不是 body：body 可能带 transform 或 position，
    // 那会改变绝对定位的参照物，让浮层整体偏移
    document.documentElement.appendChild(host);
  }
  if (cssText) addCss(cssText);
  return root;
}

function addCss(cssText) {
  if (injected.has(cssText)) return;
  injected.add(cssText);
  const style = document.createElement('style');
  style.textContent = cssText;
  root.appendChild(style);
}

/**
 * 事件是不是从我们的浮层里发出来的。
 *
 * 不能再用 `e.target.closest('.sit-panel')`：事件穿出影子树时 target 会被
 * 重定向成 host 元素，closest 找不到面板，于是「点面板内部」会被判成
 * 「点了外面」，面板每点一下就关。composedPath() 保留了影子树内的真实路径。
 */
export function isInsideUi(event) {
  if (!host) return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.includes(host);
}

/** 节点是不是在浮层里（用于判断选区落点，那里拿不到事件对象） */
export function isNodeInsideUi(node) {
  if (!host || !node) return false;
  return host.contains(node) || node.getRootNode?.() === root;
}
