// 讓網頁在斷網時也能重新整理：有網路一律抓最新版本，抓不到才用上次存下的檔案。
// 只有 https 或 127.0.0.1／localhost 網址能使用；http 區網位址的瀏覽器不會啟用這個檔案。
const CACHE_NAME = "mapfog-shell-v3";
// 新增網頁會用到的檔案時，也要加進這份清單，第一次開啟就先存好。
const SHELL_FILES = [
  "./",
  "index.html",
  "gm.html",
  "pl.html",
  "toolbar-ui.css",
  "map-adjust.css",
  "tablet-ui.css",
  "player-qr.css",
  "firebase-sync.js",
  "connection-status.js",
  "local-store.js",
  "image-store.js",
  "dice.js",
  "map-adjust.js",
  "image-processing.js",
  "app.js",
  "player.js",
  "initiative-sync.js",
  "tablet-ui.js",
  "panel-layout.js",
  "player-qr.js",
  "vendor/qrcode.min.js",
  "vendor/qrcode-LICENSE.txt"
];
const FIREBASE_SDK_FILES = [
  "https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.13.0/firebase-database-compat.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 逐一存檔，某個檔案失敗不影響其他檔案。
    await Promise.all([
      ...SHELL_FILES.map((file) => cache.add(new Request(file, { cache: "no-cache" })).catch(() => null)),
      ...FIREBASE_SDK_FILES.map((url) => fetch(url, { mode: "no-cors" })
        .then((response) => cache.put(url, response))
        .catch(() => null))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("mapfog-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const firebaseSdk = url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  // Firebase 資料庫的連線不經過這裡，照常直接連線。
  if (!sameOrigin && !firebaseSdk) return;
  event.respondWith(networkFirst(request, sameOrigin));
});

async function networkFirst(request, sameOrigin) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // 自己網站的檔案每次都向伺服器確認是否有新版，改了程式不會卡在舊版。
    // 換頁請求不能再加參數，瀏覽器重新整理時本來就會向伺服器確認。
    const revalidate = sameOrigin && request.mode !== "navigate";
    const response = await fetch(request, revalidate ? { cache: "no-cache" } : undefined);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch (error) {
    // 網址參數（?room=、?v=）不同也視為同一個檔案，例如離線開啟沒開過的 room。
    const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
