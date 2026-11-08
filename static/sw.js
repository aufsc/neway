/* 静态资源缓存 + 页面离线回退 */
const VERSION = '__SW_VERSION__';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

    // 静态资源：缓存优先
    if (url.pathname.startsWith('/static/')) {
        e.respondWith((async () => {
            const cache = await caches.open(STATIC_CACHE);
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res.ok) cache.put(req, res.clone());
            return res;
        })());
        return;
    }

    // 页面：网络优先，失败回退缓存
    if (req.mode === 'navigate') {
        e.respondWith((async () => {
            try {
                const res = await fetch(req);
                const cache = await caches.open(PAGE_CACHE);
                if (res.ok) cache.put(req, res.clone());
                return res;
            } catch (err) {
                const cache = await caches.open(PAGE_CACHE);
                const hit = await cache.match(req);
                if (hit) return hit;
                const offline = await cache.match('/static/offline.html');
                if (offline) return offline;
                throw err;
            }
        })());
    }
});