// tests/drill.test.js：js/drill.js 的單元測試（規格 10.3）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISTAKE_LIMIT, LONG_SENTENCE_WORDS, DEVIATION_LIMIT, ANCHOR_WORDS, canonicalize, canonicalizeInput, nonTypeableChars, containsCJK, wordCount, mistakeLimit, compareTyped, isPeriodShortcut } from '../js/drill.js';
import { anchorEnd, hintSegments, newCard, cardInput, cardReveal, shownLevel, cardOutcome, cardStatus } from '../js/drill.js';

// 失敗訊息用：把一個字元寫成 U+XXXX
const codePointLabel = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

// 10.3 canonicalize 的案例：[說明, 輸入, 期望]。非 ASCII 字元一律寫成 \u 跳脫，說明欄是它的樣子
const CANON_CASES = [
  ['“It’s” — fine…', '\u201CIt\u2019s\u201D \u2014 fine\u2026', '"It\'s" - fine...'],
  ['Ｉｎ　this 加 NBSP、paper， we', '\uFF29\uFF4E\u3000this\u00A0paper\uFF0C we', 'In this paper, we'],
  ['state‑of‑the‑art（U+2011）', 'state\u2011of\u2011the\u2011art', 'state-of-the-art'],
  ['a -- b', 'a -- b', 'a - b'],
  ['a、soft hyphen、b、ZWSP、c', 'a\u00ADb\u200Bc', 'abc'],
  ['雙向控制字元與其他 Cf 字元', 'a\u202Ab\u2066c\u2061d\u061Ce', 'abcde'],
  ['ﬁne', '\uFB01ne', 'fine'],
  ['In this paper。', 'In this paper\u3002', 'In this paper.'],
  ['A、B', 'A\u3001B', 'A,B'],
  ['12″ and 3′', '12\u2033 and 3\u2032', '12" and 3\''],
  ['x ﹘ y', 'x \uFE58 y', 'x - y'],
  ['前後與中間有多個空白、含換行的 In this paper', '  In   this \n\t paper \n ', 'In this paper'],
];

test('5.7 的常數', () => {
  assert.equal(MISTAKE_LIMIT, 2);
  assert.equal(LONG_SENTENCE_WORDS, 16);
  assert.equal(DEVIATION_LIMIT, 3);
  assert.equal(ANCHOR_WORDS, 2);
});

test('canonicalize：10.3 的案例', () => {
  for (const [label, input, expected] of CANON_CASES) {
    assert.equal(canonicalize(input), expected, label);
  }
});

test('canonicalizeInput：同一段多空白輸入只去開頭空白，保留一個結尾空白', () => {
  assert.equal(canonicalizeInput('  In   this \n\t paper \n '), 'In this paper ');
});

test('canonicalize 是冪等的', () => {
  for (const [label, input] of CANON_CASES) {
    const once = canonicalize(input);
    assert.equal(canonicalize(once), once, label);
  }
});

test('canonicalize：5.3 由 NFKC 負責的字元', () => {
  // 全形 ASCII U+FF01 到 U+FF5E → 半形 U+0021 到 U+007E
  for (let k = 0; k <= 0x5D; k++) {
    const full = String.fromCharCode(0xFF01 + k);
    assert.equal(canonicalize('x' + full + 'y'), 'x' + String.fromCharCode(0x21 + k) + 'y', codePointLabel(full));
  }
  // 全形空白、NBSP、U+2000 到 U+200A、U+202F、U+205F → 一般空白
  const spaces = ['\u3000', '\u00A0', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
    '\u2006', '\u2007', '\u2008', '\u2009', '\u200A', '\u202F', '\u205F'];
  for (const c of spaces) {
    assert.equal(canonicalize('x' + c + 'y'), 'x y', codePointLabel(c));
  }
  // 連字 U+FB00 到 U+FB06
  const ligatures = [['\uFB00', 'ff'], ['\uFB01', 'fi'], ['\uFB02', 'fl'], ['\uFB03', 'ffi'],
    ['\uFB04', 'ffl'], ['\uFB05', 'st'], ['\uFB06', 'st']];
  for (const [c, expected] of ligatures) {
    assert.equal(canonicalize('x' + c + 'y'), 'x' + expected + 'y', codePointLabel(c));
  }
  assert.equal(canonicalize('wait\u2026'), 'wait...');   // … → ...
  assert.equal(canonicalize('x\u2011y'), 'x-y');         // ‑ → -
  assert.equal(canonicalize('x\uFE58y'), 'x-y');         // ﹘ → — → -
  assert.equal(canonicalize('A\uFF61'), 'A.');           // ｡ → 。 → .
  assert.equal(canonicalize('A\uFF64B'), 'A,B');         // ､ → 、 → ,
  assert.equal(canonicalize('12\u2033'), '12"');         // ″ 先換成 "，不會被 NFKC 拆成兩個 ′
});

test('canonicalize：5.3 第 4 步刪除的不可見字元（Unicode 類別 Cf）', () => {
  for (const c of ['\u00AD', '\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u2060', '\uFEFF',
    '\u061C', '\u180E', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
    '\u2061', '\u2062', '\u2063', '\u2064', '\u2066', '\u2067', '\u2068', '\u2069']) {
    assert.equal(canonicalize('a' + c + 'b'), 'ab', codePointLabel(c));
  }
});

test('canonicalize：5.3 刻意不正規化的三樣，以及 -- 與 — 得到同一個結果', () => {
  assert.equal(canonicalize('\u300Ca\u300D\u300Eb\u300F'), '\u300Ca\u300D\u300Eb\u300F');   // 「a」『b』維持原狀
  assert.equal(canonicalizeInput('In this. '), 'In this. ');   // 雙空白產生的「. 」不換回空白
  assert.equal(canonicalize('In THIS Paper'), 'In THIS Paper');   // 大小寫不在正規化階段處理
  assert.equal(canonicalize('a--b'), canonicalize('a\u2014b'));
  assert.equal(canonicalize('a---b'), 'a-b');
});

test('nonTypeableChars：10.3 的案例', () => {
  assert.deepEqual(nonTypeableChars('5 \u03BCm \u00B1 2'), ['\u03BC', '\u00B1']);   // 5 μm ± 2 → μ 與 ±
  assert.deepEqual(nonTypeableChars('In this paper, we propose a method.'), []);   // 純 ASCII
  assert.deepEqual(nonTypeableChars('a\u{1F600}b'), ['\u{1F600}']);                // emoji 算一個字元，不是兩個 surrogate
});

