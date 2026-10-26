// صندوق فزعة — Service Worker
// الصفحات والملفات: من الشبكة أولاً (عشان أي تحديث يوصل على طول)، ومن النسخة المحفوظة إذا انقطع النت.
// بيانات الحجز (Firebase) ما تتخزّن هنا أبداً — دائماً مباشرة.
const CACHE = "fazza-v1";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/common.js", "/firebase-config.js",
               "/logo.png", "/icon.png", "/manifest.webmanifest", "/offline.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/__/")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(hit => hit || (req.mode === "navigate" ? caches.match("/offline.html") : Response.error())))
  );
});
