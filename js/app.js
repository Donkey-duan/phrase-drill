// js/app.js：唯一碰 DOM 與瀏覽器 API 的 module，分區順序照規格 4.8

// ===== 1. import 與常數 =====
import { SEED } from './seed.js';
import {
  load, save, todayStatus, backupReminder, SCHEMA,
  validateSentenceInput, addSentence, updateSentence, deleteSentence, mergeSeed,
  startOrResumeSession, currentCard, cardTopic, completeCard, extendSession,
  DAILY_OPTIONS, setDailyCount, markExported, createInitialData, toBackupJSON, fromBackupJSON,
  writeUndo, readUndo, clearUndo, readCorrupt, clearCorrupt,
} from './store.js';
import {
  localDay, streakInfo, levelCounts, levelLabel, dueLabel, STAGE_NAMES, resultMessage, rungMessage,
} from './schedule.js';
import {
  newCard, cardInput, cardReveal, shownLevel, cardOutcome, cardStatus, hintSegments,
  newProdCard, prodInput, prodSubmit, prodReveal, prodOutcome, prodStatus, prodHintSegments,
} from './drill.js';

const SCREENS = ['home', 'practice', 'library', 'edit', 'settings'];
const NAV_SCREENS = ['home', 'library', 'settings'];
const INSTALL_HINT = '你現在是在 Safari 分頁裡開啟。分頁和主畫面 app 的資料互不相通，私密瀏覽關掉分頁後資料也會消失。請從 Safari 的分享選單選『加入主畫面』；iOS 26 以上的加入畫面有一個讓網站以 App 方式開啟的開關，請保持開啟。之後一律從主畫面圖示練習與備份。加入後第一次從圖示開啟時需要網路。';
const nav = document.getElementById('nav');
const input = document.getElementById('p-input');   // 練習頁的元素都寫在 index.html（4.1），整個 session 重複使用，不重建
const nextBtn = document.getElementById('p-next');
const revealBtn = document.getElementById('p-reveal');
const resumeBtn = document.getElementById('p-resume');
const exitBtn = document.getElementById('p-exit');

// ===== 2. 狀態 =====
let data = null;              // AppData
let warnings = [];            // load 的 warnings；只在啟動流程第 3 步設定，匯入、還原、清除後設為 []
let currentScreen = null;     // 'home' | 'practice' | 'library' | 'edit' | 'settings'
let card = null;              // CardState（stage 0 到 2）或 ProdCard（stage 3）；總結畫面時為 null
let cardSentence = null;      // 開新卡時存下的整個 Sentence
let cardInfo = null;          // 開新卡時存下的 { stage, retry, pos }；只在 card 不是 null 時有意義
let prevMessage = null;
let resultMsg = null;
let flashMsg = null;
let editingId = null;         // 編輯頁的句子 id；null 表示新增句子
let pendingReload = false;
let reloading = false;
let swReg = null;
let lastEnterAt = -Infinity;  // onEnter 去重用的 performance.now()
let debugLines = null;        // null 表示鍵盤事件紀錄未啟用

// ===== 3. 時鐘與 id =====
const today = () => localDay(new Date());
const nowIso = () => new Date().toISOString();
const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ===== 4. commit 與 show =====
function commit(next) {
  data = next;
  try { save(localStorage, data); return true; } catch (e) { window.PD_LOG(e, 'save'); return false; }
}

function show(name) {
  if (name === 'home' && pendingReload) { location.reload(); return; }
  for (const id of SCREENS) document.getElementById(id).hidden = id !== name;
  nav.hidden = !NAV_SCREENS.includes(name);
  currentScreen = name;
  if (name === 'home') renderHome();
  else if (name === 'practice') renderPractice();
  else if (name === 'library') renderLibrary();
  else if (name === 'edit') renderEdit();
  else if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

// ===== 5. h() =====
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);   // onclick → click
    else if (v === false || v == null) continue;                   // false、null、undefined 略過
    else el.setAttribute(k, v === true ? '' : String(v));         // true 寫成空字串屬性
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 整頁重畫：清空 root 再放入 children；children 規則同 h()，字串成為 text node
function fill(root, ...children) {
  root.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return root;
}

// ===== 6. 首頁 =====
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function streakText(day) {                    // 首頁與總結共用（4.2、4.3）
  const s = streakInfo(data.doneDays, day);
  return '連續 ' + s.current + ' 天・最長 ' + s.best + ' 天'
    + (s.current > 0 && !s.doneToday ? '（今天還沒練）' : '');
}

function moreLabel(st) {                      // 首頁與總結的「再練 N 句」（4.2、4.3）；st 是 todayStatus 的回傳值
  return '再練 ' + Math.min(data.settings.dailyCount, st.remaining) + ' 句';
}

