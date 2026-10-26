// tools/release.mjs：依 sw.js 的 FILES 內容計算版本，改寫 sw.js 的 VERSION（規格 9.4）
// node tools/release.mjs          版本不同時改寫 VERSION，印出舊版本與新版本
// node tools/release.mjs --check  版本不同時印出提示，以結束碼 1 離開，不改任何檔案
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SW = join(ROOT, 'sw.js');
const VERSION_RE = /const VERSION = '([^']*)';/;

const sw = readFileSync(SW, 'utf8');
const filesMatch = /const FILES = (\[[\s\S]*?\]);/.exec(sw);   // 1. 取出 FILES
const versionMatch = VERSION_RE.exec(sw);
if (!filesMatch || !versionMatch) {
  console.error('sw.js 裡找不到 const FILES 或 const VERSION');
  process.exit(1);
}
const files = JSON.parse(filesMatch[1]);

// 2. 依路徑排序，依序餵進「路徑、\0、內容、\0」；.png 以外的文字檔先把 CRLF 換成 LF
const hash = createHash('sha256');
for (const file of [...files].sort()) {
  let content = readFileSync(join(ROOT, file));
  if (!file.endsWith('.png')) content = Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  hash.update(file);
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
}
const version = hash.digest('hex').slice(0, 8);
const old = versionMatch[1];

// 3. 依模式處理
if (process.argv.includes('--check')) {
  if (version !== old) {
    console.error('sw.js 的 VERSION 過期，請先執行 npm run release');
    process.exit(1);
  }
} else if (version !== old) {
  writeFileSync(SW, sw.replace(VERSION_RE, "const VERSION = '" + version + "';"));
  console.log('sw.js 的 VERSION：' + old + ' -> ' + version);
}
