import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLOVER_HOUR, PROMOTE_AFTER, L2_INTERVALS, LEVEL_NAMES,
  localDay, addDays, daysBetween, isDay, streakInfo,
} from '../js/schedule.js';
import { deepFreeze, makeSentence, TODAY } from './helpers.js';
import { applyResult, compareDay, compareDayNullFirst, pickToday, levelCounts, levelLabel, dueLabel, resultMessage } from '../js/schedule.js';
import { STAGE_NAMES, rungMessage } from '../js/schedule.js';

test('schedule.js 的常數', () => {
  assert.equal(ROLLOVER_HOUR, 4);
  assert.equal(PROMOTE_AFTER, 1);
  assert.deepEqual(L2_INTERVALS, [2, 4, 7, 14, 30]);
  assert.deepEqual(LEVEL_NAMES, ['全句提示', '首字母提示', '背誦']);
  assert.deepEqual(STAGE_NAMES, ['全句提示', '首字母提示', '背誦', '議題應用']);
  assert.deepEqual(LEVEL_NAMES, STAGE_NAMES.slice(0, 3));
});

// Date 一律用本地時間建構子建立，不用帶 Z 的 ISO 字串，結果才不受機器時區影響
test('localDay：本地時間凌晨 4 點換日', () => {
  assert.equal(localDay(new Date(2026, 9, 14, 3, 59)), '2026-10-13');
  assert.equal(localDay(new Date(2026, 9, 14, 4, 0)), '2026-10-14');
  assert.equal(localDay(new Date(2026, 10, 1, 2, 0)), '2026-10-31');
  assert.equal(localDay(new Date(2027, 0, 1, 3, 0)), '2026-12-31');
});

test('localDay：rolloverHour 可由第二個參數覆寫', () => {
  assert.equal(localDay(new Date(2026, 9, 14, 3, 59), 0), '2026-10-14');
});

test('addDays：跨月、跨年與閏年', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-10-14', 30), '2026-11-13');
});

test('isDay：只接受補零而且真實存在的 YYYY-MM-DD 字串', () => {
  assert.equal(isDay('2026-02-30'), false);
  assert.equal(isDay('2026-1-5'), false);
  assert.equal(isDay('2026-10-14'), true);
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay(null), false);
  assert.equal(isDay(20261014), false);
});

test('daysBetween：to 減 from 的天數，from 晚於 to 時為負數', () => {
  assert.equal(daysBetween('2026-09-29', '2026-10-14'), 15);
  assert.equal(daysBetween('2026-10-14', '2026-11-13'), 30);
  assert.equal(daysBetween('2026-10-14', '2026-10-13'), -1);
});

const STREAK_CASES = [                     // today 一律是 TODAY（2026-10-14）
  [[], { current: 0, best: 0, doneToday: false }],
  [['2026-10-14'], { current: 1, best: 1, doneToday: true }],
  [['2026-10-13'], { current: 1, best: 1, doneToday: false }],
  [['2026-10-11', '2026-10-13', '2026-10-14'], { current: 2, best: 2, doneToday: true }],
  [['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-10-13', '2026-10-14'],
    { current: 2, best: 5, doneToday: true }],
  [['2026-10-20'], { current: 0, best: 1, doneToday: false }],   // 比 today 晚的日期：不當機、不出現負數
];
for (const [doneDays, expected] of STREAK_CASES) {
  test(`streakInfo：doneDays ${JSON.stringify(doneDays)}`, () => {
    assert.deepEqual(streakInfo(deepFreeze(doneDays), TODAY), expected);
  });
}

// ---- 第 5 任務：applyResult（規格 6.2）----

// 輸入 level、streak、outcome，期望的 level、streak、due；today 為 2026-10-14，輸入的 reps 為 3
const APPLY_RESULT_TABLE = [
  [0, 0, 'pass', 1, 0, '2026-10-15'],
  [0, 1, 'pass', 1, 0, '2026-10-15'],   // 第 1 版資料
  [1, 0, 'pass', 2, 0, '2026-10-15'],
  [1, 1, 'pass', 2, 0, '2026-10-15'],   // 第 1 版資料
  [2, 0, 'pass', 2, 1, '2026-10-16'],
  [2, 1, 'pass', 2, 2, '2026-10-18'],
  [2, 2, 'pass', 2, 3, '2026-10-21'],
  [2, 3, 'pass', 2, 4, '2026-10-28'],
  [2, 4, 'pass', 2, 5, '2026-11-13'],
  [2, 5, 'pass', 2, 6, '2026-11-13'],
  [0, 0, 'fail', 0, 0, '2026-10-15'],
  [1, 0, 'fail', 0, 0, '2026-10-15'],
  [2, 3, 'fail', 1, 0, '2026-10-15'],
];

