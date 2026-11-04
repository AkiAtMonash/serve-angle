// Keeps the app itself on the phone, so it opens with no connection and no PC. The reference videos
// are left out on purpose: they are a few MB each, and a video asked for as a byte range cannot be
// cached anyway, so an offline "並べる" would fail quietly.
//
// Bump CACHE when the file list changes, so an old shell is dropped.
const CACHE = "serve-angle-v1";
const SHELL = [
  "./", "./index.html", "./app.js", "./clips.js", "./coach.js", "./serve.js", "./refjob.js",
  "./estimate.js", "./guide.js", "./drive-url.js", "./refs.json", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Online: always the newest file, and keep a copy. Offline: the copy (the ?v= in app.js is ignored,
// so the cached file answers whatever version the page asks for). A proxy that answers 502 while the
// network is down also counts as offline: an empty 502 page is not the app.
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (/\.(mp4|webm)$/.test(url.pathname)) return;
  const cached = () => caches.match(req, { ignoreSearch: true });
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }
      return (await cached()) || r;
    } catch {
      return (await cached()) || (await caches.match("./index.html")) || Response.error();
    }
  })());
});
