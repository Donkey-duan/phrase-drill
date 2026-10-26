import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, makeSentence, TODAY, FakeStorage } from './helpers.js';
import { SEED } from '../js/seed.js';
import {
  SCHEMA, DATA_KEY, UNDO_KEY, CORRUPT_KEY, DAILY_OPTIONS, DEFAULT_DAILY, BACKUP_REMIND_DAYS,
  MAX_TEXT_LENGTH, MAX_ZH_LENGTH, createInitialData, validateSentenceInput,
  addSentence, updateSentence, setDailyCount, markExported, addDoneDay,
  startOrResumeSession, currentSentence, completeCard, deleteSentence,
  todayStatus, backupReminder,
  sanitizeData, toBackupJSON, fromBackupJSON, load, save,
  writeUndo, readUndo, clearUndo, readCorrupt, clearCorrupt,
} from '../js/store.js';

// 測試用的 AppData：預設是空句子庫、沒有 session，overrides 覆蓋頂層欄位
function appDataWith(overrides = {}) {
  return {
    schema: 2,
    settings: { dailyCount: 10, lastExport: null },
    sentences: [],
    doneDays: [],
    removedSeeds: [],
    session: null,
    ...overrides,
  };
}

test('validateSentenceInput：空字串與只有空白', () => {
  const d = deepFreeze(appDataWith());
  const empty = { ok: false, field: 'text', error: '請輸入英文句子' };
  assert.deepEqual(validateSentenceInput(d, '', '', '', null), empty);
  assert.deepEqual(validateSentenceInput(d, '   ', '', '', null), empty);
  assert.deepEqual(validateSentenceInput(d, ' \n\t\u3000\u00A0 ', '', '', null), empty);
});

test('validateSentenceInput：英文鍵盤打不出的字元依出現順序各自包在「」裡', () => {
  const d = deepFreeze(appDataWith());
  // μ 是 U+03BC（希臘字母 mu），± 是 U+00B1
  assert.deepEqual(validateSentenceInput(d, 'The error is 5 μm ± 2.', '', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「μ」「±」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'Ring \u0007 bell.', '', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「U+0007」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'Ring \u0007 at 5 μm.', '', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「U+0007」「μ」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'From 5 μm to 6 μm.', '', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「μ」，請改寫' });
});

test('validateSentenceInput：看不見或無法單獨顯示的字元寫成大寫補滿 4 碼的 U+XXXX', () => {
  const d = deepFreeze(appDataWith());
  const error = (text) => validateSentenceInput(d, text, '', '', null).error;
  assert.equal(error('Null \u0000 char.'), '有英文鍵盤打不出的字元：「U+0000」，請改寫');
  assert.equal(error('Unit \u001F sep.'), '有英文鍵盤打不出的字元：「U+001F」，請改寫');
  assert.equal(error('Del \u007F char.'), '有英文鍵盤打不出的字元：「U+007F」，請改寫');
  assert.equal(error('Apc \u009F char.'), '有英文鍵盤打不出的字元：「U+009F」，請改寫');
  assert.equal(error('Sel \uFE0F here.'), '有英文鍵盤打不出的字元：「U+FE0F」，請改寫');
  assert.equal(error('x\u0301 mark.'), '有英文鍵盤打不出的字元：「U+0301」，請改寫');
  assert.equal(error('Priv \uE000 use.'), '有英文鍵盤打不出的字元：「U+E000」，請改寫');
  assert.equal(error('Inverted \u00A1 mark.'), '有英文鍵盤打不出的字元：「¡」，請改寫');
});

test('validateSentenceInput：沒有英文字母、少於兩個字', () => {
  const d = deepFreeze(appDataWith());
  assert.deepEqual(validateSentenceInput(d, '123 456', '', '', null),
    { ok: false, field: 'text', error: '英文句子至少要有一個英文字母' });
  assert.deepEqual(validateSentenceInput(d, 'Hello.', '', '', null),
    { ok: false, field: 'text', error: '請輸入至少兩個字的句子' });
});

test('validateSentenceInput：超過 300 字元', () => {
  const d = deepFreeze(appDataWith());
  const tooLong = 'word '.repeat(60) + 'x';             // canonical 之後 301 字元、61 個字
  assert.equal(tooLong.length, 301);
  assert.deepEqual(validateSentenceInput(d, tooLong, '', '', null),
    { ok: false, field: 'text', error: '英文句子請在 300 字元以內' });
  const exact = 'word '.repeat(59) + 'abcde';           // 剛好 300 字元
  assert.equal(exact.length, 300);
  assert.equal(validateSentenceInput(d, exact, '', '', null).ok, true);
});

test('validateSentenceInput：與其他句子不分大小寫相同時判為重複，編輯句子本身時不算', () => {
  const d = deepFreeze(appDataWith({
    sentences: [
      makeSentence({ id: 'a1', text: "It's fine here." }),
      makeSentence({ id: 'b2', text: 'Another one here.' }),
    ],
  }));
  const dup = { ok: false, field: 'text', error: '句子庫裡已經有相同的句子' };
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', '', null), dup);
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', '', 'b2'), dup);
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', '', 'a1'),
    { ok: true, text: "it's FINE here.", frame: '', zh: '', topics: [] });
});

test('validateSentenceInput：zh 在 trim 後超過 200 字', () => {
  const d = deepFreeze(appDataWith());
  assert.deepEqual(validateSentenceInput(d, 'Two words.', '中'.repeat(201), '', null),
    { ok: false, field: 'zh', error: '中文意思請在 200 字以內' });
  assert.deepEqual(validateSentenceInput(d, 'Two words.', '  ' + '中'.repeat(200) + '  ', '', null),
    { ok: true, text: 'Two words.', frame: '', zh: '中'.repeat(200), topics: [] });
});

test('validateSentenceInput：通過時回傳 canonical 英文與 trim 後的中文', () => {
  const d = deepFreeze(appDataWith());
  assert.deepEqual(validateSentenceInput(d, '  it’s “fine”  here.  ', '  很好  ', '', null),
    { ok: true, text: 'it\'s "fine" here.', frame: '', zh: '很好', topics: [] });
});

test('validateSentenceInput：依 7.5 的順序回傳第一個成立的錯誤', () => {
  const d = deepFreeze(appDataWith({ sentences: [makeSentence({ id: 'a1', text: 'Two words.' })] }));
  const error = (text, zh) => validateSentenceInput(d, text, zh, '', null).error;
  assert.equal(error('μ', ''), '有英文鍵盤打不出的字元：「μ」，請改寫');      // 2 先於 3、4
  assert.equal(error('123', ''), '英文句子至少要有一個英文字母');             // 3 先於 4
  assert.equal(error('a'.repeat(301), ''), '請輸入至少兩個字的句子');        // 4 先於 5
  assert.equal(error('two WORDS.', '中'.repeat(201)), '句子庫裡已經有相同的句子'); // 6 先於 7
  assert.equal(error('Hello.', '中'.repeat(201)), '請輸入至少兩個字的句子');  // text 的錯誤先於 zh
});

test('updateSentence：只改中文時進度不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', frame: '', topics: [], level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const other = makeSentence({ id: 'x2', text: 'Other one here.' });
  const d = deepFreeze(appDataWith({ sentences: [s, other] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: "It's fine here.", zh: '  很好  ', frame: '', topics: [] }), TODAY);
  assert.deepEqual(r, { ...d, sentences: [{ ...s, zh: '很好' }, other] });
});

test('updateSentence：英文只差彎引號這類寫法、canonical 相同時視為沒變，進度不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', frame: '', topics: [], level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: '  It’s  fine here. ', zh: '還好', frame: '', topics: [] }), TODAY);
  assert.deepEqual(r.sentences, [s]);
});

test('updateSentence：改英文時 level、streak 歸零，lastResult 為 null，reps 大於 0 的 due 變成 today，lastSeen 與 reps 不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', frame: '', topics: [], level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: 'It is  fine here.', zh: '還好', frame: '', topics: [] }), TODAY);
  assert.deepEqual(r.sentences, [
    { id: 'p1', text: 'It is fine here.', zh: '還好', frame: '', topics: [], level: 0, streak: 0, due: TODAY, lastSeen: '2026-10-12', lastResult: null, reps: 5 },
  ]);
});

test('updateSentence：只改大小寫也算改了英文', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', frame: '', topics: [], level: 1, streak: 1, due: '2026-10-15', lastSeen: '2026-10-13', lastResult: 'fail', reps: 2 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: "it's fine here.", zh: '還好', frame: '', topics: [] }), TODAY);
  assert.deepEqual(r.sentences, [
    { id: 'p1', text: "it's fine here.", zh: '還好', frame: '', topics: [], level: 0, streak: 0, due: TODAY, lastSeen: '2026-10-13', lastResult: null, reps: 2 },
  ]);
});

test('updateSentence：reps 為 0 的句子改英文時 due 維持 null', () => {
  const s = makeSentence({ id: 'n1', text: 'New one here.', zh: '新' });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'n1', deepFreeze({ text: 'Brand new one.', zh: '全新', frame: '', topics: [] }), TODAY);
  assert.deepEqual(r.sentences, [{ ...s, text: 'Brand new one.', zh: '全新' }]);
  assert.equal(r.sentences[0].due, null);
});

test('setDailyCount：DAILY_OPTIONS 內的值寫進 settings，今天的 session 不動', () => {
  const session = { day: TODAY, ids: ['x1'], index: 0, results: [], stage: 0, retry: false };
  const d = deepFreeze(appDataWith({ sentences: [makeSentence()], session }));
  for (const n of DAILY_OPTIONS) {
    assert.deepEqual(setDailyCount(d, n), { ...d, settings: { dailyCount: n, lastExport: null } });
  }
  assert.equal(setDailyCount(d, 20).session, d.session);
});

test('setDailyCount：選項以外的值原樣回傳同一個 data', () => {
  const d = deepFreeze(appDataWith());
  for (const n of [0, 7, 12, -5, 10.5, 35, NaN, '20', null, undefined]) {
    assert.equal(setDailyCount(d, n), d);
  }
});

test('markExported：把 lastExport 設為 today，其他欄位不變', () => {
  const d = deepFreeze(appDataWith({ settings: { dailyCount: 15, lastExport: '2026-10-01' }, doneDays: ['2026-10-13'] }));
  assert.deepEqual(markExported(d, TODAY), { ...d, settings: { dailyCount: 15, lastExport: TODAY } });
});

test('addDoneDay：day 已存在時原樣回傳同一個陣列', () => {
  const days = deepFreeze(['2026-10-12', '2026-10-14']);
  assert.equal(addDoneDay(days, '2026-10-12'), days);
  assert.equal(addDoneDay(days, '2026-10-14'), days);
});

test('addDoneDay：插入後排序，時鐘倒退時也維持遞增不重複', () => {
  const days = deepFreeze(['2026-10-12', '2026-10-14']);
  assert.deepEqual(addDoneDay(days, '2026-10-13'), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(addDoneDay(days, '2026-10-15'), ['2026-10-12', '2026-10-14', '2026-10-15']);
  assert.deepEqual(addDoneDay(days, '2026-10-01'), ['2026-10-01', '2026-10-12', '2026-10-14']);
  assert.deepEqual(addDoneDay(deepFreeze(['2027-01-01']), '2026-12-31'), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(addDoneDay(deepFreeze([]), TODAY), [TODAY]);
});

test('currentSentence：回傳 ids[index] 對應的句子，沒有 session、找不到或已經做完時回傳 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const at = (session) => currentSentence(deepFreeze(appDataWith({ sentences: [a, b], session })));
  assert.deepEqual(at({ day: TODAY, ids: ['b', 'a'], index: 0, results: [], stage: 0, retry: false }), b);
  assert.deepEqual(at({ day: TODAY, ids: ['b', 'a'], index: 1, results: ['pass'], stage: 0, retry: false }), a);
  assert.equal(at(null), null);
  assert.equal(at({ day: TODAY, ids: ['b', 'a'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false }), null);
  assert.equal(at({ day: TODAY, ids: ['zz', 'a'], index: 0, results: [], stage: 0, retry: false }), null);
});

test('startOrResumeSession：沒有 session 時依 pickToday 新建，題數是 min(dailyCount, 句數)', () => {
  const seeded = deepFreeze(createInitialData(SEED));
  assert.deepEqual(startOrResumeSession(seeded, TODAY), {
    ...seeded,
    session: { day: TODAY, ids: ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10'], index: 0, results: [], stage: 0, retry: false },
  });
  const five = deepFreeze(setDailyCount(seeded, 5));
  assert.deepEqual(startOrResumeSession(five, TODAY).session,
    { day: TODAY, ids: ['s01', 's02', 's03', 's04', 's05'], index: 0, results: [], stage: 0, retry: false });
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.', level: 0, streak: 1, due: TODAY, lastSeen: '2026-10-13', lastResult: 'pass', reps: 1 });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const small = deepFreeze(appDataWith({ sentences: [a, b, c] }));
  assert.deepEqual(startOrResumeSession(small, TODAY).session,
    { day: TODAY, ids: ['b', 'a', 'c'], index: 0, results: [], stage: 0, retry: false });
});

test('startOrResumeSession：同一天再呼叫時沿用同一個 session，改過每日題數也不重建', () => {
  const started = deepFreeze(startOrResumeSession(deepFreeze(createInitialData(SEED)), TODAY));
  const changed = deepFreeze(setDailyCount(started, 5));
  assert.deepEqual(startOrResumeSession(changed, TODAY), changed);
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const midway = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: TODAY, ids: ['c', 'a', 'b'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(startOrResumeSession(midway, TODAY), midway);
});

test('startOrResumeSession：同一天但剩下的 id 已不存在時會被過濾，做過的 id 保留', () => {
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const d = makeSentence({ id: 'd', text: 'Delta four here.' });
  const data = deepFreeze(appDataWith({
    sentences: [b, d],
    session: { day: TODAY, ids: ['a', 'b', 'c', 'd'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY),
    { ...data, session: { day: TODAY, ids: ['a', 'b', 'd'], index: 1, results: ['pass'], stage: 0, retry: false } });
});

test('startOrResumeSession：同一天剩下的 id 全部不存在、已經做過幾張時，ids 改成做過的部分並記為完成', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a],
    doneDays: ['2026-10-13'],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['fail'], stage: 0, retry: false },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY), {
    ...data,
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a'], index: 1, results: ['fail'], stage: 0, retry: false },
  });
});

test('startOrResumeSession：同一天一張都還沒做、剩下的 id 也全部不存在時，session 為 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a],
    session: { day: TODAY, ids: ['b', 'c'], index: 0, results: [], stage: 0, retry: false },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY), { ...data, session: null });
});