test('nonTypeableChars：只收 0x20 到 0x7E 以外的字元，不重複，依出現順序', () => {
  assert.deepEqual(nonTypeableChars(''), []);
  assert.deepEqual(nonTypeableChars(' ~'), []);                                   // 0x20 與 0x7E 都打得出來
  assert.deepEqual(nonTypeableChars('a\u001Fb\u007Fc'), ['\u001F', '\u007F']);    // 0x1F 與 0x7F 剛好在範圍外
  assert.deepEqual(nonTypeableChars('\u00B1 \u03BC \u00B1 \u03BC'), ['\u00B1', '\u03BC']);
});

test('containsCJK：10.3 的案例', () => {
  assert.equal(containsCJK('這'), true);
  assert.equal(containsCJK('ㄅ'), true);
  assert.equal(containsCJK('\uFF0C'), false);   // 全形逗號「，」
  assert.equal(containsCJK('In t這'), true);
  assert.equal(containsCJK('In this paper, we'), false);
});

test('canonicalize：從 PDF、Word 或網頁貼上的標點與不可見字元正規化成 ASCII，照常存檔', () => {
  for (const c of ['\u2018', '\u201A', '\u201B', '\u02BC']) {               // ‘ ‚ ‛ ʼ
    assert.equal(canonicalize('x' + c + 'y'), "x'y", codePointLabel(c));
  }
  for (const c of ['\u201E', '\u201F']) {                                   // „ ‟
    assert.equal(canonicalize('x' + c + 'y'), 'x"y', codePointLabel(c));
  }
  for (const c of ['\u2010', '\u2012', '\u2013', '\u2015', '\u2212']) {     // ‐ ‒ – ― −
    assert.equal(canonicalize('x' + c + 'y'), 'x-y', codePointLabel(c));
  }
  // Results in Table 2 (pp. 10–20) show a −0.5 dB drop for the ‘baseline’ methods.
  const pasted = canonicalize('Results in Table 2 (pp. 10\u201320) show a \u22120.5 dB drop for the \u2018baseline\u2019 methods.');
  assert.equal(pasted, "Results in Table 2 (pp. 10-20) show a -0.5 dB drop for the 'baseline' methods.");
  assert.deepEqual(nonTypeableChars(pasted), []);
  // The、proposed、method、works、well 後面依序夾著 U+200D、U+2060、U+FEFF、U+200E、U+200C
  const hidden = canonicalize('The\u200D proposed\u2060 method\uFEFF works\u200E well\u200C.');
  assert.equal(hidden, 'The proposed method works well.');
  assert.deepEqual(nonTypeableChars(hidden), []);
});

test('wordCount：空字串為 0，其餘為用空白切開的段數', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('Hello.'), 1);
  assert.equal(wordCount('One two.'), 2);
  assert.equal(wordCount('In this paper, we propose a method.'), 7);
});

test('mistakeLimit：10.3 的 20 個字的句子為 3，7 個字的 target 為 2', () => {
  const twenty = 'This is a sentence with exactly twenty words that is used to test the mistake limit of the drill card.';
  assert.equal(wordCount(twenty), 20);
  assert.equal(mistakeLimit(twenty), 3);
  assert.equal(mistakeLimit('In this paper, we propose a method.'), 2);
});

test('mistakeLimit：剛好 16 個字的句子容許 3，15 個字的句子（s05、s51）容許 2', () => {
  const s05 = 'To the best of our knowledge, this is the first work to study this problem.';
  assert.equal(wordCount(s05), 15);
  assert.equal(mistakeLimit(s05), 2);
  const s51 = 'It should be noted that the computational cost increases with the size of the input.';
  assert.equal(wordCount(s51), 15);
  assert.equal(mistakeLimit(s51), 2);
  const sixteen = 'To the best of our knowledge, this is the first work to study this problem carefully.';
  assert.equal(wordCount(sixteen), 16);
  assert.equal(mistakeLimit(sixteen), 3);
});

test('compareTyped：10.3 的表格（target 為 In this paper, we propose a method.）', () => {
  const target = 'In this paper, we propose a method.';
  const rows = [
    // [說明, 輸入, typed, matched, hasError, complete]
    ['空字串', '', '', 0, false, false],
    ['In th', 'In th', 'In th', 5, false, false],
    ['in THIS', 'in THIS', 'in THIS', 7, false, false],
    ['In thsi', 'In thsi', 'In thsi', 5, true, false],
    ['In this paper we', 'In this paper we', 'In this paper we', 13, true, false],
    ['In this paper （結尾有空白，目標在這個位置是逗號）', 'In this paper ', 'In this paper ', 13, true, false],
    ['In this （結尾有空白）', 'In this ', 'In this ', 8, false, false],
    ['全句去掉結尾句點、改成一個空白（5.4 規則 1）', target.slice(0, -1) + ' ', target.slice(0, -1) + ' ', 34, false, false],
    ['全句', target, target, 35, false, true],
    ['全句加一個空白（5.4 規則 2）', target + ' ', target + ' ', 35, false, true],
    ['全句加 x', target + 'x', target + 'x', 35, true, false],
    ['In this paper, 後接兩個空白再接 we', 'In this paper,  we', 'In this paper, we', 17, false, false],
    ['In this. 後接兩個空白', 'In this.  ', 'In this. ', 7, true, false],
  ];
  for (const [label, raw, typed, matched, hasError, complete] of rows) {
    assert.deepEqual(compareTyped(target, raw), { typed, matched, hasError, complete }, label);
  }
});

test('compareTyped：彎撇號、雙空白句點打到一半、真的漏打句點', () => {
  // target 為 it's fine.、輸入 it’s（U+2019）
  assert.deepEqual(compareTyped("it's fine.", 'it\u2019s'), { typed: "it's", matched: 4, hasError: false, complete: false });
  // Fig 後面打了一個空白：雙空白句點打到一半，沒有錯
  assert.deepEqual(compareTyped('Fig. 1 shows it.', 'Fig '), { typed: 'Fig ', matched: 3, hasError: false, complete: false });
  // Fig 1：真的漏打句點，有錯
  assert.deepEqual(compareTyped('Fig. 1 shows it.', 'Fig 1'), { typed: 'Fig 1', matched: 3, hasError: true, complete: false });
});

test('isPeriodShortcut：句點出現在目標是空白的位置，後面是空白或沒有字元', () => {
  const target = 'In this paper, we propose a method.';
  const shortcut = (raw) => isPeriodShortcut(target, compareTyped(target, raw));
  assert.equal(shortcut('In this. '), true);        // 不該有句點的地方連按兩下空白
  assert.equal(shortcut('In this.'), true);         // 照提示退格，刪掉自動插入的空白
  assert.equal(shortcut('In this. paper'), true);   // 句點後面是空白，之後又打了字
  assert.equal(shortcut('In this.paper'), false);   // 句點後面不是空白
  assert.equal(shortcut('In this'), false);         // 沒有錯
  assert.equal(shortcut('In this '), false);        // 沒有錯
  assert.equal(shortcut('In thsi'), false);         // 錯的字元不是句點
});

