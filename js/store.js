// js/store.js：資料結構、資料變更、句子驗證與 session 推進。只 import drill.js 與 schedule.js
import { canonicalize, nonTypeableChars, wordCount } from './drill.js';
import { daysBetween, compareDay, applyResult, isDay, pickToday } from './schedule.js';

/**
 * @typedef {string} Day                  'YYYY-MM-DD'，本地日期，凌晨 4 點換日
 * @typedef {0|1|2} Level                 0 全句提示、1 首字母提示、2 背誦
 * @typedef {'pass'|'fail'} Outcome
 *
 * @typedef {Object} Sentence
 * @property {string} id                  內建 's01' 到 's55'；自訂為 'u' + Date.now().toString(36) + 4 碼 base36 亂數
 * @property {string} text                canonical 英文句，只含可列印 ASCII，顯示與比對都用它
 * @property {string} zh                  中文意思，已 trim，可為 ''
 * @property {Level} level
 * @property {number} streak              目前層級的連續通過次數；在 L2 時兼作間隔階梯索引
 * @property {Day|null} due               下次到期日；reps 為 0 時一定是 null
 * @property {Day|null} lastSeen
 * @property {Outcome|null} lastResult
 * @property {number} reps                總練習次數，0 代表未開始
 *
 * @typedef {Object} Session
 * @property {Day} day                    建立的那一天，completeCard 以它當作今天
 * @property {string[]} ids               出題順序，不重複，至少一個
 * @property {number} index               下一張卡的位置，0 到 ids.length
 * @property {Outcome[]} results          長度恆等於 index
 *
 * @typedef {Object} AppData
 * @property {1} schema
 * @property {{ dailyCount: number, lastExport: Day|null }} settings   dailyCount 為 5、10、15、20、25、30 之一，預設 10
 * @property {Sentence[]} sentences       陣列順序就是句子庫的顯示順序與新句出場順序
 * @property {Day[]} doneDays             完成當天練習的日期，遞增且不重複
 * @property {Session|null} session
 *
 * @typedef {{ id: string, text: string, zh: string }} SeedItem
 */

export const SCHEMA = 1;
export const DATA_KEY = 'phrase-drill:data';
export const UNDO_KEY = 'phrase-drill:undo';
export const CORRUPT_KEY = 'phrase-drill:corrupt';
export const DAILY_OPTIONS = [5, 10, 15, 20, 25, 30];
export const DEFAULT_DAILY = 10;
export const BACKUP_REMIND_DAYS = 14;
export const MAX_TEXT_LENGTH = 300;
export const MAX_ZH_LENGTH = 200;

/** @param {SeedItem[]} seed @returns {AppData} */
export function createInitialData(seed) {
  return {
    schema: SCHEMA,
    settings: { dailyCount: DEFAULT_DAILY, lastExport: null },
    sentences: seed.map((s) => ({
      id: s.id, text: s.text, zh: s.zh,
      level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0,
    })),
    doneDays: [],
    session: null,
  };
}

/**
 * 依規格 7.5 的順序檢查，回傳第一個成立的錯誤；全部通過時回傳 canonical 英文與 trim 後的中文。
 * @param {AppData} data @param {string} text @param {string} zh @param {string|null} editingId
 */