test('startOrResumeSession：隔天時丟棄舊 session 並重建，舊的那天不算完成', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.', level: 0, streak: 1, due: TODAY, lastSeen: '2026-10-13', lastResult: 'pass', reps: 1 });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c],
    doneDays: ['2026-10-12'],
    session: { day: '2026-10-13', ids: ['a', 'b'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY),
    { ...data, session: { day: TODAY, ids: ['a', 'b', 'c'], index: 0, results: [], stage: 0, retry: false } });
});

test('startOrResumeSession：句子庫為空時 session 為 null', () => {
  const empty = deepFreeze(appDataWith());
  assert.deepEqual(startOrResumeSession(empty, TODAY), empty);
  const stale = deepFreeze(appDataWith({ session: { day: '2026-10-13', ids: ['a'], index: 0, results: [], stage: 0, retry: false } }));
  assert.equal(startOrResumeSession(stale, TODAY).session, null);
});

test('startOrResumeSession：已完成的 session 冪等，doneDays 補上 day 而且不重複', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const done = deepFreeze(appDataWith({
    sentences: [a, b],
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false },
  }));
  const r1 = deepFreeze(startOrResumeSession(done, TODAY));
  assert.deepEqual(r1, done);
  assert.deepEqual(startOrResumeSession(r1, TODAY), done);
  const missing = deepFreeze({ ...done, doneDays: ['2026-10-13'] });
  const r2 = deepFreeze(startOrResumeSession(missing, TODAY));
  assert.deepEqual(r2, done);
  assert.deepEqual(startOrResumeSession(r2, TODAY), done);
});

test('completeCard：沒有進行中的卡片時 throw', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const withSession = (session) => deepFreeze(appDataWith({ sentences: [a], session }));
  assert.throws(() => completeCard(withSession(null), 'pass'), /沒有進行中的卡片/);
  assert.throws(() => completeCard(withSession({ day: TODAY, ids: ['a'], index: 1, results: ['pass'], stage: 0, retry: false }), 'pass'), /沒有進行中的卡片/);
  assert.throws(() => completeCard(withSession({ day: TODAY, ids: ['zz'], index: 0, results: [], stage: 0, retry: false }), 'pass'), /沒有進行中的卡片/);
});

test('completeCard：outcome 不是 pass 或 fail 時 throw，在檢查有沒有進行中的卡片之前', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const d = deepFreeze(appDataWith({ sentences: [a], session: { day: TODAY, ids: ['a'], index: 0, results: [], stage: 2, retry: true } }));
  const err = { name: 'Error', message: 'completeCard：outcome 只能是 pass 或 fail' };
  for (const outcome of ['Pass', 'FAIL', '', 'x', undefined, null, true, 1]) {
    assert.throws(() => completeCard(d, outcome), err, String(outcome));
  }
  assert.throws(() => completeCard(deepFreeze(appDataWith()), 'Pass'), err);
});

test('deleteSentence：session 為 null 時只移除句子，其他欄位不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    settings: { dailyCount: 15, lastExport: '2026-10-01' },
    sentences: [a, b, c],
    doneDays: ['2026-10-13'],
  }));
  assert.deepEqual(deleteSentence(data, 'b', TODAY), { ...data, sentences: [a, c] });
});

test('deleteSentence：刪除不在 session 裡的句子，session 不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const x = makeSentence({ id: 'x', text: 'Extra one here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c, x],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(data, 'x', TODAY), { ...data, sentences: [a, b, c] });
});

test('deleteSentence：刪除目前這一張，後面的卡往前補，index 與 results 不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  const r = deepFreeze(deleteSentence(data, 'b', TODAY));
  assert.deepEqual(r, {
    ...data,
    sentences: [a, c],
    session: { day: TODAY, ids: ['a', 'c'], index: 1, results: ['pass'], stage: 0, retry: false },
  });
  assert.deepEqual(currentSentence(r), c);
});

test('deleteSentence：index 大於 0 時刪除最後一張未完成的卡，ids 改成做過的部分，doneDays 加入 today', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c],
    doneDays: ['2026-10-13'],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(data, 'c', TODAY), {
    ...data,
    sentences: [a, b],
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false },
  });
});

test('deleteSentence：只有一張卡而且還沒做時刪除它，session 變成 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b],
    session: { day: TODAY, ids: ['a'], index: 0, results: [], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(data, 'a', TODAY), { ...data, sentences: [b], session: null });
});

test('deleteSentence：刪除已完成的卡，ids、index 與 results 都不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const midway = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 2, results: ['pass', 'pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(midway, 'a', TODAY), { ...midway, sentences: [b, c] });
  const finished = deepFreeze(appDataWith({
    sentences: [a, b],
    doneDays: [TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(finished, 'b', TODAY), { ...finished, sentences: [a] });
  // 已經做完的 session 不算「原本還有未完成的卡」，刪除時不補記 doneDays
  const finishedNoDay = deepFreeze({ ...finished, doneDays: [] });
  assert.deepEqual(deleteSentence(finishedNoDay, 'b', TODAY), { ...finishedNoDay, sentences: [a] });
});

test('deleteSentence：session 的 day 不是 today 時，session 變成 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c],
    doneDays: ['2026-10-12'],
    session: { day: '2026-10-13', ids: ['a', 'b'], index: 1, results: ['pass'], stage: 0, retry: false },
  }));
  assert.deepEqual(deleteSentence(data, 'c', TODAY), { ...data, sentences: [a, b], session: null });
});

test('backupReminder：lastExport 為 null 而且 doneDays 至少 3 天時提醒還沒匯出過', () => {
  const days = (n) => ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].slice(0, n);
  const at = (doneDays) => backupReminder(deepFreeze(appDataWith({ doneDays })), TODAY);
  assert.equal(at(days(4)), '還沒有匯出過備份');
  assert.equal(at(days(3)), '還沒有匯出過備份');
  assert.equal(at(days(2)), null);
  assert.equal(at([]), null);
});

test('backupReminder：距上次匯出超過 14 天才提醒，15 天提醒、14 天不提醒', () => {
  const at = (lastExport) => backupReminder(deepFreeze(appDataWith({
    settings: { dailyCount: 10, lastExport },
    doneDays: ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'],
  })), TODAY);
  assert.equal(at('2026-09-29'), '已經 15 天沒有匯出備份');
  assert.equal(at('2026-09-30'), null);
  assert.equal(at('2026-08-01'), '已經 74 天沒有匯出備份');
  assert.equal(at(TODAY), null);
  assert.equal(at('2026-10-20'), null);                  // 時鐘被調回去，lastExport 晚於 today
});

// ===== 第 8 任務：sanitizeData（7.4） =====

const NOW_ISO = '2026-10-14T13:05:00.000Z';

function rawAppData(overrides = {}) {
  return { schema: 2, settings: { dailyCount: 10, lastExport: null }, sentences: [], doneDays: [], removedSeeds: [], session: null, ...overrides };
}

// app 自己產生、練過兩張卡的資料：有 session、有進度、有 lastExport 與 doneDays
function practicedData() {
  let data = createInitialData(SEED);
  data = startOrResumeSession(deepFreeze(data), TODAY);
  data = completeCard(deepFreeze(data), 'pass');
  data = completeCard(deepFreeze(data), 'fail');
  return deepFreeze({
    ...data,
    settings: { ...data.settings, lastExport: '2026-10-01' },
    doneDays: ['2026-10-12', '2026-10-13'],
  });
}

test('sanitizeData：三種情況丟出 name 為 DataError 的 Error，訊息逐字照 7.4', () => {
  const cases = [
    [null, '格式不是物件'],
    [undefined, '格式不是物件'],
    [42, '格式不是物件'],
    ['{"schema":1}', '格式不是物件'],
    [deepFreeze([]), '格式不是物件'],
    [deepFreeze({ sentences: [] }), 'schema 不符'],
    [deepFreeze({ schema: 0, sentences: [] }), 'schema 不符'],
    [deepFreeze({ schema: 3, sentences: [] }), 'schema 不符'],
    [deepFreeze({ schema: '2', sentences: [] }), 'schema 不符'],
    [deepFreeze({ schema: 2 }), 'sentences 不是陣列'],
    [deepFreeze({ schema: '1', sentences: [] }), 'schema 不符'],
    [deepFreeze({ schema: 1 }), 'sentences 不是陣列'],
    [deepFreeze({ schema: 1, sentences: {} }), 'sentences 不是陣列'],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => sanitizeData(input), { name: 'DataError', message });
  }
});

test('sanitizeData：app 自己產生的資料原樣通過、warnings 為空，而且一律重建新物件', () => {
  const data = practicedData();
  const res = sanitizeData(data);
  assert.deepStrictEqual(res, { data, warnings: [] });
  assert.notEqual(res.data, data);
  assert.notEqual(res.data.settings, data.settings);
  assert.notEqual(res.data.sentences[0], data.sentences[0]);
  assert.notEqual(res.data.session, data.session);
  assert.notEqual(res.data.session.ids, data.session.ids);
});

test('sanitizeData：不合格的句子被丟棄，並產生一條 warning', () => {
  const input = deepFreeze(rawAppData({ sentences: [
    null, 42, 'text', ['s01'],                                   // 不是物件
    makeSentence({ id: '' }),                                    // id 格式不符
    makeSentence({ id: 'a b' }),
    makeSentence({ id: 'x'.repeat(65) }),
    makeSentence({ id: 7 }),                                     // id 不是字串
    makeSentence({ id: 'k1', text: 42 }),                        // text 不是字串
    makeSentence({ id: 'k2', text: '   ' }),                     // canonicalize 後為空
    makeSentence({ id: 'k3', text: 'The error is 5 μm.' }),      // 英文鍵盤打不出的字元
    makeSentence({ id: 'k4', text: 'Ring \u0007 bell.' }),
    makeSentence({ id: 'k5', text: '123 456.' }),                // 沒有英文字母
    makeSentence({ id: 'x'.repeat(64), text: 'Long id is fine.' }),
    makeSentence({ id: 'A-z_9', text: '  Curly “quotes” — here…  ' }),
  ] }));
  const res = sanitizeData(input);
  assert.deepStrictEqual(res.data.sentences.map((s) => [s.id, s.text]), [
    ['x'.repeat(64), 'Long id is fine.'],
    ['A-z_9', 'Curly "quotes" - here...'],
  ]);
  assert.deepStrictEqual(res.warnings, ['有 13 句資料不完整，或含有英文鍵盤打不出的字元，已略過']);
});

test('sanitizeData：id 重複的檢查排在 id 格式與 text 檢查之後', () => {
  const input = deepFreeze(rawAppData({ sentences: [
    makeSentence({ id: 'd1', text: 'First copy stays here.' }),
    makeSentence({ id: 'd1', text: 'Second copy is dropped.' }),
    makeSentence({ id: 'd2', text: 'Bad 5 μm comes first.' }),
    makeSentence({ id: 'd2', text: 'Good one comes second.' }),
  ] }));
  const res = sanitizeData(input);
  assert.deepStrictEqual(res.data.sentences.map((s) => [s.id, s.text]), [
    ['d1', 'First copy stays here.'],
    ['d2', 'Good one comes second.'],
  ]);
  assert.deepStrictEqual(res.warnings, ['有 2 句資料不完整，或含有英文鍵盤打不出的字元，已略過']);
});

