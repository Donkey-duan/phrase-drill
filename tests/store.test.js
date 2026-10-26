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
    schema: 1,
    settings: { dailyCount: 10, lastExport: null },
    sentences: [],
    doneDays: [],
    session: null,
    ...overrides,
  };
}

test('store 常數與規格 7.7 相同', () => {
  assert.equal(SCHEMA, 1);
  assert.equal(DATA_KEY, 'phrase-drill:data');
  assert.equal(UNDO_KEY, 'phrase-drill:undo');
  assert.equal(CORRUPT_KEY, 'phrase-drill:corrupt');
  assert.deepEqual(DAILY_OPTIONS, [5, 10, 15, 20, 25, 30]);
  assert.equal(DEFAULT_DAILY, 10);
  assert.equal(BACKUP_REMIND_DAYS, 14);
  assert.equal(MAX_TEXT_LENGTH, 300);
  assert.equal(MAX_ZH_LENGTH, 200);
});

test('createInitialData：schema 1、dailyCount 10、lastExport null，句子都是初始進度', () => {
  const seed = deepFreeze([
    { id: 's01', text: 'Alpha beta gamma.', zh: '甲乙丙' },
    { id: 's02', text: 'Delta epsilon.', zh: '' },
  ]);
  assert.deepEqual(createInitialData(seed), {
    schema: 1,
    settings: { dailyCount: 10, lastExport: null },
    sentences: [
      { id: 's01', text: 'Alpha beta gamma.', zh: '甲乙丙', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
      { id: 's02', text: 'Delta epsilon.', zh: '', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
    ],
    doneDays: [],
    session: null,
  });
});

test('createInitialData(SEED)：依 SEED 的順序收進全部句子', () => {
  const d = createInitialData(deepFreeze(SEED));
  assert.equal(d.sentences.length, SEED.length);
  for (const [i, s] of d.sentences.entries()) {
    assert.deepEqual(s, {
      id: SEED[i].id, text: SEED[i].text, zh: SEED[i].zh,
      level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0,
    });
  }
});

test('validateSentenceInput：空字串與只有空白', () => {
  const d = deepFreeze(appDataWith());
  const empty = { ok: false, field: 'text', error: '請輸入英文句子' };
  assert.deepEqual(validateSentenceInput(d, '', '', null), empty);
  assert.deepEqual(validateSentenceInput(d, '   ', '', null), empty);
  assert.deepEqual(validateSentenceInput(d, ' \n\t\u3000\u00A0 ', '', null), empty);
});

test('validateSentenceInput：英文鍵盤打不出的字元依出現順序各自包在「」裡', () => {
  const d = deepFreeze(appDataWith());
  // μ 是 U+03BC（希臘字母 mu），± 是 U+00B1
  assert.deepEqual(validateSentenceInput(d, 'The error is 5 μm ± 2.', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「μ」「±」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'Ring \u0007 bell.', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「U+0007」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'Ring \u0007 at 5 μm.', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「U+0007」「μ」，請改寫' });
  assert.deepEqual(validateSentenceInput(d, 'From 5 μm to 6 μm.', '', null),
    { ok: false, field: 'text', error: '有英文鍵盤打不出的字元：「μ」，請改寫' });
});

test('validateSentenceInput：看不見或無法單獨顯示的字元寫成大寫補滿 4 碼的 U+XXXX', () => {
  const d = deepFreeze(appDataWith());
  const error = (text) => validateSentenceInput(d, text, '', null).error;
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
  assert.deepEqual(validateSentenceInput(d, '123 456', '', null),
    { ok: false, field: 'text', error: '英文句子至少要有一個英文字母' });
  assert.deepEqual(validateSentenceInput(d, 'Hello.', '', null),
    { ok: false, field: 'text', error: '請輸入至少兩個字的句子' });
});

test('validateSentenceInput：超過 300 字元', () => {
  const d = deepFreeze(appDataWith());
  const tooLong = 'word '.repeat(60) + 'x';             // canonical 之後 301 字元、61 個字
  assert.equal(tooLong.length, 301);
  assert.deepEqual(validateSentenceInput(d, tooLong, '', null),
    { ok: false, field: 'text', error: '英文句子請在 300 字元以內' });
  const exact = 'word '.repeat(59) + 'abcde';           // 剛好 300 字元
  assert.equal(exact.length, 300);
  assert.equal(validateSentenceInput(d, exact, '', null).ok, true);
});

test('validateSentenceInput：與其他句子不分大小寫相同時判為重複，編輯句子本身時不算', () => {
  const d = deepFreeze(appDataWith({
    sentences: [
      makeSentence({ id: 'a1', text: "It's fine here." }),
      makeSentence({ id: 'b2', text: 'Another one here.' }),
    ],
  }));
  const dup = { ok: false, field: 'text', error: '句子庫裡已經有相同的句子' };
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', null), dup);
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', 'b2'), dup);
  assert.deepEqual(validateSentenceInput(d, 'it’s FINE here.', '', 'a1'),
    { ok: true, text: "it's FINE here.", zh: '' });
});

test('validateSentenceInput：zh 在 trim 後超過 200 字', () => {
  const d = deepFreeze(appDataWith());
  assert.deepEqual(validateSentenceInput(d, 'Two words.', '中'.repeat(201), null),
    { ok: false, field: 'zh', error: '中文意思請在 200 字以內' });
  assert.deepEqual(validateSentenceInput(d, 'Two words.', '  ' + '中'.repeat(200) + '  ', null),
    { ok: true, text: 'Two words.', zh: '中'.repeat(200) });
});

test('validateSentenceInput：通過時回傳 canonical 英文與 trim 後的中文', () => {
  const d = deepFreeze(appDataWith());
  assert.deepEqual(validateSentenceInput(d, '  it’s “fine”  here.  ', '  很好  ', null),
    { ok: true, text: 'it\'s "fine" here.', zh: '很好' });
});

test('validateSentenceInput：依 7.5 的順序回傳第一個成立的錯誤', () => {
  const d = deepFreeze(appDataWith({ sentences: [makeSentence({ id: 'a1', text: 'Two words.' })] }));
  const error = (text, zh) => validateSentenceInput(d, text, zh, null).error;
  assert.equal(error('μ', ''), '有英文鍵盤打不出的字元：「μ」，請改寫');      // 2 先於 3、4
  assert.equal(error('123', ''), '英文句子至少要有一個英文字母');             // 3 先於 4
  assert.equal(error('a'.repeat(301), ''), '請輸入至少兩個字的句子');        // 4 先於 5
  assert.equal(error('two WORDS.', '中'.repeat(201)), '句子庫裡已經有相同的句子'); // 6 先於 7
  assert.equal(error('Hello.', '中'.repeat(201)), '請輸入至少兩個字的句子');  // text 的錯誤先於 zh
});

test('seed：每一句對其他句子都通過 validateSentenceInput', () => {
  const d = deepFreeze(createInitialData(SEED));
  for (const s of SEED) {
    assert.deepEqual(validateSentenceInput(d, s.text, s.zh, s.id), { ok: true, text: s.text, zh: s.zh }, s.id);
  }
});

test('addSentence：新句插在最前面、進度是初始值，text 會 canonicalize、zh 會 trim', () => {
  const old = makeSentence({ id: 's01', text: 'Old one here.', level: 1, streak: 1, due: '2026-10-15', lastSeen: TODAY, lastResult: 'pass', reps: 2 });
  const d = deepFreeze(appDataWith({ sentences: [old], doneDays: ['2026-10-13'] }));
  const r = addSentence(d, deepFreeze({ id: 'u1', text: 'it’s “fine”  here.', zh: '  很好  ' }));
  assert.deepEqual(r.sentences, [
    { id: 'u1', text: 'it\'s "fine" here.', zh: '很好', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
    old,
  ]);
  assert.deepEqual({ ...r, sentences: d.sentences }, d);      // sentences 以外的欄位不變
});

test('updateSentence：只改中文時進度不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const other = makeSentence({ id: 'x2', text: 'Other one here.' });
  const d = deepFreeze(appDataWith({ sentences: [s, other] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: "It's fine here.", zh: '  很好  ' }), TODAY);
  assert.deepEqual(r, { ...d, sentences: [{ ...s, zh: '很好' }, other] });
});

test('updateSentence：英文只差彎引號這類寫法、canonical 相同時視為沒變，進度不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: '  It’s  fine here. ', zh: '還好' }), TODAY);
  assert.deepEqual(r.sentences, [s]);
});

test('updateSentence：改英文時 level、streak 歸零，lastResult 為 null，reps 大於 0 的 due 變成 today，lastSeen 與 reps 不動', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', level: 2, streak: 3, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass', reps: 5 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: 'It is  fine here.', zh: '還好' }), TODAY);
  assert.deepEqual(r.sentences, [
    { id: 'p1', text: 'It is fine here.', zh: '還好', level: 0, streak: 0, due: TODAY, lastSeen: '2026-10-12', lastResult: null, reps: 5 },
  ]);
});

