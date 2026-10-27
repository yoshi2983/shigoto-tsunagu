// 画面のファイルだけをキャッシュする。登録データ（Firebase）はキャッシュしない。
const CACHE = "shigoto-v5";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "privacy.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 同じサイトのファイルは「ネット優先、だめならキャッシュ」。更新がすぐ届き、圏外でも開ける。
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    // cache:"no-cache"：ブラウザに残った古いファイルを使わず、毎回サーバーに新しい版があるか確かめる
    fetch(e.request, { cache: "no-cache" }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