for (const [level, streak, outcome, wantLevel, wantStreak, wantDue] of APPLY_RESULT_TABLE) {
  test(`applyResult：L${level} streak ${streak} ${outcome} 之後為 L${wantLevel} streak ${wantStreak}、due ${wantDue}`, () => {
    // lastSeen 與 lastResult 故意和期望值不同，才看得出有沒有被改寫
    const s = deepFreeze(makeSentence({ reps: 3, level, streak, due: TODAY, lastSeen: '2026-10-12',
      lastResult: outcome === 'pass' ? 'fail' : 'pass' }));
    const before = { ...s };
    const r = applyResult(s, outcome, TODAY);
    assert.deepEqual(r, { ...before, level: wantLevel, streak: wantStreak, due: wantDue,
      reps: 4, lastSeen: '2026-10-14', lastResult: outcome });
    assert.notEqual(r, s);          // 回傳新物件
    assert.deepEqual(s, before);    // 輸入沒有被修改
  });
}

// ---- 第 5 任務：compareDay 與 compareDayNullFirst（規格 6.3）----

test('compareDay：小於回傳 -1、大於回傳 1、相等回傳 0', () => {
  assert.equal(compareDay('2026-10-13', '2026-10-14'), -1);
  assert.equal(compareDay('2026-10-14', '2026-10-13'), 1);
  assert.equal(compareDay('2026-10-14', '2026-10-14'), 0);
  assert.equal(compareDay('2026-09-30', '2026-10-01'), -1);
  assert.equal(compareDay('2027-01-01', '2026-12-31'), 1);
});

test('compareDayNullFirst：null 排在所有日期之前，兩個 null 視為相等', () => {
  assert.equal(compareDayNullFirst(null, '2026-10-14'), -1);
  assert.equal(compareDayNullFirst('2026-10-14', null), 1);
  assert.equal(compareDayNullFirst(null, null), 0);
  assert.equal(compareDayNullFirst('2026-10-10', '2026-10-12'), -1);
  assert.equal(compareDayNullFirst('2026-10-12', '2026-10-10'), 1);
  assert.equal(compareDayNullFirst('2026-10-12', '2026-10-12'), 0);
  assert.deepEqual(['2026-10-12', null, '2026-10-10'].sort(compareDayNullFirst), [null, '2026-10-10', '2026-10-12']);
});

// ---- 第 5 任務：pickToday（規格 6.3）----

// fixture F，today 為 2026-10-14：a、b、g 到期，c、f 是新句，d、e 未到期
const FIXTURE_F = deepFreeze([
  makeSentence({ id: 'a', reps: 3, level: 1, due: '2026-10-14', lastSeen: '2026-10-13', lastResult: 'pass' }),
  makeSentence({ id: 'b', reps: 2, level: 0, due: '2026-10-13', lastSeen: '2026-10-12', lastResult: 'fail' }),
  makeSentence({ id: 'c', reps: 0, level: 0, due: null, lastSeen: null, lastResult: null }),
  makeSentence({ id: 'd', reps: 5, level: 2, due: '2026-10-20', lastSeen: '2026-10-12', lastResult: 'pass' }),
  makeSentence({ id: 'e', reps: 4, level: 2, due: '2026-10-16', lastSeen: '2026-10-10', lastResult: 'pass' }),
  makeSentence({ id: 'f', reps: 0, level: 0, due: null, lastSeen: null, lastResult: null }),
  makeSentence({ id: 'g', reps: 1, level: 0, due: '2026-10-14', lastSeen: '2026-10-13', lastResult: 'pass' }),
]);

// count 與期望的 id 順序
const PICK_TODAY_TABLE = [
  [10, ['b', 'g', 'a', 'c', 'f', 'e', 'd']],
  [7, ['b', 'g', 'a', 'c', 'f', 'e', 'd']],
  [6, ['b', 'g', 'a', 'c', 'f', 'e']],
  [4, ['b', 'g', 'a', 'c']],
  [2, ['b', 'g']],
  [0, []],
];

