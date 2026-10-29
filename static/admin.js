/* 管理后台（/admin）：登录 · 概览 · 统计 · 文章（GitHub）· 媒体库（R2）· 评论 · 留言 · 用户
 * 所有来自用户的内容都通过 textContent / DOM API 渲染，不使用 innerHTML（预览除外：经 DOMPurify 净化）。
 */
(() => {
    const app = document.getElementById('app');
    const CFG = window.__ADMIN__ || {};
    let me = null;
    let deployTimer = null;

    // ================================================================ 工具
    function h(tag, props, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
            else if (k === 'for') el.htmlFor = v;
            else if (['value', 'checked', 'disabled', 'href', 'src', 'target', 'rel', 'type', 'rows', 'placeholder', 'title', 'multiple', 'accept', 'id', 'selected', 'loading', 'alt'].includes(k)) el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
        return el;
    }
    const $ = (s, el = document) => el.querySelector(s);
    const fmtTime = ms => { if (!ms) return '—'; const d = new Date(Number(ms)), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

    const regionName = code => { try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || code; } catch (e) { return code || '未知'; } };

    const today = () => new Date().toISOString().slice(0, 10);

    function toast(msg, err) {
        let box = $('.adm-toasts');
        if (!box) { box = h('div', { class: 'adm-toasts', role: 'status' }); document.body.append(box); }
        const t = h('div', { class: 'adm-toast' + (err ? ' err' : '') }, msg);
        box.append(t);
        setTimeout(() => t.remove(), err ? 6000 : 3200);
    }

    async function api(method, path, body) {
        const opt = { method, headers: { 'x-requested-with': 'nw' }, credentials: 'same-origin' };
        if (body instanceof FormData) opt.body = body;
        else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
        const r = await fetch('/api/admin/' + path, opt);
        const data = await r.json().catch(() => ({}));
        if (r.status === 401 && !path.startsWith('auth/')) { me = null; boot(); throw new Error('登录已失效，请重新登录'); }
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        return data;
    }
    const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return null; } };

    async function copy(text) {
        try { await navigator.clipboard.writeText(text); toast('已复制'); }
        catch (e) { const t = h('textarea', { value: text }); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('已复制'); }
    }

    function modal(title, content, small) {
        const close = () => { m.remove(); document.removeEventListener('keydown', esc); };
        const esc = e => { if (e.key === 'Escape') close(); };
        const m = h('div', { class: 'adm-modal', on: { mousedown: e => { if (e.target === m) close(); } } },
            h('div', { class: 'box' + (small ? ' sm' : '') },
                h('div', { class: 'hd' }, h('h3', null, title), h('button', { class: 'btn btn-sm', type: 'button', on: { click: close } }, '关闭')),
                content));
        document.addEventListener('keydown', esc);
        document.body.append(m);
        return close;
    }

    function pager(total, per, page, go) {
        const pages = Math.max(Math.ceil(total / per), 1);
        if (pages <= 1) return null;
        return h('div', { class: 'adm-pager' },
            h('button', { class: 'btn btn-sm', type: 'button', disabled: page <= 1, on: { click: () => go(page - 1) } }, '上一页'),
            `${page} / ${pages}（共 ${total}）`,
            h('button', { class: 'btn btn-sm', type: 'button', disabled: page >= pages, on: { click: () => go(page + 1) } }, '下一页'));
    }

    const field = (label, input) => h('label', { class: 'fld' }, h('span', null, label), input);
    const glass = (cls, ...kids) => h('div', { class: 'glass ' + cls }, ...kids);

    // ================================================================ 登录 / 初始化
    function authScreen(needSetup) {
        const u = h('input', { type: 'text', autocomplete: 'username', placeholder: '用户名' });
        const p = h('input', { type: 'password', autocomplete: needSetup ? 'new-password' : 'current-password', placeholder: needSetup ? '密码（至少 8 位）' : '密码' });
        const t = h('input', { type: 'password', autocomplete: 'off', placeholder: '初始化口令（ADMIN_SETUP_TOKEN）' });
        const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, needSetup ? '创建管理员' : '登录');
        const form = h('form', { class: 'glass adm-login-card', on: { submit: async e => {
            e.preventDefault(); btn.disabled = true;
            const ok = await run(async () => {
                if (needSetup) await api('POST', 'auth/setup', { username: u.value.trim(), password: p.value, setup_token: t.value });
                await api('POST', 'auth/login', { username: u.value.trim(), password: p.value });
                return true;
            });
            btn.disabled = false;
            if (ok) boot();
        } } },
            h('img', { src: CFG.logo || '/static/logo.svg', alt: '' }),
            h('h1', null, needSetup ? '创建第一个管理员' : '管理后台'),
            needSetup ? h('p', { class: 'hint' }, '仅在尚无管理员时可用。初始化口令是你在 Cloudflare 配置的 ADMIN_SETUP_TOKEN。') : null,
            needSetup ? field('初始化口令', t) : null, field('用户名', u), field('密码', p), btn);
        app.replaceChildren(h('div', { class: 'adm-login' }, form));
        u.focus();
    }

    // ================================================================ 外壳与路由
    const NAV = [['overview', '概览'], ['stats', '统计'], ['posts', '文章'], ['comments', '评论'], ['messages', '留言'], ['users', '用户'], ['media', '媒体库']];

    function shell() {
        const main = h('main', { class: 'adm-main', id: 'view' });
        const nav = h('nav', { class: 'adm-nav' }, NAV.map(([k, label]) => h('a', { href: '#/' + k, 'data-k': k }, label)));
        const chip = h('span', { class: 'tag deploy-chip', id: 'deployChip', hidden: true });
        const side = glass('adm-side',
            h('div', { class: 'adm-brand' }, h('img', { src: CFG.logo || '/static/logo.svg', alt: '' }), h('span', null, CFG.site || '后台')),
            nav, chip,
            h('div', { class: 'adm-side-foot' },
                h('div', { class: 'adm-me' }, h('b', null, me.username), h('small', null, me.role === 'admin' ? '管理员' : '编辑')),
                h('div', { class: 'adm-row' },
                    h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': '切换主题', id: 'admTheme' }, '◐'),
                    h('a', { class: 'btn btn-sm', href: '/', target: '_blank', rel: 'noopener' }, '看站点'),
                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: passwordDialog } }, '改密码'),
                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { await run(() => api('POST', 'auth/logout')); me = null; boot(); } } }, '退出'))));
        app.replaceChildren(h('div', { class: 'adm-shell' }, side, main));
        $('#admTheme', side).addEventListener('click', () => {
            const root = document.documentElement, next = root.dataset.theme === 'dark' ? 'light' : 'dark';
            root.dataset.theme = next; try { localStorage.setItem('theme', next); } catch (e) {}
        });
        refreshDeploy();
        route();
    }

    async function refreshDeploy(poll) {
        const chip = $('#deployChip');
        if (!chip) return;
        const d = await api('GET', 'deploy').catch(() => null);
        clearTimeout(deployTimer);
        if (!d || !d.configured) { chip.hidden = true; return; }
        const st = d.status;
        const map = { success: ['已上线', ''], active: ['构建中…', 'warn'], idle: ['排队中…', 'warn'], failure: ['构建失败', 'bad'], canceled: ['已取消', 'bad'] };
        const [label, cls] = map[st] || [st || '—', ''];
        chip.textContent = '站点：' + label; chip.className = 'tag deploy-chip ' + cls; chip.hidden = false;
        if (st === 'active' || st === 'idle' || poll) deployTimer = setTimeout(() => refreshDeploy(st === 'active' || st === 'idle'), 6000);
    }

    function route() {
        if (!me) return;
        const hash = location.hash.replace(/^#\/?/, '') || 'overview';
        const [view, ...rest] = hash.split('/');
        document.querySelectorAll('.adm-nav a').forEach(a => a.classList.toggle('on', a.dataset.k === view));
        const main = $('#view');
        main.replaceChildren(h('p', { class: 'adm-boot' }, '加载中…'));
        const views = { overview: viewOverview, stats: viewStats, posts: viewPosts, media: viewMedia, comments: viewComments, messages: viewMessages, users: viewUsers };
        (views[view] || viewOverview)(main, rest.map(decodeURIComponent)).catch(e => main.replaceChildren(h('p', { class: 'adm-empty' }, '加载失败：' + e.message)));
    }
    window.addEventListener('hashchange', route);

    function passwordDialog() {
        const o = h('input', { type: 'password', autocomplete: 'current-password' });
        const n = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 8 位' });
        const close = modal('修改密码', h('div', { class: 'adm-form' }, field('原密码', o), field('新密码', n),
            h('button', { class: 'btn btn-primary', type: 'button', on: { click: async () => {
                if (await run(() => api('POST', 'auth/password', { old: o.value, password: n.value }), '密码已更新')) close();
            } } }, '保存')), true);
    }

    // ================================================================ 概览
    async function viewOverview(main) {
        const d = await api('GET', 'overview');
        const stat = (n, l) => glass('adm-stat', h('strong', null, Number(n).toLocaleString('en-US')), h('span', null, l));
        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, '概览')),
            h('div', { class: 'adm-stats' }, stat(d.pv, '访问量'), stat(d.uv, '访客'), stat(d.comments, '评论'), stat(d.pending, '待审核'), stat(d.messages, '留言'), stat(d.media, '图片 · ' + fmtSize(d.mediaBytes))),
            glass('adm-card', h('h3', null, '最近评论'),
                d.recent.length ? h('div', { class: 'adm-list' }, d.recent.map(c => h('div', { class: 'adm-item' },
                    h('div', null, h('div', { class: 't' }, c.name, ' ', c.status === 2 ? h('span', { class: 'tag warn' }, '待审核') : c.status === 1 ? h('span', { class: 'tag bad' }, '已隐藏') : null),
                        h('div', { class: 'm' }, h('span', null, c.body.slice(0, 80)), h('span', null, c.path), h('span', null, fmtTime(c.created_at)))),
                    h('a', { class: 'btn btn-sm', href: '#/comments' }, '去处理')))) : h('p', { class: 'adm-empty' }, '还没有评论')));
    }

    // ================================================================ 统计
    async function viewStats(main) {
        const [d, v] = await Promise.all([
            api('GET', 'overview'),
            api('GET', 'visits?per=50').catch(() => ({ items: [], total: 0 })),
        ]);
        const stat = (n, l) => glass('adm-stat', h('strong', null, Number(n).toLocaleString('en-US')), h('span', null, l));
        const geo = d.geo || { countries: [], cities: [] };

        const codeBadge = code => h('span', { class: 'geo-code' }, (code || '--').toUpperCase().slice(0, 2));
        const num = n => Number(n || 0).toLocaleString('en-US');
        const maxHits = Math.max(1, ...geo.countries.map(c => Number(c.hits || 0)));

        const byCountry = new Map();
        for (const c of geo.cities) {
            if (!byCountry.has(c.country)) byCountry.set(c.country, []);
            byCountry.get(c.country).push(c);
        }
        const order = [...geo.countries.map(c => c.country), ...byCountry.keys()]
            .filter((val, i, a) => val && a.indexOf(val) === i);

        const countriesCard = glass('adm-card',
            h('h3', null, '国家 / 地区'),
            geo.countries.length
                ? h('div', { class: 'geo-list' }, geo.countries.map(c => h('div', { class: 'geo-row' },
                    h('div', { class: 'geo-name' }, codeBadge(c.country), h('span', { class: 'geo-cn' }, regionName(c.country) || '未知')),
                    h('div', { class: 'geo-track' }, h('span', { style: `width:${Math.max(2, Math.round(Number(c.hits) / maxHits * 100))}%` })),
                    h('div', { class: 'geo-val' }, num(c.hits)))))
                : h('p', { class: 'adm-empty' }, '还没有来源数据'));

        const cityCard = glass('adm-card',
            h('h3', null, '城市分布（按国家）'),
            geo.cities.length
                ? h('div', { class: 'geo-groups' }, order.map(k => {
                    const list = (byCountry.get(k) || []).slice(0, 6);
                    if (!list.length) return null;
                    const row = geo.countries.find(c => c.country === k);
                    return h('div', { class: 'geo-group' },
                        h('div', { class: 'geo-group-hd' },
                            h('span', { class: 'geo-group-name' }, codeBadge(k), h('span', null, regionName(k) || k)),
                            h('span', { class: 'adm-muted' }, row ? `${num(row.hits)} 次` : '')),
                        h('ul', { class: 'geo-cities' }, list.map(c => h('li', null,
                            h('span', null, [c.city, c.region].filter(Boolean).join(' · ') || '未知'),
                            h('span', { class: 'adm-muted' }, `${num(c.hits)} 次`)))));
                }).filter(Boolean))
                : h('p', { class: 'adm-empty' }, '还没有城市数据'));

        const kindLabel = k => ({ hit: '浏览', comment: '评论', message: '留言' }[k] || k);

        const visitsCard = glass('adm-card',
            h('h3', null, `最近访问（${num(v.total)} 条记录）`),
            v.items.length
                ? h('div', { class: 'visit-table' },
                    h('div', { class: 'visit-row visit-hd' },
                        h('span', null, '时间'), h('span', null, '国家'), h('span', null, '地区 / 城市'), h('span', null, '类型'), h('span', null, '页面')),
                    ...v.items.map(it => h('div', { class: 'visit-row' },
                        h('span', null, fmtTime(it.created_at)),
                        h('span', { class: 'visit-country' }, codeBadge(it.country), h('span', null, regionName(it.country) || '未知')),
                        h('span', null, [it.city, it.region].filter(Boolean).join(' · ') || '—'),
                        h('span', null, kindLabel(it.kind)),
                        h('span', { class: 'visit-path', title: it.path }, it.path || '—'))))
                : h('p', { class: 'adm-empty' }, '还没有访问明细'));

        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, '统计')),
            h('div', { class: 'adm-stats' },
                stat(d.pv, '访问量'), stat(d.uv, '访客'), stat(d.comments, '评论'),
                stat(d.messages, '留言'), stat(d.media, '图片 · ' + fmtSize(d.mediaBytes))),
            h('div', { class: 'stats-grid' }, countriesCard, cityCard),
            visitsCard);
    }

    // ================================================================ 文章
    function parsePost(text) {
        const L = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        const g = i => (L[i] || '').trim(), strip = s => s.replace(/^#+\s*/, '').trim();
        let cover = g(1).replace(/^cover\s*[:：]\s*/i, '').trim();
        const m = cover.match(/^!\[.*?\]\((.*?)\)/); if (m) cover = m[1].trim();
        return { title: strip(g(0)), cover, date: g(2), category: g(3), tags: g(4), articleTitle: strip(g(5)), body: L.slice(6).join('\n').replace(/^\n/, '') };
    }
    const composePost = f => [`# ${f.title}`, `cover: ${f.cover}`, f.date, f.category, f.tags, `# ${f.articleTitle || f.title}`, '', f.body].join('\n');

    async function viewPosts(main, rest) {
        if (rest[0] === 'new') return editor(main, null);
        if (rest[0] === 'edit' && rest[1]) return editor(main, rest[1]);
        const { posts } = await api('GET', 'posts');
        const q = h('input', { class: 'adm-search', placeholder: '搜索标题 / 分类 / 标签' });
        const list = h('div', { class: 'adm-list' });
        const stale = posts.some(p => !p.indexed);
        const draw = () => {
            const kw = q.value.trim().toLowerCase();
            const rows = posts.filter(p => !kw || (p.title + p.category + p.tags + p.name).toLowerCase().includes(kw));
            list.replaceChildren(...(rows.length ? rows.map(p => h('div', { class: 'adm-item' },
                h('div', null,
                    h('div', { class: 't' }, p.title, ' ', p.draft ? h('span', { class: 'tag warn' }, '草稿') : null),
                    h('div', { class: 'm' }, p.category ? h('span', { class: 'tag' }, p.category) : null, h('span', null, p.date || '—'), h('span', null, p.tags), h('span', null, p.name))),
                h('div', { class: 'adm-row' },
                    h('a', { class: 'btn btn-sm', href: '#/posts/edit/' + encodeURIComponent(p.name) }, '编辑'),
                    h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: async () => {
                        if (!confirm(`删除「${p.title}」？将提交一次删除 commit（可在 GitHub 回滚）。`)) return;
                        if (await run(() => api('DELETE', 'posts/' + encodeURIComponent(p.name), { sha: p.sha }), '已删除，站点将重新构建')) { refreshDeploy(true); route(); }
                    } } }, '删除')))) : [h('p', { class: 'adm-empty' }, '没有文章')]));
        };
        q.addEventListener('input', draw); draw();
        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, '文章'),
                h('div', { class: 'adm-row adm-actions' },
                    q,
                    stale ? h('button', { class: 'btn', type: 'button', on: { click: async () => { const r = await run(() => api('POST', 'posts/sync'), '索引已更新'); if (r) route(); } } }, '同步标题索引') : null,
                    h('a', { class: 'btn btn-primary', href: '#/posts/new' }, '新建文章'))),
            glass('adm-card', list),
            h('p', { class: 'adm-muted' }, '保存 = 向 GitHub 提交一次 commit，Cloudflare Pages 自动重建，约 1 分钟后上线。文件名以 _ 开头的是草稿，不会发布。'));
    }

    async function editor(main, name) {
        const isNew = !name;
        let sha = '', f = { title: '', cover: '', date: today(), category: '', tags: '', articleTitle: '', body: '' };
        let fileName = name || '';
        if (!isNew) { const r = await api('GET', 'posts/' + encodeURIComponent(name)); sha = r.sha; f = parsePost(r.content); }
        const cats = [...new Set((await api('GET', 'posts').catch(() => ({ posts: [] }))).posts.map(p => p.category).filter(Boolean))];

        const title = h('input', { class: 'ed-title', placeholder: '文章标题', value: f.title });
        const nameIn = h('input', { placeholder: '文件名，如 my-first-post（自动补 .md）', value: fileName, disabled: !isNew });
        const draftIn = h('input', { type: 'checkbox', checked: !isNew && name.startsWith('_') });
        const cover = h('input', { placeholder: '/media/… 或完整图片地址', value: f.cover });
        const coverPrev = h('img', { class: 'cover-prev', alt: '', hidden: !f.cover, src: f.cover || '' });
        const date = h('input', { type: 'date', value: f.date });
        const cat = h('input', { value: f.category, placeholder: '分类', list: 'catlist' });
        const tags = h('input', { value: f.tags, placeholder: '标签，用英文逗号分隔' });
        const body = h('textarea', { class: 'ed-text', spellcheck: false, value: f.body, placeholder: '在这里写 Markdown…（可粘贴 / 拖入图片自动上传）' });
        const prev = h('article', { class: 'markdown-body ed-prev', hidden: true });
        const split = h('div', { class: 'ed-split' }, body, prev);
        cover.addEventListener('input', () => { coverPrev.src = cover.value; coverPrev.hidden = !cover.value; });

        const insert = (text, selectInner) => {
            const s = body.selectionStart, e = body.selectionEnd;
            body.setRangeText(text, s, e, 'end'); body.focus();
            if (selectInner) body.setSelectionRange(s + selectInner[0], s + selectInner[1]);
        };
        const wrap = (a, b, ph) => { const sel = body.value.slice(body.selectionStart, body.selectionEnd) || ph; insert(a + sel + b, [a.length, a.length + sel.length]); };
        const addImages = items => insert(items.map(i => `![${i.name.replace(/\.[^.]+$/, '')}](${i.url})`).join('\n') + '\n');
        const upload = async files => { const items = await uploadFiles([...files]); if (items.length) addImages(items); };
        body.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/')); if (fs.length) { e.preventDefault(); upload(fs); } });
        body.addEventListener('dragover', e => e.preventDefault());
        body.addEventListener('drop', e => { const fs = [...(e.dataTransfer?.files || [])].filter(x => x.type.startsWith('image/')); if (fs.length) { e.preventDefault(); upload(fs); } });
        body.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); insert('    '); } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });

        let previewOn = false;
        const togglePreview = async () => {
            previewOn = !previewOn; prev.hidden = !previewOn; split.classList.toggle('preview', previewOn);
            if (previewOn) { await ensureMarked(); renderPreview(); }
        };
        const renderPreview = () => { prev.innerHTML = window.DOMPurify && window.marked ? DOMPurify.sanitize(marked.parse(body.value)) : ''; if (!window.marked) prev.textContent = '预览库加载失败（需访问 cdnjs）。'; };
        body.addEventListener('input', () => { if (previewOn) renderPreview(); });

        async function save() {
            const t = title.value.trim();
            if (!t) { toast('请填写标题', true); return; }
            let fn = fileName;
            if (isNew) {
                fn = nameIn.value.trim().replace(/\.md$/i, '').replace(/\s+/g, '-');
                if (!fn) fn = t.replace(/\s+/g, '-');
                fn = (draftIn.checked && !fn.startsWith('_') ? '_' : '') + fn + '.md';
            }
            const text = composePost({ ...f, title: t, cover: cover.value.trim(), date: date.value || today(), category: cat.value.trim(), tags: tags.value.trim(), body: body.value });
            const r = await run(() => api('PUT', 'posts/' + encodeURIComponent(fn), { content: text, sha: sha || undefined }), '已提交到 GitHub，约 1 分钟后上线');
            if (!r) return;
            sha = r.sha; fileName = fn; refreshDeploy(true);
            if (isNew) location.hash = '#/posts/edit/' + encodeURIComponent(fn);
        }
        async function toggleDraft() {
            const to = fileName.startsWith('_') ? fileName.slice(1) : '_' + fileName;
            if (!confirm(`将文件重命名为 ${to}（会产生两次 commit）？`)) return;
            const text = composePost({ ...f, title: title.value.trim(), cover: cover.value.trim(), date: date.value, category: cat.value.trim(), tags: tags.value.trim(), body: body.value });
            const a = await run(() => api('PUT', 'posts/' + encodeURIComponent(to), { content: text }));
            if (a && await run(() => api('DELETE', 'posts/' + encodeURIComponent(fileName), { sha }), to.startsWith('_') ? '已转为草稿' : '已发布')) { refreshDeploy(true); location.hash = '#/posts/edit/' + encodeURIComponent(to); }
        }

        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, isNew ? '新建文章' : '编辑文章'),
                h('div', { class: 'adm-row' }, h('a', { class: 'btn', href: '#/posts' }, '返回列表'), h('button', { class: 'btn', type: 'button', on: { click: togglePreview } }, '预览'),
                    h('button', { class: 'btn btn-primary', type: 'button', on: { click: save } }, '保存并发布'))),
            h('div', { class: 'ed' },
                glass('adm-card ed-main', title,
                    h('div', { class: 'ed-bar' },
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => pickMedia(addImages) } }, '插入图片（媒体库）'),
                        h('label', { class: 'btn btn-sm' }, '上传图片', h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, on: { change: e => { upload(e.target.files); e.target.value = ''; } } })),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => wrap('**', '**', '加粗') } }, 'B'),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => wrap('[', '](https://)', '链接文字') } }, '链接'),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => wrap('\n```\n', '\n```\n', '代码') } }, '代码块'),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => insert('\n- [ ] ') } }, '待办')),
                    split),
                glass('adm-card ed-side',
                    h('h3', null, '文章信息'),
                    field('文件名', nameIn),
                    isNew ? h('label', { class: 'fld chk' }, draftIn, '保存为草稿（文件名加 _ 前缀，不发布）')
                          : h('div', { class: 'adm-row' }, fileName.startsWith('_') ? h('span', { class: 'tag warn' }, '草稿') : h('span', { class: 'tag' }, '已发布'),
                              h('button', { class: 'btn btn-sm', type: 'button', on: { click: toggleDraft } }, fileName.startsWith('_') ? '发布' : '转为草稿')),
                    field('封面', cover), h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => pickMedia(items => { cover.value = items[0].url; cover.dispatchEvent(new Event('input')); }, true) } }, '从媒体库选封面'), coverPrev,
                    field('日期', date), field('分类', cat), h('datalist', { id: 'catlist' }, cats.map(c => h('option', { value: c }))), field('标签', tags))));
    }

    let markedLoading;
    function ensureMarked() {
        if (window.marked && window.DOMPurify) return Promise.resolve();
        if (markedLoading) return markedLoading;
        const load = src => new Promise(res => { const s = h('script'); s.src = src; s.onload = res; s.onerror = res; document.head.append(s); });
        markedLoading = Promise.all([
            load('https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js'),
            load('https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js'),
        ]);
        return markedLoading;
    }

    // ================================================================ 媒体库
    let currentDir = '';

    async function uploadFiles(files, dirHint) {
        const out = [];
        const dir = String(dirHint ?? currentDir ?? '').replace(/^\/+|\/+$/g, '');
        for (const file of files) {
            const base = file.name.replace(/\.[^.]+$/, '');
            const def = dir ? `${dir}/${base}` : base;
            const custom = prompt('保存路径（可带文件夹，如 test/test-001；留空用默认）', def);
            if (custom === null) continue;
            const fd = new FormData();
            fd.append('file', file);
            fd.append('name', custom.trim() || def);
            const r = await run(() => api('POST', 'media', fd));
            if (r) out.push(r.item);
        }
        if (out.length) toast(`已上传 ${out.length} 张`);
        return out;
    }

    function mediaBrowser({ onPick, single }) {
        const wrapEl = h('div'), grid = h('div', { class: 'media-grid' });
        let page = 1, q = '', dir = '';
        const checked = new Set();

        const slugPath = s => String(s || '').toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5/]+/g, '-')
            .replace(/\/+/g, '/').replace(/^-+|-+$/g, '');

        const search = h('input', { class: 'adm-search', placeholder: '搜索文件名 / 路径' });
        const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });

        // ---------- 自定义文件夹下拉 ----------
        const dirMenu = h('details', { class: 'adm-menu' });
        const dirSummary = h('summary', { class: 'btn btn-sm' }, '全部文件夹');
        const dirList = h('div', { class: 'adm-menu-list' });
        dirMenu.append(dirSummary, dirList);
        document.addEventListener('click', e => { if (!dirMenu.contains(e.target)) dirMenu.open = false; });

        const openDirs = folders => {
            dirSummary.textContent = dir ? dir + '/' : '全部文件夹';
            const opts = [['', '全部文件夹'], ...folders.map(f => [f, f + '/'])];
            dirList.replaceChildren(...opts.map(([v, label]) =>
                h('button', {
                    class: 'adm-menu-item' + (v === dir ? ' on' : ''),
                    type: 'button',
                    on: { click: () => { dir = v; currentDir = v; dirMenu.open = false; checked.clear(); load(1); } },
                }, label)));
        };

        // ---------- 工具栏按钮 ----------
        const bulkBtn = h('button', { class: 'btn btn-sm btn-danger', type: 'button', hidden: true, on: { click: async () => {
            if (!checked.size) return;
            if (!confirm(`删除选中的 ${checked.size} 张图片？旧链接会失效。`)) return;
            if (await run(() => api('POST', 'media/bulk', { ids: [...checked], action: 'delete' }), '已删除')) { checked.clear(); load(page); }
        } } }, '批量删除');

        const newDirBtn = h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => {
            const name = prompt('新文件夹名（如 test）');
            if (!name || !name.trim()) return;
            if (await run(() => api('POST', 'media/dirs', { name }), '已创建')) { dir = slugPath(name); load(1); }
        } } }, '新建文件夹');

        const renameDirBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, on: { click: async () => {
            const name = prompt(`把「${dir}/」重命名为`, dir);
            if (!name || !name.trim()) return;
            if (!confirm('目录下所有图片的 URL 都会改变，文章里的旧链接需手动替换。继续？')) return;
            if (await run(() => api('PATCH', 'media/dirs/' + encodeURIComponent(dir), { name }), '已重命名')) { dir = slugPath(name); load(1); }
        } } }, '重命名文件夹');

        // ---------- 列表 ----------
        async function load(p) {
            page = p;
            const d = await run(() => api('GET', `media?page=${page}&q=${encodeURIComponent(q)}&dir=${encodeURIComponent(dir)}`));
            if (!d) return;

            openDirs(d.folders || []);
            renameDirBtn.hidden = !dir;
            bulkBtn.hidden = checked.size === 0;
            bulkBtn.textContent = checked.size ? `批量删除（${checked.size}）` : '批量删除';

            grid.replaceChildren(...(d.items.length ? d.items.map(it => {
                const folder = it.key.split('/').slice(0, -1).join('/');
                const card = h('div', { class: 'media-card' + (checked.has(it.id) ? ' checked' : '') },
                    h('label', { class: 'media-pick' },
                        h('input', { type: 'checkbox', checked: checked.has(it.id), on: { change: e => {
                            if (e.target.checked) checked.add(it.id); else checked.delete(it.id);
                            card.classList.toggle('checked', e.target.checked);
                            bulkBtn.hidden = checked.size === 0;
                            bulkBtn.textContent = checked.size ? `批量删除（${checked.size}）` : '批量删除';
                        } } })),
                    h('img', { src: it.url, alt: it.name, loading: 'lazy', on: { click: () => window.open(it.url, '_blank') } }),
                    h('div', { class: 'info', title: it.key },
                        folder ? h('span', { class: 'tag' }, folder + '/') : null,
                        ` ${it.name} · ${fmtSize(it.size)}`),
                    h('div', { class: 'acts' },
                        onPick ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', on: { click: () => onPick([it]) } }, '选用') : null,
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => copy(it.url) } }, '链接'),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => copy(`![${it.name.replace(/\.[^.]+$/, '')}](${it.url})`) } }, 'Markdown'),
                        h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => {
                            const val = prompt('新的路径（可改文件夹与文件名，会改变 URL）', it.key.replace(/\.[^.]+$/, ''));
                            if (val === null) return;
                            const key = val.trim();
                            if (!key || key === it.key) return;
                            if (!confirm('路径改变后旧链接会失效，继续？')) return;
                            if (await run(() => api('PATCH', 'media/' + it.id, { key }), '已移动，URL 已更新')) load(page);
                        } } }, '改名/移动'),
                        h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: async () => {
                            if (!confirm('删除后，引用这张图的文章会失效。确定删除？')) return;
                            if (await run(() => api('DELETE', 'media/' + it.id), '已删除')) load(page);
                        } } }, '删除')));
                return card;
            }) : [h('p', { class: 'adm-empty' }, dir ? `「${dir}/」里还没有图片` : '还没有图片，点右下角上传，或把图片拖进来')]));

            const old = $('.adm-pager', wrapEl); if (old) old.remove();
            const pg = pager(d.total, d.per, page, load); if (pg) wrapEl.append(pg);
        }

        let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(1); }, 250); });
        fileIn.addEventListener('change', async e => { await uploadFiles(e.target.files, dir); e.target.value = ''; load(1); });

        wrapEl.addEventListener('dragover', e => { e.preventDefault(); wrapEl.classList.add('drop-on'); });
        wrapEl.addEventListener('dragleave', () => wrapEl.classList.remove('drop-on'));
        wrapEl.addEventListener('drop', async e => {
            e.preventDefault(); wrapEl.classList.remove('drop-on');
            const fs = [...e.dataTransfer.files].filter(x => x.type.startsWith('image/'));
            if (fs.length) { await uploadFiles(fs, dir); load(1); }
        });

        wrapEl.append(
            h('div', { class: 'media-toolbar' }, search, dirMenu, newDirBtn, renameDirBtn, bulkBtn),
            grid,
            h('div', { class: 'media-foot' }, h('label', { class: 'btn btn-primary media-upload' }, '上传图片', fileIn)));

        load(1);
        return wrapEl;
    }

    function pickMedia(cb, single) {
        let close;
        const el = mediaBrowser({ onPick: items => { close(); cb(items); }, single });
        close = modal('选择图片', el);
    }

    async function viewMedia(main) {
        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, '媒体库')),
            glass('adm-card', mediaBrowser({})),
            h('p', { class: 'adm-muted' }, '图片存放在 Cloudflare R2，通过自定义域名或 /media/… 访问（长期缓存）。支持 jpg / png / gif / webp / avif / svg，单张默认 ≤ 10 MB。'));
    }

    // ================================================================ 评论
    async function viewComments(main) {
        let page = 1, status = '', q = '';
        const sel = h('select', { on: { change: () => { status = sel.value; load(1); } } },
            [['', '全部'], ['0', '公开'], ['2', '待审核'], ['1', '已隐藏']].map(([v, l]) => h('option', { value: v }, l)));
        const search = h('input', { class: 'adm-search', placeholder: '搜索内容 / 昵称 / 邮箱' });
        let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(1); }, 250); });
        const list = h('div', { class: 'adm-list' }), pg = h('div');
        const checked = new Set();
        const bulk = async action => {
            if (!checked.size) return toast('先勾选评论', true);
            if (action === 'delete' && !confirm(`删除选中的 ${checked.size} 条评论（含其回复）？`)) return;
            if (await run(() => api('POST', 'comments/bulk', { ids: [...checked], action }), '已处理')) load(page);
        };
        const block = async (kind, value, label) => { if (value && confirm(`拉黑${label}：${value.slice(0, 40)}？`)) await run(() => api('POST', 'blocks', { kind, value }), '已加入黑名单'); };

        async function load(p) {
            page = p; checked.clear();
            const d = await run(() => api('GET', `comments?page=${p}&status=${status}&q=${encodeURIComponent(q)}`));
            if (!d) return;
            list.replaceChildren(...(d.items.length ? d.items.map(c => {
                const reply = h('textarea', { placeholder: '以站主身份回复…', hidden: true });
                const sendBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', hidden: true, on: { click: async () => {
                    if (await run(() => api('POST', `comments/${c.id}/reply`, { body: reply.value }), '已回复')) load(page);
                } } }, '发送回复');
                return h('div', { class: 'cm' },
                    h('input', { type: 'checkbox', 'aria-label': '选择', on: { change: e => e.target.checked ? checked.add(c.id) : checked.delete(c.id) } }),
                    h('div', null,
                        h('div', { class: 't' }, c.is_owner ? '站主' : c.name, ' ',
                            c.status === 2 ? h('span', { class: 'tag warn' }, '待审核') : c.status === 1 ? h('span', { class: 'tag bad' }, '已隐藏') : null,
                            c.parent_id ? h('span', { class: 'tag' }, '回复 @' + (c.reply_to || '')) : null),
                        h('div', { class: 'm adm-muted' }, h('a', { href: c.path, target: '_blank', rel: 'noopener' }, c.path), h('span', null, fmtTime(c.created_at)), c.email ? h('span', null, c.email) : null, c.ip_hash ? h('span', null, 'IP ' + c.ip_hash.slice(0, 8)) : null),
                        h('div', { class: 'body' }, c.body), reply,
                        h('div', { class: 'acts' },
                            c.status === 2 ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', on: { click: async () => { if (await run(() => api('PATCH', 'comments/' + c.id, { status: 0 }), '已通过')) load(page); } } }, '通过') : null,
                            h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => { reply.hidden = !reply.hidden; sendBtn.hidden = reply.hidden; reply.focus(); } } }, '回复'), sendBtn,
                            c.status !== 2 ? h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { if (await run(() => api('PATCH', 'comments/' + c.id, { status: c.status === 1 ? 0 : 1 }))) load(page); } } }, c.status === 1 ? '恢复显示' : '隐藏') : null,
                            h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: async () => { if (confirm('删除这条评论（含回复）？') && await run(() => api('DELETE', 'comments/' + c.id), '已删除')) load(page); } } }, '删除'),
                            !c.is_owner ? h('details', null, h('summary', { class: 'btn btn-sm' }, '拉黑'),
                                h('div', { class: 'acts', style: 'margin-top:6px' },
                                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => block('name', c.name, '昵称') } }, '昵称'),
                                    c.email ? h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => block('email', c.email, '邮箱') } }, '邮箱') : null,
                                    c.ip_hash ? h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => block('ip', c.ip_hash, 'IP') } }, 'IP') : null)) : null)));
            }) : [h('p', { class: 'adm-empty' }, '没有评论')]));
            pg.replaceChildren(...[pager(d.total, d.per, page, load)].filter(Boolean));
        }
        main.replaceChildren(
            h('div', { class: 'adm-top' }, h('h2', null, '评论'), h('div', { class: 'adm-row' }, sel, search)),
            glass('adm-card',
                h('div', { class: 'adm-row', style: 'margin-bottom:8px' }, h('span', { class: 'adm-muted' }, '批量：'),
                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => bulk('show') } }, '公开'),
                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => bulk('hide') } }, '隐藏'),
                    h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: () => bulk('delete') } }, '删除')),
                list, pg),
            h('p', { class: 'adm-muted' }, '开启「先审后发」：在 Cloudflare 里设置变量 COMMENT_MODERATION=1，游客评论会先进入“待审核”。'));
        load(1);
    }

    // ================================================================ 留言
    async function viewMessages(main) {
        let page = 1;
        const list = h('div', { class: 'adm-list' }), pg = h('div');
        async function load(p) {
            page = p;
            const d = await run(() => api('GET', 'messages?page=' + p)); if (!d) return;
            list.replaceChildren(...(d.items.length ? d.items.map(m => h('div', { class: 'adm-item' },
                h('div', null, h('div', { class: 't' }, m.subject || '（无主题）', ' ', m.mailed ? null : h('span', { class: 'tag warn' }, '未通知')),
                    h('div', { class: 'm' }, h('span', null, m.name), h('span', null, m.email), h('span', null, fmtTime(m.created_at))),
                    h('div', { class: 'cm body', style: 'display:block' }, m.body)),
                h('div', { class: 'adm-row' },
                    h('a', { class: 'btn btn-sm btn-primary', href: `mailto:${m.email}?subject=${encodeURIComponent('回复：' + (m.subject || '你的留言'))}` }, '回复'),
                    h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: async () => { if (confirm('删除这条留言？') && await run(() => api('DELETE', 'messages/' + m.id), '已删除')) load(page); } } }, '删除')))) : [h('p', { class: 'adm-empty' }, '没有留言')]));
            pg.replaceChildren(...[pager(d.total, d.per, page, load)].filter(Boolean));
        }
        main.replaceChildren(h('div', { class: 'adm-top' }, h('h2', null, '留言')), glass('adm-card', list, pg));
        load(1);
    }

    // ================================================================ 用户（管理员 / 评论者 / 黑名单）
    async function viewUsers(main) {
        const isAdmin = me.role === 'admin';
        const tabs = [...(isAdmin ? [['admins', '管理员账号']] : []), ['commenters', '评论者'], ['blocks', '黑名单']];
        let cur = tabs[0][0];
        const body = h('div', { class: 'adm-main' });
        const bar = h('div', { class: 'adm-tabs' });
        const drawTabs = () => bar.replaceChildren(...tabs.map(([k, l]) => h('button', { type: 'button', class: k === cur ? 'on' : '', on: { click: () => { cur = k; drawTabs(); panel(); } } }, l)));
        const panel = async () => { body.replaceChildren(h('p', { class: 'adm-boot' }, '加载中…')); await ({ admins: tabAdmins, commenters: tabCommenters, blocks: tabBlocks }[cur])(body).catch(e => body.replaceChildren(h('p', { class: 'adm-empty' }, e.message))); };
        main.replaceChildren(h('div', { class: 'adm-top' }, h('h2', null, '用户'), bar), body);
        drawTabs(); panel();
    }

    async function tabAdmins(body) {
        const d = await api('GET', 'users');
        const u = h('input', { placeholder: '用户名（3–32 位）' }), p = h('input', { type: 'password', placeholder: '密码（≥ 8 位）', autocomplete: 'new-password' });
        const r = h('select', null, h('option', { value: 'editor' }, '编辑（文章 / 媒体 / 评论）'), h('option', { value: 'admin' }, '管理员（含用户管理）'));
        const reload = () => viewUsers($('#view'));
        body.replaceChildren(
            glass('adm-card', h('h3', null, '添加账号'), h('div', { class: 'adm-form' }, field('用户名', u), field('密码', p), field('角色', r),
                h('button', { class: 'btn btn-primary', type: 'button', on: { click: async () => { if (await run(() => api('POST', 'users', { username: u.value.trim(), password: p.value, role: r.value }), '已添加')) reload(); } } }, '添加'))),
            glass('adm-card', h('h3', null, '账号'), h('div', { class: 'adm-list' }, d.items.map(a => h('div', { class: 'adm-item' },
                h('div', null, h('div', { class: 't' }, a.username, a.id === d.me ? ' （我）' : '', ' ', a.disabled ? h('span', { class: 'tag bad' }, '已停用') : null),
                    h('div', { class: 'm' }, h('span', { class: 'tag' }, a.role === 'admin' ? '管理员' : '编辑'), h('span', null, '上次登录 ' + fmtTime(a.last_login)))),
                h('div', { class: 'adm-row' },
                    a.id !== d.me ? h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { if (await run(() => api('PATCH', 'users/' + a.id, { role: a.role === 'admin' ? 'editor' : 'admin' }), '角色已更新')) reload(); } } }, a.role === 'admin' ? '降为编辑' : '升为管理员') : null,
                    a.id !== d.me ? h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { if (await run(() => api('PATCH', 'users/' + a.id, { disabled: !a.disabled }), a.disabled ? '已启用' : '已停用')) reload(); } } }, a.disabled ? '启用' : '停用') : null,
                    h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { const pw = prompt('输入新密码（≥ 8 位）；该账号的所有登录会失效'); if (pw && await run(() => api('PATCH', 'users/' + a.id, { password: pw }), '密码已重置')) reload(); } } }, '重置密码'),
                    a.id !== d.me ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', on: { click: async () => { if (confirm(`删除账号 ${a.username}？`) && await run(() => api('DELETE', 'users/' + a.id), '已删除')) reload(); } } }, '删除') : null))))));
    }

    async function tabCommenters(body) {
        const q = h('input', { class: 'adm-search', placeholder: '搜索昵称 / 邮箱' });
        const list = h('div', { class: 'adm-list' });
        async function load() {
            const d = await run(() => api('GET', 'commenters?q=' + encodeURIComponent(q.value.trim()))); if (!d) return;
            const btn = (it, kind, label, val) => it.blocked[kind] ? h('span', { class: 'tag bad' }, label + '已拉黑')
                : h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { if (await run(() => api('POST', 'blocks', { kind, value: val }), '已加入黑名单')) load(); } } }, '拉黑' + label);
            list.replaceChildren(...(d.items.length ? d.items.map(it => h('div', { class: 'adm-item' },
                h('div', null, h('div', { class: 't' }, it.name), h('div', { class: 'm' }, h('span', null, it.email || '未留邮箱'), h('span', null, it.ip_hash ? 'IP ' + it.ip_hash.slice(0, 8) : ''), h('span', null, `${it.n} 条评论`), h('span', null, '最近 ' + fmtTime(it.last_at)))),
                h('div', { class: 'adm-row' }, btn(it, 'name', '昵称', it.name.toLowerCase()), it.email ? btn(it, 'email', '邮箱', it.email.toLowerCase()) : null, it.ip_hash ? btn(it, 'ip', 'IP', it.ip_hash) : null))) : [h('p', { class: 'adm-empty' }, '还没有评论者')]));
        }
        let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
        body.replaceChildren(glass('adm-card', h('div', { class: 'adm-row', style: 'margin-bottom:8px' }, q), list)); load();
    }

    async function tabBlocks(body) {
        const kind = h('select', null, h('option', { value: 'name' }, '昵称'), h('option', { value: 'email' }, '邮箱'), h('option', { value: 'ip' }, 'IP 哈希'));
        const val = h('input', { placeholder: '要拉黑的值' }), note = h('input', { placeholder: '备注（选填）' });
        const list = h('div', { class: 'adm-list' });
        async function load() {
            const d = await run(() => api('GET', 'blocks')); if (!d) return;
            list.replaceChildren(...(d.items.length ? d.items.map(b => h('div', { class: 'adm-item' },
                h('div', null, h('div', { class: 't' }, h('span', { class: 'tag' }, { name: '昵称', email: '邮箱', ip: 'IP' }[b.kind]), ' ', b.kind === 'ip' ? b.value.slice(0, 12) + '…' : b.value),
                    h('div', { class: 'm' }, h('span', null, b.note || ''), h('span', null, fmtTime(b.created_at)))),
                h('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => { if (await run(() => api('DELETE', 'blocks/' + b.id), '已移除')) load(); } } }, '移除'))) : [h('p', { class: 'adm-empty' }, '黑名单为空')]));
        }
        body.replaceChildren(
            glass('adm-card', h('h3', null, '添加'), h('div', { class: 'adm-form' }, field('类型', kind), field('值', val), field('备注', note),
                h('button', { class: 'btn btn-primary', type: 'button', on: { click: async () => { if (await run(() => api('POST', 'blocks', { kind: kind.value, value: val.value, note: note.value }), '已加入')) { val.value = ''; load(); } } } }, '添加'))),
            glass('adm-card', h('h3', null, '黑名单'), list),
            h('p', { class: 'adm-muted' }, '命中的访客发评论会被拒绝；联系页留言会被静默丢弃。拉黑 IP 请从“评论者”页操作（存的是加盐哈希，不是真实 IP）。'));
        load();
    }

    // ================================================================ 启动
    async function boot() {
        try {
            const r = await api('GET', 'auth/me');
            if (r.user) { me = r.user; shell(); } else authScreen(r.needSetup);
        } catch (e) { app.replaceChildren(h('p', { class: 'adm-boot' }, '无法连接后台接口：' + e.message + '（本地预览请使用 tools/local_admin.mjs）')); }
    }
    boot();
})();