test('isPeriodShortcut：目標在那個位置不是空白，或根本沒有錯時為 false', () => {
  const comma = 'However, existing methods.';
  const c1 = compareTyped(comma, 'However. ');
  assert.equal(c1.hasError, true);
  assert.equal(isPeriodShortcut(comma, c1), false);   // 目標在那個位置是逗號
  const eg = 'We use e.g. this.';
  const c2 = compareTyped(eg, 'We use e. ');
  assert.equal(c2.hasError, true);
  assert.equal(isPeriodShortcut(eg, c2), false);      // e.g. 的第一個句點後面沒有空白，多出來的空白照常判錯
  const fig = 'Fig. 1 shows it.';
  const c3 = compareTyped(fig, 'Fig. ');
  assert.equal(c3.hasError, false);
  assert.equal(isPeriodShortcut(fig, c3), false);     // 句點本來就在這裡，不是錯誤
});

// ===== 第 3 任務：anchorEnd 與 hintSegments（規格 6.1） =====
// 包在區塊裡：區塊內的 const 只在區塊內有效，不會和檔案頂層的名稱衝突。
{
  const T = 'In this paper, we propose a method.';
  const seg = (kind, text) => ({ text, kind });
  const joined = (segs) => segs.map((s) => s.text).join('');

  test('anchorEnd：One two three four. 為 7、One two. 為 3、Single. 為 0', () => {
    assert.equal(anchorEnd('One two three four.'), 7);
    assert.equal(anchorEnd('One two.'), 3);
    assert.equal(anchorEnd('Single.'), 0);
  });

  test('hintSegments L1、matched 0：In this paper, we propose', () => {
    assert.equal(joined(hintSegments('In this paper, we propose', 1, 0, false)), 'I_ t___ p____, w_ p______');
  });

  test('hintSegments L1、matched 0：state-of-the-art methods.', () => {
    assert.equal(joined(hintSegments('state-of-the-art methods.', 1, 0, false)), 's____-o_-t__-a__ m______.');
  });

  test("hintSegments L1、matched 0：Fig. 3 and e.g., don't 3D.", () => {
    assert.equal(joined(hintSegments("Fig. 3 and e.g., don't 3D.", 1, 0, false)), "F__. 3 a__ e.g., d__'t 3_.");
  });

  test('hintSegments L0、matched 0', () => {
    assert.deepEqual(hintSegments(T, 0, 0, false), [seg('todo', 'In this paper, we propose a method.')]);
  });

  test('hintSegments L0、matched 5、有錯', () => {
    assert.deepEqual(hintSegments(T, 0, 5, true), [
      seg('done', 'In th'), seg('err', 'i'), seg('todo', 's paper, we propose a method.'),
    ]);
  });

  test('hintSegments L1、matched 5', () => {
    assert.deepEqual(hintSegments(T, 1, 5, false), [
      seg('done', 'In th'), seg('mask', '__'), seg('todo', ' p'), seg('mask', '____'),
      seg('todo', ', w'), seg('mask', '_'), seg('todo', ' p'), seg('mask', '______'),
      seg('todo', ' a m'), seg('mask', '_____'), seg('todo', '.'),
    ]);
  });

  test('hintSegments L1、matched 5、有錯', () => {
    assert.deepEqual(hintSegments(T, 1, 5, true), [
      seg('done', 'In th'), seg('err', '_'), seg('mask', '_'), seg('todo', ' p'), seg('mask', '____'),
      seg('todo', ', w'), seg('mask', '_'), seg('todo', ' p'), seg('mask', '______'),
      seg('todo', ' a m'), seg('mask', '_____'), seg('todo', '.'),
    ]);
  });

  test('hintSegments L2、matched 0', () => {
    assert.deepEqual(hintSegments(T, 2, 0, false), [seg('todo', 'In this')]);
  });

  test('hintSegments L2、matched 4、有錯', () => {
    assert.deepEqual(hintSegments(T, 2, 4, true), [seg('done', 'In t'), seg('err', 'h'), seg('todo', 'is')]);
  });

  test('hintSegments L2、matched 14', () => {
    assert.deepEqual(hintSegments(T, 2, 14, false), [seg('done', 'In this paper,')]);
  });

  test('hintSegments L2、matched 14、有錯', () => {
    assert.deepEqual(hintSegments(T, 2, 14, true), [seg('done', 'In this paper,'), seg('err', '_')]);
  });

  test('hintSegments a b.：L0、matched 4、有錯（輸入超出句尾）', () => {
    assert.deepEqual(hintSegments('a b.', 0, 4, true), [seg('done', 'a b.'), seg('err', '_')]);
  });
}