for (const [count, want] of PICK_TODAY_TABLE) {
  test(`pickToday：fixture F、count ${count}`, () => {
    const ids = pickToday(FIXTURE_F, TODAY, count);
    assert.deepEqual(ids, want);
    assert.equal(new Set(ids).size, ids.length);    // id 不重複
  });
}

test('pickToday：空句子庫回傳空陣列', () => {
  const ids = pickToday(deepFreeze([]), TODAY, 10);
  assert.deepEqual(ids, []);
  assert.equal(new Set(ids).size, ids.length);
});

test('pickToday：到期句都是 L1 時，lastSeen 較舊的在前，lastSeen 相同時依陣列位置', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'p', reps: 1, level: 1, due: '2026-10-14', lastSeen: '2026-10-12', lastResult: 'pass' }),
    makeSentence({ id: 'q', reps: 1, level: 1, due: '2026-10-14', lastSeen: '2026-10-10', lastResult: 'pass' }),
    makeSentence({ id: 'r', reps: 1, level: 1, due: '2026-10-14', lastSeen: '2026-10-10', lastResult: 'pass' }),
  ]);
  const ids = pickToday(sentences, TODAY, 3);
  assert.deepEqual(ids, ['q', 'r', 'p']);
  assert.equal(new Set(ids).size, ids.length);
});

test('pickToday：未到期句都是 L2 時，due 較近的在前，due 相同時 lastSeen 較舊的在前', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'u', reps: 1, level: 2, due: '2026-10-18', lastSeen: '2026-10-11', lastResult: 'pass' }),
    makeSentence({ id: 'v', reps: 1, level: 2, due: '2026-10-16', lastSeen: '2026-10-09', lastResult: 'pass' }),
    makeSentence({ id: 'w', reps: 1, level: 2, due: '2026-10-16', lastSeen: '2026-10-08', lastResult: 'pass' }),
  ]);
  const ids = pickToday(sentences, TODAY, 2);
  assert.deepEqual(ids, ['w', 'v']);
  assert.equal(new Set(ids).size, ids.length);
});

test('pickToday：同樣的輸入永遠得到同樣的輸出', () => {
  const first = pickToday(FIXTURE_F, TODAY, 10);
  assert.deepEqual(pickToday(FIXTURE_F, TODAY, 10), first);
  assert.equal(new Set(first).size, first.length);
});

// ---- 第 5 任務：levelCounts、levelLabel、dueLabel（規格 6.5）----

test('levelCounts：fresh 是 reps 為 0 的句數，l0、l1、l2 只計 reps 大於 0 的句子', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'n1' }),
    makeSentence({ id: 'n2' }),
    makeSentence({ id: 'k0', reps: 2, level: 0 }),
    makeSentence({ id: 'k1', reps: 3, level: 1 }),
    makeSentence({ id: 'k2', reps: 6, level: 2 }),
    makeSentence({ id: 'k3', reps: 9, level: 2 }),
  ]);
  const c = levelCounts(sentences);
  assert.deepEqual(c, { fresh: 2, l0: 1, l1: 1, l2: 2 });
  assert.equal(c.fresh + c.l0 + c.l1 + c.l2, sentences.length);
  assert.deepEqual(levelCounts(deepFreeze([])), { fresh: 0, l0: 0, l1: 0, l2: 0 });
});

test('levelLabel：reps 為 0 是「未開始」，其餘依 level 為「全句」「首字母」「背誦」', () => {
  assert.equal(levelLabel(makeSentence()), '未開始');
  assert.equal(levelLabel(makeSentence({ reps: 2, level: 0 })), '全句');
  assert.equal(levelLabel(makeSentence({ reps: 2, level: 1 })), '首字母');
  assert.equal(levelLabel(makeSentence({ reps: 2, level: 2 })), '背誦');
});

test('dueLabel：reps 為 0 是空字串，due 為 null 或不晚於 today 是「今天」，其餘是不補零的月/日', () => {
  assert.equal(dueLabel(makeSentence(), TODAY), '');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: null }), TODAY), '今天');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: '2026-10-14' }), TODAY), '今天');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: '2026-10-18' }), TODAY), '10/18');
});

// Review Focus 第 3 條：個位數的月或日不補零，已逾期或 due 為 null 時不出現過去的日期
test('dueLabel：11/3、1/5 不補零，已逾期與 reps 大於 0 而 due 為 null 時是「今天」', () => {
  assert.equal(dueLabel(makeSentence({ reps: 2, due: '2026-11-03' }), TODAY), '11/3');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: '2027-01-05' }), TODAY), '1/5');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: '2026-10-12' }), TODAY), '今天');
  assert.equal(dueLabel(makeSentence({ reps: 2, due: null }), TODAY), '今天');
});