// 首頁五種狀態依 todayStatus 的 { kind, done, total, remaining }（4.2 的表）
function renderHome() {
  const t = today();
  const st = todayStatus(data, t);
  const notes = [];
  if (warnings.length > 0) {                  // load 的 warnings，含第 2 版第一次開啟時的升級通知
    notes.push(h('div', { class: 'note' },
      warnings.map((w) => h('p', null, w)),
      h('button', { type: 'button', onclick: () => show('settings') }, '去設定頁')));
  }
  if (/iPhone|iPod/.test(navigator.userAgent) && !isStandalone()) {
    notes.push(h('div', { class: 'note' }, h('p', null, INSTALL_HINT)));
  }
  const reminder = backupReminder(data, t);
  if (reminder !== null) {
    notes.push(h('div', { class: 'note' },
      h('p', null, reminder),
      h('button', { type: 'button', onclick: () => show('settings') }, '去備份')));
  }
  let progress = null;
  let main;
  if (st.kind === 'start') {
    progress = '今天 ' + st.done + ' / ' + st.total;
    main = h('button', { type: 'button', class: 'primary', onclick: startPractice }, '開始今天的練習');
  } else if (st.kind === 'continue') {
    progress = '今天 ' + st.done + ' / ' + st.total;
    main = h('button', { type: 'button', class: 'primary', onclick: startPractice }, '繼續練習');
  } else if (st.kind === 'done') {
    progress = '今天 ' + st.done + ' / ' + st.total + '・完成';
    main = st.remaining > 0
      ? h('button', { type: 'button', class: 'primary', onclick: startPractice }, moreLabel(st))
      : h('button', { type: 'button', class: 'primary', 'aria-disabled': 'true' }, '今天完成了');   // 不綁 click
  } else {
    main = h('button', { type: 'button', class: 'primary', disabled: true }, '句子庫是空的');
  }
  const c = levelCounts(data.sentences);
  fill(document.getElementById('home'),
    notes,
    progress === null ? null : h('p', null, progress),
    h('p', null, main),
    st.kind === 'empty'
      ? h('p', null, h('button', { type: 'button', onclick: () => openEdit(null) }, '去新增句子'))
      : null,
    h('p', null, streakText(t)),
    h('p', null, '未開始 ' + c.fresh + '・全句 ' + c.l0 + '・首字母 ' + c.l1 + '・背誦 ' + c.l2));
}

// ===== 7. 練習頁 =====
// 首頁主要按鈕（開始、繼續、再練 N 句）的 click handler（4.2）。和 enterPractice 合起來全部同步執行，
// 中間不得有 await、setTimeout 或 Promise.then，否則 iOS 不讓 focus() 叫出鍵盤
function startPractice() {                     // 首頁主要按鈕；「今天完成了」與「句子庫是空的」不綁這個 handler
  const t = today();
  if (todayStatus(data, t).kind === 'done') extendAndResume(t);   // 只有「再練 N 句」會走到這一行
  else commit(startOrResumeSession(data, t));
  enterPractice(renderHome);                   // 見 4.3；沒有卡可以打時重畫首頁
}
function extendAndResume(t) {                  // 「再練 N 句」的資料步驟，首頁與總結共用：先加練、再恢復（6.4）
  commit(extendSession(data, t));
  commit(startOrResumeSession(data, t));
}
function practiceMore() {                      // 總結畫面的「再練 N 句」（4.3 總結畫面第 4 條），同樣全部同步
  extendAndResume(today());
  enterPractice(() => show('home'));
}

// 開卡時存下 cardSentence、cardInfo、card 三樣東西，畫面一律從這三樣取值（4.3「卡片與 cardInfo」）
function openCard(c) {                         // c 是 currentCard(data) 的回傳值，不是 null
  cardSentence = c.sentence;
  cardInfo = { stage: c.stage, retry: c.retry, pos: data.session.index + 1 };
  card = c.stage === 3
    ? newProdCard(c.sentence.frame, c.sentence.text, cardTopic(c.sentence, c.retry))
    : newCard(c.sentence.text, c.stage);
}
function enterPractice(onNone) {               // onNone：沒有卡可以打時要做的事
  const c = currentCard(data);
  if (c === null) { onNone(); return; }
  openCard(c);
  prevMessage = null;
  resultMsg = null;
  flashMsg = null;
  input.value = '';
  let flag = null;
  try { flag = localStorage.getItem('phrase-drill:debug'); } catch (e) { flag = null; }   // 讀取失敗視為未啟用（5.2）
  debugLines = flag === '1' ? [] : null;
  show('practice');                            // renderPractice 在這裡先把 enterkeyhint 設好
  input.focus();
}