test('sanitizeData：zh 與進度欄位依 7.4 修正', () => {
  const rows = [
    // [id, 輸入的 overrides, 期望的 overrides]
    ['q01', { zh: 42 }, { zh: '' }],
    ['q02', { zh: '  前後有空白  ' }, { zh: '前後有空白' }],
    ['q03', { reps: 0, level: 2, streak: 3, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass' }, {}],
    ['q04', { reps: -1, level: 2, streak: 3, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass' }, {}],
    ['q05', { reps: 1.5, level: 1, lastResult: 'fail' }, {}],
    ['q06', { reps: '3', level: 1, due: '2026-10-15' }, {}],
    ['q07', { reps: 4, level: 1, streak: 1, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'fail' },
      { reps: 4, level: 1, streak: 1, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'fail' }],
    ['q08', { reps: 3, level: 7 }, { reps: 3, level: 2 }],
    ['q09', { reps: 3, level: -1 }, { reps: 3, level: 0 }],
    ['q10', { reps: 3, level: 1.5 }, { reps: 3, level: 0 }],
    ['q11', { reps: 3, level: '2' }, { reps: 3, level: 0 }],
    ['q12', { reps: 2, level: 2, streak: -1 }, { reps: 2, level: 2, streak: 0 }],
    ['q13', { reps: 2, level: 2, streak: 2.5 }, { reps: 2, level: 2, streak: 0 }],
    ['q14', { reps: 2, due: '2026-02-30', lastSeen: '2026-1-5' }, { reps: 2, due: null, lastSeen: null }],
    ['q15', { reps: 2, due: 20261015, lastResult: 'skip' }, { reps: 2, due: null, lastResult: null }],
  ];
  const input = deepFreeze(rawAppData({ sentences: [
    { id: 'q00', text: 'Only id and text here.' },
    ...rows.map(([id, given]) => makeSentence({ id, ...given })),
  ] }));
  const res = sanitizeData(input);
  assert.deepStrictEqual(res.warnings, []);
  assert.deepStrictEqual(res.data.sentences, [
    makeSentence({ id: 'q00', text: 'Only id and text here.', zh: '' }),
    ...rows.map(([id, , expected]) => makeSentence({ id, ...expected })),
  ]);
});

test('sanitizeData：settings 不合法時補預設值', () => {
  const cases = [
    [undefined, { dailyCount: 10, lastExport: null }],
    [null, { dailyCount: 10, lastExport: null }],
    ['x', { dailyCount: 10, lastExport: null }],
    [[30], { dailyCount: 10, lastExport: null }],
    [{ dailyCount: 7, lastExport: '2026-10-01' }, { dailyCount: 10, lastExport: '2026-10-01' }],
    [{ dailyCount: '15', lastExport: '2026-1-5' }, { dailyCount: 10, lastExport: null }],
    [{ dailyCount: 30, lastExport: '2026-02-30' }, { dailyCount: 30, lastExport: null }],
    [{ dailyCount: 5 }, { dailyCount: 5, lastExport: null }],
  ];
  for (const [settings, expected] of cases) {
    const res = sanitizeData(deepFreeze(rawAppData({ settings })));
    assert.deepStrictEqual(res.data.settings, expected);
    assert.deepStrictEqual(res.warnings, []);
  }
});

test('sanitizeData：doneDays 過濾不合法的日期、去重並排序', () => {
  const cases = [
    [undefined, []],
    ['2026-10-14', []],
    [{ 0: '2026-10-14' }, []],
    [['2026-10-12', '2026-10-01', '2026-10-12', '2026-02-30', 7, null, '2026-1-5'], ['2026-10-01', '2026-10-12']],
    [['2026-10-13', '2026-10-14'], ['2026-10-13', '2026-10-14']],
  ];
  for (const [doneDays, expected] of cases) {
    const res = sanitizeData(deepFreeze(rawAppData({ doneDays })));
    assert.deepStrictEqual(res.data.doneDays, expected);
    assert.deepStrictEqual(res.warnings, []);
  }
});

test('sanitizeData：session 任一條不合法就設為 null', () => {
  const valid = { day: TODAY, ids: ['s01', 's02', 'gone'], index: 1, results: ['pass'], stage: 0, retry: false };
  const bad = [
    'x', 42, [],
    { ...valid, day: '2026-13-01' },
    { ...valid, day: undefined },
    { ...valid, ids: 's01' },
    { ...valid, ids: [], index: 0, results: [], stage: 0, retry: false },
    { ...valid, ids: ['s01', 2, 's03'] },
    { ...valid, ids: ['s01', 's02', 's01'] },
    { ...valid, index: -1 },
    { ...valid, index: 1.5 },
    { ...valid, index: 4 },
    { ...valid, index: '1' },
    { ...valid, results: [], stage: 0, retry: false },
    { ...valid, results: ['skip'], stage: 0, retry: false },
    { ...valid, results: 'pass' },
  ];
  for (const session of bad) {
    const res = sanitizeData(deepFreeze(rawAppData({ session })));
    assert.equal(res.data.session, null, JSON.stringify(session));
    assert.deepStrictEqual(res.warnings, []);
  }
  // 合格的 session 原樣保留；ids 指向不存在的句子（gone）也不檢查
  assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ session: valid }))).data.session, valid);
  const finished = { day: TODAY, ids: ['s01', 's02'], index: 2, results: ['pass', 'fail'], stage: 0, retry: false };
  assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ session: finished }))).data.session, finished);
});

// ===== 第 8 任務：toBackupJSON 與 fromBackupJSON（7.6） =====

test('fromBackupJSON：檔頭的 exportedDay 不是合法 Day 時 summary.exportedDay 為 null', () => {
  const header = { app: 'phrase-drill', schema: 1, exportedDay: '2026-1-5', exportedAt: NOW_ISO };
  const res = fromBackupJSON(JSON.stringify({ ...header, sentences: [makeSentence()] }));
  assert.equal(res.ok, true);
  assert.equal(res.summary.exportedDay, null);
});

// ===== 第 8 任務：load 與 save（7.3） =====

deepFreeze(SEED);   // load 會把 seed 交給 createInitialData，先凍結

