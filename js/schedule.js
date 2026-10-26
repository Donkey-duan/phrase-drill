// js/schedule.js：純函式，不 import 任何模組。日期一律是本地時間的 'YYYY-MM-DD' 字串，凌晨 4 點換日
/** @typedef {string} Day  'YYYY-MM-DD' */

export const ROLLOVER_HOUR = 4;
export const PROMOTE_AFTER = 2;
export const L2_INTERVALS = [2, 4, 7, 14, 30];
export const LEVEL_NAMES = ['全句提示', '首字母提示', '背誦'];

function fmt(y, m, d) {                                                // 補零成 YYYY-MM-DD
  return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** @param {Date} now @param {number} [rolloverHour] @returns {Day} */
export function localDay(now, rolloverHour = ROLLOVER_HOUR) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - rolloverHour);
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());          // 不用 toISOString
}

function utc(day) {                                                    // Day 在 UTC 午夜的毫秒數
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** @param {Day} day @param {number} n @returns {Day} */
export function addDays(day, n) {                                      // 以 Date.UTC 解析與格式化，和時區無關
  const t = new Date(utc(day) + n * 86400000);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** @param {Day} from @param {Day} to @returns {number} */
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86400000);

/** @param {unknown} s @returns {boolean} */
export const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

/**
 * @param {Day[]} doneDays
 * @param {Day} today
 * @returns {{ current: number, best: number, doneToday: boolean }}
 */
export function streakInfo(doneDays, today) {
  const done = new Set(doneDays);
  const doneToday = done.has(today);
  let current = 0;                                                     // 今天還沒練時從昨天往回數
  for (let d = doneToday ? today : addDays(today, -1); done.has(d); d = addDays(d, -1)) current += 1;
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...done].sort()) {                                  // 比 today 晚的日期也算進 best
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return { current, best: Math.max(best, current), doneToday };
}

/**
 * 依練習結果升降級並排定下次到期日（6.2）。
 * @param {Sentence} s
 * @param {Outcome} outcome
 * @param {Day} today
 * @returns {Sentence}
 */
export function applyResult(s, outcome, today) {           // 回傳新物件，不修改 s
  const next = { ...s, reps: s.reps + 1, lastSeen: today, lastResult: outcome };
  if (outcome === 'fail') {
    next.level = Math.max(0, s.level - 1); next.streak = 0; next.due = addDays(today, 1);
    return next;
  }
  const st = s.streak + 1;
  if (s.level < 2) {
    if (st >= PROMOTE_AFTER) { next.level = s.level + 1; next.streak = 0; } else next.streak = st;
    next.due = addDays(today, 1);
  } else {
    next.streak = st;
    next.due = addDays(today, L2_INTERVALS[Math.min(st, L2_INTERVALS.length) - 1]);
  }
  return next;
}

/**
 * 直接比較兩個 YYYY-MM-DD 字串：小於回傳 -1、大於回傳 1、相等回傳 0（6.3）。
 * @param {Day} a
 * @param {Day} b
 * @returns {number}
 */
export function compareDay(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 規則同 compareDay，但 null 排在所有日期之前，兩個 null 視為相等（6.3）。
 * @param {Day|null} a
 * @param {Day|null} b
 * @returns {number}
 */
export function compareDayNullFirst(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return compareDay(a, b);
}

/**
 * 挑出今天要練的句子，回傳 id 陣列，順序就是出題順序（6.3）。
 * 第一段到期的舊句、第二段新句（依陣列順序）、第三段未到期的舊句（提前複習）。
 * @param {Sentence[]} sentences
 * @param {Day} today
 * @param {number} count
 * @returns {string[]}
 */
export function pickToday(sentences, today, count) {
  const pos = new Map(sentences.map((s, i) => [s.id, i]));
  const weakFirst = (a, b) =>
    (a.lastResult === 'fail' ? 0 : 1) - (b.lastResult === 'fail' ? 0 : 1)   // 最近打錯的在前
    || a.level - b.level                                                    // 不熟的在前
    || compareDayNullFirst(a.lastSeen, b.lastSeen)                          // 最久沒練的在前
    || pos.get(a.id) - pos.get(b.id);                                       // 陣列位置在前
  const practiced = sentences.filter((s) => s.reps > 0);
  const due   = practiced.filter((s) => s.due === null || s.due <= today).sort(weakFirst);
  const fresh = sentences.filter((s) => s.reps === 0);                      // 依陣列順序
  const ahead = practiced.filter((s) => s.due !== null && s.due > today)
                         .sort((a, b) => compareDay(a.due, b.due) || weakFirst(a, b));
  return [...due, ...fresh, ...ahead].slice(0, Math.min(count, sentences.length)).map((s) => s.id);
}

/**
 * 各層級的句數（6.5）：fresh 是 reps 為 0 的句子，l0、l1、l2 只計 reps 大於 0 的句子。
 * @param {Sentence[]} sentences
 * @returns {{ fresh: number, l0: number, l1: number, l2: number }}
 */
export function levelCounts(sentences) {
  const c = { fresh: 0, l0: 0, l1: 0, l2: 0 };
  for (const s of sentences) {
    if (s.reps === 0) c.fresh += 1;
    else if (s.level === 0) c.l0 += 1;
    else if (s.level === 1) c.l1 += 1;
    else c.l2 += 1;
  }
  return c;
}

/**
 * 句子庫的層級標籤（6.5）：未開始、全句、首字母、背誦。
 * @param {Sentence} s
 * @returns {string}
 */
export function levelLabel(s) {
  if (s.reps === 0) return '未開始';
  return ['全句', '首字母', '背誦'][s.level];
}

/**
 * 句子庫的到期標籤（6.5）：空白、今天，或不補零的 M/D。
 * @param {Sentence} s
 * @param {Day} today
 * @returns {string}
 */
export function dueLabel(s, today) {
  if (s.reps === 0) return '';
  if (s.due === null || s.due <= today) return '今天';
  const [, m, d] = s.due.split('-');
  return Number(m) + '/' + Number(d);            // '2026-11-03' → '11/3'
}

/**
 * 卡片完成後狀態列的結果訊息（6.2）；after 是 applyResult(before, outcome, day) 的回傳值。
 * @param {Sentence} before
 * @param {Sentence} after
 * @param {Outcome} outcome
 * @returns {string}
 */
export function resultMessage(before, after, outcome) {
  if (outcome === 'fail') {
    if (after.level < before.level) return '沒過，下次退回' + LEVEL_NAMES[after.level];
    return '沒過，下次仍是全句提示';
  }
  if (after.level > before.level) return '通過，下次升到' + LEVEL_NAMES[after.level];
  if (after.level < 2) return '通過，再 ' + (PROMOTE_AFTER - after.streak) + ' 次升到' + LEVEL_NAMES[after.level + 1];
  return '通過，維持背誦';
}