// 依 cardInfo.stage 決定各項（4.3「各階段的畫面」）；打字卡是 stage 0 到 2，議題應用卡是 stage 3
function renderPractice() {
  const cardEl = document.getElementById('p-card');
  const summaryEl = document.getElementById('p-summary');
  cardEl.hidden = card === null;               // 每次都先決定顯示哪一塊，隔天按開始才不會看到舊的總結
  summaryEl.hidden = card !== null;
  if (card === null) { renderSummary(summaryEl); return; }
  const prod = cardInfo.stage === 3;
  const lv = prod ? 3 : shownLevel(card);      // 打字卡已揭示時照 L0 處理；議題應用卡固定用 STAGE_NAMES[3]
  document.getElementById('p-progress').textContent = cardInfo.pos + ' / ' + data.session.ids.length
    + '・' + STAGE_NAMES[lv] + (cardInfo.retry ? '（再試一次）' : '');
  revealBtn.textContent = prod ? '看範例' : '看答案';
  revealBtn.hidden = prod
    ? card.revealed || card.complete
    : !(card.level > 0 && !card.revealed && !card.complete);
  const promptEl = document.getElementById('p-prompt');   // 題目一律取自 cardSentence 與 card，不回頭讀 session
  promptEl.classList.toggle('recall', !prod && lv === 2);  // 只有打字卡的 lv 為 2 時是 20px 正常字色
  if (prod) {
    fill(promptEl,
      h('span', { class: 'p-topic' }, '議題：' + card.topic),
      card.revealed && !card.complete           // 揭示後、完成前第二行改顯示範例，取代中文那一行，題目區不會變高
        ? h('span', { class: 'p-example', lang: 'en' }, '範例：' + card.target)
        : cardSentence.zh === '' ? null : h('span', { class: 'p-zh' }, cardSentence.zh));
  } else {
    promptEl.textContent = lv === 2 && cardSentence.zh === '' ? '（沒有中文意思，請從開頭兩個字背出整句）' : cardSentence.zh;
  }
  const segs = prod
    ? prodHintSegments(card.frame, card.revealed)
    : hintSegments(card.target, lv, card.matched, card.hasError);
  fill(document.getElementById('p-hint'), segs.map((seg) => h('span', { class: 'seg-' + seg.kind }, seg.text)));
  const want = prod ? 'send' : 'next';         // 只在值不同時才寫，不重建 textarea、不 blur 再 focus
  if (input.getAttribute('enterkeyhint') !== want) input.setAttribute('enterkeyhint', want);
  input.classList.toggle('has-error', !prod && card.hasError);
  const statusEl = document.getElementById('p-status');
  if (card.complete && prod) {                 // 已完成的議題應用卡：兩行，第二行顯示範例
    fill(statusEl, h('span', { class: 'st-line' }, resultMsg), h('span', { class: 'st-line' }, prodStatus(card, null)));
  } else if (card.complete) statusEl.textContent = resultMsg;
  else if (flashMsg !== null) statusEl.textContent = flashMsg;
  else statusEl.textContent = prod ? prodStatus(card, prevMessage) : cardStatus(card, prevMessage);
  nextBtn.setAttribute('aria-disabled', card.complete ? 'false' : 'true');   // 不用 disabled，pointerdown 才收得到
  nextBtn.textContent = card.complete && currentCard(data) === null ? '完成' : '下一句';
  const debugEl = document.getElementById('p-debug');
  debugEl.hidden = debugLines === null;
  debugEl.textContent = debugLines === null ? '' : debugLines.join('\n');
}

function renderSummary(el) {
  const s = data.session;
  const results = s ? s.results : [];
  const passed = results.filter((r) => r === 'pass').length;
  const failed = [];
  if (s) {
    s.ids.forEach((id, i) => {
      if (results[i] !== 'fail') return;
      const x = data.sentences.find((y) => y.id === id);
      if (x) failed.push(x);                   // 已被刪除的句子略過
    });
  }
  const st = todayStatus(data, today());
  const more = st.kind === 'done' && st.remaining > 0
    ? h('p', null, h('button', { type: 'button', class: 'primary', onclick: practiceMore }, moreLabel(st)))
    : null;
  fill(el,
    h('p', null, '今天完成 ' + results.length + ' 句，其中 ' + passed + ' 句通過'),
    h('p', null, streakText(today())),         // 和首頁同一段文字（4.2）
    failed.length > 0 ? h('h2', null, '今天沒過的句子') : null,   // 全部通過或沒過的都已刪除時，整區省略
    failed.length > 0
      ? h('ul', null, failed.map((x) => h('li', null, h('div', { lang: 'en' }, x.text), x.zh === '' ? null : h('div', null, x.zh))))
      : null,
    more,
    h('button', { type: 'button', onclick: () => show('home') }, '回首頁'));
}

// 鍵盤事件紀錄（5.2）：debugLines 為 null 時不記錄，否則只留最後 12 筆
function debugLog(name, e) {
  if (debugLines === null) return;
  let line = name;
  if (name === 'keydown') line += ' key=' + JSON.stringify(e.key) + ' keyCode=' + e.keyCode + ' isComposing=' + e.isComposing;
  else if (name === 'beforeinput') line += ' inputType=' + e.inputType;
  else if (name === 'input') line += ' inputType=' + e.inputType + ' isComposing=' + e.isComposing + ' value.length=' + input.value.length;
  else if (typeof e === 'string') line += ' ' + e;
  debugLines.push(line);
  if (debugLines.length > 12) debugLines.shift();
  document.getElementById('p-debug').textContent = debugLines.join('\n');
}