export function validateSentenceInput(data, text, zh, editingId) {
  const canonical = canonicalize(text);
  const textError = (error) => ({ ok: false, field: 'text', error });
  if (canonical === '') return textError('請輸入英文句子');
  const bad = nonTypeableChars(canonical);
  if (bad.length > 0) {
    const shown = bad.map((ch) => {
      const cp = ch.codePointAt(0);
      const hidden = /[\p{C}\p{Z}\p{M}]/u.test(ch);   // 看不見或無法單獨顯示的字元
      return '「' + (hidden ? 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') : ch) + '」';
    });
    return textError('有英文鍵盤打不出的字元：' + shown.join('') + '，請改寫');
  }
  if (!/[A-Za-z]/.test(canonical)) return textError('英文句子至少要有一個英文字母');
  if (wordCount(canonical) < 2) return textError('請輸入至少兩個字的句子');
  if (canonical.length > MAX_TEXT_LENGTH) return textError('英文句子請在 300 字元以內');
  const lower = canonical.toLowerCase();
  if (data.sentences.some((s) => s.id !== editingId && s.text.toLowerCase() === lower)) {
    return textError('句子庫裡已經有相同的句子');
  }
  const zhTrimmed = zh.trim();
  if (zhTrimmed.length > MAX_ZH_LENGTH) return { ok: false, field: 'zh', error: '中文意思請在 200 字以內' };
  return { ok: true, text: canonical, zh: zhTrimmed };
}

/** 新句插在最前面，進度都是初始值；text 與 zh 在這裡再正規化一次。 */
export function addSentence(data, { id, text, zh }) {
  const s = {
    id, text: canonicalize(text), zh: zh.trim(),
    level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0,
  };
  return { ...data, sentences: [s, ...data.sentences] };
}

/** 英文的 canonical 形式有變（區分大小寫）時重設進度；只改中文或 canonical 相同時進度不動。 */
export function updateSentence(data, id, { text, zh }, today) {
  const t = canonicalize(text);
  const z = zh.trim();
  return {
    ...data,
    sentences: data.sentences.map((s) => {
      if (s.id !== id) return s;
      if (t === s.text) return { ...s, text: t, zh: z };
      return { ...s, text: t, zh: z, level: 0, streak: 0, lastResult: null, due: s.reps > 0 ? today : null };
    }),
  };
}

/** 只接受 DAILY_OPTIONS 內的值，其他值原樣回傳 data；今天已建立的 session 不動。 */
export function setDailyCount(data, n) {
  if (!DAILY_OPTIONS.includes(n)) return data;
  return { ...data, settings: { ...data.settings, dailyCount: n } };
}

/** 把 lastExport 設為 today。 */
export function markExported(data, today) {
  return { ...data, settings: { ...data.settings, lastExport: today } };
}

/** day 已存在時原樣回傳；否則插入後排序，保證遞增而且不重複。 */
export function addDoneDay(days, day) {
  if (days.includes(day)) return days;
  return [...days, day].sort(compareDay);
}

/** 開始或繼續今天的練習，規則見規格 6.4。 */
export function startOrResumeSession(data, today) {
  const s = data.session;
  if (s && s.day === today) {
    if (s.index >= s.ids.length) return { ...data, doneDays: addDoneDay(data.doneDays, s.day) };  // 已完成，冪等
    const exists = new Set(data.sentences.map((x) => x.id));
    const done = s.ids.slice(0, s.index);
    const rest = s.ids.slice(s.index).filter((id) => exists.has(id));
    if (rest.length === 0) {
      if (done.length === 0) return { ...data, session: null };
      return { ...data, session: { ...s, ids: done }, doneDays: addDoneDay(data.doneDays, s.day) };
    }
    return { ...data, session: { ...s, ids: done.concat(rest) } };
  }
  const ids = pickToday(data.sentences, today, data.settings.dailyCount);
  return { ...data, session: ids.length ? { day: today, ids, index: 0, results: [] } : null };
}

/** 回傳 ids[index] 對應的句子；沒有 session、已經做完或找不到時回傳 null。 */
export function currentSentence(data) {
  const s = data.session;
  if (!s || s.index >= s.ids.length) return null;
  const id = s.ids[s.index];
  return data.sentences.find((x) => x.id === id) || null;
}

/** 把目前這一句的結果寫回原位置並推進 session；以 session.day 當作今天。沒有進行中的卡片時 throw。 */
export function completeCard(data, outcome) {
  const cur = currentSentence(data);
  if (cur === null) throw new Error('completeCard：沒有進行中的卡片');
  const s = data.session;
  const updated = applyResult(cur, outcome, s.day);
  const isLast = s.index + 1 === s.ids.length;
  return {
    ...data,
    sentences: data.sentences.map((x) => (x.id === cur.id ? updated : x)),
    doneDays: isLast ? addDoneDay(data.doneDays, s.day) : data.doneDays,
    session: { ...s, index: s.index + 1, results: [...s.results, outcome] },
  };
}

/** 移除句子，再依規格 7.5 調整 session：過期的 session 丟棄，今天的 session 去掉這個 id。 */
export function deleteSentence(data, id, today) {
  const next = { ...data, sentences: data.sentences.filter((x) => x.id !== id) };
  const s = data.session;
  if (!s) return next;
  if (s.day !== today) return { ...next, session: null };
  const done = s.ids.slice(0, s.index);
  const rest = s.ids.slice(s.index).filter((x) => x !== id);
  if (done.length === 0 && rest.length === 0) return { ...next, session: null };
  if (s.index < s.ids.length && rest.length === 0) {
    return { ...next, session: { ...s, ids: done }, doneDays: addDoneDay(data.doneDays, s.day) };
  }
  return { ...next, session: { ...s, ids: done.concat(rest) } };
}

/** 首頁的今日進度：依 done、empty、continue、start 的順序判斷。 */
export function todayStatus(data, today) {
  const s = data.session;
  const isToday = !!s && s.day === today;
  const n = data.sentences.length;
  if (data.doneDays.includes(today)) {
    const total = isToday ? s.ids.length : Math.min(data.settings.dailyCount, n);
    return { kind: 'done', done: total, total };
  }
  if (n === 0) return { kind: 'empty', done: 0, total: 0 };
  if (isToday && s.index < s.ids.length) return { kind: 'continue', done: s.index, total: s.ids.length };
  return { kind: 'start', done: 0, total: Math.min(data.settings.dailyCount, n) };
}

/** 備份提醒文字；不需要提醒時回傳 null。 */
export function backupReminder(data, today) {
  const last = data.settings.lastExport;
  if (last === null) return data.doneDays.length >= 3 ? '還沒有匯出過備份' : null;
  const n = daysBetween(last, today);
  return n > BACKUP_REMIND_DAYS ? '已經 ' + n + ' 天沒有匯出備份' : null;
}

// ===== 第 8 任務：sanitizeData、載入存檔、匯出匯入、undo 與 corrupt =====

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function throwDataError(message) {
  const e = new Error(message); e.name = 'DataError'; throw e;
}

function isPlainObject(x) {
  if (x === null || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const isNonNegInt = (x) => Number.isInteger(x) && x >= 0;

/** 7.4 的句子規則；不合格時回傳 null。id 重複由 sanitizeData 檢查。 */
function sanitizeSentence(x) {
  if (!isPlainObject(x) || typeof x.id !== 'string' || !ID_PATTERN.test(x.id) || typeof x.text !== 'string') return null;
  const text = canonicalize(x.text);
  if (text === '' || nonTypeableChars(text).length > 0 || !/[A-Za-z]/.test(text)) return null;
  const zh = typeof x.zh === 'string' ? x.zh.trim() : '';
  const reps = isNonNegInt(x.reps) ? x.reps : 0;
  if (reps === 0) {
    return { id: x.id, text, zh, level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 };
  }
  return {
    id: x.id,
    text,
    zh,
    level: Number.isInteger(x.level) ? Math.min(2, Math.max(0, x.level)) : 0,
    streak: isNonNegInt(x.streak) ? x.streak : 0,
    due: isDay(x.due) ? x.due : null,
    lastSeen: isDay(x.lastSeen) ? x.lastSeen : null,
    lastResult: x.lastResult === 'pass' || x.lastResult === 'fail' ? x.lastResult : null,
    reps,
  };
}

/** 7.4 的 session 規則；任一條不成立就回傳 null。ids 不檢查句子是否存在。 */
function sanitizeSession(s) {
  if (!isPlainObject(s) || !isDay(s.day)) return null;
  const { ids, index, results } = s;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (!Number.isInteger(index) || index < 0 || index > ids.length) return null;
  if (!Array.isArray(results) || results.length !== index) return null;
  if (!results.every((r) => r === 'pass' || r === 'fail')) return null;
  return { day: s.day, ids: ids.slice(), index, results: results.slice() };
}

/**
 * 7.4：驗證並重建整份資料，未知欄位丟掉。只在三種情況丟出 name 為 'DataError' 的 Error。
 * @returns {{ data: AppData, warnings: string[] }}
 */
export function sanitizeData(raw) {
  if (!isPlainObject(raw)) throwDataError('格式不是物件');
  if (raw.schema !== SCHEMA) throwDataError('schema 不符');
  if (!Array.isArray(raw.sentences)) throwDataError('sentences 不是陣列');
  const seen = new Set();
  const sentences = [];
  let dropped = 0;
  for (const x of raw.sentences) {
    const s = sanitizeSentence(x);
    if (s === null || seen.has(s.id)) { dropped += 1; continue; }   // 只有合格的句子才登記 id
    seen.add(s.id);
    sentences.push(s);
  }
  const st = isPlainObject(raw.settings) ? raw.settings : {};
  const settings = {
    dailyCount: DAILY_OPTIONS.includes(st.dailyCount) ? st.dailyCount : DEFAULT_DAILY,
    lastExport: isDay(st.lastExport) ? st.lastExport : null,
  };
  const doneDays = Array.isArray(raw.doneDays) ? [...new Set(raw.doneDays.filter((d) => isDay(d)))].sort() : [];
  const warnings = dropped > 0 ? ['有 ' + dropped + ' 句資料不完整，或含有英文鍵盤打不出的字元，已略過'] : [];
  return { data: { schema: SCHEMA, settings, sentences, doneDays, session: sanitizeSession(raw.session) }, warnings };
}

/** 7.6：去掉 session 的 AppData 加上檔頭，縮排 2 格。 */
export function toBackupJSON(data, today, nowIso) {
  const payload = {
    app: 'phrase-drill',
    schema: SCHEMA,
    exportedDay: today,
    exportedAt: nowIso,
    settings: data.settings,
    sentences: data.sentences,
    doneDays: data.doneDays,
  };
  return JSON.stringify(payload, null, 2);
}

/** 7.6：依序檢查，失敗回傳 { ok: false, error }。sanitizeData 丟出 DataError 以外的例外不攔截。 */
export function fromBackupJSON(text) {
  const fail = (error) => ({ ok: false, error });
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return fail('不是有效的 JSON');
  }
  if (!isPlainObject(obj)) return fail('這不是句練的備份檔');
  const hasApp = Object.prototype.hasOwnProperty.call(obj, 'app');
  if (hasApp && obj.app !== 'phrase-drill') return fail('這不是句練的備份檔');
  if (!hasApp && !Array.isArray(obj.sentences)) return fail('這不是句練的備份檔');
  if (Number.isInteger(obj.schema) && obj.schema > SCHEMA) return fail('備份來自較新版本，請先更新 app');
  let res;
  try {
    res = sanitizeData({ ...obj, session: null });
  } catch (e) {
    if (e && e.name === 'DataError') return fail('備份內容無法讀取：' + e.message);
    throw e;
  }
  if (res.data.sentences.length === 0) return fail('備份裡沒有任何句子');
  return {
    ok: true,
    data: res.data,
    warnings: res.warnings,
    summary: {
      sentences: res.data.sentences.length,
      days: res.data.doneDays.length,
      exportedDay: isDay(obj.exportedDay) ? obj.exportedDay : null,
    },
  };
}

const RESET_WARNING = '主資料讀取失敗，已重建內建句子庫；原始資料已另存，可到『設定 > 診斷』複製';
const RAW_SAVED_WARNING = '原始資料已另存，可到『設定 > 診斷』複製';

/** 7.3：整份寫入 data key；setItem 失敗（例如 QuotaExceededError）時直接 throw。 */
export function save(storage, data) {
  storage.setItem(DATA_KEY, JSON.stringify(data));
}

// corrupt key 只有一份，每次直接覆寫
function writeCorrupt(storage, raw, nowIso) {
  storage.setItem(CORRUPT_KEY, JSON.stringify({ at: nowIso, raw }));
}

function rebuildFromSeed(storage, seed, raw, nowIso) {
  writeCorrupt(storage, raw, nowIso);
  const data = createInitialData(seed);
  save(storage, data);
  return { status: 'reset', data, warnings: [RESET_WARNING] };
}

/**
 * 7.3：依 seeded、newer、reset、ok 的順序判斷。
 * 只在 JSON.parse 與 sanitizeData 外面包 try/catch；storage 的例外與 DataError 以外的例外都原樣往上丟。
 */
export function load(storage, seed, nowIso) {
  const raw = storage.getItem(DATA_KEY);
  if (raw === null) {
    const data = createInitialData(seed);
    save(storage, data);
    return { status: 'seeded', data, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return rebuildFromSeed(storage, seed, raw, nowIso);
  }
  if (isPlainObject(parsed) && Number.isInteger(parsed.schema) && parsed.schema > SCHEMA) {
    return { status: 'newer', data: null, warnings: [] };
  }
  let res;
  try {
    res = sanitizeData(parsed);
  } catch (e) {
    if (e && e.name === 'DataError') return rebuildFromSeed(storage, seed, raw, nowIso);
    throw e;
  }
  if (res.warnings.length === 0) return { status: 'ok', data: res.data, warnings: [] };
  writeCorrupt(storage, raw, nowIso);
  save(storage, res.data);
  return { status: 'ok', data: res.data, warnings: res.warnings.concat([RAW_SAVED_WARNING]) };
}

/** 7.3：匯入或清除所有資料之前呼叫；setItem 失敗時直接 throw，由呼叫端接住。 */
export function writeUndo(storage, data, reason, nowIso) {
  storage.setItem(UNDO_KEY, JSON.stringify({ at: nowIso, reason, json: JSON.stringify(data) }));
}

/** 7.6：解析並 sanitize undo 的內容；任何失敗都回傳 null。 */
export function readUndo(storage) {
  try {
    const u = JSON.parse(storage.getItem(UNDO_KEY));
    if (!isPlainObject(u) || typeof u.at !== 'string' || typeof u.json !== 'string') return null;
    if (u.reason !== 'import' && u.reason !== 'clear') return null;
    return { at: u.at, reason: u.reason, data: sanitizeData(JSON.parse(u.json)).data };
  } catch (e) {
    return null;
  }
}

export function clearUndo(storage) {
  storage.removeItem(UNDO_KEY);
}

/** 7.3：key 不存在、無法解析，或 at 與 raw 不是字串時回傳 null。 */
export function readCorrupt(storage) {
  try {
    const c = JSON.parse(storage.getItem(CORRUPT_KEY));
    if (!isPlainObject(c) || typeof c.at !== 'string' || typeof c.raw !== 'string') return null;
    return { at: c.at, raw: c.raw };
  } catch (e) {
    return null;
  }
}

export function clearCorrupt(storage) {
  storage.removeItem(CORRUPT_KEY);
}
