// tests/helpers.test.js：只驗證 tests/helpers.js 本身的行為
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, FakeStorage, makeSentence, TODAY } from './helpers.js';

test('deepFreeze 遞迴凍結物件與陣列，並回傳同一個物件', () => {
  const x = { a: { b: 1 }, list: [{ c: 2 }, 3], s: 'str', n: null };
  assert.equal(deepFreeze(x), x);
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.a));
  assert.ok(Object.isFrozen(x.list));
  assert.ok(Object.isFrozen(x.list[0]));
  // ES module 是 strict mode，改動凍結的物件會直接 throw
  assert.throws(() => { x.a.b = 9; }, TypeError);
  assert.throws(() => { x.list[0].c = 9; }, TypeError);
  assert.throws(() => { x.list.push(4); }, TypeError);
  assert.throws(() => { delete x.s; }, TypeError);
  assert.deepEqual(x, { a: { b: 1 }, list: [{ c: 2 }, 3], s: 'str', n: null });
});

test('deepFreeze 對 null 與原始值原樣回傳，已經淺凍結的物件仍會往下凍結', () => {
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze(undefined), undefined);
  assert.equal(deepFreeze(0), 0);
  assert.equal(deepFreeze('x'), 'x');
  const inner = { v: 1 };
  const outer = Object.freeze({ inner });
  assert.equal(deepFreeze(outer), outer);
  assert.ok(Object.isFrozen(inner));
});

test('FakeStorage 的 getItem、setItem、removeItem、key 與 length', () => {
  const s = new FakeStorage();
  assert.equal(s.failWrites, false);
  assert.equal(s.length, 0);
  assert.equal(s.getItem('missing'), null);
  assert.equal(s.key(0), null);
  s.setItem('a', 1);
  s.setItem('b', 'x');
  assert.equal(s.getItem('a'), '1');           // 和 localStorage 一樣存成字串
  assert.equal(s.length, 2);
  assert.equal(s.key(0), 'a');
  assert.equal(s.key(1), 'b');
  assert.equal(s.key(2), null);
  s.setItem('a', 'y');                         // 覆寫同一個 key，length 不變
  assert.equal(s.getItem('a'), 'y');
  assert.equal(s.length, 2);
  s.removeItem('a');
  s.removeItem('missing');                     // 刪除不存在的 key 不會 throw
  assert.equal(s.getItem('a'), null);
  assert.equal(s.length, 1);
  assert.equal(s.key(0), 'b');
  const other = new FakeStorage();             // 每個實例的資料各自獨立
  assert.equal(other.getItem('b'), null);
  assert.equal(other.length, 0);
});

test('FakeStorage 的 failWrites 讓 setItem 丟出 QuotaExceededError，內容不變', () => {
  const s = new FakeStorage();
  s.setItem('k', 'old');
  s.failWrites = true;
  const isQuota = (e) => e instanceof Error && e.name === 'QuotaExceededError';
  assert.throws(() => s.setItem('k', 'new'), isQuota);
  assert.throws(() => s.setItem('other', 'v'), isQuota);
  assert.equal(s.getItem('k'), 'old');
  assert.equal(s.getItem('other'), null);
  assert.equal(s.length, 1);
  s.removeItem('k');                           // 讀取與刪除不受 failWrites 影響
  assert.equal(s.getItem('k'), null);
  s.failWrites = false;
  s.setItem('k', 'new');
  assert.equal(s.getItem('k'), 'new');
});

test('makeSentence 預設是一句未開始的句子，overrides 蓋在預設值上；TODAY 為 2026-10-14', () => {
  assert.equal(TODAY, '2026-10-14');
  assert.deepEqual(makeSentence(), {
    id: 'x1', text: 'This is a test sentence.', zh: '測試句', level: 0, streak: 0,
    due: null, lastSeen: null, lastResult: null, reps: 0,
  });
  assert.deepEqual(Object.keys(makeSentence()), ['id','text','zh','level','streak','due','lastSeen','lastResult','reps']);
  assert.deepEqual(makeSentence({ id: 'b', reps: 2, level: 1, due: TODAY }), {
    id: 'b', text: 'This is a test sentence.', zh: '測試句', level: 1, streak: 0,
    due: '2026-10-14', lastSeen: null, lastResult: null, reps: 2,
  });
  const a = deepFreeze(makeSentence());        // 每次回傳新物件，凍結一個不影響下一個
  const b = makeSentence();
  assert.notEqual(a, b);
  assert.equal(Object.isFrozen(b), false);
});
