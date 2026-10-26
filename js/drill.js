// js/drill.js：純函式，負責正規化、比對、提示片段、單張卡片狀態機與狀態列文字。
// 不 import 任何模組，也不碰 DOM、時間與亂數。JSDoc 只作說明，不做型別檢查。

export const MISTAKE_LIMIT = 2;
export const LONG_SENTENCE_WORDS = 16;    // 達到這個字數，容許上限加 1
export const DEVIATION_LIMIT = 3;         // L0 錯誤尾巴累積到這個長度才計失誤
export const ANCHOR_WORDS = 2;            // L2 顯示的開頭字數

// 5.3 mapPunct 對照表：來源字元 → ASCII
const PUNCT_MAP = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'", '\u02BC': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"', '\u2033': '"',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u3002': '.',
  '\u3001': ',',
};
// 字元類別由 PUNCT_MAP 的 key 組成，兩邊不會不同步；key 都不是 regex 的特殊字元
const PUNCT_RE = new RegExp('[' + Object.keys(PUNCT_MAP).join('') + ']', 'g');

function mapPunct(s) {
  return s.replace(PUNCT_RE, (c) => PUNCT_MAP[c]);
}

function base(s) {
  let t = mapPunct(s);                       // 1. 換掉彎引號、各種破折號、「。」「、」
  t = t.normalize('NFKC');                   // 2. 全形轉半形、連字拆開、… 變 ...、特殊空白變一般空白
  t = mapPunct(t);                           // 3. 再換一次，收拾 NFKC 新產生的字元
  t = t.replace(/\p{Cf}/gu, '');             // 4. 刪除不可見的格式字元（Unicode 類別 Cf）
  t = t.replace(/\s+/g, ' ');                // 5. 所有空白序列壓成一個空白
  t = t.replace(/-{2,}/g, '-');              // 6. 連續的 - 壓成一個
  return t;
}
export const canonicalize = (text) => base(text).trim();           // 7. 存檔用，去頭尾空白
export const canonicalizeInput = (raw) => base(raw).trimStart();   // 7. 輸入用，保留結尾空白

/**
 * 5.3：回傳不在可列印 ASCII（0x20 到 0x7E）範圍內的字元，不重複，依出現順序。
 * for...of 逐 code point 走訪，所以 emoji 這類 BMP 以外的字元算一個字元。
 * @param {string} text
 * @returns {string[]}
 */
export function nonTypeableChars(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if ((code < 0x20 || code > 0x7E) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Bopomofo}]/u;

/**
 * 5.5：輸入含中文字或注音時為 true，這時不計失誤。
 * @param {string} raw
 * @returns {boolean}
 */
export function containsCJK(raw) {
  return CJK_RE.test(raw);
}

/**
 * 5.7：'' 回傳 0，其餘為 split(' ').length。傳入的必須是 canonical 句子（字間只有一個空白）。
 * @param {string} canonical
 * @returns {number}
 */
export function wordCount(canonical) {
  return canonical === '' ? 0 : canonical.split(' ').length;
}

/**
 * 5.5：容許的失誤次數。字數達到 LONG_SENTENCE_WORDS（16）的句子是 MISTAKE_LIMIT + 1（3），其餘是 MISTAKE_LIMIT（2）。
 * @param {string} target canonical 句子
 * @returns {number}
 */
export function mistakeLimit(target) {
  return wordCount(target) >= LONG_SENTENCE_WORDS ? MISTAKE_LIMIT + 1 : MISTAKE_LIMIT;
}

/**
 * @typedef {{ typed: string, matched: number, hasError: boolean, complete: boolean }} Compare
 */

/**
 * @typedef {0|1|2} Level
 */

/**
 * @typedef {'pass'|'fail'} Outcome
 */

/**
 * @typedef {{ text: string, kind: 'done'|'todo'|'mask'|'err' }} Segment
 */

/**
 * @typedef {{ target: string, level: Level, typed: string, matched: number, hasError: boolean,
 *   complete: boolean, mistakes: number, errorCounted: boolean, revealed: boolean,
 *   hint: null|'cjk'|'period' }} CardState
 */

/**
 * 5.4：以 canonicalizeInput 之後的整段輸入和 target 比對，不分大小寫，含兩條雙空白句點規則。
 * @param {string} target canonical 的 ASCII 句子
 * @param {string} raw textarea 的原始值
 * @returns {Compare}
 */
export function compareTyped(target, raw) {
  const typed = canonicalizeInput(raw);
  const n = Math.min(typed.length, target.length);
  let i = 0;
  while (i < n && typed[i].toLowerCase() === target[i].toLowerCase()) i++;
  // 規則 1：只有最後一個字元不同，而且是輸入空白、目標句點，視為雙空白句點打到一半
  const pendingPeriod = i === typed.length - 1 && typed[i] === ' ' && target[i] === '.';
  // 規則 2：整句打對之後只多一個結尾空白
  const trailingSpace = i === target.length && typed.length === target.length + 1 && typed[i] === ' ';
  const hasError = i < typed.length && !pendingPeriod && !trailingSpace;
  return { typed, matched: i, hasError, complete: !hasError && i === target.length };
}

/**
 * 5.5：iOS 的雙空白句點出現在不該有句點的地方，這時不計失誤。
 * 條件：有錯誤、輸入在 matched 位置是句點、target 在同一位置是空白，而且句點後面是空白或已經沒有字元。
 * @param {string} target
 * @param {Compare} c compareTyped 的結果
 * @returns {boolean}
 */