// 依 key 排序列出 storage 的所有 key 與值，用來比對 load 前後是否完全相同
function storageSnapshot(storage) {
  const out = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    out.push([k, storage.getItem(k)]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

test('save：把 JSON.stringify(data) 寫進 phrase-drill:data；failWrites 時直接 throw', () => {
  const data = deepFreeze(createInitialData(SEED));
  const storage = new FakeStorage();
  save(storage, data);
  assert.equal(storage.getItem('phrase-drill:data'), JSON.stringify(data));
  assert.equal(storage.length, 1);
  const full = new FakeStorage();
  full.failWrites = true;
  assert.throws(() => save(full, data), { name: 'QuotaExceededError' });
  assert.equal(full.getItem('phrase-drill:data'), null);
});

test('load：data key 不存在時用 seed 建立初始資料並存檔（seeded）', () => {
  const storage = new FakeStorage();
  const res = load(storage, SEED, NOW_ISO);
  const expected = createInitialData(SEED);
  assert.deepStrictEqual(res, { status: 'seeded', data: expected, warnings: [] });
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:data')), expected);
  assert.equal(storage.length, 1);
});

test('load：資料完好時回傳 ok，load 前後所有 key 完全相同', () => {
  const data = practicedData();
  const storage = new FakeStorage();
  // 刻意存成縮排格式：load 若多寫一次 data key，字串就會改變
  storage.setItem('phrase-drill:data', JSON.stringify(data, null, 2));
  storage.setItem('phrase-drill:undo', JSON.stringify({ at: NOW_ISO, reason: 'import', json: '{}' }));
  storage.setItem('phrase-drill:corrupt', JSON.stringify({ at: NOW_ISO, raw: 'old' }));
  const before = storageSnapshot(storage);
  const res = load(storage, SEED, NOW_ISO);
  assert.deepStrictEqual(res, { status: 'ok', data, warnings: [] });
  assert.deepStrictEqual(storageSnapshot(storage), before);
});

test('load：有句子被丟棄時另存原始字串、存回修正後的資料，warnings 有兩條', () => {
  const good = createInitialData(SEED);
  const raw = JSON.stringify({ ...good, sentences: [makeSentence({ id: 'u1', text: 'The error is 5 μm.' }), ...good.sentences] });
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:data', raw);
  const res = load(storage, SEED, NOW_ISO);
  assert.deepStrictEqual(res, {
    status: 'ok',
    data: good,
    warnings: ['有 1 句資料不完整，或含有英文鍵盤打不出的字元，已略過', '原始資料已另存，可到『設定 > 診斷』複製'],
  });
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:corrupt')), { at: NOW_ISO, raw });
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:data')), good);
});

test('load：JSON.parse 失敗時先另存原始字串，再用 seed 重建並存檔（reset）', () => {
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:data', '{');
  const res = load(storage, SEED, NOW_ISO);
  const expected = createInitialData(SEED);
  assert.deepStrictEqual(res, {
    status: 'reset',
    data: expected,
    warnings: ['主資料讀取失敗，已重建內建句子庫；原始資料已另存，可到『設定 > 診斷』複製'],
  });
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:corrupt')), { at: NOW_ISO, raw: '{' });
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:data')), expected);
});

test('load：sanitizeData 丟出 DataError 時同樣 reset', () => {
  const raws = ['[]', 'null', '"text"', '{"schema":1}', '{"schema":0,"sentences":[]}',
    '{"schema":"2","sentences":[]}', '{"schema":1.5,"sentences":[]}'];
  for (const raw of raws) {
    const storage = new FakeStorage();
    storage.setItem('phrase-drill:data', raw);
    const res = load(storage, SEED, NOW_ISO);
    assert.equal(res.status, 'reset', raw);
    assert.deepStrictEqual(res.data, createInitialData(SEED));
    assert.deepStrictEqual(res.warnings, ['主資料讀取失敗，已重建內建句子庫；原始資料已另存，可到『設定 > 診斷』複製']);
    assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:corrupt')), { at: NOW_ISO, raw });
    assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:data')), createInitialData(SEED));
  }
});

test('load：corrupt key 已有舊內容時被覆寫', () => {
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:corrupt', JSON.stringify({ at: '2026-10-01T00:00:00.000Z', raw: 'old' }));
  storage.setItem('phrase-drill:data', '{');
  load(storage, SEED, NOW_ISO);
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:corrupt')), { at: NOW_ISO, raw: '{' });
});

test('load：schema 是大於 SCHEMA 的整數時回傳 newer，不寫入任何 key', () => {
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:data', JSON.stringify({ schema: 3, sentences: 'future format' }));
  storage.setItem('phrase-drill:corrupt', JSON.stringify({ at: NOW_ISO, raw: 'old' }));
  const before = storageSnapshot(storage);
  const res = load(storage, SEED, NOW_ISO);
  assert.deepStrictEqual(res, { status: 'newer', data: null, warnings: [] });
  assert.deepStrictEqual(storageSnapshot(storage), before);
});

test('load：storage 丟出的例外不攔截，原樣往上丟', () => {
  const throwing = {
    getItem() { throw new Error('storage unavailable'); },
    setItem() {},
    removeItem() {},
  };
  assert.throws(() => load(throwing, SEED, NOW_ISO), { message: 'storage unavailable' });
  const empty = new FakeStorage();
  empty.failWrites = true;
  assert.throws(() => load(empty, SEED, NOW_ISO), { name: 'QuotaExceededError' });
  const broken = new FakeStorage();
  broken.setItem('phrase-drill:data', '{');
  broken.failWrites = true;
  assert.throws(() => load(broken, SEED, NOW_ISO), { name: 'QuotaExceededError' });
});

// ===== 自訂句與手動修過的資料：存檔再載入 =====

test('load：自訂片語與句子不受 seed 專屬規則限制，save 後重新 load 原樣保留、沒有 warning', () => {
  let data = deepFreeze(createInitialData(SEED));
  const phrase = validateSentenceInput(data, 'In contrast,', '', '', null);
  assert.deepStrictEqual(phrase, { ok: true, text: 'In contrast,', frame: '', zh: '', topics: [] });
  const quoted = validateSentenceInput(data, 'The so-called "cold start" problem [12] remains open...', '所謂的冷啟動問題仍未解決', '', null);
  assert.equal(quoted.ok, true);
  data = deepFreeze(addSentence(data, deepFreeze({ id: 'u1', text: phrase.text, zh: phrase.zh, frame: phrase.frame, topics: phrase.topics })));
  data = deepFreeze(addSentence(data, deepFreeze({ id: 'u2', text: quoted.text, zh: quoted.zh, frame: quoted.frame, topics: quoted.topics })));
  assert.deepStrictEqual(data.sentences.slice(0, 2).map((s) => [s.id, s.text, s.zh]), [
    ['u2', 'The so-called "cold start" problem [12] remains open...', '所謂的冷啟動問題仍未解決'],
    ['u1', 'In contrast,', ''],
  ]);
  const storage = new FakeStorage();
  save(storage, data);
  const res = load(storage, SEED, '2026-10-14T13:05:00.000Z');
  assert.equal(res.status, 'ok');
  assert.deepStrictEqual(res.warnings, []);
  assert.deepStrictEqual(res.data, data);
});

test('load：手動修過的資料缺 settings、doneDays 雜亂、session 為任意值、sentences 混有雜項時照 7.4 修正，不丟出 TypeError', () => {
  const raw = '{"schema":2,"sentences":[null,42,["s01"],{"id":"s01","text":"Hello world."}],"doneDays":["2026-10-12","2026-10-01","2026-10-12","2026-02-30",7],"session":"x"}';
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:data', raw);
  let res;
  assert.doesNotThrow(() => { res = load(storage, SEED, '2026-10-14T13:05:00.000Z'); });
  assert.equal(res.status, 'ok');
  assert.deepStrictEqual(res.data.settings, { dailyCount: 10, lastExport: null });
  assert.deepStrictEqual(res.data.doneDays, ['2026-10-01', '2026-10-12']);
  assert.equal(res.data.session, null);
  assert.deepStrictEqual(res.data.sentences, [
    { id: 's01', text: 'Hello world.', zh: '', frame: '', topics: [], level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
  ]);
  assert.deepStrictEqual(res.warnings, [
    '有 3 句資料不完整，或含有英文鍵盤打不出的字元，已略過',
    '原始資料已另存，可到『設定 > 診斷』複製',
  ]);

  const edited = deepFreeze({
    ...JSON.parse(raw),
    settings: null,
    session: { day: '2026-10-14', ids: ['s01', 's01'], index: 0, results: [], stage: 0, retry: false },
  });
  let res2;
  assert.doesNotThrow(() => { res2 = sanitizeData(edited); });
  assert.deepStrictEqual(res2.data.settings, { dailyCount: 10, lastExport: null });
  assert.equal(res2.data.session, null);
});

// ===== 第 8 任務：undo 與 corrupt（7.3、7.6） =====

test('writeUndo 與 readUndo：寫入 { at, reason, json }，讀回 sanitize 過的資料', () => {
  const data = practicedData();
  const storage = new FakeStorage();
  writeUndo(storage, data, 'import', NOW_ISO);
  assert.deepStrictEqual(JSON.parse(storage.getItem('phrase-drill:undo')),
    { at: NOW_ISO, reason: 'import', json: JSON.stringify(data) });
  assert.deepStrictEqual(readUndo(storage), { at: NOW_ISO, reason: 'import', data });
  writeUndo(storage, data, 'clear', '2026-10-15T01:00:00.000Z');
  assert.deepStrictEqual(readUndo(storage), { at: '2026-10-15T01:00:00.000Z', reason: 'clear', data });
});

test('writeUndo：setItem 失敗時直接 throw', () => {
  const storage = new FakeStorage();
  storage.failWrites = true;
  assert.throws(() => writeUndo(storage, practicedData(), 'clear', NOW_ISO), { name: 'QuotaExceededError' });
});

test('clearUndo：刪掉 undo key，之後 readUndo 為 null', () => {
  const storage = new FakeStorage();
  writeUndo(storage, practicedData(), 'import', NOW_ISO);
  clearUndo(storage);
  assert.equal(storage.getItem('phrase-drill:undo'), null);
  assert.equal(readUndo(storage), null);
});

test('readUndo：key 不存在、內容壞掉或讀取失敗時回傳 null', () => {
  assert.equal(readUndo(new FakeStorage()), null);
  const json = JSON.stringify(createInitialData(SEED));
  const broken = [
    '{',
    '[]',
    'null',
    JSON.stringify({ at: NOW_ISO, reason: 'import', json: '{' }),
    JSON.stringify({ at: NOW_ISO, reason: 'import', json: '[]' }),
    JSON.stringify({ at: NOW_ISO, reason: 'import', json: JSON.stringify({ schema: 3, sentences: [] }) }),
    JSON.stringify({ at: NOW_ISO, reason: 'import' }),
    JSON.stringify({ at: 1, reason: 'import', json }),
    JSON.stringify({ at: NOW_ISO, reason: 'other', json }),
  ];
  for (const value of broken) {
    const storage = new FakeStorage();
    storage.setItem('phrase-drill:undo', value);
    assert.equal(readUndo(storage), null, value);
  }
  const throwing = { getItem() { throw new Error('storage unavailable'); }, setItem() {}, removeItem() {} };
  assert.equal(readUndo(throwing), null);
});

test('readCorrupt 與 clearCorrupt：讀回 load 另存的原始資料，刪除後為 null', () => {
  const storage = new FakeStorage();
  assert.equal(readCorrupt(storage), null);
  storage.setItem('phrase-drill:data', '{');
  load(storage, SEED, NOW_ISO);
  assert.deepStrictEqual(readCorrupt(storage), { at: NOW_ISO, raw: '{' });
  clearCorrupt(storage);
  assert.equal(storage.getItem('phrase-drill:corrupt'), null);
  assert.equal(readCorrupt(storage), null);
});

test('readCorrupt：內容壞掉，或 at 與 raw 不是字串時回傳 null', () => {
  const broken = [
    '{',
    '[]',
    'null',
    '"text"',
    JSON.stringify({ at: NOW_ISO }),
    JSON.stringify({ at: 1, raw: '{' }),
    JSON.stringify({ at: NOW_ISO, raw: 42 }),
  ];
  for (const value of broken) {
    const storage = new FakeStorage();
    storage.setItem('phrase-drill:corrupt', value);
    assert.equal(readCorrupt(storage), null, value);
  }
  const throwing = { getItem() { throw new Error('storage unavailable'); }, setItem() {}, removeItem() {} };
  assert.equal(readCorrupt(throwing), null);
});

test('load：corrupt key 寫入失敗時直接 throw，data key 保持原始字串（reset 與丟棄句子兩條路徑）', () => {
  const failCorrupt = (inner) => ({
    getItem: (k) => inner.getItem(k),
    setItem: (k, v) => {
      if (k === 'phrase-drill:corrupt') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      inner.setItem(k, v);
    },
    removeItem: (k) => inner.removeItem(k),
  });
  const dropped = JSON.stringify({ ...createInitialData(SEED), sentences: [makeSentence({ id: 'u1', text: 'The error is 5 μm.' })] });
  for (const raw of ['{', '[]', dropped]) {
    const inner = new FakeStorage();
    inner.setItem('phrase-drill:data', raw);
    assert.throws(() => load(failCorrupt(inner), SEED, NOW_ISO), { name: 'QuotaExceededError' }, raw);
    assert.equal(inner.getItem('phrase-drill:data'), raw, raw);
    assert.equal(inner.getItem('phrase-drill:corrupt'), null, raw);
  }
});

test('sanitizeData：session 的 index 比 ids.length 大時設為 null，就算 results 長度剛好等於 index', () => {
  const session = { day: TODAY, ids: ['s01', 's02'], index: 3, results: ['pass', 'fail', 'pass'], stage: 0, retry: false };
  const res = sanitizeData(deepFreeze(rawAppData({ session })));
  assert.equal(res.data.session, null);
  assert.deepStrictEqual(res.warnings, []);
});

test('clearUndo 與 clearCorrupt：removeItem 丟出的例外不攔截，原樣往上丟', () => {
  const failing = { getItem: () => null, setItem() {}, removeItem() { throw new Error('remove failed'); } };
  assert.throws(() => clearUndo(failing), { message: 'remove failed' });
  assert.throws(() => clearCorrupt(failing), { message: 'remove failed' });
});
// ===== 第 2 版：資料模型、骨架、階梯、加練、合併內建句與升級（規格 6.4、7.1 到 7.7、10.5） =====
// import 宣告在模組頂層的任何位置都合法，第 2 版的名稱在這裡另外 import，不改檔案開頭
import { MAX_TOPICS, MAX_TOPIC_LENGTH, mergeSeed, topStage, startStage, currentCard, cardTopic } from '../js/store.js';
import { extendSession, remainingToday, upgradeV1 } from '../js/store.js';
import { normalizeFrame } from '../js/drill.js';
import { pickToday } from '../js/schedule.js';

// 10.5 的三句 fixture：A 是有骨架的新句，B 是沒有骨架的新句，C 是有骨架、已在背誦的舊句
const SA = makeSentence({
  id: 'A', text: 'To address this issue, we propose a simple yet effective method.',
  frame: 'To address this issue, we propose {a simple yet effective method}.', topics: ['甲', '乙', '丙'],
});
const SB = makeSentence({ id: 'B', text: 'The results show that the method works.', frame: '', topics: [] });
const SC = makeSentence({
  id: 'C', text: 'The question is not whether we should regulate AI, but how we do it.',
  frame: 'The question is not whether {we should regulate AI}, but how {we do it}.', topics: ['甲', '乙', '丙'],
  reps: 3, level: 2, streak: 1, due: '2026-10-14', lastSeen: '2026-10-12', lastResult: 'pass',
});
// session 物件，欄位依 7.1 的順序
const sessionOf = (ids, index, stage, retry, results = []) => ({ day: TODAY, ids, index, results, stage, retry });

test('store 常數與規格 7.7 相同（第 2 版）', () => {
  assert.equal(SCHEMA, 2);
  assert.equal(DATA_KEY, 'phrase-drill:data');
  assert.equal(UNDO_KEY, 'phrase-drill:undo');
  assert.equal(CORRUPT_KEY, 'phrase-drill:corrupt');
  assert.deepEqual(DAILY_OPTIONS, [5, 10, 15, 20, 25, 30]);
  assert.equal(DEFAULT_DAILY, 10);
  assert.equal(BACKUP_REMIND_DAYS, 14);
  assert.equal(MAX_TEXT_LENGTH, 300);
  assert.equal(MAX_ZH_LENGTH, 200);
  assert.equal(MAX_TOPICS, 6);
  assert.equal(MAX_TOPIC_LENGTH, 40);
});

// ---- createInitialData 與 seed 交叉檢查（7.5、10.5） ----

test('createInitialData：schema 2，text 與 frame 由 normalizeFrame 導出，topics 是複本，頂層 key 依 7.1 的順序', () => {
  const seed = deepFreeze([
    { id: 's01', frame: '  To address this issue, we propose { a simple yet effective method}.', zh: '為了解決這個問題', topics: ['甲', '乙', '丙'] },
    { id: 's02', frame: 'The question is not whether {we should regulate AI}, but how {we do it}.', zh: '', topics: [] },
  ]);
  const d = createInitialData(seed);
  assert.deepStrictEqual(d, {
    schema: 2,
    settings: { dailyCount: 10, lastExport: null },
    sentences: [
      { id: 's01', text: SA.text, zh: '為了解決這個問題', frame: SA.frame, topics: ['甲', '乙', '丙'],
        level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
      { id: 's02', text: SC.text, zh: '', frame: SC.frame, topics: [],
        level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
    ],
    doneDays: [],
    removedSeeds: [],
    session: null,
  });
  assert.deepStrictEqual(Object.keys(d), ['schema', 'settings', 'sentences', 'doneDays', 'removedSeeds', 'session']);
  assert.notEqual(d.sentences[0].topics, seed[0].topics);
});

test('createInitialData：內建句的骨架不合格時丟出一般的 Error（不是 DataError）', () => {
  const seed = deepFreeze([{ id: 's07', frame: 'we propose a method.', zh: '', topics: [] }]);
  assert.throws(() => createInitialData(seed), { name: 'Error', message: '內建句 s07 的骨架不合格：至少要有一組大括號' });
});

test('createInitialData(SEED)：115 句，text 與 frame 等於 normalizeFrame(item.frame)，topics 內容相同但不是同一個陣列', () => {
  const d = createInitialData(SEED);
  assert.equal(d.sentences.length, 115);
  assert.equal(d.schema, 2);
  assert.equal(d.settings.dailyCount, 10);
  assert.deepStrictEqual(d.removedSeeds, []);
  assert.equal(d.session, null);
  d.sentences.forEach((s, i) => {
    const t = normalizeFrame(SEED[i].frame);
    assert.deepStrictEqual(s, {
      id: SEED[i].id, text: t.text, zh: SEED[i].zh, frame: t.frame, topics: SEED[i].topics,
      level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0,
    });
    assert.notEqual(s.topics, SEED[i].topics);
  });
});

test('seed 交叉檢查：每一句以 frame、zh、議題輸入 validateSentenceInput 都通過，結果等於 createInitialData 存入的值', () => {
  const d = deepFreeze(createInitialData(SEED));
  SEED.forEach((item, i) => {
    const r = validateSentenceInput(d, item.frame, item.zh, item.topics.join('\n'), item.id);
    const s = d.sentences[i];
    assert.deepStrictEqual(r, { ok: true, text: s.text, frame: s.frame, zh: s.zh, topics: s.topics }, item.id);
  });
});

// ---- validateSentenceInput 的骨架與議題（7.5、10.5） ----

test('validateSentenceInput：只有 {} 時 plain 為空，回傳「請輸入英文句子」', () => {
  const d = deepFreeze(appDataWith());
  assert.deepStrictEqual(validateSentenceInput(d, '{}', '', '', null), { ok: false, field: 'text', error: '請輸入英文句子' });
  assert.deepStrictEqual(validateSentenceInput(d, ' { } ', '', '', null), { ok: false, field: 'text', error: '請輸入英文句子' });
});

test('validateSentenceInput：大括號的錯誤，field 都是 text', () => {
  const d = deepFreeze(appDataWith());
  const CASES = [
    ['we propose {a method here.', '大括號沒有成對'],
    ['we propose a} method here.', '大括號沒有成對'],
    ['we propose {} here.', '大括號裡要有範例內容'],
    ['{We propose a new} method.', '大括號外面至少要保留兩個英文字'],
    ['we propose{a method} here.', '大括號要放在字與字之間，不能切開一個字'],
    ["{The model}'s output is {robust}.", '大括號要放在字與字之間，不能切開一個字'],
  ];
  for (const [text, error] of CASES) {
    assert.deepStrictEqual(validateSentenceInput(d, text, '', '', null), { ok: false, field: 'text', error }, text);
  }
});

test("validateSentenceInput：重複檢查排在骨架檢查之前，{It's} fine here. 也判為重複，編輯句子本身時不算", () => {
  const d = deepFreeze(appDataWith({ sentences: [makeSentence({ id: 'a1', text: "It's fine here." })] }));
  const dup = { ok: false, field: 'text', error: '句子庫裡已經有相同的句子' };
  assert.deepStrictEqual(validateSentenceInput(d, 'it’s FINE here.', '', '', null), dup);
  assert.deepStrictEqual(validateSentenceInput(d, "{It's} fine here.", '', '', null), dup);
  assert.deepStrictEqual(validateSentenceInput(d, "{It's} fine here.", '', '', 'a1'),
    { ok: true, text: "It's fine here.", frame: "{It's} fine here.", zh: '', topics: [] });
});

test('validateSentenceInput：骨架通過的案例，大括號內側的空白移到外側，全形大括號也算', () => {
  const d = deepFreeze(appDataWith());
  const ok = (frame, plain) => ({ ok: true, text: plain, frame, zh: '', topics: [] });
  assert.deepStrictEqual(validateSentenceInput(d, SA.frame, '', '', null), ok(SA.frame, SA.text));
  assert.deepStrictEqual(validateSentenceInput(d, 'To address this issue, we propose {a simple yet effective method }.', '', '', null),
    ok('To address this issue, we propose {a simple yet effective method} .', 'To address this issue, we propose a simple yet effective method .'));
  assert.deepStrictEqual(validateSentenceInput(d, 'we propose{ a method} here.', '', '', null),
    ok('we propose {a method} here.', 'we propose a method here.'));
  assert.deepStrictEqual(validateSentenceInput(d, 'The results show that the method works.', '', '', null),
    ok('', 'The results show that the method works.'));
  assert.deepStrictEqual(validateSentenceInput(d, 'we propose ｛a new method｝ here.', '', '', null),
    ok('we propose {a new method} here.', 'we propose a new method here.'));
  assert.deepStrictEqual(validateSentenceInput(d, 'we propose ｛a new method} here.', '', '', null),
    ok('we propose {a new method} here.', 'we propose a new method here.'));
});

test('validateSentenceInput：議題一行一個，去掉空行與行尾的 CR；最多 6 個、每個 40 字以內，field 為 topics', () => {
  const d = deepFreeze(appDataWith());
  const topicsOf = (topicsText) => validateSentenceInput(d, 'Two words here.', '', topicsText, null);
  assert.deepStrictEqual(topicsOf(' 甲 \n\n乙\r\n').topics, ['甲', '乙']);
  assert.deepStrictEqual(topicsOf('一\n二\n三\n四\n五\n六\n七'), { ok: false, field: 'topics', error: '議題最多 6 個' });
  assert.deepStrictEqual(topicsOf('一\n二\n\n三\n四\n五\n六\n').topics, ['一', '二', '三', '四', '五', '六']);
  assert.deepStrictEqual(topicsOf('甲\n' + '議'.repeat(41)), { ok: false, field: 'topics', error: '每個議題請在 40 字以內' });
  assert.deepStrictEqual(topicsOf('議'.repeat(40)).topics, ['議'.repeat(40)]);
  // zh 的錯誤在議題之前，text 的錯誤又在 zh 之前
  assert.equal(validateSentenceInput(d, 'Two words here.', '中'.repeat(201), '一\n二\n三\n四\n五\n六\n七', null).field, 'zh');
  assert.equal(validateSentenceInput(d, 'Hello.', '中'.repeat(201), '一\n二\n三\n四\n五\n六\n七', null).field, 'text');
});

// ---- addSentence、updateSentence、deleteSentence（7.5、10.5） ----

test('addSentence：text canonicalize、zh trim，frame 與 topics 照存而且 topics 是複本；frame 與 text 不符時存成空字串', () => {
  const d = deepFreeze(appDataWith({ sentences: [SB] }));
  const topics = deepFreeze(['甲', '乙']);
  const r = addSentence(d, deepFreeze({ id: 'u1', text: 'it’s “fine”  here.', zh: '  很好  ', frame: '', topics }));
  assert.deepStrictEqual(r.sentences, [
    { id: 'u1', text: 'it\'s "fine" here.', zh: '很好', frame: '', topics: ['甲', '乙'],
      level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
    SB,
  ]);
  assert.notEqual(r.sentences[0].topics, topics);
  const withFrame = addSentence(d, deepFreeze({ id: 'u2', text: SA.text, zh: '', frame: SA.frame, topics: [] }));
  assert.equal(withFrame.sentences[0].frame, SA.frame);
  const mismatch = addSentence(d, deepFreeze({ id: 'u3', text: 'We propose a method.', zh: '', frame: SA.frame, topics: [] }));
  assert.equal(mismatch.sentences[0].frame, '');
  assert.deepStrictEqual({ ...r, sentences: d.sentences }, d);
});

test('updateSentence：只改骨架或拿掉大括號時，frame 更新，進度不動', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC] }));
  const moved = 'The question is not {whether we should regulate AI}, but how {we do it}.';
  const r1 = updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: moved, topics: SC.topics }), TODAY);
  assert.deepStrictEqual(r1.sentences, [{ ...SC, frame: moved }]);
  const r2 = updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: '', topics: SC.topics }), TODAY);
  assert.deepStrictEqual(r2.sentences, [{ ...SC, frame: '' }]);
});