test('updateSentence：只改大小寫也算改了英文', () => {
  const s = makeSentence({ id: 'p1', text: "It's fine here.", zh: '還好', level: 1, streak: 1, due: '2026-10-15', lastSeen: '2026-10-13', lastResult: 'fail', reps: 2 });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'p1', deepFreeze({ text: "it's fine here.", zh: '還好' }), TODAY);
  assert.deepEqual(r.sentences, [
    { id: 'p1', text: "it's fine here.", zh: '還好', level: 0, streak: 0, due: TODAY, lastSeen: '2026-10-13', lastResult: null, reps: 2 },
  ]);
});

test('updateSentence：reps 為 0 的句子改英文時 due 維持 null', () => {
  const s = makeSentence({ id: 'n1', text: 'New one here.', zh: '新' });
  const d = deepFreeze(appDataWith({ sentences: [s] }));
  const r = updateSentence(d, 'n1', deepFreeze({ text: 'Brand new one.', zh: '全新' }), TODAY);
  assert.deepEqual(r.sentences, [{ ...s, text: 'Brand new one.', zh: '全新' }]);
  assert.equal(r.sentences[0].due, null);
});

test('setDailyCount：DAILY_OPTIONS 內的值寫進 settings，今天的 session 不動', () => {
  const session = { day: TODAY, ids: ['x1'], index: 0, results: [] };
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
  assert.deepEqual(at({ day: TODAY, ids: ['b', 'a'], index: 0, results: [] }), b);
  assert.deepEqual(at({ day: TODAY, ids: ['b', 'a'], index: 1, results: ['pass'] }), a);
  assert.equal(at(null), null);
  assert.equal(at({ day: TODAY, ids: ['b', 'a'], index: 2, results: ['pass', 'fail'] }), null);
  assert.equal(at({ day: TODAY, ids: ['zz', 'a'], index: 0, results: [] }), null);
});

