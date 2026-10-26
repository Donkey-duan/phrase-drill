import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, startOrResumeSession, completeCard, currentSentence, sanitizeData } from '../js/store.js';
import { addDays, streakInfo } from '../js/schedule.js';
import { SEED } from '../js/seed.js';
import { deepFreeze, TODAY } from './helpers.js';

const ALL_PASS = () => 'pass';
const EVERY_7TH_FAILS = (k) => (k % 7 === 0 ? 'fail' : 'pass');   // k 是累計張數，從 1 起算

// 10.6：每一步之後都要成立的條件
function checkInvariants(data) {
  const r = sanitizeData(deepFreeze(JSON.parse(JSON.stringify(data))));
  assert.deepStrictEqual(r.data, data);
  assert.deepStrictEqual(r.warnings, []);
  if (data.session) {
    const ids = new Set(data.sentences.map((s) => s.id));
    for (const id of data.session.ids.slice(data.session.index)) {
      assert.ok(ids.has(id), `session 剩下的 id ${id} 不存在`);
    }
  }
  for (let i = 1; i < data.doneDays.length; i++) {
    assert.ok(data.doneDays[i - 1] < data.doneDays[i], `doneDays 沒有嚴格遞增：${data.doneDays.join(', ')}`);
  }
  for (const s of data.sentences) {
    if (s.reps === 0) continue;
    assert.ok(s.due !== null && s.lastSeen !== null, `${s.id} 的 due 或 lastSeen 是 null`);
    assert.ok(s.due > s.lastSeen, `${s.id} 的 due ${s.due} 沒有大於 lastSeen ${s.lastSeen}`);
  }
}

// 一次模擬的狀態：目前的資料與累計張數
function createRun() {
  const data = createInitialData(deepFreeze(SEED));
  checkInvariants(data);
  return { data, cards: 0 };
}

// 以 day 開始練習，這一天必須新建 session
function startDay(run, day) {
  const next = startOrResumeSession(deepFreeze(run.data), day);
  checkInvariants(next);
  assert.notEqual(next.session, null);
  assert.equal(next.session.day, day);
  assert.equal(next.session.index, 0);
  assert.equal(next.session.ids.length, Math.min(next.settings.dailyCount, next.sentences.length));
  run.data = next;
}

// 依序完成卡片，最多 limit 張；outcomeOf 收到累計張數
function playCards(run, outcomeOf, limit = Infinity) {
  for (let n = 0; n < limit && run.data.session.index < run.data.session.ids.length; n++) {
    deepFreeze(run.data);
    assert.notEqual(currentSentence(run.data), null);
    run.cards += 1;
    const next = completeCard(run.data, outcomeOf(run.cards));
    assert.equal(next.session.index, run.data.session.index + 1);
    checkInvariants(next);
    run.data = next;
  }
}

// 從 TODAY 起連續 days 天，每天做完整個 session；回傳 55 句全部出場的那一天（從 1 起算），沒有全部出場時為 null
function runDays(run, days, outcomeOf) {
  let allSeenDay = null;
  for (let d = 1; d <= days; d++) {
    startDay(run, addDays(TODAY, d - 1));
    playCards(run, outcomeOf);
    if (allSeenDay === null && run.data.sentences.every((s) => s.reps > 0)) allSeenDay = d;
  }
  return allSeenDay;
}

test('不變式檢查抓得到壞資料', () => {
  const run = createRun();
  startDay(run, TODAY);
  playCards(run, ALL_PASS, 1);
  const good = run.data;
  const first = good.sentences.find((s) => s.reps > 0);
  const bad = [
    { ...good, extra: 1 },                                                                    // sanitizeData 會丟掉未知欄位
    { ...good, doneDays: ['2026-10-15', '2026-10-14'] },                                      // 沒有嚴格遞增
    { ...good, session: { ...good.session, ids: [...good.session.ids.slice(0, -1), 'zz'] } }, // 剩下的 id 不存在
    { ...good, sentences: good.sentences.map((s) => (s === first ? { ...s, due: s.lastSeen } : s)) }, // due 沒有大於 lastSeen
  ];
  checkInvariants(good);
  for (const data of bad) assert.throws(() => checkInvariants(data), assert.AssertionError);
});

test('60 天模擬：全部通過', (t) => {
  const run = createRun();
  assert.equal(run.data.sentences.length, 55);
  assert.equal(run.data.settings.dailyCount, 10);
  const allSeenDay = runDays(run, 60, ALL_PASS);
  const lastDay = addDays(TODAY, 59);
  assert.equal(lastDay, '2026-12-12');
  assert.equal(run.cards, 600);
  assert.deepStrictEqual(streakInfo(run.data.doneDays, lastDay), { current: 60, best: 60, doneToday: true });
  t.diagnostic(`55 句全部出場：第 ${allSeenDay} 天（規格 6.6 為第 35 天）`);
  assert.ok(allSeenDay !== null && allSeenDay <= 40, `55 句全部出場在第 ${allSeenDay} 天，應不晚於第 40 天`);
});

test('60 天模擬：每第 7 張卡失敗', () => {
  const run = createRun();
  runDays(run, 60, EVERY_7TH_FAILS);
  assert.equal(run.cards, 600);
  assert.ok(run.data.sentences.some((s) => s.lastResult === 'fail'), '應該留下 lastResult 為 fail 的句子');
  assert.deepStrictEqual(streakInfo(run.data.doneDays, addDays(TODAY, 59)), { current: 60, best: 60, doneToday: true });
});

test('時鐘倒退：做完第 10 天後，以前一天的日期再做一次 session', () => {
  const run = createRun();
  runDays(run, 10, ALL_PASS);
  const day9 = addDays(TODAY, 8);
  assert.equal(day9, '2026-10-22');
  startDay(run, day9);
  playCards(run, ALL_PASS);
  const tenDays = Array.from({ length: 10 }, (_, i) => addDays(TODAY, i));
  assert.deepStrictEqual(run.data.doneDays, tenDays);
  const info = streakInfo(run.data.doneDays, day9);
  assert.ok(info.current >= 0 && info.best >= 0);
  assert.deepStrictEqual(info, { current: 9, best: 10, doneToday: true });
});

test('前一天沒做完：第 10 天只做 3 張，第 11 天新建 session', () => {
  const run = createRun();
  runDays(run, 9, ALL_PASS);
  const day10 = addDays(TODAY, 9);
  const day11 = addDays(TODAY, 10);
  assert.equal(day10, '2026-10-23');
  assert.equal(day11, '2026-10-24');
  startDay(run, day10);
  playCards(run, ALL_PASS, 3);
  assert.equal(run.data.session.index, 3);
  startDay(run, day11);
  assert.equal(run.data.doneDays.includes(day10), false);
  assert.equal(streakInfo(run.data.doneDays, day11).current, 0);
  playCards(run, ALL_PASS);
  assert.equal(streakInfo(run.data.doneDays, day11).current, 1);
});