test('updateSentence：只改議題時，topics 更新而且是複本，進度不動', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC] }));
  const topics = deepFreeze(['能源政策']);
  const r = updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: SC.frame, topics }), TODAY);
  assert.deepStrictEqual(r.sentences, [{ ...SC, topics: ['能源政策'] }]);
  assert.notEqual(r.sentences[0].topics, topics);
});

test('updateSentence：改了今天目前這句的英文時，句子進度歸零，session 的 stage 設為 0、retry 設為 false', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC, SA], session: sessionOf(['C', 'A'], 0, 3, true) }));
  const r = updateSentence(d, 'C', deepFreeze({ text: 'The question is how we do it.', zh: '', frame: '', topics: [] }), TODAY);
  assert.equal(r.sentences[0].level, 0);
  assert.equal(r.sentences[0].due, TODAY);
  assert.deepStrictEqual(r.session, sessionOf(['C', 'A'], 0, 0, false));
});

test('updateSentence：只改目前這句的議題或骨架、改別句的英文、session 不是今天或已做完時，session 不變', () => {
  const live = sessionOf(['C', 'A'], 0, 3, true);
  const d = deepFreeze(appDataWith({ sentences: [SC, SA], session: live }));
  const newText = { text: 'The question is how we do it.', zh: '', frame: '', topics: [] };
  assert.equal(updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: SC.frame, topics: ['丁'] }), TODAY).session, live);
  assert.equal(updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: '', topics: SC.topics }), TODAY).session, live);
  assert.equal(updateSentence(d, 'A', deepFreeze({ text: 'We propose a plan.', zh: '', frame: '', topics: [] }), TODAY).session, live);
  const old = { ...live, day: '2026-10-13' };
  assert.equal(updateSentence(deepFreeze({ ...d, session: old }), 'C', deepFreeze(newText), TODAY).session, old);
  const finished = sessionOf(['C', 'A'], 2, 0, false, ['pass', 'pass']);
  assert.equal(updateSentence(deepFreeze({ ...d, session: finished }), 'C', deepFreeze(newText), TODAY).session, finished);
});

test('deleteSentence：內建句 id 依數字順序記進 removedSeeds，自訂句不記、已有的不重複，結果經 sanitizeData 原樣通過', () => {
  const s07 = makeSentence({ id: 's07', text: 'Seven is a seed sentence.' });
  const s100 = makeSentence({ id: 's100', text: 'Hundred is a seed sentence.' });
  const u1 = makeSentence({ id: 'u1', text: 'A custom sentence here.' });
  const d0 = deepFreeze(appDataWith({ sentences: [s07, s100, u1], removedSeeds: ['s10'] }));
  const d1 = deepFreeze(deleteSentence(d0, 's07', TODAY));
  assert.deepStrictEqual(d1.removedSeeds, ['s07', 's10']);
  const d2 = deepFreeze(deleteSentence(d1, 's100', TODAY));
  assert.deepStrictEqual(d2.removedSeeds, ['s07', 's10', 's100']);
  const d3 = deepFreeze(deleteSentence(d2, 'u1', TODAY));
  assert.deepStrictEqual(d3.removedSeeds, ['s07', 's10', 's100']);
  assert.deepStrictEqual(d3.sentences, []);
  const again = deepFreeze(appDataWith({ sentences: [s07], removedSeeds: ['s07'] }));
  assert.deepStrictEqual(deleteSentence(again, 's07', TODAY).removedSeeds, ['s07']);
  const s99 = makeSentence({ id: 's99', text: 'Ninety-nine is a seed sentence.' });
  const d99 = deepFreeze(appDataWith({ sentences: [s99], removedSeeds: ['s100'] }));
  assert.deepStrictEqual(deleteSentence(d99, 's99', TODAY).removedSeeds, ['s99', 's100']);
  for (const d of [d1, d2, d3]) assert.deepStrictEqual(sanitizeData(d), { data: d, warnings: [] });
});

test('deleteSentence：刪除目前這句時，stage 設為新的目前這句的 startStage、retry 為 false', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC, SA, SB], session: sessionOf(['C', 'A', 'B'], 0, 3, true) }));
  assert.deepStrictEqual(deleteSentence(d, 'C', TODAY).session, sessionOf(['A', 'B'], 0, 0, false));
});

test('deleteSentence：刪除其他未做的句子時，stage 與 retry 不變', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC, SA, SB], session: sessionOf(['C', 'A', 'B'], 0, 3, true) }));
  assert.deepStrictEqual(deleteSentence(d, 'B', TODAY).session, sessionOf(['C', 'A'], 0, 3, true));
});

test('deleteSentence：index 大於 0 時刪掉最後一句未完成的句子，stage 0、retry false，doneDays 加入 today', () => {
  const d = deepFreeze(appDataWith({ sentences: [SA, SB], session: sessionOf(['A', 'B'], 1, 2, true, ['pass']) }));
  const r = deleteSentence(d, 'B', TODAY);
  assert.deepStrictEqual(r.session, sessionOf(['A'], 1, 0, false, ['pass']));
  assert.deepStrictEqual(r.doneDays, [TODAY]);
});

// ---- startOrResumeSession、currentCard、topStage、startStage、cardTopic（6.4、10.5） ----

test('startOrResumeSession：新建時 stage 為第一句的 startStage、retry 為 false；第一句是 C 時 stage 為 2', () => {
  const d = deepFreeze(appDataWith({ sentences: [SA, SB, SC] }));
  assert.deepStrictEqual(startOrResumeSession(d, TODAY).session, sessionOf(['C', 'A', 'B'], 0, 2, false));
  const fresh = deepFreeze(appDataWith({ sentences: [SA, SB] }));
  assert.deepStrictEqual(startOrResumeSession(fresh, TODAY).session, sessionOf(['A', 'B'], 0, 0, false));
});

test('startOrResumeSession：同一天再呼叫時沿用同一個 session，stage 2、retry true 原樣保留', () => {
  const d = deepFreeze(appDataWith({ sentences: [SA, SB, SC], session: sessionOf(['C', 'A', 'B'], 0, 2, true) }));
  assert.deepStrictEqual(startOrResumeSession(d, TODAY), d);
});

test('startOrResumeSession：目前這句已不存在而被過濾時，stage 改為新的目前這句的 startStage、retry 為 false', () => {
  const d = deepFreeze(appDataWith({ sentences: [SC, SB], session: sessionOf(['A', 'X', 'C', 'B'], 1, 3, true, ['pass']) }));
  assert.deepStrictEqual(startOrResumeSession(d, TODAY).session, sessionOf(['A', 'C', 'B'], 1, 2, false, ['pass']));
});

test('topStage 與 startStage：有骨架為 3、沒有骨架為 2；startStage 等於 level', () => {
  assert.equal(topStage(SA), 3);
  assert.equal(topStage(SB), 2);
  assert.equal(topStage(SC), 3);
  assert.equal(startStage(SA), 0);
  assert.equal(startStage(SC), 2);
  assert.equal(startStage(makeSentence({ reps: 1, level: 1 })), 1);
});

test('currentCard 與 currentSentence：沒有 session、已做完、目前的 id 不存在時都是 null', () => {
  const at = (session) => deepFreeze(appDataWith({ sentences: [SA, SB], session }));
  for (const session of [null, sessionOf(['A'], 1, 0, false, ['pass']), sessionOf(['Z', 'A'], 0, 0, false)]) {
    assert.equal(currentCard(at(session)), null);
    assert.equal(currentSentence(at(session)), null);
  }
  const d = at(sessionOf(['B', 'A'], 1, 1, true, ['pass']));
  assert.deepStrictEqual(currentCard(d), { sentence: SA, stage: 1, retry: true });
  assert.equal(currentSentence(d), currentCard(d).sentence);
});

test('currentCard：session.stage 大於 topStage 時夾回 topStage、retry 回報 false，session 本身不變', () => {
  const clamped = deepFreeze(appDataWith({ sentences: [SB], session: sessionOf(['B'], 0, 3, true) }));
  assert.deepStrictEqual(currentCard(clamped), { sentence: SB, stage: 2, retry: false });
  assert.deepStrictEqual(clamped.session, sessionOf(['B'], 0, 3, true));
  const notClamped = deepFreeze(appDataWith({ sentences: [SB], session: sessionOf(['B'], 0, 2, true) }));
  assert.deepStrictEqual(currentCard(notClamped), { sentence: SB, stage: 2, retry: true });
});

test('cardTopic：6.4 表格的六列，以及 A、B、C 三句的期望值', () => {
  const t3 = ['AI 監管', '資料隱私', '你自己的研究'];
  const at = (topics, reps, retry) => cardTopic(deepFreeze(makeSentence({ topics, reps, level: 1 })), retry);
  assert.equal(at(t3, 0, false), 'AI 監管');
  assert.equal(at(t3, 0, true), '資料隱私');
  assert.equal(at(t3, 2, true), 'AI 監管');
  assert.equal(at(t3, 4, false), '資料隱私');
  assert.equal(at(['能源政策'], 3, true), '能源政策');
  assert.equal(at([], 5, false), '你自己的研究');
  assert.equal(cardTopic({ ...SB, reps: 5 }, false), '你自己的研究');
  assert.equal(cardTopic(SA, true), '乙');
  assert.equal(cardTopic(SC, true), '乙');
});

