// tools/serve.mjs：零相依的本機伺服器，把網站掛在和 GitHub Pages 一樣的子路徑（規格 9.3）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = '/phrase-drill/';
const PORT = 8080;
const ROOT = fs.realpathSync.native(path.resolve(import.meta.dirname, '..'));   // 專案根目錄；native 版會把 Windows 的 8.3 短檔名展開成長檔名
const BACKSLASH = String.fromCharCode(92);              // Windows 的 path.join 也把反斜線當成分隔符
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function send(res, status, headers = {}, body = '') {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });   // 所有回應都帶 no-store
  res.end(body);
}

function handle(req, res) {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;            // 丟掉 ?sw=1、?v= 這類 query
  } catch {
    return send(res, 404);
  }
  if (pathname === '/') return send(res, 302, { Location: BASE });
  if (!pathname.startsWith(BASE)) return send(res, 404);
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(BASE.length));
  } catch {
    return send(res, 404);                                               // % 編碼不合法
  }
  const segs = rel.replaceAll(BACKSLASH, '/').split('/');
  if (rel.includes('..') || segs.some((seg) => seg.startsWith('.'))) return send(res, 403);
  try {
    let file = path.join(ROOT, rel);
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const real = path.relative(ROOT, fs.realpathSync.native(file));      // Windows 會把 GIT~1 這類 8.3 短檔名解析成 .git，展開成實際路徑後再檢查一次
    if (path.isAbsolute(real) || real.split(path.sep).some((seg) => seg.startsWith('.'))) return send(res, 403);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, { 'Content-Type': type }, fs.readFileSync(file));
  } catch {
    send(res, 404);                                                      // 不存在或讀不到
  }
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log('句練本機伺服器已啟動（Ctrl+C 停止）：');
  console.log(`  http://localhost:${PORT}${BASE}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}${BASE}`);
    }
  }
});
