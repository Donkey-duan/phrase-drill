// tests/seed.test.js：規格 7.8 的八條 seed 規則（不需要 store.js 的部分）
// 需要 validateSentenceInput 與 createInitialData 的交叉檢查在 tests/store.test.js（規格 10.5）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SEED } from '../js/seed.js';
import { canonicalize, nonTypeableChars, wordCount, normalizeFrame, parseFrame, tokens } from '../js/drill.js';

// 規格 7.8 第 7 條：7.8 清單 115 行（id|frame|zh|議題）以 LF 串接、結尾不加換行後的 SHA-256。
// 要改內建句時，先改規格 7.8 的清單，再重算這個值
const SPEC_SEED_SHA256 = '4e6bb5ed5d746839ee961e626e45c12e906a86050363dfd17da030938c2e3569';
// 規格 7.8 第 8 條：第 1 版 7.8 清單 55 句 text 的 SHA-256，永遠不改
const V1_TEXT_SHA256 = 'fb2116a6061eacf3c5850f3d4bba7ae9e8f3e27465197a9020980836dafe0039';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const textOf = (item) => normalizeFrame(item.frame).text;

test('第 1 條：SEED 是 115 項，id 依序為 s01 到 s115，key 依序正好是 id、frame、zh、topics', () => {
  assert.ok(Array.isArray(SEED));
  assert.equal(SEED.length, 115);
  SEED.forEach((item, i) => {
    assert.equal(item.id, 's' + String(i + 1).padStart(2, '0'));
    assert.deepEqual(Object.keys(item), ['id', 'frame', 'zh', 'topics'], item.id);
    assert.equal(typeof item.frame, 'string', item.id);
    assert.equal(typeof item.zh, 'string', item.id);
    assert.ok(Array.isArray(item.topics) && item.topics.every((t) => typeof t === 'string'), item.id);
  });
});

test('第 2 條：normalizeFrame 回傳 ok 而且 frame 不變，空格片段有 1 到 3 個', () => {
  for (const item of SEED) {
    const r = normalizeFrame(item.frame);
    assert.equal(r.ok, true, item.id + '：' + r.error);
    assert.equal(r.frame, item.frame, item.id);
    const slots = parseFrame(item.frame).parts.filter((p) => p.slot).length;
    assert.ok(slots >= 1 && slots <= 3, item.id + ' 有 ' + slots + ' 個空格');
  }
});

test('第 3 條：text 是 canonical、只含可列印 ASCII、6 到 25 個字、以句點結尾、不含 [ ] < > { } " 與 ...', () => {
  for (const item of SEED) {
    const text = textOf(item);
    assert.equal(canonicalize(text), text, item.id);
    assert.deepEqual(nonTypeableChars(text), [], item.id);
    const n = wordCount(text);
    assert.ok(n >= 6 && n <= 25, item.id + ' 有 ' + n + ' 個字');
    assert.ok(text.endsWith('.'), item.id + ' 不是以句點結尾');
    assert.doesNotMatch(text, /[[\]<>{}"]/, item.id);
    assert.ok(!text.includes('...'), item.id + ' 含有 ...');
  }
});

test('第 4 條：text 不分大小寫不重複，固定字序列（空格換成同一個佔位符）也不重複', () => {
  const texts = new Map();
  const skeletons = new Map();
  for (const item of SEED) {
    const key = textOf(item).toLowerCase();
    assert.ok(!texts.has(key), item.id + ' 的 text 與 ' + texts.get(key) + ' 重複');
    texts.set(key, item.id);
    const seq = [];
    for (const p of parseFrame(item.frame).parts) {
      if (p.slot) seq.push('{}');
      else seq.push(...tokens(p.text));               // tokens 為空的片段（只有標點）自然略過
    }
    const skel = seq.join(' ');
    assert.ok(!skeletons.has(skel), item.id + ' 的固定字序列與 ' + skeletons.get(skel) + ' 相同：' + skel);
    skeletons.set(skel, item.id);
  }
});

test('第 5 條：topics 恰好 3 項，已 trim、長度 2 到 12、同一句內不重複', () => {
  for (const item of SEED) {
    assert.equal(item.topics.length, 3, item.id);
    for (const t of item.topics) {
      assert.equal(t, t.trim(), item.id + ' 的議題「' + t + '」前後有空白');
      assert.ok(t.length >= 2 && t.length <= 12, item.id + ' 的議題「' + t + '」長度 ' + t.length);
    }
    assert.equal(new Set(item.topics).size, 3, item.id + ' 的議題重複');
  }
});

test('第 6 條：zh 不是空字串，而且等於 zh.trim()', () => {
  for (const item of SEED) {
    assert.notEqual(item.zh, '', item.id);
    assert.equal(item.zh, item.zh.trim(), item.id);
  }
});

test('第 7 條：內容與規格 7.8 的清單逐字相同（SPEC_SEED_SHA256）', () => {
  const joined = SEED.map((s) => s.id + '|' + s.frame + '|' + s.zh + '|' + s.topics.join(';')).join('\n');
  assert.equal(sha256(joined), SPEC_SEED_SHA256);
});

test('第 8 條：s01 到 s55 的 text 與第 1 版逐字相同（V1_TEXT_SHA256）', () => {
  const v1 = SEED.slice(0, 55).map(textOf).join('\n');
  assert.equal(sha256(v1), V1_TEXT_SHA256);
});