// ---- completeCard 的階梯轉移（6.4、10.5 的表格） ----
{
  // 從 sentences 與 session 開始依序 completeCard，回傳每張之後的 [stage, retry, index] 與最後的資料
  const ladder = (sentences, session, outcomes, doneDays = []) => {
    let d = deepFreeze(appDataWith({ sentences, session, doneDays }));
    const steps = [];
    for (const o of outcomes) {
      d = deepFreeze(completeCard(d, o));
      steps.push([d.session.stage, d.session.retry, d.session.index]);
    }
    return { d, steps };
  };
  const byId = (d, id) => d.sentences.find((s) => s.id === id);

  test('completeCard：新句四階全過，A 升為 level 1，doneDays 不變', () => {
    const { d, steps } = ladder([SA, SB], sessionOf(['A', 'B'], 0, 0, false), ['pass', 'pass', 'pass', 'pass']);
    assert.deepStrictEqual(steps, [[1, false, 0], [2, false, 0], [3, false, 0], [0, false, 1]]);
    assert.deepStrictEqual(d.session.results, ['pass']);
    assert.deepStrictEqual(byId(d, 'A'), { ...SA, level: 1, streak: 0, reps: 1, due: '2026-10-15', lastSeen: TODAY, lastResult: 'pass' });
    assert.deepStrictEqual(d.doneDays, []);
  });

  test('completeCard：第二階失敗一次再過，結果仍是 pass', () => {
    const { d, steps } = ladder([SA, SB], sessionOf(['A', 'B'], 0, 0, false), ['pass', 'fail', 'pass', 'pass', 'pass']);
    assert.deepStrictEqual(steps, [[1, false, 0], [1, true, 0], [2, false, 0], [3, false, 0], [0, false, 1]]);
    assert.deepStrictEqual(d.session.results, ['pass']);
    assert.equal(byId(d, 'A').level, 1);
  });

  test('completeCard：第二階連續失敗兩次，這句以 fail 結束', () => {
    const { d, steps } = ladder([SA, SB], sessionOf(['A', 'B'], 0, 0, false), ['pass', 'fail', 'fail']);
    assert.deepStrictEqual(steps, [[1, false, 0], [1, true, 0], [0, false, 1]]);
    assert.deepStrictEqual(d.session.results, ['fail']);
    assert.deepStrictEqual(byId(d, 'A'), { ...SA, level: 0, streak: 0, reps: 1, due: '2026-10-15', lastSeen: TODAY, lastResult: 'fail' });
  });

  test('completeCard：沒有骨架的句子在背誦結束，最後一句結束時 doneDays 加入今天', () => {
    const { d, steps } = ladder([SB], sessionOf(['B'], 0, 0, false), ['pass', 'pass', 'pass']);
    assert.deepStrictEqual(steps, [[1, false, 0], [2, false, 0], [0, false, 1]]);
    assert.equal(byId(d, 'B').level, 1);
    assert.deepStrictEqual(d.doneDays, [TODAY]);
  });

  test('completeCard：從背誦開始、議題應用重試後通過，C 的 streak 2、reps 4、due 2026-10-18', () => {
    const { d, steps } = ladder([SC], sessionOf(['C'], 0, 2, false), ['pass', 'fail', 'pass']);
    assert.deepStrictEqual(steps, [[3, false, 0], [3, true, 0], [0, false, 1]]);
    assert.deepStrictEqual(d.session.results, ['pass']);
    assert.deepStrictEqual(byId(d, 'C'), { ...SC, level: 2, streak: 2, reps: 4, due: '2026-10-18', lastSeen: TODAY, lastResult: 'pass' });
  });

  test('completeCard：全句提示連續失敗兩次', () => {
    const { d, steps } = ladder([SA, SB], sessionOf(['A', 'B'], 0, 0, false), ['fail', 'fail']);
    assert.deepStrictEqual(steps, [[0, true, 0], [0, false, 1]]);
    assert.equal(byId(d, 'A').level, 0);
    assert.equal(byId(d, 'A').lastResult, 'fail');
  });

  test('completeCard：骨架被清掉時夾值，session.stage 3 的 B 一次 pass 就結束', () => {
    const { d, steps } = ladder([SB], sessionOf(['B'], 0, 3, false), ['pass']);
    assert.deepStrictEqual(steps, [[0, false, 1]]);
    assert.equal(byId(d, 'B').level, 1);
  });

  test('completeCard：夾值時 retry 視為 false，第一個 fail 把夾過的 stage 2 寫回 session', () => {
    const { d, steps } = ladder([SB], sessionOf(['B'], 0, 3, true), ['fail', 'fail']);
    assert.deepStrictEqual(steps, [[2, true, 0], [0, false, 1]]);
    assert.equal(byId(d, 'B').level, 0);
    assert.equal(byId(d, 'B').lastResult, 'fail');
  });

  test('completeCard：議題應用重試時 reps 不變、retry 設為 true，cardTopic 從「甲」換成「乙」', () => {
    let d = deepFreeze(appDataWith({ sentences: [SC], session: sessionOf(['C'], 0, 2, false) }));
    d = deepFreeze(completeCard(d, 'pass'));
    const first = currentCard(d);
    assert.deepStrictEqual([first.stage, first.retry, first.sentence.reps], [3, false, 3]);
    assert.equal(cardTopic(first.sentence, first.retry), '甲');
    d = deepFreeze(completeCard(d, 'fail'));
    const second = currentCard(d);
    assert.deepStrictEqual([second.stage, second.retry, second.sentence.reps], [3, true, 3]);
    assert.equal(d.session.retry, true);
    assert.equal(cardTopic(second.sentence, second.retry), '乙');
  });

  test('completeCard：以 session.day 當作今天，session.day 為 2026-10-13 時 lastSeen 也是 2026-10-13', () => {
    const { d } = ladder([SC], { ...sessionOf(['C'], 0, 2, false), day: '2026-10-13' }, ['pass', 'pass']);
    assert.equal(byId(d, 'C').lastSeen, '2026-10-13');
    assert.deepStrictEqual(d.doneDays, ['2026-10-13']);
  });

  test('completeCard：最後一句結束時加入 doneDays，原本就有這一天時不重複', () => {
    const { d } = ladder([SC], sessionOf(['C'], 0, 2, false), ['pass', 'pass'], ['2026-10-13', TODAY]);
    assert.deepStrictEqual(d.doneDays, ['2026-10-13', TODAY]);
  });
}

// ---- extendSession、remainingToday、todayStatus（6.4、7.5、10.5） ----
{
  // a 到 e 是今天已經做完的五句；f 是 reps 2、level 1、今天到期的舊句；g 是新句。dailyCount 5
  const five = ['a', 'b', 'c', 'd', 'e'].map((id) => makeSentence({ id, text: 'Sentence ' + id + ' is here.' }));
  const f = makeSentence({ id: 'f', text: 'Sentence f is due today.', reps: 2, level: 1, due: TODAY, lastSeen: '2026-10-13', lastResult: 'pass' });
  const g = makeSentence({ id: 'g', text: 'Sentence g is brand new.' });
  const SEVEN = [...five, f, g];
  const IDS5 = ['a', 'b', 'c', 'd', 'e'];
  const PASS5 = ['pass', 'pass', 'pass', 'pass', 'pass'];
  const fixture = (session, doneDays = [TODAY], dailyCount = 5) => deepFreeze(appDataWith({
    settings: { dailyCount, lastExport: null }, sentences: SEVEN, doneDays, session,
  }));
  const doneToday = () => fixture(sessionOf(IDS5, 5, 0, false, PASS5));

  test('extendSession：今天的 session 做完時接上 pickToday 對剩下句子的結果，stage 為第一句的 startStage', () => {
    const d = doneToday();
    const r = extendSession(d, TODAY);
    assert.deepStrictEqual(r.session, sessionOf([...IDS5, 'f', 'g'], 5, 1, false, PASS5));
    assert.deepStrictEqual(r.doneDays, [TODAY]);
    assert.equal(r.sentences, d.sentences);
  });

  test('extendSession：沒有剩餘句、不是今天、還沒做完、session 為 null 時回傳同一個物件', () => {
    const all = fixture(sessionOf([...IDS5, 'f', 'g'], 7, 0, false, [...PASS5, 'pass', 'pass']));
    assert.equal(extendSession(all, TODAY), all);
    const old = fixture({ ...sessionOf(IDS5, 5, 0, false, PASS5), day: '2026-10-13' });
    assert.equal(extendSession(old, TODAY), old);
    const midway = fixture(sessionOf(IDS5, 3, 0, false, ['pass', 'pass', 'pass']));
    assert.equal(extendSession(midway, TODAY), midway);
    const none = fixture(null);
    assert.equal(extendSession(none, TODAY), none);
    // 呼叫端接著 startOrResumeSession：沒有 session 時新建一批
    assert.deepStrictEqual(startOrResumeSession(none, TODAY).session.ids, pickToday(SEVEN, TODAY, 5));
  });

  test('extendSession：數量是呼叫當下的 dailyCount，dailyCount 1 時只接上 f；最後一句還在做時回傳同一個物件', () => {
    const d1 = fixture(sessionOf(IDS5, 5, 0, false, PASS5), [TODAY], 1);
    const r1 = extendSession(d1, TODAY);
    assert.deepStrictEqual(r1.session.ids, [...IDS5, 'f']);
    assert.deepStrictEqual(r1.session, sessionOf([...IDS5, 'f'], 5, 1, false, PASS5));
    const last = fixture(sessionOf(IDS5, 4, 0, false, ['pass', 'pass', 'pass', 'pass']));
    assert.equal(extendSession(last, TODAY), last);
  });

  test('remainingToday：沒有 session 為 7，今天的 session 用掉 5 句為 2，舊 session 為 7，加練後為 0，刪掉 f 後為 1', () => {
    assert.equal(remainingToday(fixture(null), TODAY), 7);
    assert.equal(remainingToday(doneToday(), TODAY), 2);
    assert.equal(remainingToday(fixture({ ...sessionOf(IDS5, 5, 0, false, PASS5), day: '2026-10-13' }), TODAY), 7);
    assert.equal(remainingToday(extendSession(doneToday(), TODAY), TODAY), 0);
    assert.equal(remainingToday(deleteSentence(doneToday(), 'f', TODAY), TODAY), 1);
  });

  test('todayStatus：10.5 表格的九列（含 remaining）', () => {
    const status = (d) => todayStatus(d, TODAY);
    const st = (kind, done, total, remaining) => ({ kind, done, total, remaining });
    assert.deepStrictEqual(status(deepFreeze(appDataWith())), st('empty', 0, 0, 0));
    assert.deepStrictEqual(status(fixture(null, [])), st('start', 0, 5, 7));
    assert.deepStrictEqual(status(fixture({ ...sessionOf(IDS5, 2, 0, false, ['pass', 'pass']), day: '2026-10-13' }, [])), st('start', 0, 5, 7));
    assert.deepStrictEqual(status(fixture(sessionOf(IDS5, 2, 0, false, ['pass', 'pass']), [])), st('continue', 2, 5, 2));
    assert.deepStrictEqual(status(fixture(sessionOf(IDS5, 2, 0, false, ['pass', 'pass']), [], 10)), st('continue', 2, 5, 2));
    assert.deepStrictEqual(status(doneToday()), st('done', 5, 5, 2));
    assert.deepStrictEqual(status(extendSession(doneToday(), TODAY)), st('continue', 5, 7, 0));
    assert.deepStrictEqual(status(fixture(sessionOf([...IDS5, 'f', 'g'], 7, 0, false, [...PASS5, 'pass', 'pass']))), st('done', 7, 7, 0));
    assert.deepStrictEqual(status(fixture(null)), st('done', 5, 5, 7));
  });

  test('todayStatus：今天的 session 已做完但 doneDays 沒有今天時是 start；doneDays 有今天、句數少於每日句數時 total 是句數', () => {
    assert.deepStrictEqual(todayStatus(fixture(sessionOf(IDS5, 5, 0, false, PASS5), []), TODAY),
      { kind: 'start', done: 0, total: 5, remaining: 2 });
    const two = deepFreeze(appDataWith({ sentences: [SA, SB], doneDays: [TODAY] }));
    assert.deepStrictEqual(todayStatus(two, TODAY), { kind: 'done', done: 2, total: 2, remaining: 2 });
  });

  test('extendSession：加練一批做到一半，同一天再開始時繼續同一張；做完 doneDays 不重複；remaining 為 0 時不能再加練', () => {
    let d = deepFreeze(extendSession(doneToday(), TODAY));
    d = deepFreeze(completeCard(d, 'pass'));                       // f 從首字母提示通過，進到背誦
    assert.deepStrictEqual([d.session.index, d.session.stage, d.session.retry], [5, 2, false]);
    const resumed = startOrResumeSession(d, TODAY);                // 結束 app 再回來
    assert.deepStrictEqual(resumed, d);
    assert.deepStrictEqual(currentCard(resumed), { sentence: f, stage: 2, retry: false });
    while (currentCard(d) !== null) d = deepFreeze(completeCard(d, 'pass'));
    assert.deepStrictEqual(d.doneDays, [TODAY]);
    assert.equal(remainingToday(d, TODAY), 0);
    assert.equal(extendSession(d, TODAY), d);
    assert.deepStrictEqual(todayStatus(d, TODAY), { kind: 'done', done: 7, total: 7, remaining: 0 });
  });
}

