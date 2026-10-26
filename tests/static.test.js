// tests/static.test.js：規格 10.8，把對 index.html、manifest、樣式、圖示與 SW 的「不要做」寫成會失敗的檢查
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const isFile = (rel) => existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).isFile();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 取出 html 裡所有 <name ...> 標籤的屬性表；屬性名轉小寫，只處理雙引號屬性與無值屬性（index.html 只用這兩種）
// 名稱後面接的不是英數字或連字號，才算這個標籤（<meta 不會抓到 <metadata）
function tags(html, name) {
  const out = [];
  for (const m of html.matchAll(new RegExp('<' + name + '(?![a-z0-9-])([^>]*)>', 'gi'))) {
    const attrs = {};
    for (const a of m[1].matchAll(/([^\s="'/]+)(?:\s*=\s*"([^"]*)")?/g)) attrs[a[1].toLowerCase()] = a[2] ?? '';
    out.push(attrs);
  }
  return out;
}

// 和 tools/release.mjs 用同一條 regex 取出 FILES（規格 8.4、9.4）
function swFiles() {
  const m = /const FILES = (\[[\s\S]*?\]);/.exec(read('sw.js'));
  assert.ok(m, 'sw.js 裡找不到 const FILES = [...];');
  return JSON.parse(m[1]);
}

test('manifest：沒有 id 欄位，也沒有 theme_color 欄位', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal('id' in m, false, 'manifest 不得有 id');
  assert.equal('theme_color' in m, false, 'manifest 不得有 theme_color');
});

test('manifest：start_url 與 scope 是 ./，display 是 standalone，name 與 short_name 是「句練」', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.equal(m.name, '句練');
  assert.equal(m.short_name, '句練');
});

test('manifest：icons 指向的檔案都存在', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, 'manifest 沒有 icons');
  for (const icon of m.icons) assert.ok(isFile(icon.src), `${icon.src} 不存在`);
});

test('index.html：viewport 的 content 正好是 width=device-width, initial-scale=1', () => {
  const viewports = tags(read('index.html'), 'meta').filter((a) => a.name === 'viewport');
  assert.equal(viewports.length, 1, 'viewport meta 必須正好一條');
  assert.equal(viewports[0].content, 'width=device-width, initial-scale=1');
});

test('index.html：不含 viewport-fit、maximum-scale、user-scalable 與 apple-mobile-web-app-*、mobile-web-app-capable', () => {
  const html = read('index.html').toLowerCase();
  for (const s of ['viewport-fit', 'maximum-scale', 'user-scalable', 'apple-mobile-web-app-capable',
    'mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title']) {
    assert.equal(html.includes(s), false, `index.html 不得出現 ${s}`);
  }
});

test('index.html：不含 <form（不分大小寫）', () => {
  assert.doesNotMatch(read('index.html'), /<form/i);
});

test('index.html：apple-touch-icon 指向 ./icons/icon-180.png，<title>句練</title>，兩條 theme-color 分別是 #ffffff 與 #000000', () => {
  const html = read('index.html');
  assert.ok(tags(html, 'link').some((a) => a.rel === 'apple-touch-icon' && a.href === './icons/icon-180.png'),
    '缺少指向 ./icons/icon-180.png 的 apple-touch-icon');
  assert.ok(html.includes('<title>句練</title>'), '缺少 <title>句練</title>');
  const themes = tags(html, 'meta').filter((a) => a.name === 'theme-color');
  assert.deepEqual(themes.map((a) => [a.media, a.content]), [
    ['(prefers-color-scheme: light)', '#ffffff'],
    ['(prefers-color-scheme: dark)', '#000000'],
  ]);
});

test('index.html：沒有 src="/ 或 href="/', () => {
  const html = read('index.html');
  assert.equal(html.includes('src="/'), false, 'index.html 不得有 src="/');
  assert.equal(html.includes('href="/'), false, 'index.html 不得有 href="/');
});

test('index.html：boot.js 的 script 出現在 app.js 之前', () => {
  const html = read('index.html');
  const boot = html.indexOf('src="./js/boot.js"');
  const app = html.indexOf('src="./js/app.js"');
  assert.ok(boot >= 0, '找不到 ./js/boot.js 的 script');
  assert.ok(app >= 0, '找不到 ./js/app.js 的 script');
  assert.ok(boot < app, 'boot.js 必須在 app.js 之前');
});