// ===== 第 3 任務：卡片狀態機（規格 5.5、10.3） =====
// 包在區塊裡，理由同上一個區塊。
{
  const T = 'In this paper, we propose a method.';
  // 20 個字，容許上限是 3
  const LONG20 = 'In this paper, we propose a simple yet effective method to reduce the computational cost of the overall inference process.';
  // 三次各自刪乾淨的獨立錯誤
  const THREE_ERRORS = ['In t', 'In tx', 'In t', 'In tx', 'In t', 'In tx', 'In t'];
  // 從 newCard 開始依序輸入，回傳每一步之後的卡片；輸入前先凍結，cardInput 若修改輸入會直接 throw
  const steps = (level, inputs, target = T) => {
    const cards = [];
    let card = newCard(target, level);
    for (const raw of inputs) {
      card = cardInput(Object.freeze(card), raw);
      cards.push(card);
    }
    return cards;
  };
  const last = (cards) => cards[cards.length - 1];

  test('newCard：typed 為空字串，數值為 0，布林為 false，hint 為 null', () => {
    assert.deepEqual(newCard(T, 1), {
      target: T, level: 1, typed: '', matched: 0, hasError: false, complete: false,
      mistakes: 0, errorCounted: false, revealed: false, hint: null,
    });
  });

  test('L0：In t、In tx、In txy、In tx、In t、In th，失誤 0', () => {
    const cards = steps(0, ['In t', 'In tx', 'In txy', 'In tx', 'In t', 'In th']);
    assert.deepEqual(cards.map((c) => c.mistakes), [0, 0, 0, 0, 0, 0]);
  });

  test('L0：In t、In tx、In txy、In txyz、In txyzw、In t，在 In txyz 時計 1 次，之後不重複計', () => {
    const cards = steps(0, ['In t', 'In tx', 'In txy', 'In txyz', 'In txyzw', 'In t']);
    assert.deepEqual(cards.map((c) => c.mistakes), [0, 0, 0, 1, 1, 1]);
  });

  test('L1：In t、In tx，失誤 1', () => {
    assert.equal(last(steps(1, ['In t', 'In tx'])).mistakes, 1);
  });

  test('L1：三次各自刪乾淨的獨立錯誤，失誤 3、revealed 為 true', () => {
    const cards = steps(1, THREE_ERRORS);
    assert.deepEqual(cards.map((c) => c.mistakes), [0, 1, 1, 2, 2, 3, 3]);
    assert.equal(cards[4].revealed, false);       // 失誤 2 還在容許範圍內
    assert.equal(last(cards).revealed, true);
  });

  test('L2：In t、再打一個「這」，hint 為 cjk、失誤 0', () => {
    const card = last(steps(2, ['In t', 'In t這']));
    assert.equal(card.hint, 'cjk');
    assert.equal(card.hasError, true);            // 仍然有錯，要刪掉才能繼續
    assert.equal(card.mistakes, 0);
  });

  test('L1：In this、In this. 、In this. paper，hint 為 period、失誤 0', () => {
    const card = last(steps(1, ['In this', 'In this. ', 'In this. paper']));
    assert.equal(card.hint, 'period');
    assert.equal(card.mistakes, 0);
  });

  test('L1：In this、In this 、In this. 、In this.、In this，失誤 0', () => {
    const cards = steps(1, ['In this', 'In this ', 'In this. ', 'In this.', 'In this']);
    assert.deepEqual(cards.map((c) => c.mistakes), [0, 0, 0, 0, 0]);
    assert.deepEqual(cards.map((c) => c.hint), [null, null, 'period', 'period', null]);
  });

  test('L2：target 為 However, existing methods.、輸入 However. 時失誤 1（目標在那個位置是逗號）', () => {
    const card = last(steps(2, ['However. '], 'However, existing methods.'));
    assert.equal(card.hint, null);
    assert.equal(card.mistakes, 1);
  });

  test('一路打完全句：complete 為 true，cardOutcome 為 pass', () => {
    const prefixes = [];
    for (let i = 1; i <= T.length; i++) prefixes.push(T.slice(0, i));
    for (const level of [0, 1, 2]) {
      const card = last(steps(level, prefixes));
      assert.equal(card.complete, true);
      assert.equal(card.mistakes, 0);
      assert.equal(cardOutcome(card), 'pass');
    }
  });

  test('結尾句點用雙空白打出：失誤 0、complete 為 true', () => {
    const cards = steps(2, [T.slice(0, -1) + ' ', T + ' ']);
    assert.equal(cards[0].hasError, false);
    assert.equal(cards[0].complete, false);
    assert.equal(cards[1].mistakes, 0);
    assert.equal(cards[1].complete, true);
    assert.equal(cardOutcome(cards[1]), 'pass');
  });

  test('L2 按看答案之後打完：cardOutcome 為 fail、shownLevel 為 0', () => {
    const fresh = newCard(T, 2);
    assert.equal(shownLevel(fresh), 2);
    const revealed = cardReveal(Object.freeze(fresh));
    assert.equal(revealed.revealed, true);
    assert.equal(shownLevel(revealed), 0);
    const done = cardInput(Object.freeze(revealed), T);
    assert.equal(done.complete, true);
    assert.equal(cardOutcome(done), 'fail');
    assert.equal(shownLevel(done), 0);
  });

  test('complete 之後再輸入或看答案，回傳同一個物件', () => {
    const done = Object.freeze(cardInput(newCard(T, 0), T));
    assert.equal(done.complete, true);
    assert.equal(cardInput(done, T + 'x'), done);
    assert.equal(cardReveal(done), done);
  });

  test('容許上限依 mistakeLimit：20 個字的句子是 3，上述 target 是 2', () => {
    assert.equal(last(steps(1, THREE_ERRORS)).revealed, true);
    const long = steps(1, [...THREE_ERRORS, 'In tx'], LONG20);
    assert.equal(long[6].mistakes, 3);
    assert.equal(long[6].revealed, false);
    assert.equal(long[7].mistakes, 4);
    assert.equal(long[7].revealed, true);
  });

  test('揭示之後不再計失誤，revealed 也不會取消', () => {
    const card = last(steps(1, [...THREE_ERRORS, 'In tx', 'In t']));
    assert.equal(card.mistakes, 3);
    assert.equal(card.revealed, true);
  });

  test('shownLevel：沒有揭示時等於 card.level', () => {
    assert.equal(shownLevel(newCard(T, 0)), 0);
    assert.equal(shownLevel(newCard(T, 1)), 1);
    assert.equal(shownLevel(newCard(T, 2)), 2);
  });

  test('揭示之後，提示列照 L0 的規則顯示', () => {
    const card = cardInput(Object.freeze(cardReveal(newCard(T, 2))), 'In th');
    assert.deepEqual(hintSegments(card.target, shownLevel(card), card.matched, card.hasError), [
      { text: 'In th', kind: 'done' }, { text: 'is paper, we propose a method.', kind: 'todo' },
    ]);
  });

  test('補充：失誤 1 次但沒有揭示，打完之後 cardOutcome 仍為 pass', () => {
    const card = last(steps(1, ['In t', 'In tx', 'In t', T]));
    assert.equal(card.mistakes, 1);
    assert.equal(card.revealed, false);
    assert.equal(card.complete, true);
    assert.equal(cardOutcome(card), 'pass');
  });

  test('補充：同時有中文與多餘句點時，hint 為 cjk、失誤 0', () => {
    const card = last(steps(1, ['In this. 這']));
    assert.equal(card.hint, 'cjk');
    assert.equal(card.mistakes, 0);
  });
}

