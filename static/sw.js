/* Service Worker
 * - 静态资源：缓存优先（配合 ?v= 哈希，可长期缓存）
 * - 页面导航：网络优先，失败回退缓存，再失败回退离线页
 * - /api/* 与 /admin 不拦截
 * - VERSION 由 build.py 注入（ASSET_V），每次部署自动换缓存名
 */
const VERSION = '__SW_VERSION__';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const OFFLINE_URL = '/static/offline.html';

// ---------------- 安装 / 激活 ----------------
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

// ---------------- 工具 ----------------
async function cacheFirst(request) {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;

    try {
        const res = await fetch(request);
        // 只缓存正常的 200，且不是重定向后的响应
        if (res.ok && res.status === 200 && !res.redirected) {
            cache.put(request, res.clone());
        }
        return res;
    } catch (err) {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
}

async function networkFirst(request) {
    const cache = await caches.open(PAGE_CACHE);

    try {
        const res = await fetch(request);
        if (res.ok && res.status === 200 && !res.redirected) {
            cache.put(request, res.clone());
        }
        return res;
    } catch (err) {
        const hit = await cache.match(request);
        if (hit) return hit;

        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;

        return new Response('离线，且没有缓存副本。', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    }
}

// ---------------- 拦截 ----------------
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;          // 跨域不管
    if (url.pathname === '/static/sw.js') return;             // 自身不拦截
    if (url.pathname.startsWith('/api/')) return;             // 接口不缓存
    if (url.pathname.startsWith('/admin')) return;            // 后台不缓存

    if (url.pathname.startsWith('/static/')) {
        event.respondWith(cacheFirst(request));
        return;
    }

    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(networkFirst(request));
    }
});

// ---------------- 可选：手动更新 ----------------
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
