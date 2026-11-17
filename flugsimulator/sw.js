// Kleiner Hintergrunddienst: speichert den Simulator, damit er als App startet und auch offline läuft.
// Online wird immer die neueste Fassung geladen, der Speicher ist nur die Reserve.
const CACHE = 'flugsimulator-v1';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './vendor/three.min.js', './js/util.js', './js/world.js', './js/physics.js', './js/failures.js',
  './js/audio.js', './js/panel.js', './js/model.js', './js/main.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const cp = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, cp));
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
