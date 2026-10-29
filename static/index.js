/* 首页：搜索 / 分类筛选 / 标签词云 / 分页（状态保存在 sessionStorage，从文章返回时可恢复） */
(() => {
    const $ = id => document.getElementById(id);
    const MOBILE_BP = 900;
    const isMobile = () => window.innerWidth <= MOBILE_BP;

    const postList = $('postList');
    const pagination = $('pagination');
    const tagCloud = $('tagCloud');
    const cloudPagination = $('cloudPagination');
    const searchInput = $('searchInput');
    const catList = $('catList');

    // ===== 状态 =====
    const allPostItems = Array.from(document.querySelectorAll('.post-item'));
    let filteredItems = allPostItems;
    let currentPage = 1, currentTag = '', currentSearch = '', currentCat = '';
    const KEY = 'index-state';

    const saveState = () => {
        try { sessionStorage.setItem(KEY, JSON.stringify({ p: currentPage, t: currentTag, s: currentSearch, c: currentCat })); } catch (e) {}
    };
    const loadState = () => {
        try {
            const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
            if (s) { currentPage = s.p || 1; currentTag = s.t || ''; currentSearch = s.s || ''; currentCat = s.c || ''; }
        } catch (e) {}
    };

    // ===== 词云数据：按字数从少到多，"全部"固定在最前 =====
    const tagsSet = new Set();
    allPostItems.forEach(item => {
        (item.dataset.tags || '').split(',').forEach(t => { t = t.trim(); if (t) tagsSet.add(t); });
    });
    const tagCountEl = $('tagCount');
    if (tagCountEl) tagCountEl.textContent = tagsSet.size;

    const allTags = ['全部', ...Array.from(tagsSet).sort((a, b) => {
        const d = [...a].length - [...b].length;
        return d !== 0 ? d : a.localeCompare(b, 'zh');
    })];

    // ===== 筛选（搜索范围：标题 + 分类 + 标签） =====
    function computeFiltered() {
        filteredItems = allPostItems.filter(li => {
            const tags = (li.dataset.tags || '').split(',');
            return (li.dataset.search || '').includes(currentSearch)
                && (!currentTag || tags.includes(currentTag))
                && (!currentCat || li.dataset.category === currentCat);
        });
    }

    // ===== 文章分页 =====
    function renderPagination() {
        postList.innerHTML = '';
        pagination.innerHTML = '';

        if (filteredItems.length === 0) {
            postList.innerHTML = '<li style="text-align:center;padding:40px;color:var(--secondary-text);grid-column:1/-1;">没有找到匹配的文章</li>';
            return;
        }

        const perPage = isMobile() ? 3 : 6;
        const totalPages = Math.ceil(filteredItems.length / perPage);
        currentPage = Math.min(Math.max(currentPage, 1), totalPages);

        const start = (currentPage - 1) * perPage;
        const frag = document.createDocumentFragment();
        filteredItems.slice(start, start + perPage).forEach(item => frag.appendChild(item));
        postList.appendChild(frag);

        if (totalPages > 1) {
            const btns = document.createDocumentFragment();
            for (let i = 1; i <= totalPages; i++) {
                const btn = document.createElement('button');
                btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
                btn.textContent = i;
                btn.setAttribute('aria-label', `第 ${i} 页`);
                if (i === currentPage) btn.setAttribute('aria-current', 'page');
                btn.onclick = () => {
                    currentPage = i;
                    renderPagination();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                };
                btns.appendChild(btn);
            }
            pagination.appendChild(btns);
        }
        saveState();
    }

    // ===== 词云分页：按卡片实际可用高度动态分页 =====
    let cloudPages = [];
    let currentCloudPage = 1;

    function makeTagEl(tag) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'tag-item' + (tag === (currentTag || '全部') ? ' active' : '');
        el.textContent = tag;
        el.onclick = () => filterByTag(tag);
        return el;
    }

    // 一次性写入全部标签 → 一次重排批量读位置 → 纯计算分页
    function buildCloudPages() {
        if (isMobile()) {                      // 移动端：不限高，每页 20 个
            cloudPages = [];
            for (let i = 0; i < allTags.length; i += 20) cloudPages.push(allTags.slice(i, i + 20));
            return;
        }

        cloudPagination.innerHTML = '<button class="cloud-page-btn">1</button>';  // 占位，使高度与最终一致
        tagCloud.innerHTML = '';

        const frag = document.createDocumentFragment();
        const els = allTags.map(tag => { const el = makeTagEl(tag); frag.appendChild(el); return el; });
        tagCloud.appendChild(frag);

        const cloudTop = tagCloud.getBoundingClientRect().top;
        const maxH = tagCloud.clientHeight;
        const rects = els.map(el => el.getBoundingClientRect());

        cloudPages = [];
        let cur = [];
        let pageTop = rects[0].top - cloudTop;
        allTags.forEach((tag, i) => {
            if (rects[i].bottom - cloudTop - pageTop > maxH && cur.length > 0) {
                cloudPages.push(cur);
                cur = [];
                pageTop = rects[i].top - cloudTop;   // 新一页从该行顶部开始
            }
            cur.push(tag);
        });
        if (cur.length) cloudPages.push(cur);
    }

    function renderCloud() {
        tagCloud.innerHTML = '';
        cloudPagination.innerHTML = '';

        const totalPages = cloudPages.length;
        currentCloudPage = Math.min(Math.max(currentCloudPage, 1), totalPages || 1);

        const frag = document.createDocumentFragment();
        (cloudPages[currentCloudPage - 1] || []).forEach(tag => frag.appendChild(makeTagEl(tag)));
        tagCloud.appendChild(frag);

        if (totalPages > 1) {
            const btns = document.createDocumentFragment();
            for (let i = 1; i <= totalPages; i++) {
                const btn = document.createElement('button');
                btn.className = 'cloud-page-btn' + (i === currentCloudPage ? ' active' : '');
                btn.textContent = i;
                btn.onclick = () => { currentCloudPage = i; renderCloud(); };
                btns.appendChild(btn);
            }
            cloudPagination.appendChild(btns);
        }
    }

    const rebuildCloud = () => { buildCloudPages(); renderCloud(); };

    // ===== 分类筛选 =====
    function renderCats() {
        if (!catList) return;
        catList.querySelectorAll('.cat-item').forEach(b => {
            const on = b.dataset.cat === currentCat;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    }
    function filterByCat(cat) {
        currentCat = currentCat === cat ? '' : cat;      // 再点一次取消
        applyFilters();
    }
    if (catList) {
        catList.addEventListener('click', e => {
            const b = e.target.closest('.cat-item');
            if (b) filterByCat(b.dataset.cat);
        });
    }

    // ===== 筛选联动 =====
    function applyFilters() {
        computeFiltered();
        currentPage = 1;
        renderPagination();
        renderCloud();      // 仅刷新选中状态，不重新分页
        renderCats();
    }

    function filterPosts() {
        currentSearch = searchInput.value.toLowerCase().trim();
        applyFilters();
    }

    function filterByTag(tag) {
        currentTag = tag === '全部' ? '' : tag;
        applyFilters();
    }

    let searchTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(filterPosts, 120);
    });
    const searchBtn = $('searchBtn');
    if (searchBtn) searchBtn.addEventListener('click', filterPosts);

    // ===== 初始化 =====
    loadState();
    const queryTag = new URLSearchParams(location.search).get('tag');   // 文章页点标签跳转：/?tag=xxx
    const queryCat = new URLSearchParams(location.search).get('cat');
    if (queryTag) { currentTag = queryTag; currentSearch = ''; currentCat = ''; currentPage = 1; }
    if (queryCat) { currentCat = queryCat; currentTag = ''; currentSearch = ''; currentPage = 1; }
    if (currentCat && !allPostItems.some(li => li.dataset.category === currentCat)) currentCat = '';
    if (currentTag && !tagsSet.has(currentTag)) currentTag = '';
    searchInput.value = currentSearch;
    computeFiltered();
    renderPagination();
    renderCats();
    rebuildCloud();
    // 字体加载完成后再校准一次（字体会影响标签宽度）
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuildCloud);

    // 只在宽度变化时重算（移动端地址栏高度变化不触发）
    let lastWidth = window.innerWidth, resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth === lastWidth) return;
            lastWidth = window.innerWidth;
            renderPagination();
            rebuildCloud();
        }, 200);
    });
})();