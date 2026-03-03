/* geog PWA service worker – v2.0.5 */
var CACHE_NAME = 'geog-cache-v2.0.5';
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/quiz.html',
  '/leaderboards.html',
  '/training.html',
  '/mistakes.html',
  '/verify.html',
  '/styles.css',
  '/app_v2.js',
  '/data_v2.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache){ return cache.addAll(PRECACHE_URLS); }));
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ if (k !== CACHE_NAME) return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET' || req.url.indexOf('http') !== 0) return; // pass through non-GETs and non-http
  event.respondWith(
    caches.match(req).then(function(res){
      var fetchPromise = fetch(req).then(function(networkRes){
        // cache a copy for next time (only for same-origin)
        if (networkRes && networkRes.status === 200 && new URL(req.url).origin === self.location.origin) {
          var copy = networkRes.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        }
        return networkRes;
      }).catch(function(){ return res; });
      return res || fetchPromise;
    })
  );
});