// ===== 第 3 任務：cardStatus（規格 5.6） =====
// 包在區塊裡，理由同上一個區塊。
{
  const T = 'In this paper, we propose a method.';
  // 20 個字，容許上限是 3
  const LONG20 = 'In this paper, we propose a simple yet effective method to reduce the computational cost of the overall inference process.';
  const PREV = '通過，維持背誦';
  // 依序輸入，回傳最後的卡片；輸入前先凍結
  const typeAll = (card, inputs) => {
    let c = card;
    for (const raw of inputs) c = cardInput(Object.freeze(c), raw);
    return c;
  };

  test('cardStatus 第 1 種：hint 為 cjk（也優先於揭示）', () => {
    const card = typeAll(newCard(T, 2), ['In t', 'In t這']);
    assert.equal(cardStatus(card, null), '偵測到中文輸入，請切換到英文鍵盤（不計失誤）');
    const shown = typeAll(cardReveal(newCard(T, 1)), ['In t這']);
    assert.equal(cardStatus(shown, PREV), '偵測到中文輸入，請切換到英文鍵盤（不計失誤）');
  });

  test('cardStatus 第 2 種：hint 為 period', () => {
    const card = typeAll(newCard(T, 1), ['In this', 'In this. ']);
    assert.equal(cardStatus(card, null), '這裡多了句點，可能是連按兩下空白造成的，請刪掉（不計失誤）');
  });

  test('cardStatus 第 3 種：revealed 而且有錯', () => {
    const card = typeAll(cardReveal(newCard(T, 1)), ['In tx']);
    assert.equal(cardStatus(card, null), '這次算沒過，請刪回紅色的位置，再照著全句打完');
  });

  test('cardStatus 第 4 種：revealed 而且沒錯（也優先於「上一張」）', () => {
    assert.equal(cardStatus(cardReveal(newCard(T, 1)), PREV), '這次算沒過，請照著全句打完');
  });

  test('cardStatus 第 5 種：有錯', () => {
    const card = typeAll(newCard(T, 1), ['In t', 'In tx']);
    assert.equal(cardStatus(card, null), '有錯，請刪回紅色的位置・失誤 1／容許 2');
  });

  test('cardStatus 第 6 種：typed 為空字串而且 previous 不為 null，前綴是「上一張：」', () => {
    assert.equal(cardStatus(newCard(T, 2), PREV), '上一張：通過，維持背誦');
    assert.equal(cardStatus(newCard(T, 1), '通過，接著首字母提示'), '上一張：通過，接著首字母提示');
    assert.equal(cardStatus(newCard(T, 2), '通過，明天從背誦開始'), '上一張：通過，明天從背誦開始');
    assert.ok(!cardStatus(newCard(T, 2), PREV).startsWith('上一句：'));
  });

  test('cardStatus 第 7 種：其他', () => {
    assert.equal(cardStatus(newCard(T, 0), null), '失誤 0／容許 2');
    assert.equal(cardStatus(typeAll(newCard(T, 0), ['In th']), PREV), '失誤 0／容許 2');
    assert.equal(cardStatus(newCard(LONG20, 0), null), '失誤 0／容許 3');
  });
}

test('補充：句點位置打了別的字母不是雙空白句點，全句之後多出不只一個空白判錯', () => {
  const target = 'In this paper, we propose a method.';
  assert.deepEqual(compareTyped(target, 'In this paper, we propose a methodx'),
    { typed: 'In this paper, we propose a methodx', matched: 34, hasError: true, complete: false });
  assert.deepEqual(compareTyped(target, target + ' x'),
    { typed: target + ' x', matched: 35, hasError: true, complete: false });
  assert.equal(isPeriodShortcut(target, compareTyped(target, 'In thisx')), false);
});

// ===== 第 2 版：句型骨架與議題應用（規格 5.7、5.8、10.3） =====
// import 宣告在模組頂層的任何位置都合法，所以第 2 版的名稱在這裡另外 import，不改檔案開頭
import { PROD_ATTEMPTS, PROD_HINT_FIRST_LETTERS, SLOT_BLANK, stripBraces, tokens, parseFrame, normalizeFrame, skeletonCheck } from '../js/drill.js';
import { newProdCard, prodInput, prodSubmit, prodReveal, prodOutcome, prodStatus, prodHintSegments } from '../js/drill.js';
import { deepFreeze } from './helpers.js';

test('5.7 第 2 版的常數：PROD_ATTEMPTS 3、PROD_HINT_FIRST_LETTERS false、SLOT_BLANK 四個底線', () => {
  assert.equal(PROD_ATTEMPTS, 3);
  assert.equal(PROD_HINT_FIRST_LETTERS, false);
  assert.equal(SLOT_BLANK, '____');
});

// 5.8 stripBraces 與 tokens 的表格
{
  const STRIP_CASES = [
    ['we propose {a method}.', 'we propose a method.'],
    ['{{x}}', 'x'],
    ['no braces', 'no braces'],
    ['}{', ''],
  ];
  for (const [input, want] of STRIP_CASES) {
    test('stripBraces：' + JSON.stringify(input) + ' 為 ' + JSON.stringify(want), () => {
      assert.equal(stripBraces(input), want);
    });
  }

  const TOKEN_CASES = [
    ["Don't stop.", ["don't", 'stop']],
    ["'quoted'", ['quoted']],
    ['state-of-the-art', ['state', 'of', 'the', 'art']],
    ['Fig. 3 and 3D.', ['fig', '3', 'and', '3d']],
    ['', []],
    ["rock 'n' roll", ['rock', 'n', 'roll']],
    ["students' work", ['students', 'work']],
    ['e.g., 10%', ['e', 'g', '10']],
    ['résumé', ['r', 'sum']],
    ['To address 這個 issue', ['to', 'address', 'issue']],
    ["'''''''''''x", ['x']],
  ];
  for (const [input, want] of TOKEN_CASES) {
    test('tokens：' + JSON.stringify(input), () => {
      assert.deepEqual(tokens(input), want);
    });
  }
}

// 5.8 parseFrame 的表格，加上 10.3 的「we propose a} method{.」
{
  const F = (text) => ({ slot: false, text });
  const S = (text) => ({ slot: true, text });
  const OK_CASES = [
    ['To address this issue, we propose {a simple yet effective method}.',
      [F('To address this issue, we propose '), S('a simple yet effective method'), F('.')]],
    ['The question is not whether {we should regulate AI}, but how {we do it}.',
      [F('The question is not whether '), S('we should regulate AI'), F(', but how '), S('we do it'), F('.')]],
    ['{Formal verification} is not a substitute for {testing}.',
      [S('Formal verification'), F(' is not a substitute for '), S('testing'), F('.')]],
    ['{a}{b} is fine.', [S('a'), S('b'), F(' is fine.')]],
    ["'{x}' is the {key}.", [F("'"), S('x'), F("' is the "), S('key'), F('.')]],
  ];
  for (const [frame, parts] of OK_CASES) {
    test('parseFrame ok：' + frame, () => {
      assert.deepEqual(parseFrame(frame), { ok: true, parts });
    });
  }
  const CUT = '大括號要放在字與字之間，不能切開一個字';
  const ERROR_CASES = [
    ['we propose {a method.', '大括號沒有成對'],
    ['we propose a} method.', '大括號沒有成對'],
    ['we {propose {a} method}.', '大括號沒有成對'],
    ['we propose a} method{.', '大括號沒有成對'],
    ['we propose {  } method.', '大括號裡要有範例內容'],
    ["{The model}'s output is {robust}.", CUT],
    ['we {re}consider it.', CUT],
    ['we propose{a method}.', CUT],
    ['we propose{ a method}.', CUT],
    ['we propose a method.', '至少要有一組大括號'],
    ['{We} propose {a method}.', '大括號外面至少要保留兩個英文字'],
    ['{x}, and {y}.', '大括號外面至少要保留兩個英文字'],
    ['we{ } it is.', '大括號裡要有範例內容'],
    ['we{x}.', CUT],
    ['we ran 10{x} trials here.', CUT],
  ];
  for (const [frame, error] of ERROR_CASES) {
    test('parseFrame 錯誤：' + frame + ' 為「' + error + '」', () => {
      assert.deepEqual(parseFrame(frame), { ok: false, error });
    });
  }
}

