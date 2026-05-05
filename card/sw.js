var CACHE = 'in3-card-v1';
var SHELL = [
  '/card/',
  '/card/index.html',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Exo+2:wght@300;400;600;700&display=swap',
  'https://innovat3.co.za/assets/logo.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Always go network-first for API calls (profile data, scan alerts)
  if(url.includes('api.innovat3.co.za') || url.includes('nominatim.openstreetmap.org')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var fresh = fetch(e.request).then(function(resp) {
        if(resp && resp.status === 200 && e.request.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      });
      // Return cached immediately, update in background (stale-while-revalidate)
      return cached || fresh;
    })
  );
});
