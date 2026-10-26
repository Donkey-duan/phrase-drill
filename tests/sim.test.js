// tests/sim.test.js：規格 10.6 的 120 天模擬（第 2 版）。內建 115 句、每天 10 句，從 2026-10-14 起；
// 每天先 startOrResumeSession，再反覆 completeCard 直到 currentCard 為 null，不呼叫 extendSession。
// 期望值是規格 6.6 的表格與 10.6 的第 120 天等級分布；每一步都檢查 10.6 的不變式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, startOrResumeSession, completeCard, currentCard, sanitizeData, topStage, startStage } from '../js/store.js';
import { addDays, streakInfo, levelCounts } from '../js/schedule.js';
import { SEED } from '../js/seed.js';
import { deepFreeze, TODAY } from './helpers.js';

const DAYS = 120;

// 6.6 的三個情境：情境函式收到 { card, sentence, stage, top }，card 與 sentence 都是跨天累計、從 1 起算的編號
const ALL_PASS = () => 'pass';
const EVERY_7TH_CARD_FAILS = ({ card }) => (card % 7 === 0 ? 'fail' : 'pass');
const EVERY_5TH_SENTENCE_TOP_FAILS = ({ sentence, stage, top }) => (sentence % 5 === 0 && stage === top ? 'fail' : 'pass');

// 10.6：每一步（每次 startOrResumeSession 與 completeCard 之後）都要成立的條件。
// repsTrack 是模擬自己記錄的「每句結束階梯的次數」，沒有記錄的句子視為 0
function checkInvariants(data, repsTrack) {
  const r = sanitizeData(deepFreeze(JSON.parse(JSON.stringify(data))));
  assert.deepStrictEqual(r.data, data);
  assert.deepStrictEqual(r.warnings, []);
  const byId = new Map(data.sentences.map((s) => [s.id, s]));
  const ss = data.session;
  if (ss !== null) {
    assert.equal(ss.results.length, ss.index, 'results.length 不等於 index');
    for (const id of ss.ids.slice(ss.index)) assert.ok(byId.has(id), 'session 剩下的 id ' + id + ' 不存在');
    if (ss.index < ss.ids.length) {
      assert.notEqual(currentCard(data), null);
      const s = byId.get(ss.ids[ss.index]);
      assert.ok(ss.stage >= startStage(s) && ss.stage <= topStage(s),
        ss.ids[ss.index] + ' 的 stage ' + ss.stage + ' 不在 ' + startStage(s) + ' 到 ' + topStage(s) + ' 之間');
    } else {
      assert.equal(ss.stage, 0, '做完時 stage 不是 0');
      assert.equal(ss.retry, false, '做完時 retry 不是 false');
    }
  }
  for (let i = 1; i < data.doneDays.length; i++) {
    assert.ok(data.doneDays[i - 1] < data.doneDays[i], 'doneDays 沒有嚴格遞增：' + data.doneDays.join(', '));
  }
  for (const s of data.sentences) {
    assert.equal(s.reps, repsTrack.get(s.id) || 0, s.id + ' 的 reps 不等於結束階梯的次數');
    if (s.reps === 0) continue;
    assert.ok(s.due !== null && s.lastSeen !== null, s.id + ' 的 due 或 lastSeen 是 null');
    assert.ok(s.due > s.lastSeen, s.id + ' 的 due ' + s.due + ' 沒有大於 lastSeen ' + s.lastSeen);
  }
  assert.deepStrictEqual(data.removedSeeds, [], 'removedSeeds 不是空陣列');
}

// 一次模擬的狀態
function createRun() {
  const data = createInitialData(deepFreeze(SEED));
  const run = {
    data,
    card: 0,              // 累計卡片編號
    sentence: 0,          // 累計句子編號（階梯的序號）
    ladder: null,         // 目前這段階梯的 session.day 與 index，用來判斷「這句當天的第一張卡」
    reps: new Map(),      // 每句結束階梯的次數
    failEnds: 0,          // 以 fail 結束的階梯數
    retried: false,       // 有沒有任何一次 completeCard 讓 retry 變成 true
  };
  checkInvariants(data, run.reps);
  return run;
}

// 以 day 開始練習（這一天必須新建 session），回傳 startOrResumeSession 之前的到期句數
function startDay(run, day) {
  const due = run.data.sentences.filter((s) => s.reps > 0 && s.due !== null && s.due <= day).length;
  const next = startOrResumeSession(deepFreeze(run.data), day);
  checkInvariants(next, run.reps);
  assert.notEqual(next.session, null);
  assert.equal(next.session.day, day);
  assert.equal(next.session.index, 0);
  assert.equal(next.session.ids.length, Math.min(next.settings.dailyCount, next.sentences.length));
  run.data = next;
  return due;
}