// 5.8 normalizeFrame 的表格與三個性質
{
  const OK_CASES = [
    ['we propose { a method } .', 'we propose {a method} .', 'we propose a method .'],
    ['we propose { a method }.', 'we propose {a method} .', 'we propose a method .'],
    ['we propose{ a method}.', 'we propose {a method}.', 'we propose a method.'],
    ['  To address this issue,  we propose {a simple yet effective method}.  ',
      'To address this issue, we propose {a simple yet effective method}.',
      'To address this issue, we propose a simple yet effective method.'],
    ['we propose ｛a method｝.', 'we propose {a method}.', 'we propose a method.'],
    ['we propose ｛ a method ｝.', 'we propose {a method} .', 'we propose a method .'],
    ['“It’s” {fine} — really…', `"It's" {fine} - really...`, `"It's" fine - really...`],
  ];
  for (const [raw, frame, text] of OK_CASES) {
    test('normalizeFrame ok：' + JSON.stringify(raw), () => {
      const r = normalizeFrame(raw);
      assert.deepEqual(r, { ok: true, frame, text });
      assert.deepEqual(normalizeFrame(r.frame), r);                              // 冪等
      assert.equal(canonicalize(stripBraces(r.frame)), r.text);
      assert.equal(r.text, canonicalize(stripBraces(canonicalize(raw))));      // 空白只移動、不刪除
    });
  }
  const ERROR_CASES = [
    ['we propose {a method.', '大括號沒有成對'],
    ['we propose {} .', '大括號裡要有範例內容'],
    ['we propose a method.', '至少要有一組大括號'],
    ['{We} propose {a method}.', '大括號外面至少要保留兩個英文字'],
    ['we propose{a method}.', '大括號要放在字與字之間，不能切開一個字'],
  ];
  for (const [raw, error] of ERROR_CASES) {
    test('normalizeFrame 錯誤：' + raw + ' 為「' + error + '」', () => {
      assert.deepEqual(normalizeFrame(raw), { ok: false, error });
    });
  }
}

// 5.8 skeletonCheck 的表格（F1 到 F4），加上所有格、縮寫與只有標點的固定字片段的補充案例
const F1 = 'To address this issue, we propose {a simple yet effective method}.';
const F2 = 'The question is not whether {we should regulate AI}, but how {we do it}.';
const F3 = '{Formal verification} is not a substitute for {testing}.';
const F4 = '{Cost}, {not speed}, decides the outcome.';
{
  const OK = { ok: true };
  const copy = { ok: false, reason: 'copy', detail: '' };
  const slot = (detail) => ({ ok: false, reason: 'slot', detail });
  const missing = (detail) => ({ ok: false, reason: 'missing', detail });
  const CASES = [
    ['F1', F1, 'To address this issue, we propose a hardware interlock.', OK],
    ['F1', F1, 'to address this issue we propose a hardware interlock', OK],
    ['F1', F1, 'Therefore, to address this issue, we propose a plan.', OK],
    ['F1', F1, 'To address this issue, we propose a simple yet effective method.', copy],
    ['F1', F1, 'to address this issue we propose a simple yet effective method', copy],
    ['F1', F1, 'To address this issue, we propose.', slot('a simple yet effective method')],
    ['F1', F1, 'We propose a hardware interlock to address this issue.', missing('To address this issue, we propose')],
    ['F2', F2, 'The question is not whether we need rules, but how we enforce them.', OK],
    ['F2', F2, 'The question is not whether we need rules but how.', slot('we do it')],
    ['F2', F2, 'The question is not whether, but how we enforce them.', slot('we should regulate AI')],
    ['F2', F2, 'The question is not whether we need rules, and how we enforce them.', missing(', but how')],
    ['F3', F3, 'Simulation is not a substitute for field trials.', OK],
    ['F3', F3, 'is not a substitute for field trials.', slot('Formal verification')],
    ['F3', F3, 'Simulation is not a substitute for.', slot('testing')],
    ['F3', F3, 'Formal verification is not a substitute for testing.', copy],
    ['F3', F3, 'Formal verification is not a substitute for unit testing.', OK],
    ['F4', F4, 'Price decides the outcome.', OK],
    ['F4', F4, 'decides the outcome.', slot('not speed')],
    ['F4', F4, 'In the end, price decides the outcome.', OK],
    ['F4', F4, 'Price decides the outcome in most markets.', OK],
    ['F4', F4, 'Cost, not speed, decides the outcome.', copy],
  ];
  for (const [name, frame, typed, want] of CASES) {
    test('skeletonCheck ' + name + '：' + typed, () => {
      assert.deepEqual(skeletonCheck(frame, typed), want);
    });
  }

  test('skeletonCheck：frame 不能通過 parseFrame 時 throw，訊息帶 parseFrame 的原因', () => {
    assert.throws(() => skeletonCheck('we propose a method.', 'we propose a plan.'),
      { message: 'skeletonCheck：骨架不合法：至少要有一組大括號' });
    assert.throws(() => skeletonCheck('we propose {a method.', 'we propose a plan.'),
      { message: 'skeletonCheck：骨架不合法：大括號沒有成對' });
  });

  test("skeletonCheck：所有格、連字號、句尾沒有句點都照 tokens 比對（F3 與 Students' 的句子）", () => {
    assert.deepEqual(skeletonCheck(F3, "Students' feedback is not a substitute for state-of-the-art testing"), OK);
    assert.deepEqual(skeletonCheck(F3, 'Peer review is not a substitute-for testing'), OK);
    for (const typed of [
      "To address this issue, we propose a plan that doesn't scale.",
      "To address this issue, we propose the students' own rubric.",
      'To address this issue, we propose a state-of-the-art filter.',
      'To address this issue, we propose a plan',
      'Therefore, in this paper, to address this issue, we propose a plan.',
    ]) assert.deepEqual(skeletonCheck(F1, typed), OK, typed);
    assert.deepEqual(skeletonCheck(F4, 'Price decides the outcome'), OK);
    const W = "We don't claim that {the method is optimal}.";
    assert.deepEqual(skeletonCheck(W, "We DON'T claim that it is fast."), OK);
    assert.deepEqual(skeletonCheck(W, 'We do not claim that it is fast.'), missing("We don't claim that"));
  });

  test("skeletonCheck：縮寫與句首多字，We don't {need more data}, but {better labels}.", () => {
    const frame = "We don't {need more data}, but {better labels}.";
    assert.deepEqual(skeletonCheck(frame, "Therefore, we don't need rules, but we need tests"), OK);
    assert.deepEqual(skeletonCheck(frame, "We DON'T need rules, but tests."), OK);
    assert.deepEqual(skeletonCheck(frame, 'We do not need rules, but tests.'), missing("We don't"));
    assert.deepEqual(skeletonCheck(frame, "We don't, but tests."), slot('need more data'));
  });

  test('skeletonCheck：只有標點的固定字片段（", "、"."）不影響結果', () => {
    const frame = 'It is {cheap}, {fast}, and {safe}.';
    assert.deepEqual(skeletonCheck(frame, 'It is cheap and safe.'), OK);
    assert.deepEqual(skeletonCheck(frame, 'It is cheap; light; and safe'), OK);
    assert.deepEqual(skeletonCheck(frame, 'It is, and safe.'), slot('fast'));
    assert.deepEqual(skeletonCheck(frame, 'It is cheap, fast, and.'), slot('safe'));
  });
}