// ---- 第 5 任務：resultMessage（規格 6.2）----

// before 的 level、streak，outcome，期望文字；after 一律由 applyResult 算出
const RESULT_MESSAGE_TABLE = [
  [0, 0, 'pass', '通過，明天從首字母提示開始'],
  [1, 0, 'pass', '通過，明天從背誦開始'],
  [2, 0, 'pass', '通過，維持背誦'],
  [2, 3, 'pass', '通過，維持背誦'],
  [2, 3, 'fail', '沒過，明天退回首字母提示'],
  [1, 0, 'fail', '沒過，明天退回全句提示'],
  [0, 0, 'fail', '沒過，明天仍從全句提示開始'],
];

for (const [level, streak, outcome, want] of RESULT_MESSAGE_TABLE) {
  test(`resultMessage：L${level} streak ${streak} ${outcome} 為「${want}」`, () => {
    const before = deepFreeze(makeSentence({ reps: 3, level, streak, due: TODAY, lastSeen: '2026-10-12', lastResult: 'pass' }));
    const after = applyResult(before, outcome, TODAY);
    assert.equal(resultMessage(before, after, outcome), want);
  });
}

test('streakInfo：輸入沒有排序、有重複日期時結果相同', () => {
  const doneDays = deepFreeze(['2026-09-05', '2026-10-14', '2026-09-03', '2026-09-04', '2026-09-04']);
  assert.deepEqual(streakInfo(doneDays, TODAY), { current: 1, best: 3, doneToday: true });
});

test('isDay：不是字串的輸入（陣列、物件）回傳 false，不丟出例外', () => {
  assert.equal(isDay(['2026-10-14']), false);
  assert.equal(isDay({}), false);
  assert.equal(isDay('0NaN-NaN-NaN'), false);
});

test('補充：pickToday 到期句中，lastResult 為 fail 的排在 level 較低但通過的前面', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'low', reps: 2, level: 0, due: '2026-10-14', lastSeen: '2026-10-10', lastResult: 'pass' }),
    makeSentence({ id: 'failed', reps: 2, level: 1, due: '2026-10-14', lastSeen: '2026-10-13', lastResult: 'fail' }),
  ]);
  const ids = pickToday(sentences, TODAY, 2);
  assert.deepEqual(ids, ['failed', 'low']);
  assert.equal(new Set(ids).size, ids.length);
});

test('補充：pickToday 未到期句先比 due，due 順序與 lastSeen 順序相反時仍是 due 較近的在前', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'late', reps: 2, level: 2, due: '2026-10-20', lastSeen: '2026-10-01', lastResult: 'pass' }),
    makeSentence({ id: 'soon', reps: 2, level: 2, due: '2026-10-16', lastSeen: '2026-10-12', lastResult: 'pass' }),
  ]);
  const ids = pickToday(sentences, TODAY, 2);
  assert.deepEqual(ids, ['soon', 'late']);
  assert.equal(new Set(ids).size, ids.length);
});

test('補充：pickToday reps 大於 0 而 due 為 null 的句子歸在第一段（到期）', () => {
  const sentences = deepFreeze([
    makeSentence({ id: 'n', reps: 0 }),
    makeSentence({ id: 'z', reps: 2, level: 1, due: null, lastSeen: '2026-10-01', lastResult: 'pass' }),
    makeSentence({ id: 'y', reps: 2, level: 2, due: '2026-10-30', lastSeen: '2026-10-01', lastResult: 'pass' }),
  ]);
  const ids = pickToday(sentences, TODAY, 3);
  assert.deepEqual(ids, ['z', 'n', 'y']);
  assert.equal(new Set(ids).size, ids.length);
});

// ---- 第 2 版：rungMessage（規格 6.2）----

const RUNG_MESSAGE_TABLE = [
  [0, 'pass', '通過，接著首字母提示'],
  [1, 'pass', '通過，接著背誦'],
  [2, 'pass', '通過，接著議題應用'],
  [0, 'fail', '沒過，再試一次全句提示'],
  [3, 'fail', '沒過，再試一次議題應用'],
];

for (const [stage, outcome, want] of RUNG_MESSAGE_TABLE) {
  test(`rungMessage：stage ${stage} ${outcome} 為「${want}」`, () => {
    assert.equal(rungMessage(stage, outcome), want);
  });
}
