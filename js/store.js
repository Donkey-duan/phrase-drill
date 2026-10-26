// js/store.js：資料結構、資料變更、句子驗證、session 階梯、sanitizeData、載入存檔、匯出匯入與 undo。只 import drill.js 與 schedule.js
// 骨架只在 drill.js 解析：這裡只呼叫 stripBraces 與 normalizeFrame，並存取 frame 字串（規格 §3 第 13 條）
import { canonicalize, nonTypeableChars, wordCount, stripBraces, normalizeFrame } from './drill.js';
import { daysBetween, compareDay, applyResult, isDay, pickToday } from './schedule.js';

/**
 * @typedef {string} Day                  'YYYY-MM-DD'，本地日期，凌晨 4 點換日
 * @typedef {0|1|2} Level                 這句下次出場時從哪一個階段開始：0 全句提示、1 首字母提示、2 背誦
 * @typedef {0|1|2|3} Stage               階梯上的階段：0 全句提示、1 首字母提示、2 背誦、3 議題應用
 * @typedef {'pass'|'fail'} Outcome
 *
 * @typedef {Object} Sentence
 * @property {string} id                  內建 's01' 到 's115'；自訂為 'u' + Date.now().toString(36) + 4 碼 base36 亂數
 * @property {string} text                canonical 英文句，只含可列印 ASCII，顯示與比對都用它
 * @property {string} zh                  中文意思，已 trim，可為 ''
 * @property {string} frame               '' 或經過 normalizeFrame 的句型骨架；不為 '' 時 canonicalize(stripBraces(frame)) === text
 * @property {string[]} topics            0 到 6 個議題，每個已 trim、非空、不超過 40 個字元；只用來顯示，不打字
 * @property {Level} level
 * @property {number} streak              在 L2 時是間隔階梯索引；level 小於 2 時第 2 版只會寫入 0（第 1 版資料可能是 1）
 * @property {Day|null} due               下次到期日；reps 為 0 時一定是 null
 * @property {Day|null} lastSeen          最後一次結束階梯的 session.day
 * @property {Outcome|null} lastResult    最後一次階梯的結果
 * @property {number} reps                結束階梯的次數（不是卡片數），0 代表未開始
 *
 * @typedef {Object} Session
 * @property {Day} day                    建立的那一天，completeCard 以它當作今天
 * @property {string[]} ids               出題順序，不重複，至少一個；加練時新的一批接在尾端
 * @property {number} index               目前這句的位置，0 到 ids.length
 * @property {Outcome[]} results          每句結束時推入一筆，長度恆等於 index
 * @property {Stage} stage                ids[index] 正在做的階段；index === ids.length 時為 0
 * @property {boolean} retry              目前這個階段是不是第二次嘗試；index === ids.length 時為 false
 *
 * @typedef {Object} AppData
 * @property {2} schema
 * @property {{ dailyCount: number, lastExport: Day|null }} settings   dailyCount 為 5、10、15、20、25、30 之一，預設 10，意思是每天幾句
 * @property {Sentence[]} sentences       陣列順序就是句子庫的顯示順序與新句出場順序
 * @property {Day[]} doneDays             完成當天練習的日期，遞增且不重複
 * @property {string[]} removedSeeds      使用者刪過的內建句 id（符合 /^s\d{2,3}$/），不重複，依數字部分由小到大排序；mergeSeed 不把它們加回來
 * @property {Session|null} session
 *
 * @typedef {{ id: string, frame: string, zh: string, topics: string[] }} SeedItem   text 由 normalizeFrame(frame).text 導出
 */

export const SCHEMA = 2;
export const DATA_KEY = 'phrase-drill:data';
export const UNDO_KEY = 'phrase-drill:undo';
export const CORRUPT_KEY = 'phrase-drill:corrupt';
export const DAILY_OPTIONS = [5, 10, 15, 20, 25, 30];
export const DEFAULT_DAILY = 10;
export const BACKUP_REMIND_DAYS = 14;
export const MAX_TEXT_LENGTH = 300;
export const MAX_ZH_LENGTH = 200;
export const MAX_TOPICS = 6;
export const MAX_TOPIC_LENGTH = 40;

const SEED_ID = /^s\d{2,3}$/;                          // 模組層級的常數，deleteSentence 也用它，不 export

