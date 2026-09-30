// シンプルな offline-first キャッシュ。アプリ本体(HTML/CSS/JS/アイコン)を
// キャッシュし、オフラインでも配線表アプリを起動できるようにする。
// Supabase 等への通信はネットワーク優先でそのまま素通りさせる。

const CACHE_NAME = "hairnesu-cache-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./src/app.js",
  "./src/db.js",
  "./src/csv.js",
  "./src/cloud.js",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのアプリ本体ファイルはキャッシュ優先
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            if (res.ok && req.method === "GET") {
              const resClone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            }
            return res;
          })
          .catch(() => cached);
      })
    );
    return;
  }
  // 外部(Supabase 等)はそのままネットワークへ
});
