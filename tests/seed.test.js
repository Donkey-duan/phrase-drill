// tests/seed.test.js：規格 10.5 的 seed 檢查中不需要 store.js 的部分，加上與規格 7.8 的逐字比對
// 「每一句對其他句子都通過 validateSentenceInput」在 tests/store.test.js（第 7 任務）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SEED } from '../js/seed.js';
import { canonicalize, nonTypeableChars, wordCount } from '../js/drill.js';

// 規格 7.8 code block 的 55 行（id|text|zh）以 LF 串接、結尾不加換行後的 SHA-256；
// 要改內建句時，先改規格 7.8，再重算這個值
const SPEC_SEED_SHA256 = '7c294553cc2c8616e7437eb4f8eb0842fa1820c9ad9619c42b4ffcfaab4dfe76';

test('SEED 共 55 句，id 依序為 s01 到 s55，每項只有 id、text、zh 三個字串欄位', () => {
  assert.ok(Array.isArray(SEED));
  const expected = Array.from({ length: 55 }, (_, i) => 's' + String(i + 1).padStart(2, '0'));
  assert.deepEqual(SEED.map((s) => s.id), expected);
  for (const s of SEED) {
    assert.deepEqual(Object.keys(s), ['id', 'text', 'zh'], s.id);
    assert.equal(typeof s.text, 'string', s.id);
    assert.equal(typeof s.zh, 'string', s.id);
  }
});

test('seed 檢查：數量在 40 到 60 之間，id 唯一而且符合 s 加兩位數字', () => {
  assert.ok(SEED.length >= 40 && SEED.length <= 60, `共 ${SEED.length} 句`);
  const ids = SEED.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^s\d{2}$/);
});

test('seed 檢查：text 等於 canonicalize(text)，nonTypeableChars 為空', () => {
  for (const s of SEED) {
    assert.equal(canonicalize(s.text), s.text, s.id);
    assert.deepEqual(nonTypeableChars(s.text), [], s.id);
  }
});

test('seed 檢查：6 到 25 個字，以句點結尾，不含 [ ] < > { } " 與 ...', () => {
  for (const s of SEED) {
    const n = wordCount(s.text);
    assert.ok(n >= 6 && n <= 25, `${s.id} 有 ${n} 個字`);
    assert.ok(s.text.endsWith('.'), `${s.id} 不是以句點結尾`);
    assert.doesNotMatch(s.text, /[\[\]<>{}"]/, s.id);
    assert.ok(!s.text.includes('...'), `${s.id} 含有 ...`);
  }
});

test('seed 檢查：不分大小寫也不重複，zh 不為空', () => {
  const seen = new Map();
  for (const s of SEED) {
    const key = s.text.toLowerCase();
    assert.ok(!seen.has(key), `${s.id} 與 ${seen.get(key)} 重複`);
    seen.set(key, s.id);
    assert.notEqual(s.zh, '', s.id);
    assert.equal(s.zh, s.zh.trim(), `${s.id} 的 zh 前後有空白`);
  }
});

test('內容與規格 7.8 逐字相同', () => {
  const lines = SEED.map((s) => s.id + '|' + s.text + '|' + s.zh).join('\n');
  assert.equal(createHash('sha256').update(lines).digest('hex'), SPEC_SEED_SHA256);
});