// removedSeeds 依 id 的數字部分由小到大排序，s99 排在 s100 前面；deleteSentence 與 sanitizeData 共用，不 export
function bySeedNumber(a, b) {
  return Number(a.slice(1)) - Number(b.slice(1));
}

// ===== 建立資料、驗證與資料變更（規格 7.5） =====

function seedSentence(item) {                        // createInitialData 與 mergeSeed 共用，不 export
  const t = normalizeFrame(item.frame);
  if (!t.ok) throw new Error('內建句 ' + item.id + ' 的骨架不合格：' + t.error);
  return { id: item.id, text: t.text, zh: item.zh, frame: t.frame, topics: item.topics.slice(),
           level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 };
}

/** 7.5：schema 2、dailyCount 10、lastExport null，doneDays 與 removedSeeds 為空陣列，session 為 null。 @param {SeedItem[]} seed @returns {AppData} */
export function createInitialData(seed) {
  return {
    schema: SCHEMA,
    settings: { dailyCount: DEFAULT_DAILY, lastExport: null },
    sentences: seed.map((item) => seedSentence(item)),
    doneDays: [],
    removedSeeds: [],
    session: null,
  };
}

function keepFrame(frame, text) {                      // text 已經是 canonical
  if (frame === '') return '';
  const f = normalizeFrame(frame);
  return f.ok && f.text === text ? f.frame : '';
}

/**
 * 7.5：依序檢查，回傳第一個成立的錯誤；全部通過時回傳 { ok: true, text, frame, zh, topics }。
 * 第 1 到 6 步只看 plain（去掉大括號後的 canonical 句子），第 7 步才解析骨架。
 */