// 5.8 議題應用卡：newProdCard、prodInput、prodSubmit、prodReveal、prodOutcome
const PT = 'To address this issue, we propose a simple yet effective method.';
const PROD_TOPIC = '機器人安全';
const SLOT_ONLY = 'To address this issue, we propose.';
const GOOD = 'To address this issue, we propose a plan.';
const freshProd = () => newProdCard(F1, PT, PROD_TOPIC);
// 先 prodInput 再 prodSubmit；兩步的輸入都先凍結，函式若修改輸入會直接 throw
const submitWith = (card, raw) => prodSubmit(deepFreeze(prodInput(deepFreeze(card), raw)));
const submitTimes = (card, raw, n) => {
  let c = card;
  for (let i = 0; i < n; i++) c = submitWith(c, raw);
  return c;
};
{
  const fields = (c) => ({ attempts: c.attempts, revealed: c.revealed, complete: c.complete, lastError: c.lastError });
  const row = (attempts, revealed, complete, lastError) => ({ attempts, revealed, complete, lastError });
  const NOT_YET = '還沒有寫句子';
  const UNTYPEABLE = '句子裡有英文鍵盤打不出的字元，請改寫';
  const SAME = '這句和範例一樣，請換成自己的內容';
  const MISSING = '缺少固定字：To address this issue, we propose';
  const SLOT = '空格處要填上自己的內容：a simple yet effective method';

  test('newProdCard：typed 為空字串，attempts 為 0，complete 與 revealed 為 false，lastError 與 hint 為 null', () => {
    assert.deepEqual(freshProd(), {
      frame: F1, target: PT, topic: PROD_TOPIC, typed: '', attempts: 0,
      complete: false, revealed: false, lastError: null, hint: null,
    });
  });

  test('prodInput：typed 經 canonicalizeInput，lastError 保留到下一次送出，hint 隨輸入切換', () => {
    const failed = submitWith(freshProd(), 'We propose a plan.');
    const next = prodInput(deepFreeze(failed), 'To address');
    assert.equal(next.typed, 'To address');
    assert.equal(next.lastError, MISSING);
    assert.equal(next.attempts, 1);
    assert.equal(prodInput(deepFreeze(freshProd()), ' In').typed, 'In');
    const cjk = prodInput(deepFreeze(freshProd()), 'To address 這');
    assert.equal(cjk.hint, 'cjk');
    assert.equal(prodInput(deepFreeze(cjk), 'To address').hint, null);
  });

  test('prodSubmit：5.8 狀態轉移表的前八列（不計次、照抄、缺固定字、揭示後再送錯）', () => {
    assert.deepEqual(fields(prodSubmit(deepFreeze(freshProd()))), row(0, false, false, NOT_YET));
    assert.deepEqual(fields(submitWith(freshProd(), ' . , ')), row(0, false, false, NOT_YET));
    assert.deepEqual(fields(submitWith(freshProd(), 'To address this issue, we propose 一個 plan.')), row(0, false, false, UNTYPEABLE));
    assert.deepEqual(fields(submitWith(freshProd(), 'To address this issue, we propose a μ plan.')), row(0, false, false, UNTYPEABLE));
    assert.deepEqual(fields(submitWith(freshProd(), PT)), row(1, false, false, SAME));
    let c = submitWith(freshProd(), 'We propose a plan.');
    assert.deepEqual(fields(c), row(1, false, false, MISSING));
    c = submitTimes(c, SLOT_ONLY, 2);
    assert.deepEqual(fields(c), row(3, true, false, SLOT));
    c = submitWith(c, SLOT_ONLY);
    assert.deepEqual(fields(c), row(4, true, false, SLOT));
    c = submitWith(c, GOOD);
    assert.deepEqual(fields(c), row(4, true, true, null));
    assert.equal(prodOutcome(c), 'fail');
  });

  test('prodSubmit：5.8 狀態轉移表的後五列（通過、失敗兩次後通過、看範例）', () => {
    const pass = submitWith(freshProd(), GOOD);
    assert.deepEqual(fields(pass), row(0, false, true, null));
    assert.equal(prodOutcome(pass), 'pass');
    const late = submitWith(submitTimes(freshProd(), SLOT_ONLY, 2), GOOD);
    assert.deepEqual(fields(late), row(2, false, true, null));
    assert.equal(prodOutcome(late), 'pass');
    const shown = prodReveal(deepFreeze(freshProd()));
    assert.deepEqual(fields(shown), row(0, true, false, null));
    const done = submitWith(shown, GOOD);
    assert.deepEqual(fields(done), row(0, true, true, null));
    assert.equal(prodOutcome(done), 'fail');
    assert.deepEqual(fields(prodReveal(deepFreeze(submitWith(freshProd(), 'We propose a plan.')))), row(1, true, false, null));
  });

  test('prodSubmit：不計次的兩種送出不做骨架比對，反覆送出也不加 attempts', () => {
    const c = submitTimes(freshProd(), 'To address this issue, we propose 一個 plan.', 5);
    assert.equal(c.attempts, 0);
    assert.equal(c.revealed, false);
    assert.equal(c.hint, 'cjk');
  });

  test('prodReveal：新卡揭示、送錯一次後揭示會清掉 lastError，attempts 不變', () => {
    const shown = prodReveal(deepFreeze(freshProd()));
    assert.equal(shown.revealed, true);
    assert.equal(shown.attempts, 0);
    assert.equal(shown.lastError, null);
    const failed = submitWith(freshProd(), 'We propose a plan.');
    assert.equal(failed.lastError, MISSING);
    const after = prodReveal(deepFreeze(failed));
    assert.equal(after.lastError, null);
    assert.equal(after.attempts, 1);
  });

  test('已完成的卡呼叫 prodSubmit、prodInput、prodReveal，都回傳同一個物件', () => {
    const done = deepFreeze(submitWith(freshProd(), GOOD));
    assert.equal(prodSubmit(done), done);
    assert.equal(prodInput(done, 'Something else.'), done);
    assert.equal(prodReveal(done), done);
  });
}