// handleValue、onEnter、submitProd、advance 逐字照規格 4.3「打字、送出與完成」
function handleValue() {
  if (!card) return;
  flashMsg = null;
  const newline = input.value.includes('\n');
  if (newline) input.value = input.value.replace(/\n/g, '');
  if (cardInfo.stage === 3) {
    card = prodInput(card, input.value);       // 先更新 typed，onEnter 送出的才是最新的內容
    if (newline) onEnter();
    renderPractice();                          // onEnter 可能已進入總結，renderPractice 會改畫總結
    return;
  }
  if (newline) onEnter();
  if (!card || cardInfo.stage === 3) return;   // onEnter 可能已進入總結，或已換成議題應用卡（goNext 已重畫）
  const wasComplete = card.complete;
  card = cardInput(card, input.value);
  if (card.complete && !wasComplete) finishCard();
  renderPractice();
}
function onEnter() {
  const now = performance.now();
  debugLog('onEnter', now - lastEnterAt < 300 ? '去重' : '接受');
  if (now - lastEnterAt < 300) return;         // keydown、beforeinput、input 三條路徑去重
  lastEnterAt = now;
  if (card && cardInfo.stage === 3 && !card.complete) { flashMsg = null; submitProd(); return; }
  advance();
}
function submitProd() {                        // 只由 onEnter 呼叫；「下一句」不會送出
  card = prodSubmit(card);
  if (card.complete) finishCard();
  renderPractice();
}
function advance() {                           // 卡片已完成時的 Return 與「下一句」共用
  if (!card) return;
  if (!card.complete) {
    if (cardInfo.stage === 3) flashMsg = '寫好句子後按 Return 送出';
    else if (!card.hasError) flashMsg = '還沒打完，打完整句會自動完成';
    renderPractice();
    return;
  }
  goNext();
}

// 只在 card.complete 時呼叫；下一張一律由 currentCard 決定（4.3「換卡與結束」）
function goNext() {
  const c = currentCard(data);
  if (c !== null) {                            // 還有下一張：不 blur、不重建 textarea，鍵盤不會收起
    prevMessage = resultMsg;
    resultMsg = null;
    flashMsg = null;
    openCard(c);
    input.value = '';
    renderPractice();
    return;
  }
  input.blur();                                // 最後一張：收起鍵盤，顯示總結
  card = null;
  cardSentence = null;
  renderPractice();
}

// 卡片從未完成變成完成的那一刻，由 handleValue 或 submitProd 呼叫（4.3）
function finishCard() {
  const before = cardSentence;
  const outcome = cardInfo.stage === 3 ? prodOutcome(card) : cardOutcome(card);
  const index = data.session.index;
  commit(completeCard(data, outcome));         // 結果立刻存檔；這句結束、而且是最後一句時也一併寫入當天完成
  if (data.session.index > index) {            // 這句今天結束了
    const after = data.sentences.find((x) => x.id === before.id);
    resultMsg = resultMessage(before, after, outcome);
  } else {                                     // 還在同一句：換到下一個階段，或同一階段重試
    resultMsg = rungMessage(cardInfo.stage, outcome);
  }
}

// 練習頁的事件（5.2），由 bindEvents 的最後呼叫；newer 與儲存空間失敗畫面不會走到這裡
function bindPractice() {
  input.addEventListener('keydown', (e) => {
    debugLog('keydown', e);
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); onEnter(); }
  });
  input.addEventListener('beforeinput', (e) => {
    debugLog('beforeinput', e);
    const t = e.inputType || '';
    if (t === 'insertLineBreak' || t === 'insertParagraph') { e.preventDefault(); onEnter(); return; }
    if (t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); return; }
    if (card && card.complete && t.startsWith('insert')) e.preventDefault();
  });
  input.addEventListener('input', (e) => { debugLog('input', e); if (!e.isComposing) handleValue(); });
  input.addEventListener('compositionend', (e) => { debugLog('compositionend', e); handleValue(); });
  input.addEventListener('compositionstart', (e) => debugLog('compositionstart', e));
  input.addEventListener('focus', (e) => debugLog('focus', e));
  input.addEventListener('blur', (e) => debugLog('blur', e));

  for (const b of [nextBtn, revealBtn, resumeBtn]) {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('mousedown', (e) => e.preventDefault());
  }
  nextBtn.addEventListener('click', () => { advance(); if (card) input.focus(); });
  revealBtn.addEventListener('click', () => { if (card) { flashMsg = null; card = cardInfo.stage === 3 ? prodReveal(card) : cardReveal(card); renderPractice(); input.focus(); } });
  resumeBtn.addEventListener('click', () => input.focus());
  exitBtn.addEventListener('click', () => { input.blur(); card = null; cardSentence = null; show('home'); });
}

// ===== 8. 句子庫與編輯頁 =====
function openEdit(id) {                       // id 為 null 表示新增句子
  editingId = id;
  show('edit');
}

