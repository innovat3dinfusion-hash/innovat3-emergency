// Innovat3 Pro Card — Service Worker
// Caches the page and audio files so the card works without mobile data.
var CACHE = 'innovat3-pro-v2';

var SHELL = [
  '/pro-card/',
  '/pro-card/index.html',
  '/assets/ema-face.jpg.jpeg'
];

// Install: pre-cache the page shell
self.addEventListener('install', function(evt) {
  evt.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(SHELL);
    })
  );
  self.skipWaiting();
});

// Activate: remove any old cache versions
self.addEventListener('activate', function(evt) {
  evt.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(evt) {
  var url = evt.request.url;

  // Audio files — cache on first play, serve from cache thereafter
  if (url.includes('/assist/audio/')) {
    evt.respondWith(
      caches.match(evt.request).then(function(hit) {
        if (hit) return hit;
        return fetch(evt.request).then(function(res) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(evt.request, clone); });
          return res;
        }).catch(function() { return new Response('', {status: 503}); });
      })
    );
    return;
  }

  // Page navigation — network first, fall back to cached shell
  if (evt.request.mode === 'navigate') {
    evt.respondWith(
      fetch(evt.request).then(function(res) {
        var clone = res.clone();
        caches.open(CACHE).then(function(c) { c.put(evt.request, clone); });
        return res;
      }).catch(function() {
        return caches.match('/pro-card/') || caches.match('/pro-card/index.html');
      })
    );
    return;
  }

  // Static assets (images, fonts) — cache on first request
  if (/\.(png|jpe?g|svg|woff2?|ttf)$/i.test(url)) {
    evt.respondWith(
      caches.match(evt.request).then(function(hit) {
        if (hit) return hit;
        return fetch(evt.request).then(function(res) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(evt.request, clone); });
          return res;
        }).catch(function() { return new Response('', {status: 503}); });
      })
    );
    return;
  }

  // API calls — always network only (offline handled by localStorage fallback in page JS)
});
