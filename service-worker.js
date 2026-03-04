
/* geog PWA service worker – v2.0.6 (repo-scoped precache, safer install) */
var CACHE_NAME = 'geog-cache-v2.0.6';
var PRECACHE_URLS = [
  // repo-relative paths only (no leading slash) for GitHub Pages subpath
  'index.html',
  'quiz.html',
  'leaderboards.html',
  'training.html',
  'verify.html',
  'styles.css',
  'app_v2.js',
  'data_v2.js',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return Promise.all(
        PRECACHE_URLS.map(function(url){
          return cache.add(url).catch(function(){ /* ignore missing */ });
        })
      );
    })
  );
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
  if (req.method !== 'GET') return; // non-GET passthrough
  event.respondWith(
    caches.match(req).then(function(res){
      var net = fetch(req).then(function(resp){
        try {
          if (resp && resp.status === 200 && new URL(req.url).origin === self.location.origin) {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
          }
        } catch(e){}
        return resp;
      }).catch(function(){ return res; });
      return res || net;
    })
  );
});
