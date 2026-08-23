/**
 * 打包成 Chrome 应用商店可上传的 zip。
 *
 * 商店要的是「zip 里直接就是 manifest.json」，不能套一层目录——
 * 套了会以「找不到 manifest」被拒，而错误信息不会告诉你是这个原因。
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const OUT_DIR = 'release';

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json 不存在，先跑 npm run build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const zipName = `super-immersive-translate-v${manifest.version}.zip`;
const zipPath = join(OUT_DIR, zipName);

mkdirSync(OUT_DIR, { recursive: true });
rmSync(zipPath, { force: true });

// 源文件会被一起搬进 dist：manifest 的 web_accessible_resources 里写着
// options/* 这类通配，crxjs 就把整个目录复制过去了，其中的 .tsx 没有任何
// HTML 引用（html 指向的是 assets/*.js）。发布包里不该有它们。
const EXCLUDE = ['.*', '__MACOSX/*', '*.tsx', '*.ts', '*.map'];

// -r 递归，-q 安静，-X 不要 macOS 的扩展属性（__MACOSX 目录会让审核多问一句）
// 在 dist 里执行，保证 zip 根目录就是 manifest.json
const exclude = EXCLUDE.map((p) => `-x '${p}'`).join(' ');
execSync(`cd ${DIST} && zip -r -q -X ../${zipPath} . ${exclude}`, { stdio: 'inherit' });

// 打包完立刻回查：漏进源码或 sourcemap 是不该靠肉眼发现的
const listed = execSync(`unzip -Z1 ${zipPath}`).toString().split('\n');
const leaked = listed.filter((f) => /\.(tsx?|map)$/.test(f));
if (leaked.length) {
  console.error(`发布包里混进了源文件：\n  ${leaked.join('\n  ')}`);
  process.exit(1);
}
if (!listed.includes('manifest.json')) {
  console.error('manifest.json 不在 zip 根目录——商店会以「找不到 manifest」拒绝');
  process.exit(1);
}

const size = execSync(`du -h ${zipPath} | cut -f1`).toString().trim();
console.log(`\n✓ ${zipPath}  (${size})`);
console.log(`  版本 ${manifest.version} · ${manifest.name}`);
