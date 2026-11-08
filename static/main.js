/* 所有页面共用：主题切换 / 年份 / 移动端菜单 / 分类折叠 / 访问统计 / SW 注册 */
(() => {
    const root = document.documentElement;

    const THEME_COLORS = { light: '#edf1fb', dark: '#0a0f1f' };
    const isAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

    function syncThemeColor() {
        const meta = document.getElementById('themeColor');
        if (meta) meta.setAttribute('content', THEME_COLORS[root.dataset.theme] || THEME_COLORS.light);
    }
    syncThemeColor();

    function toggleTheme() {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch (e) {}
        syncThemeColor();
        document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    }
    document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', toggleTheme));

    document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

    const runtime = document.getElementById('runtime');
    if (runtime && runtime.dataset.start) {
        const days = Math.floor((Date.now() - new Date(runtime.dataset.start + 'T00:00:00')) / 86400000);
        runtime.textContent = `${days} 天`;
    }

    // 访问统计
    const statEls = Array.from(document.querySelectorAll('[data-stat]'));
    if (statEls.length) {
        const safe = fn => { try { return fn(); } catch (e) { return null; } };
        const path = location.pathname;
        const key = 'hit:' + path;

        let vid = safe(() => localStorage.getItem('vid'));
        if (!vid) {
            vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
                : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
            safe(() => localStorage.setItem('vid', vid));
        }

        const counted = safe(() => sessionStorage.getItem(key));
        const req = counted
            ? fetch('/api/hit?path=' + encodeURIComponent(path))
            : fetch('/api/hit', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path, vid }),
                keepalive: true,
            });

        req.then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
            .then(d => {
                safe(() => sessionStorage.setItem(key, '1'));
                statEls.forEach(el => {
                    const n = d[el.dataset.stat];
                    const out = el.querySelector('strong');
                    if (typeof n === 'number' && out) {
                        out.textContent = n.toLocaleString('en-US');
                        el.hidden = false;
                    }
                });
            })
            .catch(() => {});
    }

    const hamburger = document.getElementById('hamburger-btn');
    const menu = document.getElementById('mobile-menu');
    if (hamburger && menu) {
        const setOpen = open => {
            menu.classList.toggle('active', open);
            hamburger.setAttribute('aria-expanded', String(open));
        };
        hamburger.addEventListener('click', () => setOpen(!menu.classList.contains('active')));
        menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('click', e => {
            if (!hamburger.contains(e.target) && !menu.contains(e.target)) setOpen(false);
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    }

    document.querySelectorAll('.article-list[data-count]').forEach(ul => {
        ul.style.maxHeight = ul.dataset.count * 60 + 'px';
    });

    document.addEventListener('click', e => {
        const head = e.target.closest('.category-header');
        if (!head) return;
        const block = head.parentElement;
        head.setAttribute('aria-expanded', String(block.classList.toggle('collapsed') === false));
    });

    // Service Worker（只在生产环境、非后台注册）
    if ('serviceWorker' in navigator && !isAdmin && location.protocol === 'https:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js', { scope: '/' }).catch(() => {});
        });
    }
})();