// msg 是「補入內建句型」的結果文字；show('library') 不帶參數，所以離開再回來就清掉（4.4）
function renderLibrary(msg = '') {
  const t = today();
  fill(document.getElementById('library'),
    h('div', { class: 'lib-head' },
      h('span', null, '共 ' + data.sentences.length + ' 句'),
      h('button', { type: 'button', onclick: () => openEdit(null) }, '新增句子'),
      h('button', { type: 'button', onclick: onMergeSeed }, '補入內建句型'),
      h('span', { class: 'lib-msg' }, msg)),
    h('div', { class: 'lib-list' },
      data.sentences.map((s) => h('button', { type: 'button', class: 'lib-row', onclick: () => openEdit(s.id) },
        h('span', { class: 'lib-en', lang: 'en' }, s.text),
        h('span', { class: 'lib-zh' }, s.zh),
        h('span', { class: 'lib-meta' },
          [levelLabel(s), dueLabel(s, t)].filter(Boolean).join(' ') + (s.frame !== '' ? '・有句型' : ''))))));
}

// 「補入內建句型」：mergeSeed 不改任何既有句子的英文與進度，所以不需要 confirm（4.4）
function onMergeSeed() {
  const r = mergeSeed(data, SEED);
  commit(r.data);
  renderLibrary(r.added === 0 && r.updated === 0
    ? '內建句型都已經在句子庫裡'
    : '已加入 ' + r.added + ' 句、補上 ' + r.updated + ' 句的句型');
}

function renderEdit() {
  const s = data.sentences.find((x) => x.id === editingId) || null;
  const textEl = h('textarea', { id: 'edit-text', rows: 3, lang: 'en' }, s ? (s.frame !== '' ? s.frame : s.text) : '');
  const textErr = h('p', { class: 'field-err' });
  const zhEl = h('input', { id: 'edit-zh', type: 'text', value: s ? s.zh : '' });
  const zhErr = h('p', { class: 'field-err' });
  const topicsEl = h('textarea', { id: 'edit-topics', rows: 3, lang: 'zh-Hant-TW' }, s ? s.topics.join('\n') : '');
  const topicsErr = h('p', { class: 'field-err' });
  function onSave() {
    const res = validateSentenceInput(data, textEl.value, zhEl.value, topicsEl.value, editingId);
    if (!res.ok) {                             // 錯誤顯示在 res.field 對應的欄位下方，另外兩個欄位清空
      textErr.textContent = res.field === 'text' ? res.error : '';
      zhErr.textContent = res.field === 'zh' ? res.error : '';
      topicsErr.textContent = res.field === 'topics' ? res.error : '';
      return;
    }
    const fields = { text: res.text, zh: res.zh, frame: res.frame, topics: res.topics };   // 一律傳驗證後的版本
    if (editingId === null) {
      let id = newId();
      while (data.sentences.some((x) => x.id === id)) id = newId();   // 和既有 id 重複就重新產生
      commit(addSentence(data, { id, ...fields }));
    } else {
      commit(updateSentence(data, editingId, fields, today()));
    }
    show('library');
  }
  function onDelete() {
    if (!confirm('刪除後這句的練習紀錄也會一起刪除，確定嗎？')) return;
    commit(deleteSentence(data, editingId, today()));
    show('library');
  }
  fill(document.getElementById('edit'),
    h('h1', null, editingId === null ? '新增句子' : '編輯句子'),
    h('label', { for: 'edit-text' }, '英文'),
    textEl,
    textErr,
    h('label', { for: 'edit-zh' }, '中文'),
    zhEl,
    zhErr,
    h('label', { for: 'edit-topics' }, '議題'),
    topicsEl,
    topicsErr,
    h('p', { class: 'help' }, '一行一個，最多 6 個，每個 40 字以內，議題應用時輪流出題'),
    h('p', { class: 'help' }, '只能用英文鍵盤打得出來的字元'),
    h('p', { class: 'help' }, '彎引號、破折號與全形標點會自動換成英文標點'),
    h('p', { class: 'help' }, '用 { } 包住可以替換的部分，例如 we propose {a new method}.；沒有大括號就不做議題應用'),
    editingId === null ? null : h('p', { class: 'help' }, '修改英文後，這句會從全句提示重新練起'),
    editingId === null ? null : h('p', { class: 'help' }, '只改大括號的位置或議題不影響進度'),
    h('div', { class: 'edit-actions' },
      h('button', { type: 'button', onclick: onSave }, '儲存'),
      h('button', { type: 'button', onclick: () => show('library') }, '取消'),
      editingId === null ? null : h('button', { type: 'button', onclick: onDelete }, '刪除')));
}

// ===== 9. 設定、匯出匯入、診斷 =====
// ISO 時間字串 → 本地時間的 M/D HH:MM（4.6）；無法解析時原樣顯示
function stampLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p2 = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