// 依序完成卡片，直到 currentCard 為 null 或做滿 limit 張；回傳這次完成的張數
function playCards(run, decide, limit = Infinity) {
  let n = 0;
  let c;
  while (n < limit && (c = currentCard(run.data)) !== null) {
    const ss = run.data.session;
    const key = ss.day + '#' + ss.index;
    if (run.ladder !== key) {                           // 這句當天的第一張卡：句子編號加一
      run.ladder = key;
      run.sentence += 1;
      assert.equal(c.stage, startStage(c.sentence), '階梯的第一張卡不是從 startStage 開始');
      assert.equal(c.retry, false);
    }
    run.card += 1;
    n += 1;
    const outcome = decide({ card: run.card, sentence: run.sentence, stage: c.stage, top: topStage(c.sentence) });
    const id = ss.ids[ss.index];
    const next = completeCard(deepFreeze(run.data), outcome);
    if (next.session.retry) run.retried = true;
    if (next.session.index !== ss.index) {                // 這句當天的階梯結束
      run.reps.set(id, (run.reps.get(id) || 0) + 1);
      if (outcome === 'fail') run.failEnds += 1;
    }
    checkInvariants(next, run.reps);
    run.data = next;
  }
  return n;
}

// 從 TODAY 起連續 days 天，每天做完整個 session；回傳每天的卡片數與到期句數，以及 115 句全部出場的那一天（沒有時為 null）
function runDays(run, days, decide) {
  const log = [];
  let allSeenDay = null;
  for (let d = 1; d <= days; d++) {
    const due = startDay(run, addDays(TODAY, d - 1));
    const cards = playCards(run, decide);
    assert.equal(currentCard(run.data), null);
    if (allSeenDay === null && run.data.sentences.every((s) => s.reps > 0)) allSeenDay = d;
    log.push({ cards, due });
  }
  return { log, allSeenDay };
}

// 6.6 的統計：最少、最多與平均（四捨五入到小數一位，寫成字串以便和表格逐字比對）
function stats(values) {
  const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  return { min: Math.min(...values), max: Math.max(...values), avg: avg.toFixed(1) };
}

// 跑一個情境 120 天，回傳 6.6 表格的欄位與第 120 天的等級分布
function simulate(decide) {
  const run = createRun();
  assert.equal(run.data.sentences.length, 115);
  assert.equal(run.data.settings.dailyCount, 10);
  const { log, allSeenDay } = runDays(run, DAYS, decide);
  const stable = log.slice(90, 120);                      // 穩定期：第 91 到 120 天
  return {
    run,
    allSeenDay,
    cards: stats(stable.map((x) => x.cards)),
    due: stats(stable.map((x) => x.due)),
    levels: levelCounts(run.data.sentences),
    streak: streakInfo(run.data.doneDays, addDays(TODAY, DAYS - 1)),
  };
}

const report = (t, name, r) => t.diagnostic(name + '：115 句全部出場 ' + r.allSeenDay + '、卡片數 ' + JSON.stringify(r.cards)
  + '、到期句數 ' + JSON.stringify(r.due) + '、第 120 天 ' + JSON.stringify(r.levels));

test('不變式檢查抓得到壞資料', () => {
  const run = createRun();
  startDay(run, TODAY);
  playCards(run, ALL_PASS, 4);                             // s01 從全句提示爬到議題應用，結束當天的階梯
  const good = run.data;
  assert.equal(good.session.index, 1);
  const first = good.sentences.find((s) => s.reps > 0);
  const bad = [
    { ...good, extra: 1 },                                                                      // sanitizeData 會丟掉未知欄位
    { ...good, doneDays: ['2026-10-15', '2026-10-14'] },                                        // 沒有嚴格遞增
    { ...good, session: { ...good.session, ids: [...good.session.ids.slice(0, -1), 'zz'] } },   // 剩下的 id 不存在
    { ...good, sentences: good.sentences.map((s) => (s === first ? { ...s, due: s.lastSeen } : s)) },   // due 沒有大於 lastSeen
    { ...good, sentences: good.sentences.map((s) => (s === first ? { ...s, reps: 2 } : s)) },   // reps 與結束階梯的次數不符
    { ...good, removedSeeds: ['s01'] },                                                         // removedSeeds 不是空陣列
    { ...good, session: { ...good.session, index: good.session.ids.length, results: good.session.ids.map(() => 'pass'), stage: 1 } },   // 做完時 stage 不是 0
  ];
  checkInvariants(good, run.reps);
  for (const data of bad) assert.throws(() => checkInvariants(data, run.reps), assert.AssertionError);
});