test('startOrResumeSession：沒有 session 時依 pickToday 新建，題數是 min(dailyCount, 句數)', () => {
  const seeded = deepFreeze(createInitialData(SEED));
  assert.deepEqual(startOrResumeSession(seeded, TODAY), {
    ...seeded,
    session: { day: TODAY, ids: ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10'], index: 0, results: [] },
  });
  const five = deepFreeze(setDailyCount(seeded, 5));
  assert.deepEqual(startOrResumeSession(five, TODAY).session,
    { day: TODAY, ids: ['s01', 's02', 's03', 's04', 's05'], index: 0, results: [] });
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.', level: 0, streak: 1, due: TODAY, lastSeen: '2026-10-13', lastResult: 'pass', reps: 1 });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const small = deepFreeze(appDataWith({ sentences: [a, b, c] }));
  assert.deepEqual(startOrResumeSession(small, TODAY).session,
    { day: TODAY, ids: ['b', 'a', 'c'], index: 0, results: [] });
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
    session: { day: TODAY, ids: ['c', 'a', 'b'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(startOrResumeSession(midway, TODAY), midway);
});

test('startOrResumeSession：同一天但剩下的 id 已不存在時會被過濾，做過的 id 保留', () => {
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const d = makeSentence({ id: 'd', text: 'Delta four here.' });
  const data = deepFreeze(appDataWith({
    sentences: [b, d],
    session: { day: TODAY, ids: ['a', 'b', 'c', 'd'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY),
    { ...data, session: { day: TODAY, ids: ['a', 'b', 'd'], index: 1, results: ['pass'] } });
});

test('startOrResumeSession：同一天剩下的 id 全部不存在、已經做過幾張時，ids 改成做過的部分並記為完成', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a],
    doneDays: ['2026-10-13'],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['fail'] },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY), {
    ...data,
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a'], index: 1, results: ['fail'] },
  });
});

test('startOrResumeSession：同一天一張都還沒做、剩下的 id 也全部不存在時，session 為 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a],
    session: { day: TODAY, ids: ['b', 'c'], index: 0, results: [] },
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
    session: { day: '2026-10-13', ids: ['a', 'b'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(startOrResumeSession(data, TODAY),
    { ...data, session: { day: TODAY, ids: ['a', 'b', 'c'], index: 0, results: [] } });
});

test('startOrResumeSession：句子庫為空時 session 為 null', () => {
  const empty = deepFreeze(appDataWith());
  assert.deepEqual(startOrResumeSession(empty, TODAY), empty);
  const stale = deepFreeze(appDataWith({ session: { day: '2026-10-13', ids: ['a'], index: 0, results: [] } }));
  assert.equal(startOrResumeSession(stale, TODAY).session, null);
});

test('startOrResumeSession：已完成的 session 冪等，doneDays 補上 day 而且不重複', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const done = deepFreeze(appDataWith({
    sentences: [a, b],
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'] },
  }));
  const r1 = deepFreeze(startOrResumeSession(done, TODAY));
  assert.deepEqual(r1, done);
  assert.deepEqual(startOrResumeSession(r1, TODAY), done);
  const missing = deepFreeze({ ...done, doneDays: ['2026-10-13'] });
  const r2 = deepFreeze(startOrResumeSession(missing, TODAY));
  assert.deepEqual(r2, done);
  assert.deepEqual(startOrResumeSession(r2, TODAY), done);
});

test('completeCard：以 session.day 當作今天呼叫 applyResult，寫回原位置，results 推進 outcome、index 加一', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.', level: 2, streak: 1, due: '2026-10-13', lastSeen: '2026-10-11', lastResult: 'pass', reps: 6 });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const d0 = deepFreeze(appDataWith({
    sentences: [a, b, c],
    doneDays: ['2026-10-12'],
    session: { day: '2026-10-13', ids: ['b', 'a', 'c'], index: 0, results: [] },
  }));
  const b1 = { ...b, level: 2, streak: 2, due: '2026-10-17', lastSeen: '2026-10-13', lastResult: 'pass', reps: 7 };
  const d1 = deepFreeze(completeCard(d0, 'pass'));
  assert.deepEqual(d1, {
    ...d0,
    sentences: [a, b1, c],
    session: { day: '2026-10-13', ids: ['b', 'a', 'c'], index: 1, results: ['pass'] },
  });
  const a1 = { ...a, level: 0, streak: 0, due: '2026-10-14', lastSeen: '2026-10-13', lastResult: 'fail', reps: 1 };
  const d2 = deepFreeze(completeCard(d1, 'fail'));
  assert.deepEqual(d2, {
    ...d0,
    sentences: [a1, b1, c],
    session: { day: '2026-10-13', ids: ['b', 'a', 'c'], index: 2, results: ['pass', 'fail'] },
  });
  const c1 = { ...c, level: 0, streak: 1, due: '2026-10-14', lastSeen: '2026-10-13', lastResult: 'pass', reps: 1 };
  assert.deepEqual(completeCard(d2, 'pass'), {
    ...d0,
    sentences: [a1, b1, c1],
    doneDays: ['2026-10-12', '2026-10-13'],
    session: { day: '2026-10-13', ids: ['b', 'a', 'c'], index: 3, results: ['pass', 'fail', 'pass'] },
  });
});

