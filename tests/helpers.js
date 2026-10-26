// tests/helpers.js：測試共用的輔助函式與常數。
// 這不是測試檔：檔名不符合 node --test 的預設規則（*.test.js、test-*.js 等），不會被當成測試執行。

/** 測試裡的「今天」。 */
export const TODAY = '2026-10-14';

/**
 * 遞迴凍結 x 本身與底下所有的物件和陣列，回傳同一個參考；null 與原始值原樣回傳。
 * 已經凍結的物件也會往下走，淺凍結過的物件一樣凍到底。測試資料是 JSON 形式，沒有循環參照。
 * @template T
 * @param {T} x
 * @returns {T}
 */
export function deepFreeze(x) {
  if (x !== null && typeof x === 'object') {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/**
 * 以 Map 實作的假 storage，介面同 7.7 的 StorageLike，另外多了 key 與 length。
 * store.js 只用 getItem、setItem、removeItem；key 與 length 讓測試能列出所有 key，比對 load 前後是否完全相同。
 */
export class FakeStorage {
  #map = new Map();
  /** 為 true 時 setItem 丟出 name 為 'QuotaExceededError' 的 Error，內容不變。 */
  failWrites = false;

  /** @param {string} k @returns {string|null} */
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }

  /** @param {string} k @param {unknown} v */
  setItem(k, v) {
    if (this.failWrites) {
      const e = new Error('FakeStorage: quota exceeded');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.#map.set(k, String(v));
  }

  /** @param {string} k */
  removeItem(k) {
    this.#map.delete(k);
  }

  /** @param {number} i @returns {string|null} 依插入順序，超出範圍回傳 null */
  key(i) {
    return [...this.#map.keys()][i] ?? null;
  }

  get length() {
    return this.#map.size;
  }
}

/**
 * 建立一句未開始、沒有骨架的 Sentence（frame 為 ''、topics 為 []，reps 為 0，進度欄位都是初始值），欄位依規格 7.1 的順序，
 * 再套用 overrides；每次回傳新物件。要測議題應用時，overrides 一併給 frame 與 topics；frame 必須是 normalizeFrame 的輸出，
 * 而且去掉大括號後等於 text，否則 sanitizeData 會把它清成 ''。
 * 要當成練過的句子時，overrides 必須同時把 reps 設成大於 0，否則 pickToday 會把它歸為新句，
 * sanitizeData 也會把 level 等進度欄位重設成初始值。
 * @param {Partial<Sentence>} [overrides]
 * @returns {Sentence}
 */
export function makeSentence(overrides = {}) {
  return {
    id: 'x1',
    text: 'This is a test sentence.',
    zh: '測試句',
    frame: '',
    topics: [],
    level: 0,
    streak: 0,
    due: null,
    lastSeen: null,
    lastResult: null,
    reps: 0,
    ...overrides,
  };
}
