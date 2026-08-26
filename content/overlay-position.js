/**
 * 浮层定位。纯函数，不碰 DOM——定位算错的表现是「按钮跑到看不见的地方」
 * 或「整个网站多出一条滚动条」，这两种都只有真机才看得出来，
 * 所以逻辑必须抽出来能被断言覆盖。
 *
 * 两条硬约束，都是踩出来的：
 *
 * 1. **结果必须钳在视口内**。此前图标是 `rect.right + scrollX + 4` 直接用，
 *    在视口右缘划词时它就伸到文档宽度之外，浏览器据此扩大滚动区域——
 *    宿主页面平白多出一条横向滚动条。纵向同理。
 * 2. **下方放不下要翻到上方**。在页面底部划词时，浮层放在选区下面就落在
 *    视口之外，用户根本看不到那个按钮。
 */

/**
 * @param {object} o
 * @param {{top:number,bottom:number,left:number,right:number}} o.rect
 *   选区的**视口**坐标（getBoundingClientRect 的结果）
 * @param {number} o.width  浮层宽
 * @param {number} o.height 浮层高
 * @param {number} o.viewportW
 * @param {number} o.viewportH
 * @param {number} o.scrollX
 * @param {number} o.scrollY
 * @param {number} [o.gap]    浮层与选区的间距
 * @param {number} [o.margin] 与视口边缘至少留多少
 * @param {'right'|'left'} [o.anchor] 水平上贴选区的哪一侧
 * @returns {{top:number, left:number, flipped:boolean}} **页面**坐标
 */
export function placeOverlay({
  rect, width, height, viewportW, viewportH, scrollX, scrollY,
  gap = 4, margin = 8, anchor = 'right',
}) {
  // 先在视口坐标里算，钳好边界，最后才加上滚动量换成页面坐标。
  // 反过来先加滚动再钳的话，钳的就是文档边界，仍然可能落在视口之外
  let left = anchor === 'right' ? rect.right + gap : rect.left;
  const maxLeft = viewportW - width - margin;
  // maxLeft 可能小于 margin（浮层比视口还宽），此时贴左边总比贴右边可用
  left = Math.max(margin, Math.min(left, Math.max(margin, maxLeft)));

  let top = rect.bottom + gap;
  let flipped = false;
  if (top + height > viewportH - margin) {
    const above = rect.top - height - gap;
    // 上方也放不下就贴视口顶部：宁可盖住一点选区，也不能整个跑出视口
    if (above >= margin) {
      top = above;
      flipped = true;
    } else {
      top = Math.max(margin, Math.min(top, viewportH - height - margin));
    }
  }

  return { top: top + scrollY, left: left + scrollX, flipped };
}
