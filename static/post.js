/* 文章页：目录高亮 / 移动端目录 / 检查列表 / 操作按钮 / 图片预览
 * 目录卡片在桌面端内部滚动，其余均为整页滚动。
 * 评论由 comments.js 单独处理。
 */
(() => {
    const $ = s => document.querySelector(s);
    const article = $('#markdown-content');
    if (!article) return;

    const isDesktop = () => window.innerWidth > 1100;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sidebar = $('#sidebar');
    const tocBtn = $('#mobile-toc-toggle');
    const OFFSET = 90;                     // 与 CSS 的 scroll-margin-top 保持一致

    // 任务列表（正文 + 检查列表）允许点击
    document.querySelectorAll('.markdown-body input[type="checkbox"], .checklist-body input[type="checkbox"]')
        .forEach(c => c.removeAttribute('disabled'));

    // ===== 目录 =====
    const headings = Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h => h.id);
    const tocLinks = Array.from(document.querySelectorAll('#toc a'));

    const collapseToc = () => {
        if (sidebar) sidebar.classList.add('collapsed');
        if (tocBtn) { tocBtn.classList.add('collapsed'); tocBtn.setAttribute('aria-expanded', 'false'); }
    };

    function scrollToEl(target) {
        window.scrollTo({
            top: target.getBoundingClientRect().top + window.scrollY - OFFSET,
            behavior: reduceMotion ? 'auto' : 'smooth',
        });
    }

    const tocContainer = $('#toc');
    if (tocContainer) {
        tocContainer.addEventListener('click', e => {
            const link = e.target.closest('a[href^="#"]');
            if (!link) return;
            e.preventDefault();
            const id = link.getAttribute('href').slice(1);
            const target = document.getElementById(id);
            if (!target) return;
            scrollToEl(target);
            history.replaceState(null, '', '#' + id);
            if (!isDesktop()) collapseToc();
        });
    }

    if (tocBtn) {
        tocBtn.addEventListener('click', () => {
            if (!sidebar) return;
            const collapsed = sidebar.classList.toggle('collapsed');
            tocBtn.classList.toggle('collapsed', collapsed);
            tocBtn.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    // ===== 滚动监听（整页滚动，rAF 节流） =====
    let ticking = false;
    function update() {
        ticking = false;
        const limit = 100;
        const atBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 50;
        let id = '';

        if (atBottom) {
            id = headings.length ? headings[headings.length - 1].id : '';
        } else {
            for (let i = headings.length - 1; i >= 0; i--) {
                if (headings[i].getBoundingClientRect().top <= limit) { id = headings[i].id; break; }
            }
        }
        tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
        if (window.innerWidth <= 1100 && window.scrollY > 20 && sidebar && !sidebar.classList.contains('collapsed')) {
            collapseToc();
        }
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();

    // ===== 回到顶部 =====
    const topBtn = $('#back-top');
    if (topBtn) topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    // ===== 跳到评论区 =====
    const jumpComments = $('#jump-comments');
    if (jumpComments) jumpComments.addEventListener('click', e => {
        const target = $('#comments');
        if (!target) return;                       // 没有评论区时走默认锚点
        e.preventDefault();
        scrollToEl(target);
        history.replaceState(null, '', '#comments');
        if (!isDesktop()) collapseToc();
        // 键盘/读屏用户：把焦点移到评论区（不弹软键盘）
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    });

    // ===== 检查列表：勾选状态 =====
    const checkBody = $('#checklist-body');
    if (checkBody) {
        const boxes = Array.from(checkBody.querySelectorAll('input[type="checkbox"]'));
        const progress = $('#checkProgress');
        const key = 'checklist:' + location.pathname;
        const showProgress = () => {
            if (!progress) return;
            progress.hidden = boxes.length === 0;
            progress.textContent = `${boxes.filter(b => b.checked).length}/${boxes.length}`;
        };
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            if (Array.isArray(saved)) boxes.forEach((b, i) => { if (i < saved.length) b.checked = !!saved[i]; });
        } catch (e) {}
        boxes.forEach(b => b.addEventListener('change', () => {
            try { localStorage.setItem(key, JSON.stringify(boxes.map(x => x.checked))); } catch (e) {}
            showProgress();
        }));
        showProgress();
    }

    // ===== 图片预览 =====
    const lb = $('#lightbox'), stage = $('#lb-stage'), lbImg = $('#lb-img');
    const prevBtn = $('#lb-prev'), nextBtn = $('#lb-next'), closeBtn = $('#lb-close');
    const imgs = Array.from(article.querySelectorAll('img'));
    let idx = 0, scale = 1, x = 0, y = 0, opener = null;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const apply = () => {
        lbImg.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
        stage.classList.toggle('zoomed', scale > 1);
    };
    const resetZoom = () => { scale = 1; x = y = 0; apply(); };

    function show(i) {
        idx = i;
        lbImg.src = imgs[i].currentSrc || imgs[i].src;
        lbImg.alt = imgs[i].alt || '';
        resetZoom();
        prevBtn.hidden = i === 0;
        nextBtn.hidden = i === imgs.length - 1;
    }
    function openLb(i, from) {
        opener = from;
        lb.hidden = false;
        document.body.style.overflow = 'hidden';
        show(i);
        closeBtn.focus();
    }
    function closeLb() {
        lb.hidden = true;
        document.body.style.overflow = '';
        lbImg.removeAttribute('src');
        if (opener) opener.focus({ preventScroll: true });
    }
    const step = d => { const n = idx + d; if (n >= 0 && n < imgs.length) show(n); };

    imgs.forEach((im, i) => {
        im.tabIndex = 0;
        im.setAttribute('role', 'button');
        im.addEventListener('click', e => { e.stopPropagation(); openLb(i, im); });
        im.addEventListener('keydown', e => { if (e.key === 'Enter') openLb(i, im); });
    });
    if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => step(1));
    if (closeBtn) closeBtn.addEventListener('click', closeLb);

    const pts = new Map();
    let startDist = 0, startScale = 1, drag = null, moved = false;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

    if (stage) {
        stage.addEventListener('pointerdown', e => {
            stage.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            lbImg.classList.add('no-anim');
            moved = false;
            if (pts.size === 2) { startDist = dist(); startScale = scale; drag = null; }
            else drag = { ox: e.clientX - x, oy: e.clientY - y, sx: e.clientX, sy: e.clientY };
        });
        stage.addEventListener('pointermove', e => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) {
                scale = clamp(startScale * dist() / startDist, 0.5, 5);
                moved = true;
                apply();
            } else if (drag) {
                if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved = true;
                if (scale > 1) {
                    x = e.clientX - drag.ox; y = e.clientY - drag.oy;
                    stage.classList.add('panning');
                    apply();
                }
            }
        });
        const endPointer = e => {
            if (!pts.has(e.pointerId)) return;
            pts.delete(e.pointerId);
            lbImg.classList.remove('no-anim');
            stage.classList.remove('panning');
            if (pts.size === 0 && drag) {
                const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
                if (scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
                else if (!moved && scale === 1 && e.target === stage) closeLb();
                drag = null;
            } else if (pts.size === 1) {
                const p = [...pts.values()][0];
                drag = { ox: p.x - x, oy: p.y - y, sx: p.x, sy: p.y };
            }
        };
        stage.addEventListener('pointerup', endPointer);
        stage.addEventListener('pointercancel', endPointer);
        stage.addEventListener('wheel', e => {
            e.preventDefault();
            scale = clamp(scale + (e.deltaY > 0 ? -0.2 : 0.2), 0.5, 5);
            apply();
        }, { passive: false });
    }

    document.addEventListener('keydown', e => {
        if (lb && lb.hidden) return;
        if (e.key === 'Escape') closeLb();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'Tab') {
            const f = [closeBtn, prevBtn, nextBtn].filter(b => b && !b.hidden);
            const i = f.indexOf(document.activeElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
    });
})();