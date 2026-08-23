/**
 * 生成/校准商店素材。
 *
 * 商店的要求是**严格**的，三条都会导致上传被拒：
 *   1. 尺寸必须正好 1280×800 或 640×400
 *   2. 必须是 JPEG 或 **24 位 PNG（不带 alpha 通道）**
 *   3. 最多 5 张
 *
 * 第 2 条最容易踩：macOS 截图默认带 alpha，肉眼完全看不出区别，
 * 传上去才被退回。这里统一压平成 color-type 2。
 *
 * 用法：
 *   node scripts/make-store-assets.mjs raw/*.png
 *   node scripts/make-store-assets.mjs 'shot.png:3400x1150+0+0'   # 带裁剪
 *
 * 每张图按比例缩放到能放进 1280×800，再居中垫背景色补足——
 * 不拉伸，界面不会变形。整页截图内容偏居一角时，用 :WxH+X+Y 先裁到内容区，
 * 否则缩完小到看不清。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const OUT = 'store-assets';
const W = 1280;
const H = 800;
/** 垫底色用品牌紫的深色调，比纯白/纯黑更像刻意设计过 */
const PAD = '#2a1a4a';

const MAX_SHOTS = 5;

const inputs = process.argv.slice(2);
if (inputs.length > MAX_SHOTS) {
  console.error(`商店最多 5 张截图，收到 ${inputs.length} 张`);
  process.exit(1);
}
if (inputs.length === 0) {
  console.error('用法: node scripts/make-store-assets.mjs <截图...>');
  console.error('例如: node scripts/make-store-assets.mjs ~/Desktop/shot*.png');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

inputs.forEach((arg, i) => {
  // 'path.png:3400x1150+0+0' —— 冒号后是可选的裁剪几何
  const m = arg.match(/^(.*?):(\d+x\d+[+-]\d+[+-]\d+)$/);
  const src = m ? m[1] : arg;
  const crop = m ? m[2] : null;

  if (!existsSync(src)) {
    console.error(`跳过（不存在）: ${src}`);
    return;
  }
  const n = String(i + 1).padStart(2, '0');
  const out = join(OUT, `screenshot-${n}-1280x800.png`);

  execSync(
    `magick "${src}" `
    + (crop ? `-crop ${crop} +repage ` : '')
    // -resize WxH> 只缩不放：小图放大到 1280 宽会糊，宁可留白
    + `-resize ${W}x${H}\\> -background '${PAD}' -gravity center -extent ${W}x${H} `
    // 商店只收 24 位无 alpha 的 PNG。-alpha remove 先把透明处按背景色压平，
    // -alpha off 去掉通道，color-type=2 明确写成真彩色
    + `-alpha remove -alpha off -define png:color-type=2 -strip "${out}"`,
  );

  const info = execSync(
    `magick identify -format "%wx%h 通道=%[channels]" "${out}"`,
  ).toString();
  console.log(`✓ ${out}  ${info}  ← ${basename(src)}${crop ? ` (裁 ${crop})` : ''}`);
});

console.log(`\n共 ${inputs.length} 张，输出在 ${OUT}/`);