// ---- mergeSeed（7.5、10.5 的表格） ----
{
  const T3 = ['甲', '乙', '丙'];
  const SEED6 = deepFreeze([
    { id: 's01', frame: 'In this paper, we propose {a new method}.', zh: '本文提出一個新方法。', topics: T3 },
    { id: 's02', frame: 'The results show that {the method works}.', zh: '結果顯示方法有效。', topics: T3 },
    { id: 's03', frame: '{Formal verification} is not a substitute for {testing}.', zh: '形式驗證不能取代測試。', topics: T3 },
    { id: 's04', frame: 'To address this issue, we propose {a simple yet effective method}.', zh: '為了解決這個問題。', topics: T3 },
    { id: 's05', frame: 'The key takeaway is that {simple rules work}.', zh: '重點是簡單的規則有效。', topics: T3 },
    { id: 's06', frame: 'We propose {a simple method}.', zh: '我們提出一個簡單的方法。', topics: T3 },
  ]);
  const m01 = makeSentence({ id: 's01', text: 'In this paper, we propose a new method.', zh: '', level: 1, reps: 2,
    due: '2026-10-15', lastSeen: TODAY, lastResult: 'pass' });
  const m02 = makeSentence({ id: 's02', text: 'The results show that it works.' });
  const m03 = makeSentence({ id: 's03', text: 'Formal verification is not a substitute for testing.',
    frame: '{Formal verification} is not a {substitute} for testing.' });
  const m06 = makeSentence({ id: 's06', text: 'We propose a simple method.', topics: ['我的議題'] });
  const mu1 = makeSentence({ id: 'u1', text: 'To address this issue, we propose a simple yet effective method.' });
  const base = () => deepFreeze(appDataWith({
    settings: { dailyCount: 15, lastExport: '2026-10-01' },
    sentences: [m01, m02, m03, m06, mu1],
    doneDays: ['2026-10-13'],
    removedSeeds: ['s05'],
    session: sessionOf(['s01'], 0, 1, true),
  }));

  test('mergeSeed：10.5 表格的六種情況，added 1、updated 2', () => {
    const d = base();
    const r = mergeSeed(d, SEED6);
    assert.equal(r.added, 1);
    assert.equal(r.updated, 2);
    assert.deepStrictEqual(r.data.sentences, [
      { ...m01, zh: '本文提出一個新方法。', frame: 'In this paper, we propose {a new method}.', topics: T3 },
      m02,
      m03,
      { ...m06, frame: 'We propose {a simple method}.' },
      mu1,
      { id: 's04', text: mu1.text, zh: '為了解決這個問題。', frame: 'To address this issue, we propose {a simple yet effective method}.',
        topics: T3, level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
    ]);
    assert.deepStrictEqual({ ...r.data, sentences: d.sentences }, d);   // session、settings、doneDays、removedSeeds 不變
    assert.notEqual(r.data.sentences[5].topics, SEED6[3].topics);
    assert.notEqual(r.data.sentences[0].topics, SEED6[0].topics);
  });

  test('mergeSeed：有 zh 的同 id 句子補骨架時 zh 不被覆蓋', () => {
    const d = deepFreeze(appDataWith({ sentences: [{ ...m01, zh: '我自己的翻譯' }] }));
    const r = mergeSeed(d, [SEED6[0]]);
    assert.equal(r.updated, 1);
    assert.equal(r.data.sentences[0].zh, '我自己的翻譯');
    assert.equal(r.data.sentences[0].frame, 'In this paper, we propose {a new method}.');
  });

  test('mergeSeed：對結果再呼叫一次 added 0、updated 0，內容相同，s05 仍然沒有加回來', () => {
    const once = deepFreeze(mergeSeed(base(), SEED6).data);
    const twice = mergeSeed(once, SEED6);
    assert.equal(twice.added, 0);
    assert.equal(twice.updated, 0);
    assert.deepStrictEqual(twice.data, once);
    assert.equal(twice.data.sentences.some((s) => s.id === 's05'), false);
  });

  test('mergeSeed：英文只差首字母大小寫時不補骨架（text 比對區分大小寫），updated 0、句子不變', () => {
    const lower = { ...m01, text: 'in this paper, we propose a new method.' };
    const d = deepFreeze(appDataWith({ sentences: [lower] }));
    const r = mergeSeed(d, [SEED6[0]]);
    assert.deepStrictEqual([r.added, r.updated], [0, 0]);
    assert.deepStrictEqual(r.data.sentences, [lower]);
  });

  test('mergeSeed：id 在 removedSeeds 裡、句子庫仍有同 id 而 frame 為空字串的句子時整項跳過，不補骨架', () => {
    const d = deepFreeze(appDataWith({ sentences: [m01], removedSeeds: ['s01'] }));
    const r = mergeSeed(d, [SEED6[0]]);
    assert.deepStrictEqual([r.added, r.updated], [0, 0]);
    assert.deepStrictEqual(r.data.sentences, [m01]);
  });

  test('mergeSeed：內建句的骨架不合格時丟出和 createInitialData 相同的 Error', () => {
    const bad = deepFreeze([{ id: 's09', frame: 'we propose a method.', zh: '', topics: [] }]);
    assert.throws(() => mergeSeed(base(), bad), { name: 'Error', message: '內建句 s09 的骨架不合格：至少要有一組大括號' });
  });
}

// ---- upgradeV1 與 sanitizeData（7.4、10.5） ----
{
  const V1_IDS = Array.from({ length: 55 }, (_, i) => 's' + String(i + 1).padStart(2, '0'));
  const v1Sentence = (id) => ({ id, text: 'Sentence ' + id + ' here.', zh: '', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 });

  test('upgradeV1：每句加上 frame 與 topics，schema 2、session null，removedSeeds 是 s01 到 s55 中沒有的 id，不修改輸入', () => {
    const raw = deepFreeze({
      schema: 1,
      settings: { dailyCount: 10, lastExport: null },
      sentences: [v1Sentence('s03'), 'x'],
      doneDays: [],
      session: { day: TODAY, ids: ['s03'], index: 0, results: [] },
    });
    const r = upgradeV1(raw);
    assert.equal(r.schema, 2);
    assert.deepStrictEqual(r.sentences, [{ ...v1Sentence('s03'), frame: '', topics: [] }, 'x']);
    assert.equal(r.session, null);
    assert.deepStrictEqual(r.removedSeeds, V1_IDS.filter((id) => id !== 's03'));
    assert.equal(r.removedSeeds.length, 54);
    assert.deepStrictEqual(r.settings, raw.settings);
  });

  test('upgradeV1：sentences 含 s01 到 s55 全部時 removedSeeds 為空；少 s07 與 s41、再加 u1 時為 [s07, s41]', () => {
    const all = deepFreeze({ schema: 1, sentences: V1_IDS.map(v1Sentence) });
    assert.deepStrictEqual(upgradeV1(all).removedSeeds, []);
    const some = deepFreeze({ schema: 1, sentences: [...V1_IDS.filter((id) => id !== 's07' && id !== 's41').map(v1Sentence), v1Sentence('u1')] });
    assert.deepStrictEqual(upgradeV1(some).removedSeeds, ['s07', 's41']);
  });

  test('sanitizeData：schema 1 的資料升級成第 2 版，進度保留、session 為 null、warnings 為空；含一個字串元素時產生一條 warning', () => {
    const practiced = { ...v1Sentence('s02'), level: 1, streak: 1, due: '2026-10-15', lastSeen: TODAY, lastResult: 'pass', reps: 2 };
    const raw = deepFreeze({
      schema: 1,
      settings: { dailyCount: 15, lastExport: '2026-10-01' },
      sentences: [v1Sentence('s01'), practiced, v1Sentence('u1')],
      doneDays: [TODAY],
      session: { day: TODAY, ids: ['s01', 's02'], index: 1, results: ['pass'] },
    });
    assert.deepStrictEqual(sanitizeData(raw), {
      data: {
        schema: 2,
        settings: { dailyCount: 15, lastExport: '2026-10-01' },
        sentences: [{ ...v1Sentence('s01'), frame: '', topics: [] }, { ...practiced, frame: '', topics: [] }, { ...v1Sentence('u1'), frame: '', topics: [] }],
        doneDays: [TODAY],
        removedSeeds: V1_IDS.filter((id) => id !== 's01' && id !== 's02'),
        session: null,
      },
      warnings: [],
    });
    const withString = deepFreeze({ ...raw, sentences: [...raw.sentences, 'x'] });
    assert.deepStrictEqual(sanitizeData(withString).warnings, ['有 1 句資料不完整，或含有英文鍵盤打不出的字元，已略過']);
  });

  test('sanitizeData：removedSeeds 不是陣列時為空陣列；只保留內建句 id 的格式、去重並依數字排序，不產生 warning', () => {
    for (const removedSeeds of [undefined, null, 's07']) {
      const res = sanitizeData(deepFreeze(rawAppData({ removedSeeds })));
      assert.deepStrictEqual(res.data.removedSeeds, []);
      assert.deepStrictEqual(res.warnings, []);
    }
    const res = sanitizeData(deepFreeze(rawAppData({ removedSeeds: ['s10', 's02', 'u1', 's02', 3, 's100', 's7', 'S05'] })));
    assert.deepStrictEqual(res.data.removedSeeds, ['s02', 's10', 's100']);
    assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ removedSeeds: ['s100', 's99'] }))).data.removedSeeds, ['s99', 's100']);
    assert.deepStrictEqual(res.warnings, []);
  });

  test('sanitizeData：frame 不是字串、不成對、去掉大括號後與 text 不同（區分大小寫）時為空字串；內側空白經 normalizeFrame 整理；都不產生 warning', () => {
    const rows = [
      [5, ''],
      [null, ''],
      [SA.frame, SA.frame],
      ['To address this issue, we propose { a simple yet effective method}.', SA.frame],
      ['To address this issue, we propose {a plan}.', ''],
      ['we propose {a method.', ''],
      ['to address this issue, we propose {a simple yet effective method}.', ''],
    ];
    const input = deepFreeze(rawAppData({ sentences: rows.map(([frame], i) => ({ ...SA, id: 'f' + i, frame })) }));
    const res = sanitizeData(input);
    assert.deepStrictEqual(res.data.sentences.map((s) => s.frame), rows.map(([, want]) => want));
    assert.deepStrictEqual(res.warnings, []);
  });

  test('sanitizeData：topics 只保留 trim 後非空、40 字以內（恰好 40 字保留）的字串，最多 6 個；不是陣列時為空陣列', () => {
    const res = sanitizeData(deepFreeze(rawAppData({ sentences: [
      { ...SB, id: 't1', topics: [' 甲 ', '', 3, 'x'.repeat(41), 'x'.repeat(40), '乙'] },
      { ...SB, id: 't2', topics: ['1', '2', '3', '4', '5', '6', '7', '8'] },
      { ...SB, id: 't3', topics: '甲' },
    ] })));
    assert.deepStrictEqual(res.data.sentences.map((s) => s.topics), [['甲', 'x'.repeat(40), '乙'], ['1', '2', '3', '4', '5', '6'], []]);
    assert.deepStrictEqual(res.warnings, []);
  });

  test('sanitizeData：session 的 stage 與 retry 不合法時為 null；stage 3、retry true 的合法 session 原樣保留', () => {
    const valid = sessionOf(['B'], 0, 3, true);
    for (const bad of [{ stage: 4 }, { stage: 1.5 }, { stage: '1' }, { stage: undefined }, { retry: 'true' }, { retry: 0 }, { retry: undefined }]) {
      const session = { ...valid, ...bad };
      const res = sanitizeData(deepFreeze(rawAppData({ sentences: [SB], session })));
      assert.equal(res.data.session, null, JSON.stringify(bad));
    }
    assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ sentences: [SB], session: valid }))).data.session, valid);
  });

  test('sanitizeData：未知欄位被丟掉（第 2 版）', () => {
    const input = deepFreeze({
      schema: 2,
      extra: true,
      settings: { dailyCount: 15, lastExport: '2026-10-01', theme: 'dark' },
      sentences: [{ ...SA, note: 'x' }],
      doneDays: ['2026-10-13'],
      removedSeeds: ['s07'],
      session: { ...sessionOf(['A'], 0, 0, false), extra: 1 },
    });
    assert.deepStrictEqual(sanitizeData(input), {
      data: {
        schema: 2,
        settings: { dailyCount: 15, lastExport: '2026-10-01' },
        sentences: [SA],
        doneDays: ['2026-10-13'],
        removedSeeds: ['s07'],
        session: sessionOf(['A'], 0, 0, false),
      },
      warnings: [],
    });
  });
}

// ---- toBackupJSON、fromBackupJSON（7.6、10.5） ----

test('toBackupJSON：去掉 session 的 AppData 加上檔頭，schema 2，removedSeeds 照存，用 JSON.stringify(payload, null, 2) 輸出', () => {
  const data = deepFreeze({ ...practicedData(), removedSeeds: ['s07'] });
  const text = toBackupJSON(data, TODAY, NOW_ISO);
  const obj = JSON.parse(text);
  assert.deepStrictEqual(Object.keys(obj), ['app', 'schema', 'exportedDay', 'exportedAt', 'settings', 'sentences', 'doneDays', 'removedSeeds']);
  assert.deepStrictEqual(obj, {
    app: 'phrase-drill', schema: 2, exportedDay: TODAY, exportedAt: NOW_ISO,
    settings: data.settings, sentences: data.sentences, doneDays: data.doneDays, removedSeeds: ['s07'],
  });
  assert.equal(text, JSON.stringify(obj, null, 2));
});

