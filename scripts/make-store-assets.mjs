/**
 * 生成/校准商店素材。
 *
 * 商店对尺寸是**严格**的：截图必须正好 1280×800 或 640×400，宣传图块必须
 * 正好 440×280，差一个像素就传不上去。手动裁图凑这些数字很折磨，
 * 所以这里做一件事：把你随手截的图垫成规定尺寸。
 *
 * 用法：
 *   node scripts/make-store-assets.mjs raw/*.png
 *
 * 每张图会按比例缩放到能放进 1280×800，再居中垫上背景色补足尺寸——
 * 不裁剪、不拉伸，界面内容不会变形。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const OUT = 'store-assets';
const W = 1280;
const H = 800;
/** 垫底色用品牌紫的深色调，比纯白/纯黑更像刻意设计过 */
const PAD = '#2a1a4a';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('用法: node scripts/make-store-assets.mjs <截图...>');
  console.error('例如: node scripts/make-store-assets.mjs ~/Desktop/shot*.png');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

inputs.forEach((src, i) => {
  if (!existsSync(src)) {
    console.error(`跳过（不存在）: ${src}`);
    return;
  }
  const n = String(i + 1).padStart(2, '0');
  const out = join(OUT, `screenshot-${n}-1280x800.png`);
  // -resize WxH> 只缩不放：小图放大到 1280 宽会糊，宁可留白
  execSync(
    `magick "${src}" -resize ${W}x${H}\\> -background '${PAD}' `
    + `-gravity center -extent ${W}x${H} -strip "${out}"`,
  );
  const info = execSync(`magick identify -format "%wx%h" "${out}"`).toString();
  console.log(`✓ ${out}  ${info}  ← ${basename(src)}`);
});

console.log(`\n共 ${inputs.length} 张，输出在 ${OUT}/`);