test('completeCard：最後一張完成時把 session.day 加進 doneDays，原本就有這一天時不重複', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const session = { day: TODAY, ids: ['a', 'b'], index: 1, results: ['pass'] };
  const first = deepFreeze(appDataWith({ sentences: [a, b], doneDays: ['2026-10-13'], session }));
  const r1 = completeCard(first, 'fail');
  assert.deepEqual(r1.doneDays, ['2026-10-13', TODAY]);
  assert.deepEqual(r1.session, { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'] });
  const again = deepFreeze(appDataWith({ sentences: [a, b], doneDays: ['2026-10-13', TODAY], session }));
  assert.deepEqual(completeCard(again, 'pass').doneDays, ['2026-10-13', TODAY]);
});

test('completeCard：沒有進行中的卡片時 throw', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const withSession = (session) => deepFreeze(appDataWith({ sentences: [a], session }));
  assert.throws(() => completeCard(withSession(null), 'pass'), /沒有進行中的卡片/);
  assert.throws(() => completeCard(withSession({ day: TODAY, ids: ['a'], index: 1, results: ['pass'] }), 'pass'), /沒有進行中的卡片/);
  assert.throws(() => completeCard(withSession({ day: TODAY, ids: ['zz'], index: 0, results: [] }), 'pass'), /沒有進行中的卡片/);
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
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(deleteSentence(data, 'x', TODAY), { ...data, sentences: [a, b, c] });
});

