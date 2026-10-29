/* 文章页评论区：Cloudflare Pages Functions + D1（见 functions/api/comment.js）
 * 纯文本渲染（textContent），支持一级回复。
 * 站主：口令存 localStorage（commentOwnerToken）；服务端强制用预设昵称，
 *       前端用预设头像；徽章标「new」。
 * 访客：昵称本机记住；admin/new 等保留名不可用。
 */
(() => {
    const CFG = window.__SITE__ || {};
    const OWNER_NAME = CFG.ownerName || 'new';
    const OWNER_AVATAR = CFG.ownerAvatar || '';

    const OWNER_AVATAR_LIGHT = CFG.ownerAvatarLight || OWNER_AVATAR;
    const isDark = () => document.documentElement.dataset.theme === 'dark';
    const ownerAvatarSrc = () => (isDark() ? OWNER_AVATAR : OWNER_AVATAR_LIGHT);

    const form = document.getElementById('commentForm');
    const list = document.getElementById('commentList');
    const empty = document.getElementById('commentEmpty');
    const nameInput = document.getElementById('cName');
    const mailInput = document.getElementById('cMail');
    const siteInput = document.getElementById('cSite');
    const bodyInput = document.getElementById('cBody');
    const counter = document.getElementById('cCount');
    const submit = form ? form.querySelector('.comment-submit') : null;
    const previewBtn = document.getElementById('cfPreview');
    const previewBox = document.getElementById('cfPreviewBox');
    const replyBar = document.getElementById('cfReply');
    const replyName = document.getElementById('cfReplyName');
    const replyCancel = document.getElementById('cfReplyCancel');

    if (!form || !list || !nameInput || !bodyInput) return;

    const LIMIT = 200;
    const TIMEOUT = 8000;
    const MAX = bodyInput.maxLength > 0 ? bodyInput.maxLength : 500;
    const path = location.pathname;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

    // ===== 站主口令 =====
    const OWNER_KEY = 'commentOwnerToken';
    let ownerToken = '';
    try { ownerToken = localStorage.getItem(OWNER_KEY) || ''; } catch (e) {}
    (() => {
        const qs = new URLSearchParams(location.search);
        const fromUrl = qs.get('owner');
        if (!fromUrl) return;
        ownerToken = fromUrl.trim();
        try { localStorage.setItem(OWNER_KEY, ownerToken); } catch (e) {}
        qs.delete('owner');
        const q = qs.toString();
        history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    })();

    // ===== 记住昵称（只存本机）=====
    const PROFILE_KEY = 'commentProfile';
    try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
        if (saved && saved.name && !nameInput.value) nameInput.value = saved.name;
    } catch (e) {}

    function saveProfile() {
        try {
            localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: nameInput.value.trim() }));
        } catch (e) {}
    }
    nameInput.addEventListener('change', saveProfile);

    // ===== 保留昵称（站主可用）=====
    const RESERVED = new Set([
        'admin', 'administrator', 'root', 'moderator', 'mod', 'webmaster',
        'owner', 'support', 'official', 'team', 'null', 'undefined',
        '博主', '站长', '管理员', '版主', '官方', '客服', '系统'
    ]);
    const normName = s => String(s || '').trim().toLowerCase().replace(/[\s_.\-·]+/g, '');
    const isReserved = name => RESERVED.has(normName(name));

    // ===== 回复状态 =====
    let replyTarget = null;
    let hint = null;

    function flash(msg) {
        if (!hint) {
            hint = document.createElement('p');
            hint.className = 'comment-empty';
            hint.setAttribute('role', 'status');
            previewBox ? previewBox.after(hint) : form.append(hint);
        }
        hint.textContent = msg;
        hint.hidden = !msg;
    }

    const setEmpty = show => { if (empty) empty.hidden = !show; };
    const syncCount = () => { if (counter) counter.textContent = String(bodyInput.value.length); };

    function setReply(comment) {
        replyTarget = { id: comment.parent_id || comment.id, name: comment.is_owner ? OWNER_NAME : comment.name };
        if (replyBar && replyName) {
            replyName.textContent = replyTarget.name;
            replyBar.hidden = false;
        }
        bodyInput.focus();
    }
    function clearReply() {
        replyTarget = null;
        if (replyBar) replyBar.hidden = true;
    }
    if (replyCancel) replyCancel.addEventListener('click', clearReply);

    function fmtTime(ms) {
        const d = new Date(Number(ms) || Date.now());
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
               `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function render(c) {
        const li = document.createElement('li');
        li.className = 'comment-item';
        li.dataset.id = String(c.id);
        if (c.is_owner) li.classList.add('is-owner');

        // 头像：站主用预设图，访客用首字母
        const avatar = document.createElement('div');
        avatar.className = 'comment-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        if (c.is_owner) {
            if (OWNER_AVATAR) {
                const img = document.createElement('img');
                img.src = ownerAvatarSrc();
                img.alt = '';
                img.loading = 'lazy';
                img.dataset.ownerAvatar = '1';
                avatar.append(img);
            } else {
                avatar.textContent = OWNER_NAME.charAt(0);
            }
        } else {
            avatar.textContent = (c.name || '?').trim().charAt(0).toUpperCase();
        }

        const content = document.createElement('div');
        content.className = 'comment-content';

        const head = document.createElement('div');
        head.className = 'comment-head';

        const name = document.createElement('span');
        name.className = 'comment-name';

        // 回复目标前缀
        if (c.reply_to) {
            const to = document.createElement('span');
            to.className = 'comment-reply-to';
            to.textContent = `回复 @${c.reply_to}`;
            name.append(to);
        }

        if (c.is_owner) {
            // 预设昵称（等于“new”时只留徽章，避免重复）
            if (OWNER_NAME && OWNER_NAME !== 'new') {
                const span = document.createElement('span');
                span.textContent = OWNER_NAME;
                name.append(span);
            }
            const badge = document.createElement('span');
            badge.className = 'comment-owner';
            badge.textContent = 'owner';
            badge.title = OWNER_NAME;
            name.append(badge);
        } else if (c.website) {
            const a = document.createElement('a');
            a.href = c.website;
            a.target = '_blank';
            a.rel = 'noopener noreferrer nofollow ugc';
            a.textContent = c.name;
            name.append(a);
        } else {
            const span = document.createElement('span');
            span.textContent = c.name;
            name.append(span);
        }

        const time = document.createElement('time');
        time.className = 'comment-time';
        const at = new Date(Number(c.created_at) || Date.now());
        time.dateTime = at.toISOString();
        time.textContent = fmtTime(c.created_at);

        head.append(name, time);

        const body = document.createElement('div');
        body.className = 'comment-body';
        body.textContent = c.body;

        const foot = document.createElement('div');
        foot.className = 'comment-foot';
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'comment-reply-btn';
        replyBtn.textContent = '回复';
        replyBtn.addEventListener('click', () => setReply(c));
        foot.append(replyBtn);

        content.append(head, body, foot);
        li.append(avatar, content);
        return li;
    }

    function renderTree(items) {
        const nodes = new Map();
        const roots = [];
        items.forEach(raw => {
            const node = { data: raw, children: [] };
            nodes.set(raw.id, node);
            if (raw.parent_id && nodes.has(raw.parent_id)) nodes.get(raw.parent_id).children.push(node);
            else roots.push(node);
        });
        roots.sort((a, b) => b.data.id - a.data.id);
        return roots.map(node => {
            const li = render(node.data);
            if (node.children.length) {
                const ul = document.createElement('ul');
                ul.className = 'comment-children';
                node.children
                    .sort((a, b) => a.data.id - b.data.id)
                    .forEach(child => ul.append(render(child.data)));
                li.querySelector('.comment-content').append(ul);
            }
            return li;
        });
    }

    function errText(status, detail) {
        switch (status) {
            case 400:
                return detail === 'reserved name'
                    ? '该昵称已被保留，请换一个'
                    : '昵称或内容不合法（昵称 ≤ 40 字，内容 ≤ 500 字）';
            case 403: return detail === 'blocked' ? '无法发表评论' : '来源校验失败，请从本站页面提交';
            case 429: return '发言太快，等一分钟后再试';
            case 500: return '服务端未就绪：确认 Pages 已绑定 D1（变量名 DB）';
            default:  return detail || `提交失败（HTTP ${status}）`;
        }
    }

    async function request(url, options) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    async function load() {
        try {
            const r = await request(`/api/comment?path=${encodeURIComponent(path)}&limit=${LIMIT}`,
                                    { headers: { accept: 'application/json' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            const items = Array.isArray(data.comments) ? data.comments : [];
            list.replaceChildren(...renderTree(items));
            setEmpty(items.length === 0);
        } catch (e) {
            if (e && e.name === 'AbortError') {
                flash('加载评论超时，请刷新重试。');
            } else if (isLocal) {
                if (empty) {
                    empty.textContent = '本地静态预览没有 /api/comment，部署到 Pages 后评论才会出现。';
                    empty.hidden = false;
                }
            } else {
                flash('评论加载失败，请稍后刷新。');
            }
        }
    }

    bodyInput.addEventListener('input', syncCount);
    syncCount();

    if (previewBtn && previewBox) {
        previewBtn.addEventListener('click', () => {
            const on = previewBtn.getAttribute('aria-pressed') !== 'true';
            previewBtn.setAttribute('aria-pressed', String(on));
            previewBtn.textContent = on ? '继续编辑' : '预览';
            previewBox.hidden = !on;
            previewBox.textContent = bodyInput.value;
            bodyInput.hidden = on;
        });
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const isOwnerPost = !!ownerToken;
        const name = nameInput.value.trim();
        const body = bodyInput.value.trim();

        // 站主不需要昵称，也不受保留名限制
        if (!isOwnerPost) {
            if (!name) { nameInput.focus(); flash('请填写昵称'); return; }
            if (isReserved(name)) { nameInput.focus(); flash('该昵称已被保留，请换一个'); return; }
        }
        if (!body) { bodyInput.focus(); flash('请填写内容'); return; }
        if (body.length > MAX) { bodyInput.focus(); flash(`内容不能超过 ${MAX} 字`); return; }

        const label = submit ? submit.textContent : '';
        if (submit) { submit.disabled = true; submit.textContent = '发送中…'; }
        flash('');

        try {
            const r = await request('/api/comment', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    path,
                    name: name || (isOwnerPost ? OWNER_NAME : ''),
                    body,
                    email: mailInput ? mailInput.value.trim() : '',
                    website: siteInput ? siteInput.value.trim() : '',
                    parentId: replyTarget ? replyTarget.id : null,
                    replyTo: replyTarget ? replyTarget.name : '',
                    token: ownerToken || '',
                }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.comment) {
                if (data.pending) flash('评论已提交，审核通过后显示。');
                bodyInput.value = '';
                syncCount();
                clearReply();
                saveProfile();
                if (previewBtn && previewBtn.getAttribute('aria-pressed') === 'true') previewBtn.click();
                await load();
            } else {
                flash(errText(r.status, data && data.error));
            }
        } catch (err) {
            flash(err && err.name === 'AbortError'
                ? '提交超时，请稍后重试（可能已发送成功，刷新确认）。'
                : '网络错误，请稍后再试。');
        } finally {
            if (submit) { submit.disabled = false; submit.textContent = label || '发送'; }
        }
    });
    
    document.addEventListener('themechange', () => {
        list.querySelectorAll('img[data-owner-avatar]').forEach(img => {
            img.src = ownerAvatarSrc();
        });
    });

    load();
})();