export function validateSentenceInput(data, text, zh, topicsText, editingId) {
  const textError = (error) => ({ ok: false, field: 'text', error });
  const c = canonicalize(text);                        // 全形大括號 ｛ ｝ 在這裡變成 { }
  const plain = canonicalize(stripBraces(c));
  // 第 1 到 6 步：與第 1 版相同，只是把 canonical 換成 plain
  if (plain === '') return textError('請輸入英文句子');
  const bad = nonTypeableChars(plain);
  if (bad.length > 0) {
    const shown = bad.map((ch) => {
      const cp = ch.codePointAt(0);
      const hidden = /[\p{C}\p{Z}\p{M}]/u.test(ch);   // 看不見或無法單獨顯示的字元
      return '「' + (hidden ? 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') : ch) + '」';
    });
    return textError('有英文鍵盤打不出的字元：' + shown.join('') + '，請改寫');
  }
  if (!/[A-Za-z]/.test(plain)) return textError('英文句子至少要有一個英文字母');
  if (wordCount(plain) < 2) return textError('請輸入至少兩個字的句子');
  if (plain.length > MAX_TEXT_LENGTH) return textError('英文句子請在 300 字元以內');
  const lower = plain.toLowerCase();
  if (data.sentences.some((s) => s.id !== editingId && s.text.toLowerCase() === lower)) {
    return textError('句子庫裡已經有相同的句子');
  }
  let frame = '';
  if (/[{}]/.test(c)) {
    const f = normalizeFrame(c);
    if (!f.ok) return textError(f.error);
    frame = f.frame;                                   // f.text 恆等於 plain（見 5.8）
  }
  const zhTrimmed = zh.trim();
  if (zhTrimmed.length > MAX_ZH_LENGTH) return { ok: false, field: 'zh', error: '中文意思請在 200 字以內' };
  const topics = topicsText.split('\n').map((t) => t.trim()).filter((t) => t !== '');
  if (topics.length > MAX_TOPICS) return { ok: false, field: 'topics', error: '議題最多 6 個' };
  if (topics.some((t) => t.length > MAX_TOPIC_LENGTH)) return { ok: false, field: 'topics', error: '每個議題請在 40 字以內' };
  return { ok: true, text: plain, frame, zh: zhTrimmed, topics };
}

/** 7.5：新句插在最前面，進度都是初始值；text、zh、frame、topics 在這裡再整理一次。 */
export function addSentence(data, { id, text, zh, frame, topics }) {
  const t = canonicalize(text);
  const s = {
    id, text: t, zh: zh.trim(), frame: keepFrame(frame, t), topics: topics.slice(),
    level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0,
  };
  return { ...data, sentences: [s, ...data.sentences] };
}

/**
 * 7.5：新的 text、zh、frame、topics 一律存入。英文的 canonical 形式有變（區分大小寫）時重設進度；
 * 改的正是今天未完成 session 的目前這句時，session 的 stage 設為 0、retry 設為 false。只改中文、骨架或議題時進度與 session 都不動。
 */
export function updateSentence(data, id, { text, zh, frame, topics }, today) {
  const t = canonicalize(text);
  const fields = { text: t, zh: zh.trim(), frame: keepFrame(frame, t), topics: topics.slice() };
  const old = data.sentences.find((s) => s.id === id);
  const changed = old !== undefined && old.text !== t;
  const sentences = data.sentences.map((s) => {
    if (s.id !== id) return s;
    if (!changed) return { ...s, ...fields };
    return { ...s, ...fields, level: 0, streak: 0, lastResult: null, due: s.reps > 0 ? today : null };
  });
  const ss = data.session;
  const current = changed && ss !== null && ss.day === today && ss.index < ss.ids.length && ss.ids[ss.index] === id;
  if (!current) return { ...data, sentences };
  return { ...data, sentences, session: { ...ss, stage: 0, retry: false } };
}

/** 7.5：刪除句子，內建句 id 依數字順序記進 removedSeeds；不是今天的 session 清成 null，今天的 session 跳過這句。回傳新物件。 */
export function deleteSentence(data, id, today) {
  const removedSeeds = SEED_ID.test(id) && !data.removedSeeds.includes(id)
    ? data.removedSeeds.concat(id).sort(bySeedNumber)
    : data.removedSeeds;                               // SEED_ID 見 7.4
  const next = { ...data, sentences: data.sentences.filter((x) => x.id !== id), removedSeeds };
  const ss = data.session;
  if (!ss) return next;
  if (ss.day !== today) return { ...next, session: null };
  const done = ss.ids.slice(0, ss.index);
  const rest = ss.ids.slice(ss.index).filter((x) => x !== id);
  if (done.length === 0 && rest.length === 0) return { ...next, session: null };
  if (ss.index < ss.ids.length && rest.length === 0) {
    return { ...next, session: { ...ss, ids: done, stage: 0, retry: false }, doneDays: addDoneDay(data.doneDays, ss.day) };
  }
  if (ss.index < ss.ids.length && ss.ids[ss.index] === id) {
    const cur = next.sentences.find((x) => x.id === rest[0]);
    return { ...next, session: { ...ss, ids: done.concat(rest), stage: cur ? startStage(cur) : 0, retry: false } };
  }
  return { ...next, session: { ...ss, ids: done.concat(rest) } };
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

/** 7.5：把內建句併入句子庫，不改任何既有句子的 text 與進度；回傳 { data, added, updated }。內建句的骨架不合格時 throw。 */
export function mergeSeed(data, seed) {
  const sentences = data.sentences.slice();
  const pos = new Map(sentences.map((s, i) => [s.id, i]));
  const removed = new Set(data.removedSeeds);
  let added = 0;
  let updated = 0;
  for (const item of seed) {
    const fresh = seedSentence(item);                   // 內含 normalizeFrame；不合格時 throw
    if (removed.has(item.id)) continue;                 // 使用者刪過的內建句
    const i = pos.get(item.id);
    if (i === undefined) {
      pos.set(item.id, sentences.length);
      sentences.push(fresh);
      added += 1;
    } else if (sentences[i].text === fresh.text && sentences[i].frame === '') {
      const s = sentences[i];
      sentences[i] = { ...s, zh: s.zh === '' ? item.zh : s.zh, frame: fresh.frame,
                       topics: s.topics.length === 0 ? fresh.topics : s.topics };
      updated += 1;
    }
  }
  return { data: { ...data, sentences }, added, updated };
}

// ===== session 的階梯（規格 6.4） =====

export const topStage = (s) => (s.frame !== '' ? 3 : 2);   // 只看 frame 是不是空字串
export const startStage = (s) => s.level;                  // 0、1、2

/** 6.4：今天的 session 存在時恢復它（略過已刪除的句子），否則用 pickToday 建立新的；沒有句子可排時 session 為 null。回傳新物件。 */
export function startOrResumeSession(data, today) {
  const ss = data.session;
  if (ss && ss.day === today) {
    if (ss.index >= ss.ids.length) return { ...data, doneDays: addDoneDay(data.doneDays, ss.day) };  // 已完成，冪等
    const byId = new Map(data.sentences.map((x) => [x.id, x]));
    const done = ss.ids.slice(0, ss.index);
    const rest = ss.ids.slice(ss.index).filter((id) => byId.has(id));
    if (rest.length === 0) {
      if (done.length === 0) return { ...data, session: null };
      return { ...data, session: { ...ss, ids: done, stage: 0, retry: false }, doneDays: addDoneDay(data.doneDays, ss.day) };
    }
    if (rest[0] === ss.ids[ss.index]) return { ...data, session: { ...ss, ids: done.concat(rest) } };   // 保留 stage 與 retry
    return { ...data, session: { ...ss, ids: done.concat(rest), stage: startStage(byId.get(rest[0])), retry: false } };
  }
  const ids = pickToday(data.sentences, today, data.settings.dailyCount);
  if (ids.length === 0) return { ...data, session: null };
  const first = data.sentences.find((x) => x.id === ids[0]);
  return { ...data, session: { day: today, ids, index: 0, results: [], stage: startStage(first), retry: false } };
}

/** 6.4：目前這張卡 { sentence, stage, retry }，stage 夾在 topStage 以內；沒有 session、已做完或目前這句不存在時回傳 null。 */
export function currentCard(data) {
  const ss = data.session;
  if (!ss || ss.index >= ss.ids.length) return null;
  const sentence = data.sentences.find((x) => x.id === ss.ids[ss.index]);
  if (!sentence) return null;
  const top = topStage(sentence);
  if (ss.stage > top) return { sentence, stage: top, retry: false };   // 被夾回的階段視為第一次嘗試
  return { sentence, stage: ss.stage, retry: ss.retry };
}
/** 6.4：currentCard 的 sentence；沒有卡時回傳 null。 */
export function currentSentence(data) {
  const c = currentCard(data);
  return c === null ? null : c.sentence;
}

/** 6.4：議題應用卡的議題，依 reps 與 retry 輪流取 topics；沒有議題時回傳「你自己的研究」。 */
export function cardTopic(s, retry) {
  if (s.topics.length === 0) return '你自己的研究';
  return s.topics[(s.reps + (retry ? 1 : 0)) % s.topics.length];
}

/** 6.4：依 outcome 升到下一階、同一階重試或結束這句，回傳新物件；outcome 不是 pass 或 fail、或沒有進行中的卡片時 throw。 */
export function completeCard(data, outcome) {
  if (outcome !== 'pass' && outcome !== 'fail') throw new Error('completeCard：outcome 只能是 pass 或 fail');
  const card = currentCard(data);
  if (card === null) throw new Error('completeCard：沒有進行中的卡片');
  const ss = data.session;
  const s = card.sentence;
  const st = card.stage;                                     // 已經夾在 topStage(s) 以內
  if (outcome === 'pass' && st < topStage(s)) return { ...data, session: { ...ss, stage: st + 1, retry: false } };
  if (outcome === 'fail' && !card.retry) return { ...data, session: { ...ss, stage: st, retry: true } };   // 夾過的 stage 寫回
  const updated = applyResult(s, outcome, ss.day);           // 結束這句
  const sentences = data.sentences.map((x) => (x.id === s.id ? updated : x));
  const index = ss.index + 1;
  const finished = index === ss.ids.length;
  const next = finished ? null : sentences.find((x) => x.id === ss.ids[index]) || null;
  return {
    ...data,
    sentences,
    doneDays: finished ? addDoneDay(data.doneDays, ss.day) : data.doneDays,
    session: { ...ss, index, results: [...ss.results, outcome], stage: next ? startStage(next) : 0, retry: false },
  };
}

/** 6.4：今天的 session 已做完時，用 pickToday 從還沒排進來的句子再選 dailyCount 句接在尾端；不符合條件或沒有剩餘句時回傳同一個 data。 */
export function extendSession(data, today) {
  const ss = data.session;
  if (!ss || ss.day !== today || ss.index < ss.ids.length) return data;
  const used = new Set(ss.ids);
  const next = pickToday(data.sentences.filter((x) => !used.has(x.id)), today, data.settings.dailyCount);
  if (next.length === 0) return data;
  const first = data.sentences.find((x) => x.id === next[0]);
  return { ...data, session: { ...ss, ids: ss.ids.concat(next), stage: startStage(first), retry: false } };
}

/** 6.4：今天還能加練的句數，也就是還沒排進今天 session 的句子數；沒有今天的 session 時是句子庫的句數。 */
export function remainingToday(data, today) {
  const ss = data.session;
  if (!ss || ss.day !== today) return data.sentences.length;
  const used = new Set(ss.ids);
  return data.sentences.filter((x) => !used.has(x.id)).length;
}

/** 7.5：首頁的 { kind, done, total, remaining }，kind 依序判斷 continue、done、empty、start（4.2）。 */
export function todayStatus(data, today) {
  const ss = data.session;
  const isToday = !!ss && ss.day === today;
  const n = data.sentences.length;
  const remaining = remainingToday(data, today);
  if (isToday && ss.index < ss.ids.length) return { kind: 'continue', done: ss.index, total: ss.ids.length, remaining };
  if (data.doneDays.includes(today)) {
    const total = isToday ? ss.ids.length : Math.min(data.settings.dailyCount, n);
    return { kind: 'done', done: total, total, remaining };
  }
  if (n === 0) return { kind: 'empty', done: 0, total: 0, remaining };
  return { kind: 'start', done: 0, total: Math.min(data.settings.dailyCount, n), remaining };
}

/** 備份提醒文字；不需要提醒時回傳 null。 */
export function backupReminder(data, today) {
  const last = data.settings.lastExport;
  if (last === null) return data.doneDays.length >= 3 ? '還沒有匯出過備份' : null;
  const n = daysBetween(last, today);
  return n > BACKUP_REMIND_DAYS ? '已經 ' + n + ' 天沒有匯出備份' : null;
}

// ===== sanitizeData 與第 1 版的升級（規格 7.4） =====

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

/** 7.4 的句子規則；不合格時回傳 null。id 重複由 sanitizeData 檢查。frame 與 topics 不合格時改成 '' 與 []，不算丟棄。 */
function sanitizeSentence(x) {
  if (!isPlainObject(x) || typeof x.id !== 'string' || !ID_PATTERN.test(x.id) || typeof x.text !== 'string') return null;
  const text = canonicalize(x.text);
  if (text === '' || nonTypeableChars(text).length > 0 || !/[A-Za-z]/.test(text)) return null;
  const zh = typeof x.zh === 'string' ? x.zh.trim() : '';
  const frame = typeof x.frame === 'string' ? keepFrame(x.frame, text) : '';
  const topics = Array.isArray(x.topics)
    ? x.topics.filter((t) => typeof t === 'string').map((t) => t.trim())
        .filter((t) => t !== '' && t.length <= MAX_TOPIC_LENGTH).slice(0, MAX_TOPICS)
    : [];
  const reps = isNonNegInt(x.reps) ? x.reps : 0;
  if (reps === 0) {
    return { id: x.id, text, zh, frame, topics, level: 0, streak: 0, due: null, lastSeen: null, lastResult: null, reps: 0 };
  }
  return {
    id: x.id,
    text,
    zh,
    frame,
    topics,
    level: Number.isInteger(x.level) ? Math.min(2, Math.max(0, x.level)) : 0,
    streak: isNonNegInt(x.streak) ? x.streak : 0,
    due: isDay(x.due) ? x.due : null,
    lastSeen: isDay(x.lastSeen) ? x.lastSeen : null,
    lastResult: x.lastResult === 'pass' || x.lastResult === 'fail' ? x.lastResult : null,
    reps,
  };
}

/** 7.4 的 session 規則；任一條不成立就回傳 null。ids 不檢查句子是否存在，stage 不和 topStage 比較。 */
function sanitizeSession(ss) {
  if (!isPlainObject(ss) || !isDay(ss.day)) return null;
  const { ids, index, results, stage, retry } = ss;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (!Number.isInteger(index) || index < 0 || index > ids.length) return null;
  if (!Array.isArray(results) || results.length !== index) return null;
  if (!results.every((r) => r === 'pass' || r === 'fail')) return null;
  if (!Number.isInteger(stage) || stage < 0 || stage > 3) return null;
  if (typeof retry !== 'boolean') return null;
  return { day: ss.day, ids: ids.slice(), index, results: results.slice(), stage, retry };
}

/**
 * 7.4：驗證並重建整份資料，未知欄位丟掉。只在三種情況丟出 name 為 'DataError' 的 Error。
 * 舊資料的升級只在開頭這一個分支（規格 §3 第 14 條）。
 * @returns {{ data: AppData, warnings: string[] }}
 */
export function sanitizeData(raw) {
  if (!isPlainObject(raw)) throwDataError('格式不是物件');
  if (raw.schema === 1) raw = upgradeV1(raw);          // 第 1 版的資料先升級，之後照第 2 版的規則檢查
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
  const removedSeeds = Array.isArray(raw.removedSeeds)
    ? [...new Set(raw.removedSeeds.filter((id) => typeof id === 'string' && SEED_ID.test(id)))]
        .sort(bySeedNumber)
    : [];
  const warnings = dropped > 0 ? ['有 ' + dropped + ' 句資料不完整，或含有英文鍵盤打不出的字元，已略過'] : [];
  return {
    data: { schema: SCHEMA, settings, sentences, doneDays, removedSeeds, session: sanitizeSession(raw.session) },
    warnings,
  };
}

export function upgradeV1(raw) {                       // 回傳新物件，不修改 raw
  const isArr = Array.isArray(raw.sentences);
  const sentences = isArr
    ? raw.sentences.map((x) => (isPlainObject(x) ? { ...x, frame: '', topics: [] } : x))
    : raw.sentences;                                   // 不是陣列時原樣交給後面的檢查，丟出 DataError
  const present = new Set(isArr ? raw.sentences.filter(isPlainObject).map((x) => x.id) : []);
  const removedSeeds = [];
  for (let i = 1; i <= 55; i++) {                      // 第 1 版的內建句是 s01 到 s55
    const id = 's' + String(i).padStart(2, '0');
    if (!present.has(id)) removedSeeds.push(id);
  }
  return { ...raw, schema: 2, sentences, removedSeeds, session: null };
}

// ===== 匯出與匯入（規格 7.6） =====

/** 7.6：去掉 session 的 AppData 加上檔頭，縮排 2 格；removedSeeds 照存。 */
export function toBackupJSON(data, today, nowIso) {
  const payload = {
    app: 'phrase-drill',
    schema: SCHEMA,
    exportedDay: today,
    exportedAt: nowIso,
    settings: data.settings,
    sentences: data.sentences,
    doneDays: data.doneDays,
    removedSeeds: data.removedSeeds,
  };
  return JSON.stringify(payload, null, 2);
}

/** 7.6：依序檢查，失敗回傳 { ok: false, error }。sanitizeData 丟出 DataError 以外的例外不攔截。第 1 版的備份由 sanitizeData 升級，不執行 mergeSeed。 */
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
      fromV1: obj.schema === 1,
    },
  };
}