test('deleteSentence：刪除目前這一張，後面的卡往前補，index 與 results 不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 1, results: ['pass'] },
  }));
  const r = deepFreeze(deleteSentence(data, 'b', TODAY));
  assert.deepEqual(r, {
    ...data,
    sentences: [a, c],
    session: { day: TODAY, ids: ['a', 'c'], index: 1, results: ['pass'] },
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
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 2, results: ['pass', 'fail'] },
  }));
  assert.deepEqual(deleteSentence(data, 'c', TODAY), {
    ...data,
    sentences: [a, b],
    doneDays: ['2026-10-13', TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'] },
  });
});

test('deleteSentence：只有一張卡而且還沒做時刪除它，session 變成 null', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b],
    session: { day: TODAY, ids: ['a'], index: 0, results: [] },
  }));
  assert.deepEqual(deleteSentence(data, 'a', TODAY), { ...data, sentences: [b], session: null });
});

test('deleteSentence：刪除已完成的卡，ids、index 與 results 都不變', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const midway = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: TODAY, ids: ['a', 'b', 'c'], index: 2, results: ['pass', 'pass'] },
  }));
  assert.deepEqual(deleteSentence(midway, 'a', TODAY), { ...midway, sentences: [b, c] });
  const finished = deepFreeze(appDataWith({
    sentences: [a, b],
    doneDays: [TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'] },
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
    session: { day: '2026-10-13', ids: ['a', 'b'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(deleteSentence(data, 'c', TODAY), { ...data, sentences: [a, b], session: null });
});

test('todayStatus：start 的 done 為 0，total 為 min(dailyCount, 句數)', () => {
  const seeded = deepFreeze(createInitialData(SEED));
  assert.deepEqual(todayStatus(seeded, TODAY), { kind: 'start', done: 0, total: 10 });
  assert.deepEqual(todayStatus(deepFreeze(setDailyCount(seeded, 25)), TODAY), { kind: 'start', done: 0, total: 25 });
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const c = makeSentence({ id: 'c', text: 'Gamma three here.' });
  const small = deepFreeze(appDataWith({ sentences: [a, b, c] }));
  assert.deepEqual(todayStatus(small, TODAY), { kind: 'start', done: 0, total: 3 });
  const stale = deepFreeze(appDataWith({
    sentences: [a, b, c],
    session: { day: '2026-10-13', ids: ['a', 'b'], index: 1, results: ['pass'] },
  }));
  assert.deepEqual(todayStatus(stale, TODAY), { kind: 'start', done: 0, total: 3 });
});

test('todayStatus：continue 的 done 為 index、total 為 ids.length，建立 session 之後改每日題數也不變', () => {
  const started = deepFreeze(startOrResumeSession(deepFreeze(createInitialData(SEED)), TODAY));
  const oneDone = deepFreeze(completeCard(started, 'pass'));
  assert.deepEqual(todayStatus(oneDone, TODAY), { kind: 'continue', done: 1, total: 10 });
  const changed = deepFreeze(setDailyCount(oneDone, 20));
  assert.deepEqual(todayStatus(changed, TODAY), { kind: 'continue', done: 1, total: 10 });
});

test('todayStatus：done 的 total 在 session 是今天時取 ids.length，否則取 min(dailyCount, 句數)，done 等於 total', () => {
  const seeded = deepFreeze(createInitialData(SEED));
  const withToday = deepFreeze({
    ...seeded,
    doneDays: [TODAY],
    session: { day: TODAY, ids: ['s01', 's02', 's03'], index: 3, results: ['pass', 'pass', 'fail'] },
  });
  assert.deepEqual(todayStatus(withToday, TODAY), { kind: 'done', done: 3, total: 3 });
  const noSession = deepFreeze({ ...seeded, doneDays: ['2026-10-13', TODAY] });
  assert.deepEqual(todayStatus(noSession, TODAY), { kind: 'done', done: 10, total: 10 });
  const oldSession = deepFreeze({
    ...seeded,
    settings: { dailyCount: 15, lastExport: null },
    doneDays: [TODAY],
    session: { day: '2026-10-13', ids: ['s01'], index: 1, results: ['pass'] },
  });
  assert.deepEqual(todayStatus(oldSession, TODAY), { kind: 'done', done: 15, total: 15 });
});

test('todayStatus：句子庫為空時是 empty，done 與 total 都是 0；doneDays 包含 today 時仍以 done 優先', () => {
  assert.deepEqual(todayStatus(deepFreeze(appDataWith()), TODAY), { kind: 'empty', done: 0, total: 0 });
  const emptiedAfterDone = deepFreeze(appDataWith({
    doneDays: [TODAY],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'pass'] },
  }));
  assert.deepEqual(todayStatus(emptiedAfterDone, TODAY), { kind: 'done', done: 2, total: 2 });
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
  return { schema: 1, settings: { dailyCount: 10, lastExport: null }, sentences: [], doneDays: [], session: null, ...overrides };
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
    [deepFreeze({ schema: 2, sentences: [] }), 'schema 不符'],
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

test('sanitizeData：未知欄位被丟掉', () => {
  const input = deepFreeze({
    schema: 1,
    extra: true,
    settings: { dailyCount: 15, lastExport: '2026-10-01', theme: 'dark' },
    sentences: [{ ...makeSentence({ id: 'u1' }), note: 'x' }],
    doneDays: ['2026-10-13'],
    session: { day: TODAY, ids: ['u1'], index: 0, results: [], extra: 1 },
  });
  assert.deepStrictEqual(sanitizeData(input), {
    data: {
      schema: 1,
      settings: { dailyCount: 15, lastExport: '2026-10-01' },
      sentences: [makeSentence({ id: 'u1' })],
      doneDays: ['2026-10-13'],
      session: { day: TODAY, ids: ['u1'], index: 0, results: [] },
    },
    warnings: [],
  });
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
  const valid = { day: TODAY, ids: ['s01', 's02', 'gone'], index: 1, results: ['pass'] };
  const bad = [
    'x', 42, [],
    { ...valid, day: '2026-13-01' },
    { ...valid, day: undefined },
    { ...valid, ids: 's01' },
    { ...valid, ids: [], index: 0, results: [] },
    { ...valid, ids: ['s01', 2, 's03'] },
    { ...valid, ids: ['s01', 's02', 's01'] },
    { ...valid, index: -1 },
    { ...valid, index: 1.5 },
    { ...valid, index: 4 },
    { ...valid, index: '1' },
    { ...valid, results: [] },
    { ...valid, results: ['skip'] },
    { ...valid, results: 'pass' },
  ];
  for (const session of bad) {
    const res = sanitizeData(deepFreeze(rawAppData({ session })));
    assert.equal(res.data.session, null, JSON.stringify(session));
    assert.deepStrictEqual(res.warnings, []);
  }
  // 合格的 session 原樣保留；ids 指向不存在的句子（gone）也不檢查
  assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ session: valid }))).data.session, valid);
  const finished = { day: TODAY, ids: ['s01', 's02'], index: 2, results: ['pass', 'fail'] };
  assert.deepStrictEqual(sanitizeData(deepFreeze(rawAppData({ session: finished }))).data.session, finished);
});