test('120 天模擬：全部通過', (t) => {
  const r = simulate(ALL_PASS);
  report(t, '全部通過', r);
  assert.equal(r.allSeenDay, 74);
  assert.deepStrictEqual(r.cards, { min: 20, max: 20, avg: '20.0' });
  assert.deepStrictEqual(r.due, { min: 0, max: 0, avg: '0.0' });
  assert.deepStrictEqual(r.levels, { fresh: 0, l0: 0, l1: 0, l2: 115 });
  assert.deepStrictEqual(r.streak, { current: 120, best: 120, doneToday: true });
  assert.equal(r.run.failEnds, 0);
});

test('120 天模擬：每第 7 張卡沒過', (t) => {
  const r = simulate(EVERY_7TH_CARD_FAILS);
  report(t, '每第 7 張卡沒過', r);
  assert.equal(r.allSeenDay, 74);
  assert.deepStrictEqual(r.cards, { min: 23, max: 24, avg: '23.3' });
  assert.deepStrictEqual(r.due, { min: 0, max: 0, avg: '0.0' });
  assert.deepStrictEqual(r.levels, { fresh: 0, l0: 0, l1: 0, l2: 115 });
  assert.deepStrictEqual(r.streak, { current: 120, best: 120, doneToday: true });
  assert.equal(r.run.retried, true, '至少要有一次 completeCard 讓 retry 變成 true');
  assert.equal(r.run.failEnds, 0, '這個情境不應有任何一句以 fail 結束');
  assert.ok(r.run.data.sentences.every((s) => s.lastResult === 'pass'));
});

test('120 天模擬：每第 5 句的最後一階沒過', (t) => {
  const r = simulate(EVERY_5TH_SENTENCE_TOP_FAILS);
  report(t, '每第 5 句的最後一階沒過', r);
  assert.equal(r.allSeenDay, null);
  assert.deepStrictEqual(r.cards, { min: 24, max: 30, avg: '25.0' });
  assert.deepStrictEqual(r.due, { min: 7, max: 20, avg: '13.0' });
  assert.deepStrictEqual(r.levels, { fresh: 40, l0: 0, l1: 2, l2: 73 });
  assert.equal(r.run.data.sentences.filter((s) => s.reps === 0).length, 40);
  assert.deepStrictEqual(r.streak, { current: 120, best: 120, doneToday: true });
  assert.equal(r.run.failEnds, Math.floor(r.run.sentence / 5), '以 fail 結束的句數應等於句子編號是 5 的倍數的句數');
});

test('時鐘倒退：跑完第 10 天後，以前一天的日期再開一次 session 並做完', () => {
  const run = createRun();
  runDays(run, 10, ALL_PASS);
  const day9 = addDays(TODAY, 8);
  assert.equal(day9, '2026-10-22');
  assert.doesNotThrow(() => {
    startDay(run, day9);
    playCards(run, ALL_PASS);
  });
  const tenDays = Array.from({ length: 10 }, (_, i) => addDays(TODAY, i));
  assert.deepStrictEqual(run.data.doneDays, tenDays);
  const info = streakInfo(run.data.doneDays, day9);
  assert.ok(info.current >= 0 && info.best >= 0);
  assert.deepStrictEqual(info, { current: 9, best: 10, doneToday: true });
});

test('前一天沒做完：第 10 天只做 3 張卡，第 11 天新建 session，舊 session 的 stage 與 retry 一併丟棄', () => {
  const run = createRun();
  runDays(run, 9, ALL_PASS);
  const day10 = addDays(TODAY, 9);
  const day11 = addDays(TODAY, 10);
  assert.equal(day10, '2026-10-23');
  assert.equal(day11, '2026-10-24');
  startDay(run, day10);
  playCards(run, ALL_PASS, 3);
  assert.ok(run.data.session.index < run.data.session.ids.length);
  startDay(run, day11);
  const first = run.data.sentences.find((s) => s.id === run.data.session.ids[0]);
  assert.equal(run.data.session.stage, startStage(first));
  assert.equal(run.data.session.retry, false);
  assert.equal(run.data.doneDays.includes(day10), false);
  assert.equal(streakInfo(run.data.doneDays, day11).current, 0);
  playCards(run, ALL_PASS);
  assert.equal(streakInfo(run.data.doneDays, day11).current, 1);
});