test('index.html：#p-input 帶有 5.1 的 8 個屬性而且值相同，此外只有 id 與 aria-label', () => {
  const found = tags(read('index.html'), 'textarea').filter((a) => a.id === 'p-input');
  assert.equal(found.length, 1, '#p-input 必須正好一個');
  const attrs = found[0];
  const want = {
    autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off',
    writingsuggestions: 'false', enterkeyhint: 'next', rows: '3', lang: 'en',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(attrs[k], v, `#p-input 的 ${k}`);
  for (const k of Object.keys(attrs)) {
    assert.ok(Object.hasOwn(want, k) || k === 'id' || k === 'aria-label', `#p-input 不得有 ${k} 屬性`);
  }
});

test('js/app.js：全文（含註解）不得出現 innerHTML', () => {
  assert.equal(read('js/app.js').includes('innerHTML'), false);
});

// app.js 裡頂層 function 的本文：從 `function 名稱(` 切到下一個頂層 function（含 async function）或檔尾，去掉行註解
function appFunctionBody(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, `js/app.js 找不到 function ${name}(`);
  const rest = src.slice(start + 1);
  const ends = ['\nfunction ', '\nasync function '].map((m) => rest.indexOf(m)).filter((i) => i >= 0);
  const body = ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
  return body.replace(/\/\/.*$/gm, '');
}

// 規格 4.2、4.3：開始練習與「再練 N 句」的 click handler 和 enterPractice 必須全部同步，iOS 才會讓 focus() 叫出鍵盤
test('js/app.js：startPractice、extendAndResume、practiceMore、openCard、enterPractice 的本文沒有 await、setTimeout、.then(', () => {
  const src = read('js/app.js');
  for (const name of ['startPractice', 'extendAndResume', 'practiceMore', 'openCard', 'enterPractice']) {
    const body = appFunctionBody(src, name);
    for (const bad of ['await', 'setTimeout', '.then(']) {
      assert.equal(body.includes(bad), false, `${name} 的本文出現 ${bad}`);
    }
  }
});

for (const file of ['js/boot.js', 'sw.js']) {
  test(`${file}：照 classic script 的規則編譯，不丟出例外`, () => {
    const source = read(file);
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  });
}

test('styles.css：沒有 position: fixed、100vh、100dvh、-webkit-fill-available', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /position\s*:\s*fixed/i);
  for (const s of ['100vh', '100dvh', '-webkit-fill-available']) {
    assert.equal(css.includes(s), false, `styles.css 不得出現 ${s}`);
  }
});

test('styles.css：有 [hidden] 的強制隱藏規則', () => {
  assert.match(read('styles.css'), /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/);
});

test('icons：每張 PNG 的 IHDR 寬高符合檔名，色彩型態為 2', () => {
  const pngs = readdirSync(join(ROOT, 'icons')).filter((f) => f.endsWith('.png'));
  for (const name of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
    assert.ok(pngs.includes(name), `缺少 icons/${name}`);
  }
  for (const name of pngs) {
    const size = Number(/^icon-(\d+)\.png$/.exec(name)?.[1]);
    assert.ok(size > 0, `icons/${name} 的檔名要是 icon-<邊長>.png`);
    const b = readFileSync(join(ROOT, 'icons', name));
    assert.ok(b.subarray(0, 8).equals(PNG_SIGNATURE), `icons/${name} 不是 PNG`);
    assert.equal(b.toString('latin1', 12, 16), 'IHDR', `icons/${name} 的第一個 chunk 不是 IHDR`);
    assert.equal(b.readUInt32BE(16), size, `icons/${name} 的寬`);
    assert.equal(b.readUInt32BE(20), size, `icons/${name} 的高`);
    assert.equal(b[25], 2, `icons/${name} 的色彩型態`);
  }
});

test('sw.js：FILES 能 JSON.parse，每一項都以 ./ 開頭而且檔案存在', () => {
  const files = swFiles();
  assert.ok(Array.isArray(files) && files.length > 0, 'FILES 必須是非空陣列');
  assert.equal(new Set(files).size, files.length, 'FILES 不得重複');
  for (const f of files) {
    assert.ok(typeof f === 'string' && f.startsWith('./'), `FILES 的 ${f} 必須以 ./ 開頭`);
    assert.ok(isFile(f), `FILES 的 ${f} 不存在`);
  }
});

test('sw.js：js/ 與 icons/ 底下的每個檔案，加上 index.html、styles.css、manifest.webmanifest，都列在 FILES 裡', () => {
  const files = swFiles();
  const required = ['./index.html', './styles.css', './manifest.webmanifest',
    ...readdirSync(join(ROOT, 'js')).map((f) => './js/' + f),
    ...readdirSync(join(ROOT, 'icons')).map((f) => './icons/' + f)];
  for (const f of required) assert.ok(files.includes(f), `FILES 缺少 ${f}`);
});
