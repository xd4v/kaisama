// BabyLog service worker — cache the app shell so it opens instantly and
// survives network hiccups. Data (the /exec API) is always fetched live.
const CACHE = "babylog-v7";
const SHELL = [
  ".",
  "index.html",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never cache API writes

  const url = new URL(req.url);
  // Never cache API traffic — always go to the network for live data.
  if (url.hostname.endsWith("script.google.com") ||
      url.hostname.endsWith("googleusercontent.com")) {
    return; // default network handling
  }

  // App shell + Chart.js: cache-first, fall back to network and cache it.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.ok && (url.origin === self.location.origin ||
            url.hostname.endsWith("jsdelivr.net"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
