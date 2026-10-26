// js/boot.js：classic script，不得使用 import、export 與頂層 await
(() => {
  const KEY = 'phrase-drill:errors';
  const queue = [];                                  // #err-banner 還不存在時先排隊
  function show(entry) {
    const banner = document.getElementById('err-banner');
    if (!banner) { queue.push(entry); return; }
    document.getElementById('err-text').textContent = entry.msg + (entry.at ? '（' + entry.at + '）' : '');
    banner.hidden = false;
  }
  function record(msg, at) {
    const entry = { t: new Date().toISOString(), msg: String(msg).slice(0, 500), at: at || '' };
    try {
      const old = JSON.parse(localStorage.getItem(KEY) || '[]');
      localStorage.setItem(KEY, JSON.stringify((Array.isArray(old) ? old : []).concat([entry]).slice(-20)));
    } catch (e) { /* 儲存空間不能用時只顯示橫幅 */ }
    show(entry);
  }
  window.addEventListener('error', (e) => {
    if (e instanceof ErrorEvent) { record(e.message, e.filename ? e.filename + ':' + e.lineno : ''); return; }
    const el = e.target;                             // 資源載入失敗：普通的 Event，沒有 message
    record('資源載入失敗：' + ((el && (el.src || el.href)) || '未知'), el && el.tagName ? el.tagName.toLowerCase() : '');
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    record(r && r.message ? r.message : String(r), 'promise');
  });
  window.PD_LOG = (err, where) => record(err && err.message ? err.message : String(err), where);
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('err-close').addEventListener('click', () => {
      document.getElementById('err-banner').hidden = true;
    });
    const pending = queue.splice(0);
    if (pending.length) show(pending[pending.length - 1]);
  });
})();