// boot.js 寫入的錯誤紀錄，新的在前；讀不到或格式不對時當成沒有紀錄
function readErrorLog() {
  try {
    const list = JSON.parse(localStorage.getItem('phrase-drill:errors') || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object').reverse() : [];
  } catch (e) { return []; }
}

// 複製類按鈕加上旁邊的結果 span；沒給 onSuccess 時成功顯示「已複製」，失敗一律顯示「複製失敗」，都不重畫
function copyButton(label, getText, onSuccess) {
  const msg = h('span', { class: 'muted' });
  const btn = h('button', {
    type: 'button',
    onclick: () => navigator.clipboard.writeText(getText()).then(
      () => { if (onSuccess) onSuccess(); else msg.textContent = '已複製'; },
      () => { msg.textContent = '複製失敗'; }),
  }, label);
  return [btn, msg];
}

// 規格 7.6 的 exportText，逐字照抄
function exportText(text, filename, onDone) {
  for (const type of ['application/json', 'text/plain']) {
    const file = new File([text], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] })           // 只帶 files，不同時帶 text 或 title
        .then(() => onDone('shared'))
        .catch((err) => onDone(err && err.name === 'AbortError' ? 'cancelled' : 'failed', err));
      return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);  // 不要立刻 revoke（WebKit bug 211234）
  onDone('downloaded');
}

// 7.6 匯入流程第 2 到 5 步，從檔案匯入與貼上文字匯入共用
function importBackup(text) {
  const result = fromBackupJSON(text);
  if (!result.ok) { alert(result.error); return; }
  const s = result.summary;
  const from = s.exportedDay ? '（' + s.exportedDay + ' 匯出）' : '';
  if (!confirm('備份裡有 ' + s.sentences + ' 句、' + s.days + ' 天完成紀錄' + from + '。匯入會取代目前的 '
    + data.sentences.length + ' 句與所有紀錄；目前的資料會先另存，可以用『還原』復原。確定嗎？')) return;
  try { writeUndo(localStorage, data, 'import', nowIso()); } catch (e) { if (!confirm('無法另存目前資料，仍要匯入嗎？')) return; }
  commit(result.data);
  warnings = [];
  const msg = '已匯入 ' + s.sentences + ' 句、' + s.days + ' 天紀錄'
    + (s.fromV1 ? '；這是第 1 版的備份，請到句子庫按「補入內建句型」補上新句與骨架' : '');
  renderSettings([msg, ...result.warnings]);
}

// 7.6 匯入流程第 1 步：先取出檔案、清空 value（下次才能選同一個檔案），再讀內容
async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  importBackup(await file.text());
}

// 還原按鈕與確認框共用的「10/14 21:05 匯入前」
function undoLabel(undo) {
  return stampLabel(undo.at) + ' ' + (undo.reason === 'import' ? '匯入前' : '清除前');
}

// 7.6 還原
function restoreUndo(undo) {
  if (!confirm('目前的資料會被 ' + undoLabel(undo) + '的資料取代，確定嗎？')) return;
  const saved = commit(undo.data);
  warnings = [];
  if (saved) { try { clearUndo(localStorage); } catch (e) { window.PD_LOG(e, 'undo'); } }
  renderSettings();
}

// 4.6 第 5 區：清除所有資料
function clearAllData() {
  if (!confirm('會刪除所有句子與練習紀錄，並重建內建句子庫。目前的資料會先另存，可以用『還原』復原。確定嗎？')) return;
  try { writeUndo(localStorage, data, 'clear', nowIso()); } catch (e) { if (!confirm('無法另存目前資料，仍要清除嗎？')) return; }
  commit(createInitialData(SEED));
  warnings = [];
  renderSettings();
}

// 4.6 第 1 區：每日題數；改了只 commit，不重畫（select 已經顯示新值）
function settingsDaily() {
  return h('div', null,
    h('h2', null, '每日題數'),
    h('select', { 'aria-label': '每日題數', onchange: (e) => commit(setDailyCount(data, Number(e.target.value))) },
      DAILY_OPTIONS.map((n) => h('option', { value: n, selected: n === data.settings.dailyCount }, n))),
    h('p', { class: 'muted' }, '每天練幾句，一句會打好幾張卡。下一次建立今天的練習或加練時生效；今天已經排好的句子不變'));
}

// 4.6 第 2 區：備份；msgs 每條一行，放在備份區最上方
function settingsBackup(msgs, copyOk) {
  const exportMsg = h('span');
  const paste = h('textarea', { autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false' });
  let undo = null;
  try { undo = readUndo(localStorage); } catch (e) { undo = null; }
  const onExportDone = (result) => {       // downloaded 與 cancelled 什麼都不做
    if (result === 'shared') { commit(markExported(data, today())); renderSettings(); }
    else if (result === 'failed') exportMsg.textContent = '匯出失敗，請改用『複製備份文字』';
  };
  return h('div', null,
    h('h2', null, '備份'),
    msgs.map((m) => h('p', { class: 'note' }, m)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: () => {
        const t = today();
        exportText(toBackupJSON(data, t, nowIso()), 'phrase-drill-' + t + '.json', onExportDone);
      } }, '匯出備份檔'),
      exportMsg,
      copyOk && copyButton('複製備份文字', () => toBackupJSON(data, today(), nowIso()),
        () => { commit(markExported(data, today())); renderSettings(); }),
      h('label', { class: 'btn', for: 'import-file' }, '從檔案匯入',
        h('input', { type: 'file', id: 'import-file', onchange: onImportFile }))),
    h('details', null,
      h('summary', null, '貼上文字匯入'),
      paste,
      h('button', { type: 'button', onclick: () => importBackup(paste.value) }, '匯入')),
    h('p', { class: 'muted' }, data.settings.lastExport ? '上次匯出：' + data.settings.lastExport : '尚未匯出'),
    undo && h('p', null, h('button', { type: 'button', onclick: () => restoreUndo(undo) },
      '還原上次匯入或清除前的資料（' + undoLabel(undo) + '）')));
}

