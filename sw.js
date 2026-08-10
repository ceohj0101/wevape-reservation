/* 바탕화면 설치(PWA)에 필요한 최소 서비스워커.
   캐시를 쌓아두면 앱을 고쳐도 예전 화면이 계속 보일 수 있어서,
   항상 네트워크에서 최신본을 먼저 받아오고 오프라인일 때만 캐시를 씁니다. */
const CACHE = 'wevape-resv-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