export function isPeriodShortcut(target, c) {
  return c.hasError && c.typed[c.matched] === '.' && target[c.matched] === ' '
    && (c.matched + 1 === c.typed.length || c.typed[c.matched + 1] === ' ');
}

// ---- 提示片段（規格 6.1） ----

/**
 * L2 顯示的開頭長度：開頭 ANCHOR_WORDS 個字，但至少留一個字不給，
 * 所以兩個字的句子只給第一個字，一個字的句子什麼都不給。
 * @param {string} target canonical 句子
 * @returns {number}
 */
export function anchorEnd(target) {
  const words = target.split(' ');
  const k = Math.max(0, Math.min(ANCHOR_WORDS, words.length - 1));
  return words.slice(0, k).join(' ').length;
}

/**
 * 提示列的片段。revealed 的卡片由呼叫端傳入 shownLevel(card)，也就是 0。
 * @param {string} target canonical 句子
 * @param {Level} level
 * @param {number} matched compareTyped 的 matched
 * @param {boolean} hasError compareTyped 的 hasError
 * @returns {Segment[]}
 */
export function hintSegments(target, level, matched, hasError) {
  const alnum = /[\p{L}\p{N}]/u;
  const anchor = level === 2 ? anchorEnd(target) : 0;
  const segs = [];
  const push = (text, kind) => {                  // 規則 5：相鄰而且 kind 相同的片段合併
    const prev = segs[segs.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else segs.push({ text, kind });
  };
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    let visible;                                  // 這個位置在該層本來是否可見（規則 3）
    if (level === 0) visible = true;
    else if (level === 1) visible = !alnum.test(ch) || i === 0 || !alnum.test(target[i - 1]);
    else visible = i < anchor;
    if (i < matched) push(ch, 'done');                                     // 規則 1
    else if (i === matched && hasError) push(visible ? ch : '_', 'err');   // 規則 2
    else if (visible) push(ch, 'todo');
    else if (level === 1) push('_', 'mask');
    // L2 被遮住的位置完全不輸出
  }
  if (hasError && matched >= target.length) push('_', 'err');            // 規則 4：輸入超出句尾
  return segs;
}

// ---- 單張卡片狀態機（規格 5.5） ----

/**
 * 開一張新卡：typed 為 ''，數值為 0，布林為 false，hint 為 null。
 * @param {string} target canonical 句子
 * @param {Level} level
 * @returns {CardState}
 */
export function newCard(target, level) {
  return { target, level, typed: '', matched: 0, hasError: false, complete: false,
           mistakes: 0, errorCounted: false, revealed: false, hint: null };
}

/**
 * 依整個 textarea.value 重算卡片狀態，回傳新物件；完成後原樣回傳同一個物件。
 * @param {CardState} card
 * @param {string} raw textarea 的原始值
 * @returns {CardState}
 */
export function cardInput(card, raw) {
  if (card.complete) return card;                       // 完成後原樣回傳同一個物件
  const r = compareTyped(card.target, raw);
  const hint = containsCJK(raw) ? 'cjk' : isPeriodShortcut(card.target, r) ? 'period' : null;
  let mistakes = card.mistakes;
  let errorCounted = r.hasError ? card.errorCounted : false;   // 刪回沒錯時，事件結束
  if (r.hasError && !errorCounted && !card.revealed && hint === null) {
    if (card.level !== 0 || r.typed.length - r.matched >= DEVIATION_LIMIT) { mistakes += 1; errorCounted = true; }
  }
  const revealed = card.revealed || mistakes > mistakeLimit(card.target);
  return { ...card, typed: r.typed, matched: r.matched, hasError: r.hasError, complete: r.complete,
           mistakes, errorCounted, revealed, hint };
}

/**
 * 看答案：進入 revealed，這張卡的結果固定為 fail。已完成時原樣回傳同一個物件。
 * @param {CardState} card
 * @returns {CardState}
 */
export function cardReveal(card) {
  if (card.complete) return card;
  return { ...card, revealed: true };
}

/**
 * 題目區與提示列實際採用的層級：revealed 時為 0，否則為 card.level。
 * @param {CardState} card
 * @returns {Level}
 */
export function shownLevel(card) {
  return card.revealed ? 0 : card.level;
}

/**
 * 卡片結果：revealed 為 fail，否則為 pass。只在 card.complete 之後呼叫。
 * @param {CardState} card
 * @returns {Outcome}
 */
export function cardOutcome(card) {
  return card.revealed ? 'fail' : 'pass';
}

// ---- 狀態列文字（規格 5.6） ----

/**
 * 未完成卡片的狀態列文字，依 5.6 的優先順序。卡片完成後改顯示 resultMessage，
 * 有 flashMsg 時優先顯示 flashMsg，這兩件事都由 app.js 處理。
 * @param {CardState} card
 * @param {string|null} previous 上一句的結果訊息，沒有時為 null
 * @returns {string}
 */
export function cardStatus(card, previous) {
  const count = '失誤 ' + card.mistakes + '／容許 ' + mistakeLimit(card.target);
  if (card.hint === 'cjk') return '偵測到中文輸入，請切換到英文鍵盤（不計失誤）';
  if (card.hint === 'period') return '這裡多了句點，可能是連按兩下空白造成的，請刪掉（不計失誤）';
  if (card.revealed && card.hasError) return '這次算沒過，請刪回紅色的位置，再照著全句打完';
  if (card.revealed) return '這次算沒過，請照著全句打完';
  if (card.hasError) return '有錯，請刪回紅色的位置・' + count;
  if (card.typed === '' && previous !== null) return '上一句：' + previous;
  return count;
}
