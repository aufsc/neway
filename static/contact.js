/* 联系页：表单提交到 /api/contact（Pages Function → 邮件 + 机器人通知）
 * 失败时给出明确原因，并提供“改用邮件客户端”兜底。
 */
(() => {
    const form = document.getElementById('contactForm');
    if (!form) return;

    const btn = document.getElementById('sendBtn');
    const status = document.getElementById('formStatus');
    const fallbackMail = form.dataset.fallbackMail || '';
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const TIMEOUT = 10000;

    const val = name => (form.elements[name] ? form.elements[name].value.trim() : '');

    function say(msg, kind) {
        status.textContent = msg;
        status.dataset.kind = kind || '';
        status.hidden = !msg;
    }

    function mailtoHref() {
        const subject = val('subject') || '来自博客的留言';
        const body = `姓名：${val('name')}\n邮箱：${val('email')}\n\n${val('body')}`;
        return `mailto:${fallbackMail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    function offerFallback(msg) {
        say(msg, 'error');
        if (!fallbackMail) return;
        const a = document.createElement('a');
        a.href = mailtoHref();
        a.textContent = ' 改用邮件客户端发送';
        status.append(a);
    }

    const ERRORS = {
        'bad name': '请填写姓名（40 字以内）',
        'bad email': '请填写有效的邮箱，方便我回复你',
        'bad body': '请填写留言内容（3000 字以内）',
        'too fast': '发送太频繁，请一分钟后再试',
        'mail not configured': '站点还没有配置邮件服务',
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (val('website')) return;                       // 蜜罐被填：静默丢弃

        if (!val('name')) { form.elements.name.focus(); return say('请填写姓名', 'error'); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email'))) { form.elements.email.focus(); return say('请填写有效的邮箱', 'error'); }
        if (!val('body')) { form.elements.body.focus(); return say('请填写留言内容', 'error'); }

        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = '发送中…';
        say('');

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
        try {
            const r = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: val('name'), email: val('email'), subject: val('subject'),
                    body: val('body'), website: val('website'),
                }),
                signal: ctrl.signal,
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.ok) {
                form.reset();
                say('已发送，谢谢你的留言！', 'ok');
            } else if (r.status === 429 || r.status === 400) {
                say(ERRORS[data.error] || '内容不合法，请检查后重试', 'error');
            } else if (isLocal && r.status === 404) {
                offerFallback('本地静态预览没有 /api/contact，请用 python local_api.py 启动。');
            } else {
                offerFallback(ERRORS[data.error] || `发送失败（HTTP ${r.status}）。`);
            }
        } catch (err) {
            offerFallback(err && err.name === 'AbortError' ? '请求超时。' : '网络错误。');
        } finally {
            clearTimeout(timer);
            btn.disabled = false;
            btn.textContent = label;
        }
    });
})();