// 5.8 prodStatus 的表格（T 代表 target）
{
  const PREV = '通過，接著議題應用';
  const typedOnly = (raw) => prodInput(deepFreeze(freshProd()), raw);
  const CASES = [
    ['新卡輸入「To address 這」', () => typedOnly('To address 這'), null, '偵測到中文輸入，請切換到英文鍵盤（不計失誤）'],
    ['新卡輸入夾中文的句子後送出', () => submitWith(freshProd(), 'To address this issue, we propose 一個 plan.'), null, '偵測到中文輸入，請切換到英文鍵盤（不計失誤）'],
    ['新卡輸入含 μ 的句子後送出', () => submitWith(freshProd(), 'To address this issue, we propose a μ plan.'), null, '句子裡有英文鍵盤打不出的字元，請改寫'],
    ['新卡輸入合格的句子後送出', () => submitWith(freshProd(), GOOD), null, '通過，範例：' + PT],
    ['連續三次只寫固定字、再送出合格的句子', () => submitWith(submitTimes(freshProd(), SLOT_ONLY, 3), GOOD), null, '完成，範例：' + PT],
    ['新卡輸入 We propose a plan. 後送出', () => submitWith(freshProd(), 'We propose a plan.'), null, '缺少固定字：To address this issue, we propose，還可以再試 2 次'],
    ['新卡直接送出', () => prodSubmit(deepFreeze(freshProd())), null, '還沒有寫句子'],
    ['連續三次只寫固定字後送出', () => submitTimes(freshProd(), SLOT_ONLY, 3), null, '空格處要填上自己的內容：a simple yet effective method'],
    ['送錯一次後 prodReveal', () => prodReveal(deepFreeze(submitWith(freshProd(), 'We propose a plan.'))), null, '已顯示範例，請照骨架寫一句自己的話'],
    ['新卡 prodReveal', () => prodReveal(deepFreeze(freshProd())), null, '已顯示範例，請照骨架寫一句自己的話'],
    ['新卡，previous 為「通過，接著議題應用」', () => freshProd(), PREV, '上一張：通過，接著議題應用'],
    ['送錯一次後把輸入清空（第 4 條優先於第 6 條）', () => prodInput(deepFreeze(submitWith(freshProd(), 'We propose a plan.')), ''), PREV, '缺少固定字：To address this issue, we propose，還可以再試 2 次'],
    ['新卡', () => freshProd(), null, '用這個句型寫一句自己的話，按 Return 送出'],
  ];
  for (const [name, make, previous, want] of CASES) {
    test('prodStatus：' + name, () => {
      assert.equal(prodStatus(deepFreeze(make()), previous), want);
    });
  }
}

// 5.8 prodHintSegments 的表格
{
  const todo = (text) => ({ text, kind: 'todo' });
  const mask = (text) => ({ text, kind: 'mask' });
  const joined = (segs) => segs.map((s) => s.text).join('');

  test('prodHintSegments F1、revealed false、firstLetters true', () => {
    assert.deepEqual(prodHintSegments(F1, false, true), [
      todo('T'), mask('_'), todo(' a'), mask('______'), todo(' t'), mask('___'), todo(' i'), mask('____'),
      todo(', w'), mask('_'), todo(' p'), mask('______'), todo(' '), mask('____'), todo('.'),
    ]);
    assert.equal(joined(prodHintSegments(F1, false, true)), 'T_ a______ t___ i____, w_ p______ ____.');
  });

  test('prodHintSegments F1：揭示後或 firstLetters 為 false 時固定字完整顯示，空格仍是四個底線', () => {
    const full = [todo('To address this issue, we propose '), mask('____'), todo('.')];
    assert.deepEqual(prodHintSegments(F1, true, true), full);
    assert.deepEqual(prodHintSegments(F1, false, false), full);
  });

  test('prodHintSegments F2、revealed false 與 true', () => {
    assert.equal(joined(prodHintSegments(F2, false, true)), 'T__ q_______ i_ n__ w______ ____, b__ h__ ____.');
    assert.deepEqual(prodHintSegments(F2, true, true),
      [todo('The question is not whether '), mask('____'), todo(', but how '), mask('____'), todo('.')]);
  });

  test('prodHintSegments F3、firstLetters true 與 false', () => {
    assert.deepEqual(prodHintSegments(F3, false, true), [
      mask('____'), todo(' i'), mask('_'), todo(' n'), mask('__'), todo(' a s'), mask('_________'),
      todo(' f'), mask('__'), todo(' '), mask('____'), todo('.'),
    ]);
    assert.equal(joined(prodHintSegments(F3, false, true)), '____ i_ n__ a s_________ f__ ____.');
    assert.deepEqual(prodHintSegments(F3, false, false),
      [mask('____'), todo(' is not a substitute for '), mask('____'), todo('.')]);
  });

  test('prodHintSegments：兩組緊鄰的大括號合併成八個底線', () => {
    assert.deepEqual(prodHintSegments('{a}{b} is fine.', false, true),
      [mask('________'), todo(' i'), mask('_'), todo(' f'), mask('___'), todo('.')]);
  });

  test('prodHintSegments：省略第三個參數等於傳 PROD_HINT_FIRST_LETTERS；frame 不合法時 throw', () => {
    assert.deepEqual(prodHintSegments(F1, false), prodHintSegments(F1, false, PROD_HINT_FIRST_LETTERS));
    assert.throws(() => prodHintSegments('we propose a method.', false),
      { message: 'prodHintSegments：骨架不合法：至少要有一組大括號' });
  });
}