test('toBackupJSON 與 fromBackupJSON：來回轉換後等於原資料但 session 為 null，frame、topics、removedSeeds 保留，fromV1 為 false', () => {
  const data = deepFreeze({ ...practicedData(), removedSeeds: ['s07'] });
  assert.ok(data.sentences.every((s) => s.frame !== '' && s.topics.length === 3));
  assert.deepStrictEqual(fromBackupJSON(toBackupJSON(data, TODAY, NOW_ISO)), {
    ok: true,
    data: { ...data, session: null },
    warnings: [],
    summary: { sentences: 115, days: 2, exportedDay: TODAY, fromV1: false },
  });
});

test('fromBackupJSON：7.6 的每一種錯誤訊息（第 2 版）', () => {
  const header = { app: 'phrase-drill', schema: 2, exportedDay: TODAY, exportedAt: NOW_ISO };
  const one = [makeSentence()];
  const cases = [
    ['', '不是有效的 JSON'],
    ['{', '不是有效的 JSON'],
    ['[]', '這不是句練的備份檔'],
    ['null', '這不是句練的備份檔'],
    ['42', '這不是句練的備份檔'],
    [JSON.stringify({ ...header, app: 'other-app', sentences: one }), '這不是句練的備份檔'],
    [JSON.stringify({ schema: 2, settings: {}, doneDays: [] }), '這不是句練的備份檔'],
    [JSON.stringify({ ...header, schema: 3, sentences: one }), '備份來自較新版本，請先更新 app'],
    [JSON.stringify({ ...header, schema: 0, sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ ...header, schema: '2', sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ app: 'phrase-drill', sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ ...header, sentences: {} }), '備份內容無法讀取：sentences 不是陣列'],
    [JSON.stringify({ ...header, schema: 1, sentences: {} }), '備份內容無法讀取：sentences 不是陣列'],
    [JSON.stringify({ ...header, sentences: [] }), '備份裡沒有任何句子'],
    [JSON.stringify({ ...header, sentences: [makeSentence({ text: 'The error is 5 μm.' })] }), '備份裡沒有任何句子'],
  ];
  for (const [text, error] of cases) {
    assert.deepStrictEqual(fromBackupJSON(text), { ok: false, error }, text);
  }
});

test('fromBackupJSON：接受沒有檔頭的 AppData，summary.exportedDay 為 null、fromV1 為 false', () => {
  const data = practicedData();
  const res = fromBackupJSON(JSON.stringify(data));
  assert.equal(res.ok, true);
  assert.deepStrictEqual(res.data, { ...data, session: null });
  assert.deepStrictEqual(res.summary, { sentences: 115, days: 2, exportedDay: null, fromV1: false });
});

test('fromBackupJSON：第 1 版的備份（三句）升級成第 2 版，不執行 mergeSeed，removedSeeds 是 s03 到 s55，fromV1 為 true', () => {
  const v1 = (id, text) => ({ id, text, zh: '', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 });
  const text = JSON.stringify({
    app: 'phrase-drill', schema: 1, exportedDay: '2026-10-01', exportedAt: NOW_ISO,
    settings: { dailyCount: 10, lastExport: null },
    sentences: [v1('s01', 'First sentence here.'), v1('s02', 'Second sentence here.'), v1('u1', 'My own sentence.')],
    doneDays: ['2026-10-01'],
  });
  const res = fromBackupJSON(text);
  assert.equal(res.ok, true);
  assert.equal(res.data.schema, 2);
  assert.equal(res.data.sentences.length, 3);
  assert.ok(res.data.sentences.every((s) => s.frame === '' && s.topics.length === 0));
  assert.deepStrictEqual(res.data.removedSeeds, Array.from({ length: 53 }, (_, i) => 's' + String(i + 3).padStart(2, '0')));
  assert.deepStrictEqual(res.summary, { sentences: 3, days: 1, exportedDay: '2026-10-01', fromV1: true });
});

test('fromBackupJSON：補齊缺欄位、夾住 level、丟棄重複 id 與含 μ 的句子（第 2 版）', () => {
  const text = JSON.stringify({
    app: 'phrase-drill', schema: 2, exportedDay: '2026-10-01', exportedAt: '2026-10-01T01:00:00.000Z',
    settings: { dailyCount: 15, lastExport: '2026-10-01' },
    sentences: [
      { id: 'a1', text: 'Only id and text here.' },
      { id: 'a2', text: 'Level seven is clamped.', zh: '層級被夾住', level: 7, streak: 1, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass', reps: 3 },
      { id: 'a1', text: 'Duplicate id is dropped.' },
      { id: 'a3', text: 'The error is 5 μm.' },
      { id: 'a4', text: 'Bad 5 μm comes first.' },
      { id: 'a4', text: 'Good one comes second.' },
    ],
    doneDays: ['2026-09-30', '2026-10-01'],
  });
  const res = fromBackupJSON(text);
  assert.deepStrictEqual(res.data.sentences, [
    makeSentence({ id: 'a1', text: 'Only id and text here.', zh: '' }),
    makeSentence({ id: 'a2', text: 'Level seven is clamped.', zh: '層級被夾住', level: 2, streak: 1, due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass', reps: 3 }),
    makeSentence({ id: 'a4', text: 'Good one comes second.', zh: '' }),
  ]);
  assert.deepStrictEqual(res.data.removedSeeds, []);
  assert.deepStrictEqual(res.warnings, ['有 3 句資料不完整，或含有英文鍵盤打不出的字元，已略過']);
  assert.deepStrictEqual(res.summary, { sentences: 3, days: 2, exportedDay: '2026-10-01', fromV1: false });
});

// ---- load 的升級分支、readUndo 的升級（7.3、7.6、10.5），以及刪過或改過內建句的第 1 版資料 ----
{
  // 第 1 版格式的資料：s01 到 s55 中留下 keep 回傳 true 的句子，text 與 zh 取自 SEED 導出的值；
  // 前三句練過（level 1、reps 1），帶一個進行中的 session。edit 可以改掉某些句子的英文
  const v1Data = (keep = () => true, edit = {}) => ({
    schema: 1,
    settings: { dailyCount: 10, lastExport: null },
    sentences: SEED.slice(0, 55).filter((item) => keep(item.id)).map((item, i) => ({
      id: item.id,
      text: edit[item.id] || normalizeFrame(item.frame).text,
      zh: item.zh,
      level: i < 3 ? 1 : 0, streak: 0, due: i < 3 ? '2026-10-15' : null, lastSeen: i < 3 ? TODAY : null,
      lastResult: i < 3 ? 'pass' : null, reps: i < 3 ? 1 : 0,
    })),
    doneDays: [TODAY],
    session: { day: TODAY, ids: ['s04', 's05'], index: 0, results: [] },
  });
  const upgradeMessage = (added, updated) => '資料格式已更新為第 2 版，並補入內建句型：加入 ' + added + ' 句、補上 ' + updated + ' 句的句型';

  test('load：第 1 版的 55 句資料升級成第 2 版，進度不變、補上骨架與議題、追加 s56 到 s115，再 load 一次所有 key 不變', () => {
    const raw = JSON.stringify(v1Data());
    const storage = new FakeStorage();
    storage.setItem(DATA_KEY, raw);
    const res = load(storage, SEED, NOW_ISO);
    assert.equal(res.status, 'ok');
    assert.deepStrictEqual(res.warnings, [upgradeMessage(60, 55)]);
    const d = res.data;
    assert.equal(d.schema, 2);
    assert.equal(d.session, null);
    assert.deepStrictEqual(d.removedSeeds, []);
    assert.deepStrictEqual(d.doneDays, [TODAY]);
    assert.equal(d.sentences.length, 115);
    const v1 = v1Data().sentences;
    d.sentences.forEach((s, i) => {
      const t = normalizeFrame(SEED[i].frame);
      assert.equal(s.id, SEED[i].id);
      assert.equal(s.frame, t.frame, s.id);
      assert.deepStrictEqual(s.topics, SEED[i].topics, s.id);
      if (i < 55) assert.deepStrictEqual(s, { ...v1[i], frame: t.frame, topics: SEED[i].topics }, s.id);
      else assert.deepStrictEqual(s, createInitialData(SEED).sentences[i], s.id);
    });
    assert.deepStrictEqual(JSON.parse(storage.getItem(DATA_KEY)), d);
    assert.equal(storage.getItem(CORRUPT_KEY), null);
    const before = storageSnapshot(storage);
    assert.deepStrictEqual(load(storage, SEED, NOW_ISO), { status: 'ok', data: d, warnings: [] });
    assert.deepStrictEqual(storageSnapshot(storage), before);
  });

  test('load：升級時保留刪過的內建句，少了 s07 時句數 114、removedSeeds 為 [s07]、補上 54 句的句型', () => {
    const storage = new FakeStorage();
    storage.setItem(DATA_KEY, JSON.stringify(v1Data((id) => id !== 's07')));
    const res = load(storage, SEED, NOW_ISO);
    assert.deepStrictEqual(res.warnings, [upgradeMessage(60, 54)]);
    assert.equal(res.data.sentences.length, 114);
    assert.equal(res.data.sentences.some((s) => s.id === 's07'), false);
    assert.deepStrictEqual(res.data.removedSeeds, ['s07']);
  });

  test('load：升級加上丟棄句子時，warnings 依序是丟棄、升級、原始資料已另存，corrupt key 存原字串', () => {
    const data = v1Data();
    const raw = JSON.stringify({ ...data, sentences: [...data.sentences, { id: 'u1', text: 'The error is 5 μm.' }] });
    const storage = new FakeStorage();
    storage.setItem(DATA_KEY, raw);
    const res = load(storage, SEED, NOW_ISO);
    assert.deepStrictEqual(res.warnings, [
      '有 1 句資料不完整，或含有英文鍵盤打不出的字元，已略過',
      upgradeMessage(60, 55),
      '原始資料已另存，可到『設定 > 診斷』複製',
    ]);
    assert.deepStrictEqual(JSON.parse(storage.getItem(CORRUPT_KEY)), { at: NOW_ISO, raw });
    assert.deepStrictEqual(JSON.parse(storage.getItem(DATA_KEY)), res.data);
  });

  test('readUndo：undo 內容是第 1 版的資料時，回傳升級後的資料，句數不變（不執行 mergeSeed）', () => {
    const storage = new FakeStorage();
    storage.setItem(UNDO_KEY, JSON.stringify({ at: NOW_ISO, reason: 'import', json: JSON.stringify(v1Data()) }));
    const u = readUndo(storage);
    assert.equal(u.data.schema, 2);
    assert.equal(u.data.sentences.length, 55);
    assert.ok(u.data.sentences.every((s) => s.frame === ''));
    assert.equal(u.data.session, null);
  });

  test('load：刪過 s03 與 s10、又改過 s20 英文的第 1 版資料，升級後只補沒改過的 52 句，再補入一次 added 0、updated 0', () => {
    const edited = 'This sentence was edited by the user.';
    const storage = new FakeStorage();
    storage.setItem(DATA_KEY, JSON.stringify(v1Data((id) => id !== 's03' && id !== 's10', { s20: edited })));
    const res = load(storage, SEED, NOW_ISO);
    assert.deepStrictEqual(res.data.removedSeeds, ['s03', 's10']);
    assert.deepStrictEqual(res.warnings, [upgradeMessage(60, 52)]);
    const s20 = res.data.sentences.find((s) => s.id === 's20');
    assert.deepStrictEqual([s20.text, s20.frame, s20.topics], [edited, '', []]);
    assert.equal(res.data.sentences.filter((s) => s.frame !== '').length, 52 + 60);
    assert.equal(res.data.sentences.length, 53 + 60);
    const again = mergeSeed(deepFreeze(res.data), SEED);
    assert.deepStrictEqual([again.added, again.updated], [0, 0]);
    assert.deepStrictEqual(again.data, res.data);
  });
}

test('completeCard：練習途中拿掉目前這句的骨架，議題應用卡夾回背誦，一次 pass 就結束，不會卡住或丟出例外', () => {
  let d = deepFreeze(appDataWith({ sentences: [SC, SA], session: sessionOf(['C', 'A'], 0, 3, true) }));
  d = deepFreeze(updateSentence(d, 'C', deepFreeze({ text: SC.text, zh: SC.zh, frame: '', topics: SC.topics }), TODAY));
  assert.deepStrictEqual(d.session, sessionOf(['C', 'A'], 0, 3, true));
  const card = currentCard(d);
  assert.deepStrictEqual([card.stage, card.retry], [2, false]);
  d = deepFreeze(completeCard(d, 'pass'));
  assert.deepStrictEqual([d.session.index, d.session.stage, d.session.retry], [1, 0, false]);
  assert.equal(d.sentences[0].streak, 2);
  assert.deepStrictEqual(sanitizeData(d), { data: d, warnings: [] });
});

test('deleteSentence：練習途中刪掉目前這句，換到下一句並從它的 startStage 開始', () => {
  let d = deepFreeze(appDataWith({ sentences: [SA, SC, SB], session: sessionOf(['A', 'C', 'B'], 0, 3, true) }));
  d = deepFreeze(deleteSentence(d, 'A', TODAY));
  assert.deepStrictEqual(currentCard(d), { sentence: SC, stage: 2, retry: false });
  d = deepFreeze(startOrResumeSession(d, TODAY));
  assert.deepStrictEqual(d.session, sessionOf(['C', 'B'], 0, 2, false));
  assert.doesNotThrow(() => completeCard(d, 'pass'));
});
