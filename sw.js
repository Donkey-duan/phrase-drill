const VERSION = '686faca3';   // 由 npm run release 依內容雜湊改寫，不要手改
const CACHE = 'phrase-drill-' + VERSION;
const FILES = ["./index.html", "./styles.css", "./manifest.webmanifest",
  "./js/boot.js", "./js/app.js", "./js/drill.js", "./js/schedule.js", "./js/store.js", "./js/seed.js",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];
// FILES 必須是合法 JSON 陣列（雙引號），release 工具與 static 測試會用 regex 取出後 JSON.parse

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((u) => new Request(u + '?v=' + VERSION, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('phrase-drill-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(caches.open(CACHE)
    .then((c) => c.match(key, { ignoreSearch: true }))
    .then((res) => res || fetch(req)));
});