// ===== 第 8 任務：toBackupJSON 與 fromBackupJSON（7.6） =====

test('toBackupJSON：去掉 session 的 AppData 加上檔頭，用 JSON.stringify(payload, null, 2) 輸出', () => {
  const data = practicedData();
  const text = toBackupJSON(data, TODAY, NOW_ISO);
  const obj = JSON.parse(text);
  assert.deepStrictEqual(Object.keys(obj), ['app', 'schema', 'exportedDay', 'exportedAt', 'settings', 'sentences', 'doneDays']);
  assert.deepStrictEqual(obj, {
    app: 'phrase-drill',
    schema: 1,
    exportedDay: TODAY,
    exportedAt: NOW_ISO,
    settings: data.settings,
    sentences: data.sentences,
    doneDays: data.doneDays,
  });
  assert.equal(text, JSON.stringify(obj, null, 2));
});

test('toBackupJSON 與 fromBackupJSON：來回轉換後等於原資料但 session 為 null', () => {
  const data = practicedData();
  const res = fromBackupJSON(toBackupJSON(data, TODAY, NOW_ISO));
  assert.deepStrictEqual(res, {
    ok: true,
    data: { ...data, session: null },
    warnings: [],
    summary: { sentences: SEED.length, days: 2, exportedDay: TODAY },
  });
});