// 4.6 第 3 區：iPhone 鍵盤提醒，固定文字
function settingsTips() {
  return h('div', null,
    h('h2', null, 'iPhone 鍵盤提醒'),
    h('p', { class: 'muted' }, '以下設定項目的名稱可能依 iOS 版本略有不同。'),
    h('ol', null, [
      '連按兩下空白會插入句點加空白（iOS 的「"." 快速鍵」）。在句尾或句點後面本來就接空白的地方這樣打是正常的打法，不計失誤；句點後面不是空白的地方（例如 e.g. 的第一個句點）請從數字鍵盤打，否則多出來的空白會被判錯。在不該有句點的地方誤觸時，狀態列會提示，也不計失誤，刪掉就好。',
      '本 app 已在輸入框關閉自動修正與自動大寫，並要求關閉智慧型標點；就算仍出現彎引號或破折號，也會自動換成英文標點再比對，大小寫不計分。',
      '鍵盤上方若仍出現預測列，或出現灰色的行內預測（iOS 17 無法從網頁端關閉），可到「設定 > 一般 > 鍵盤」關閉「預測文字」。',
      '在「設定 > 一般 > 鍵盤 > 替代文字」設定的縮寫，練習時也會展開，練習時不要依賴它；聽寫也能輸入文字，但等於沒有練打字。',
      '請用英文鍵盤練習；切到注音打出中文字時不計失誤，但要刪掉才能繼續。',
      '接實體鍵盤時，自動大寫等行為改由「設定 > 一般 > 鍵盤 > 實體鍵盤」控制。',
    ].map((t) => h('li', null, t))));
}

// 4.6 第 4 區：診斷；版本與永久儲存先放「…」，promise 回來後只改那個 span，不重畫
function settingsDiagnostics(copyOk) {
  const ver = h('span', null, '…');
  const persisted = h('span', null, '…');
  if (!window.caches) ver.textContent = '開發模式（未啟用離線快取）';
  else caches.keys().then((keys) => {
    const mine = keys.filter((k) => k.startsWith('phrase-drill-'));
    ver.textContent = mine.length ? mine.join('、') : '開發模式（未啟用離線快取）';
  }).catch(() => { ver.textContent = '無法讀取'; });
  if (!navigator.storage?.persisted) persisted.textContent = '不支援';
  else navigator.storage.persisted()
    .then((ok) => { persisted.textContent = ok ? '已允許' : '未允許'; })
    .catch(() => { persisted.textContent = '不支援'; });
  const standalone = isStandalone() ? '是' : '否';
  const controlled = navigator.serviceWorker?.controller ? '是' : '否';
  const errors = readErrorLog().map((e) => stampLabel(e.t) + ' ' + e.msg + (e.at ? '（' + e.at + '）' : ''));
  let corrupt = null;
  try { corrupt = readCorrupt(localStorage); } catch (e) { corrupt = null; }
  const corruptLine = corrupt && '有一份未能讀取的原始資料（' + stampLabel(corrupt.at) + '，' + corrupt.raw.length + ' 字元）';
  let debugOn = false;
  try { debugOn = localStorage.getItem('phrase-drill:debug') === '1'; } catch (e) { debugOn = false; }
  // 不含原始資料；版本與永久儲存讀 span 當下的文字，還是「…」也照樣複製
  const diagText = () => ['版本：' + ver.textContent, '資料格式：' + SCHEMA, '以主畫面 app 開啟：' + standalone,
    '永久儲存：' + persisted.textContent, 'SW 控制中：' + controlled, '錯誤紀錄：',
    ...(errors.length ? errors : ['（沒有錯誤紀錄）']), ...(corrupt ? [corruptLine] : [])].join('\n');
  return h('details', null,
    h('summary', null, '診斷'),
    h('p', null, '版本：', ver),
    h('p', null, '資料格式：' + SCHEMA),          // 同步取得的固定值，不等 promise（4.6）
    h('p', null, '以主畫面 app 開啟：' + standalone),
    h('p', null, '永久儲存：', persisted),
    h('p', null, 'SW 控制中：' + controlled),
    h('p', null, '錯誤紀錄：'),
    errors.length ? h('ul', null, errors.map((t) => h('li', null, t))) : h('p', null, '（沒有錯誤紀錄）'),
    corrupt && [h('p', null, corruptLine), h('div', { class: 'actions' },
      copyOk && copyButton('複製', () => corrupt.raw),
      h('button', { type: 'button', onclick: () => {
        if (!confirm('刪除後就無法再取回這份原始資料，確定嗎？')) return;
        try { clearCorrupt(localStorage); } catch (e) { window.PD_LOG(e, 'corrupt'); }
        renderSettings();
      } }, '刪除'))],
    h('div', { class: 'actions' },
      copyOk && copyButton('複製診斷資訊', diagText),
      h('button', { type: 'button', onclick: () => {
        try { localStorage.removeItem('phrase-drill:errors'); } catch (e) { window.PD_LOG(e, 'errors'); }
        renderSettings();
      } }, '清除錯誤紀錄'),
      h('button', { type: 'button', onclick: forceUpdate }, '強制更新')),
    h('p', null, h('label', null,
      h('input', { type: 'checkbox', checked: debugOn, onchange: (e) => {
        try {
          if (e.target.checked) localStorage.setItem('phrase-drill:debug', '1');
          else localStorage.removeItem('phrase-drill:debug');
        } catch (err) { window.PD_LOG(err, 'debug'); }
      } }),
      '在練習頁顯示鍵盤事件紀錄（除錯用）')));
}