// ===== 載入、存檔、undo 與 corrupt（規格 7.3、7.6） =====

const RESET_WARNING = '主資料讀取失敗，已重建內建句子庫；原始資料已另存，可到『設定 > 診斷』複製';

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
 * 7.3：依 seeded、newer、reset、ok 的順序判斷。schema 1 的資料在 sanitizeData 升級後接著 mergeSeed 並存檔。
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
  // load 的 ok 分支：raw 是 data key 的原始字串，parsed 是 JSON.parse 的結果，res 是 sanitizeData(parsed) 的結果
  const upgraded = parsed.schema === 1;
  let data = res.data;
  const warnings = res.warnings.slice();
  if (upgraded) {
    const m = mergeSeed(data, seed);
    data = m.data;
    warnings.push('資料格式已更新為第 2 版，並補入內建句型：加入 ' + m.added + ' 句、補上 ' + m.updated + ' 句的句型');
  }
  if (res.warnings.length > 0) {
    writeCorrupt(storage, raw, nowIso);
    warnings.push('原始資料已另存，可到『設定 > 診斷』複製');
  }
  if (upgraded || res.warnings.length > 0) save(storage, data);
  return { status: 'ok', data, warnings };
}

/** 7.3：匯入或清除所有資料之前呼叫；setItem 失敗時直接 throw，由呼叫端接住。 */
export function writeUndo(storage, data, reason, nowIso) {
  storage.setItem(UNDO_KEY, JSON.stringify({ at: nowIso, reason, json: JSON.stringify(data) }));
}

/** 7.6：解析並 sanitize undo 的內容（第 1 版的資料同樣經 sanitizeData 升級，不執行 mergeSeed）；任何失敗都回傳 null。 */
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