test('fromBackupJSON：7.6 的每一種錯誤訊息', () => {
  const header = { app: 'phrase-drill', schema: 1, exportedDay: TODAY, exportedAt: NOW_ISO };
  const one = [makeSentence()];
  const cases = [
    ['', '不是有效的 JSON'],
    ['{', '不是有效的 JSON'],
    ['not json', '不是有效的 JSON'],
    ['[]', '這不是句練的備份檔'],
    ['null', '這不是句練的備份檔'],
    ['"phrase-drill"', '這不是句練的備份檔'],
    ['42', '這不是句練的備份檔'],
    [JSON.stringify({ ...header, app: 'other-app', sentences: one }), '這不是句練的備份檔'],
    [JSON.stringify({ ...header, app: null, sentences: one }), '這不是句練的備份檔'],
    [JSON.stringify({ schema: 1, settings: {}, doneDays: [] }), '這不是句練的備份檔'],
    [JSON.stringify({ schema: 1, sentences: {} }), '這不是句練的備份檔'],
    [JSON.stringify({ ...header, schema: 2, sentences: one }), '備份來自較新版本，請先更新 app'],
    [JSON.stringify({ schema: 3, sentences: [] }), '備份來自較新版本，請先更新 app'],
    [JSON.stringify({ ...header, schema: 0, sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ ...header, schema: '1', sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ ...header, schema: 1.5, sentences: one }), '備份內容無法讀取：schema 不符'],
    [JSON.stringify({ ...header, sentences: {} }), '備份內容無法讀取：sentences 不是陣列'],
    [JSON.stringify({ ...header, sentences: [] }), '備份裡沒有任何句子'],
    [JSON.stringify({ ...header, sentences: [makeSentence({ text: 'The error is 5 μm.' })] }), '備份裡沒有任何句子'],
  ];
  for (const [text, error] of cases) {
    assert.deepStrictEqual(fromBackupJSON(text), { ok: false, error }, text);
  }
});

test('fromBackupJSON：接受沒有檔頭的 AppData，這時 summary.exportedDay 為 null', () => {
  const data = practicedData();
  const res = fromBackupJSON(JSON.stringify(data));
  assert.deepStrictEqual(res, {
    ok: true,
    data: { ...data, session: null },
    warnings: [],
    summary: { sentences: SEED.length, days: 2, exportedDay: null },
  });
});

test('fromBackupJSON：檔頭的 exportedDay 不是合法 Day 時 summary.exportedDay 為 null', () => {
  const header = { app: 'phrase-drill', schema: 1, exportedDay: '2026-1-5', exportedAt: NOW_ISO };
  const res = fromBackupJSON(JSON.stringify({ ...header, sentences: [makeSentence()] }));
  assert.equal(res.ok, true);
  assert.equal(res.summary.exportedDay, null);
});