// 4.6：show('settings') 不帶參數；匯入成功時帶入匯入訊息與 result.warnings
function renderSettings(msgs = []) {
  const copyOk = !!navigator.clipboard?.writeText && window.isSecureContext === true;
  fill(document.getElementById('settings'),
    settingsDaily(), settingsBackup(msgs, copyOk), settingsTips(), settingsDiagnostics(copyOk),
    h('p', null, h('button', { type: 'button', onclick: clearAllData }, '清除所有資料')));
}

// ===== 10. SW 註冊與強制更新 =====
// 規格 8.5，逐字照抄
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const wanted = location.protocol === 'https:' || new URLSearchParams(location.search).has('sw');
  if (!wanted) return;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }   // 第一次安裝時 clients.claim() 觸發的這一次不是更新
    if (reloading) return;
    if (currentScreen === 'home') { reloading = true; location.reload(); }
    else pendingReload = true;                   // show('home') 時再 reload
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { swReg = reg; reg.update().catch(() => {}); })
    .catch((err) => window.PD_LOG(err, 'sw-register'));
}

// 規格 8.6，逐字照抄
async function forceUpdate() {
  if (!confirm('會重新下載程式（需要網路），練習資料不受影響。確定嗎？')) return;
  const offlineMsg = '目前連不到網路，強制更新需要網路，請連上網路後再試。';
  if (navigator.onLine === false) { alert(offlineMsg); return; }
  try { await fetch('./sw.js', { cache: 'no-store' }); } catch (e) { alert(offlineMsg); return; }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();   // 只取本頁 scope 的 registration
    if (reg) await reg.unregister();
    if (window.caches) for (const k of await caches.keys()) if (k.startsWith('phrase-drill-')) await caches.delete(k);
  } finally { location.reload(); }
}

// ===== 11. 啟動流程 =====
function showOnly(...children) {              // newer 與儲存空間失敗畫面：隱藏導覽列，只顯示 #home
  nav.hidden = true;
  const home = document.getElementById('home');
  fill(home, ...children);
  home.hidden = false;
}

function bindEvents() {
  for (const b of nav.querySelectorAll('button[data-go]')) {
    b.addEventListener('click', () => show(b.getAttribute('data-go')));
  }
  bindPractice();                              // 練習頁的事件（5.2）
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  swReg?.update().catch(() => {});
  if (currentScreen === 'practice' && data.session?.day !== today()) {   // 4.7 第 2 步：練習中換日就回首頁
    input.blur(); card = null; cardSentence = null; show('home');
  }
  if (currentScreen === 'home') renderHome();
}

function boot() {
  let res;
  try {
    res = load(localStorage, SEED, nowIso());
  } catch (e) {
    window.PD_LOG(e, 'load');
    showOnly(h('p', null, '無法存取裝置上的儲存空間，句練無法運作。若在私密瀏覽模式，請改用一般模式並加入主畫面。'));
    return;
  }
  if (res.status === 'newer') {
    showOnly(
      h('p', null, '這份資料由較新版本的句練寫入，這個版本無法讀取。請按『強制更新』取得新版。'),
      h('button', { type: 'button', onclick: () => forceUpdate() }, '強制更新'));
    return;
  }
  data = res.data;
  warnings = res.warnings;
  bindEvents();
  show('home');
  setupServiceWorker();
  if (isStandalone()) navigator.storage?.persist?.().catch(() => {});
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onVisibilityChange);   // 桌面視窗一直可見時，回到視窗也檢查換日（4.7）
  window.addEventListener('storage', (e) => {   // 另一個分頁或視窗改了主資料：本頁的 data 已過期，直接重新載入（4.7）
    if (e.key !== 'phrase-drill:data') return;
    if (currentScreen === 'practice') { input.blur(); card = null; cardSentence = null; }
    location.reload();
  });
}

boot();
