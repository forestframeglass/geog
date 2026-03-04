
/* geo-trainer V2 Service Worker */
const VERSION='v2.0.0';
const CORE_CACHE=`core-${VERSION}`;
const RUNTIME_SVG_CACHE=`svg-${VERSION}`;
const CORE_ASSETS=['index.html','quiz.html','leaderboards.html','verify.html','manifest.webmanifest'];

self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(CORE_CACHE); await c.addAll(CORE_ASSETS); await self.skipWaiting();})())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys(); await Promise.all(keys.map(k=>{ if(!k.includes(VERSION)) return caches.delete(k); })); await self.clients.claim();})())});

async function swr(cacheName, request){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(new Request(request,{credentials:'omit',cache:'no-store'})).then(r=>{ if(r && r.ok) cache.put(request, r.clone()); return r; }).catch(()=>cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  if(url.pathname.endsWith('.svg') && url.pathname.includes('/svg/')){ e.respondWith(swr(RUNTIME_SVG_CACHE, e.request)); return; }
  if(CORE_ASSETS.some(p=> url.pathname.endsWith(p))){ e.respondWith((async()=>{try{const r=await fetch(e.request); const c=await caches.open(CORE_CACHE); c.put(e.request, r.clone()); return r;}catch(_){ const c=await caches.open(CORE_CACHE); const m=await c.match(e.request); return m||Response.error(); }})()); return; }
});