test('fromBackupJSON：補齊缺欄位、夾住 level、丟棄重複 id 與含 μ 的句子', () => {
  const text = JSON.stringify({
    app: 'phrase-drill',
    schema: 1,
    exportedDay: '2026-10-01',
    exportedAt: '2026-10-01T01:00:00.000Z',
    settings: { dailyCount: 15, lastExport: '2026-10-01' },
    sentences: [
      { id: 'a1', text: 'Only id and text here.' },
      { id: 'a2', text: 'Level seven is clamped.', zh: '層級被夾住', level: 7, streak: 1,
        due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass', reps: 3 },
      { id: 'a1', text: 'Duplicate id is dropped.' },
      { id: 'a3', text: 'The error is 5 μm.' },
      { id: 'a4', text: 'Bad 5 μm comes first.' },
      { id: 'a4', text: 'Good one comes second.' },
    ],
    doneDays: ['2026-09-30', '2026-10-01'],
  });
  assert.deepStrictEqual(fromBackupJSON(text), {
    ok: true,
    data: {
      schema: 1,
      settings: { dailyCount: 15, lastExport: '2026-10-01' },
      sentences: [
        { id: 'a1', text: 'Only id and text here.', zh: '', level: 0, streak: 0,
          due: null, lastSeen: null, lastResult: null, reps: 0 },
        { id: 'a2', text: 'Level seven is clamped.', zh: '層級被夾住', level: 2, streak: 1,
          due: '2026-10-15', lastSeen: '2026-10-14', lastResult: 'pass', reps: 3 },
        { id: 'a4', text: 'Good one comes second.', zh: '', level: 0, streak: 0,
          due: null, lastSeen: null, lastResult: null, reps: 0 },
      ],
      doneDays: ['2026-09-30', '2026-10-01'],
      session: null,
    },
    warnings: ['有 3 句資料不完整，或含有英文鍵盤打不出的字元，已略過'],
    summary: { sentences: 3, days: 2, exportedDay: '2026-10-01' },
  });
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
  storage.setItem('phrase-drill:data', JSON.stringify({ schema: 2, sentences: 'future format' }));
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

// ===== 第 8 任務：Review Focus =====

test('Review Focus：自訂片語與句子不受 seed 專屬規則限制，save 後重新 load 原樣保留、沒有 warning', () => {
  let data = deepFreeze(createInitialData(SEED));
  const phrase = validateSentenceInput(data, 'In contrast,', '', null);
  assert.deepStrictEqual(phrase, { ok: true, text: 'In contrast,', zh: '' });
  const quoted = validateSentenceInput(data, 'The so-called "cold start" problem [12] remains open...', '所謂的冷啟動問題仍未解決', null);
  assert.equal(quoted.ok, true);
  data = deepFreeze(addSentence(data, deepFreeze({ id: 'u1', text: phrase.text, zh: phrase.zh })));
  data = deepFreeze(addSentence(data, deepFreeze({ id: 'u2', text: quoted.text, zh: quoted.zh })));
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

test('Review Focus：手動修過的資料缺 settings、doneDays 雜亂、session 為任意值、sentences 混有雜項時照 7.4 修正，不丟出 TypeError', () => {
  const raw = '{"schema":1,"sentences":[null,42,["s01"],{"id":"s01","text":"Hello world."}],"doneDays":["2026-10-12","2026-10-01","2026-10-12","2026-02-30",7],"session":"x"}';
  const storage = new FakeStorage();
  storage.setItem('phrase-drill:data', raw);
  let res;
  assert.doesNotThrow(() => { res = load(storage, SEED, '2026-10-14T13:05:00.000Z'); });
  assert.equal(res.status, 'ok');
  assert.deepStrictEqual(res.data.settings, { dailyCount: 10, lastExport: null });
  assert.deepStrictEqual(res.data.doneDays, ['2026-10-01', '2026-10-12']);
  assert.equal(res.data.session, null);
  assert.deepStrictEqual(res.data.sentences, [
    { id: 's01', text: 'Hello world.', zh: '', level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 },
  ]);
  assert.deepStrictEqual(res.warnings, [
    '有 3 句資料不完整，或含有英文鍵盤打不出的字元，已略過',
    '原始資料已另存，可到『設定 > 診斷』複製',
  ]);

  const edited = deepFreeze({
    ...JSON.parse(raw),
    settings: null,
    session: { day: '2026-10-14', ids: ['s01', 's01'], index: 0, results: [] },
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
    JSON.stringify({ at: NOW_ISO, reason: 'import', json: JSON.stringify({ schema: 2, sentences: [] }) }),
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

test('todayStatus：doneDays 有今天、session 不是今天，而句數少於每日題數時，total 是句數', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const data = deepFreeze(appDataWith({ sentences: [a, b], doneDays: [TODAY] }));
  assert.deepEqual(todayStatus(data, TODAY), { kind: 'done', done: 2, total: 2 });
});

test('todayStatus：今天的 session 已做完但 doneDays 沒有今天時，是 start 而不是 continue', () => {
  const a = makeSentence({ id: 'a', text: 'Alpha one here.' });
  const b = makeSentence({ id: 'b', text: 'Beta two here.' });
  const data = deepFreeze(appDataWith({
    sentences: [a, b],
    session: { day: TODAY, ids: ['a', 'b'], index: 2, results: ['pass', 'fail'] },
  }));
  assert.deepEqual(todayStatus(data, TODAY), { kind: 'start', done: 0, total: 2 });
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
  const session = { day: TODAY, ids: ['s01', 's02'], index: 3, results: ['pass', 'fail', 'pass'] };
  const res = sanitizeData(deepFreeze(rawAppData({ session })));
  assert.equal(res.data.session, null);
  assert.deepStrictEqual(res.warnings, []);
});

test('clearUndo 與 clearCorrupt：removeItem 丟出的例外不攔截，原樣往上丟', () => {
  const failing = { getItem: () => null, setItem() {}, removeItem() { throw new Error('remove failed'); } };
  assert.throws(() => clearUndo(failing), { message: 'remove failed' });
  assert.throws(() => clearCorrupt(failing), { message: 'remove failed' });
});
