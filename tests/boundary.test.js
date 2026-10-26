import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

// 規格 10.7：檔案一律先去掉註解再比對
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// 第一部分：core 不碰 DOM、時間與亂數（CLAUDE.md 不變式第 3 條）
const CORE_FILES = ['js/drill.js', 'js/schedule.js', 'js/store.js', 'js/seed.js'];
const CORE_FORBIDDEN = [
  [/\bdocument\b/, 'document'],
  [/\bwindow\b/, 'window'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bnavigator\b/, 'navigator'],
  [/Date\.now/, 'Date.now'],
  [/new Date\(\s*\)/, '沒有參數的 new Date()'],
  [/Math\.random/, 'Math.random'],
  [/performance\.now/, 'performance.now'],
  [/\bimport\s*\(/, 'dynamic import('],
];
const STORE_IMPORTS = ['./drill.js', './schedule.js'];

// 第二部分：iOS 17.0 Safari 的語法與 API 上限（CLAUDE.md 不變式第 4 條），兩個陣列逐字照 10.7
// 日後發現其他 iOS 17.0 沒有的語法或 API，就加進這兩個陣列，並同步更新 CLAUDE.md 第 4 條
const JS_BLACKLIST = [
  [/\bObject\.groupBy\b/, 'Object.groupBy'],
  [/\bMap\.groupBy\b/, 'Map.groupBy'],
  [/\bPromise\.withResolvers\b/, 'Promise.withResolvers'],
  [/\bPromise\.try\b/, 'Promise.try'],
  [/\bRegExp\.escape\b/, 'RegExp.escape'],
  [/\.(?:values|keys|entries)\(\)\s*\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(/, 'iterator helpers'],
  [/\.matchAll\([^)]*\)\s*\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(/, 'iterator helpers'],
  [/\.toArray\(/, 'iterator helpers'],
  [/\bIterator\./, 'iterator helpers'],
  [/(?:^|[;{(])\s*(?:await\s+)?using\s+[A-Za-z_$][\w$]*\s*(?:=|of\b)/m, 'using 宣告'],
  [/\bimport\b[^;\n]*\b(?:with|assert)\s*\{/, 'import attributes'],
  [/\b(?:import|export)\b[^;]*?\bfrom\s*['"][^'"]*['"]\s*(?:with|assert)\s*\{/, 'import attributes'],
  [/\bimport\s*\([^)]*\{\s*(?:with|assert)\s*:/, 'import attributes'],
];
const CSS_BLACKLIST = [
  [/light-dark\(/, 'light-dark()'],
  [/&/, 'CSS nesting'],
  [/@scope\b/, '@scope'],
  [/@starting-style\b/, '@starting-style'],
  [/\btransition-behavior\s*:/, 'transition-behavior'],
  [/\btext-wrap\s*:/, 'text-wrap'],
];

// code 必須已經去掉註解；回傳「檔名：寫法」的陣列，沒有命中時是空陣列；同一種寫法被幾條規則命中都只列一次
const findHits = (file, code, list) => [...new Set(list.filter(([re]) => re.test(code)).map(([, label]) => file + '：' + label))];

// import 陳述式與 export ... from 的模組來源，依出現順序
const MODULE_SOURCE = /(?:^|;)[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]*)['"]|(?:^|;)[ \t]*import\s*['"]([^'"]*)['"]/gm;
const moduleSources = (code) => [...code.matchAll(MODULE_SOURCE)].map((m) => m[1] ?? m[2]);

// 檢查工具本身：每一條規則都抓得到，正常寫法不會誤判

test('stripJs 去掉註解但保留 https://；stripCss 去掉註解', () => {
  const js = "const a = 1; // window\n/* localStorage\n document */ const u = 'https://x.y/z';\n";
  const code = stripJs(js);
  assert.ok(code.includes("'https://x.y/z'"));
  assert.deepStrictEqual(findHits('x.js', code, CORE_FORBIDDEN), []);
  assert.deepStrictEqual(findHits('x.css', stripCss('a { color: red; } /* & light-dark( */'), CSS_BLACKLIST), []);
});

test('core 檢查抓得到每一種禁用寫法', () => {
  const samples = [
    ['document.title = 1;', 'document'],
    ['window.x = 1;', 'window'],
    ['localStorage.getItem(k);', 'localStorage'],
    ['const ua = navigator.userAgent;', 'navigator'],
    ['const t = Date.now();', 'Date.now'],
    ['const d = new Date();', '沒有參數的 new Date()'],
    ['const d = new Date( );', '沒有參數的 new Date()'],
    ['const r = Math.random();', 'Math.random'],
    ['const p = performance.now();', 'performance.now'],
    ["const m = await import('./x.js');", 'dynamic import('],
  ];
  assert.deepStrictEqual(
    samples.map(([code]) => findHits('x.js', code, CORE_FORBIDDEN)),
    samples.map(([, label]) => ['x.js：' + label]),
  );
});

test('core 檢查不擋有參數的 new Date、Date.UTC 與含有這些字的識別字', () => {
  const code = [
    'const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - rolloverHour);',
    'const ms = Date.UTC(2026, 9, 14);',
    'const windowSize = 3; const documents = [];',
  ].join('\n');
  assert.deepStrictEqual(findHits('x.js', code, CORE_FORBIDDEN), []);
});

test('moduleSources 取出 import 與 export ... from 的來源', () => {
  const code = [
    "import { canonicalize } from './drill.js';",
    'import {',
    '  addDays,',
    '  pickToday,',
    "} from './schedule.js';",
    'import * as d from "./drill.js";',
    "import './side.js';",
    "export { SEED } from './seed.js';",
    "export const x = 'from';",
    'const y = Array.from(z);',
    "import { canonicalize } from './drill.js'; import { SEED } from './seed.js';",
    "const a = 1;import { SEED } from './seed.js';",
    'import { SEED }',
    'from',
    "  './seed.js';",
  ].join('\n');
  assert.deepStrictEqual(moduleSources(code), [
    './drill.js', './schedule.js', './drill.js', './side.js', './seed.js', './drill.js', './seed.js', './seed.js', './seed.js',
  ]);
});

test('JS 黑名單抓得到每一種寫法', () => {
  const samples = [
    ['const g = Object.groupBy(xs, f);', 'Object.groupBy'],
    ['const g = Map.groupBy(xs, f);', 'Map.groupBy'],
    ['const { promise } = Promise.withResolvers();', 'Promise.withResolvers'],
    ['Promise.try(f);', 'Promise.try'],
    ['const re = new RegExp(RegExp.escape(s));', 'RegExp.escape'],
    ['const a = m.values().map(f);', 'iterator helpers'],
    ['const a = s.matchAll(re).map((m) => m[1]);', 'iterator helpers'],
    ['const a = it.toArray();', 'iterator helpers'],
    ['const a = Iterator.from(xs);', 'iterator helpers'],
    ['using res = getResource();', 'using 宣告'],
    ['  await using conn = open();', 'using 宣告'],
    ['function f() { using r = open(); }', 'using 宣告'],
    ['for (using x of xs) {}', 'using 宣告'],
    ["import data from './a.json' with { type: 'json' };", 'import attributes'],
    ["import data from './a.json' assert { type: 'json' };", 'import attributes'],
    ["import data from\n  './a.json'\n  with { type: 'json' };", 'import attributes'],
    ["export { default } from './a.json' with { type: 'json' };", 'import attributes'],
    ["const m = await import('./a.json', { with: { type: 'json' } });", 'import attributes'],
  ];
  assert.deepStrictEqual(
    samples.map(([code]) => findHits('x.js', code, JS_BLACKLIST)),
    samples.map(([, label]) => ['x.js：' + label]),
  );
});

test('一般陣列寫法與一般 import 不會命中 JS 黑名單', () => {
  const code = [
    'const a = Object.entries(x).map(f);',
    'const b = [...m.values()].map(f);',
    "import { canonicalize } from './drill.js';",
    'const using = 1;',
  ].join('\n');
  assert.deepStrictEqual(findHits('x.js', code, JS_BLACKLIST), []);
});

test('CSS 黑名單抓得到 light-dark()、nesting、@scope 等每一種寫法，註解裡的 & 不算', () => {
  assert.deepStrictEqual(findHits('x.css', 'a { color: light-dark(#000, #fff); }', CSS_BLACKLIST), ['x.css：light-dark()']);
  assert.deepStrictEqual(findHits('x.css', '.a { & .b { color: red; } }', CSS_BLACKLIST), ['x.css：CSS nesting']);
  assert.deepStrictEqual(findHits('x.css', '@scope (.a) { }', CSS_BLACKLIST), ['x.css：@scope']);
  assert.deepStrictEqual(findHits('x.css', '@starting-style { .a { opacity: 0; } }', CSS_BLACKLIST), ['x.css：@starting-style']);
  assert.deepStrictEqual(findHits('x.css', '.a { transition-behavior: allow-discrete; }', CSS_BLACKLIST), ['x.css：transition-behavior']);
  assert.deepStrictEqual(findHits('x.css', 'h1 { text-wrap: balance; }', CSS_BLACKLIST), ['x.css：text-wrap']);
  assert.deepStrictEqual(findHits('x.css', stripCss(':root { color-scheme: light dark; } /* a & b */'), CSS_BLACKLIST), []);
});

// 第一部分：core 原始碼

for (const file of CORE_FILES) {
  test(`${file} 不碰 DOM、時間與亂數，也沒有 dynamic import`, () => {
    assert.deepStrictEqual(findHits(file, stripJs(read(file)), CORE_FORBIDDEN), []);
  });
}

for (const file of ['js/drill.js', 'js/schedule.js', 'js/seed.js']) {
  test(`${file} 不 import 任何模組`, () => {
    assert.deepStrictEqual(moduleSources(stripJs(read(file))), []);
  });
}

test('js/store.js 只 import ./drill.js 與 ./schedule.js', () => {
  const sources = moduleSources(stripJs(read('js/store.js')));
  assert.ok(sources.length > 0, '沒有從 js/store.js 取出任何 import，請檢查 moduleSources');
  assert.deepStrictEqual(sources.filter((s) => !STORE_IMPORTS.includes(s)), []);
});

// 第二部分：js/ 底下所有 .js 檔加上 sw.js 與 styles.css；sw.js 與 styles.css 不存在時略過

const JS_FILES = readdirSync(new URL('js/', ROOT)).filter((f) => f.endsWith('.js')).sort().map((f) => 'js/' + f);

for (const file of [...JS_FILES, 'sw.js']) {
  test(`${file} 沒有 iOS 17.0 Safari 不支援的寫法`, (t) => {
    if (!existsSync(new URL(file, ROOT))) { t.skip(`${file} 還不存在`); return; }
    assert.deepStrictEqual(findHits(file, stripJs(read(file)), JS_BLACKLIST), []);
  });
}

test('styles.css 沒有 iOS 17.0 Safari 不支援的寫法', (t) => {
  if (!existsSync(new URL('styles.css', ROOT))) { t.skip('styles.css 還不存在'); return; }
  assert.deepStrictEqual(findHits('styles.css', stripCss(read('styles.css')), CSS_BLACKLIST), []);
});
