/**
 * 通知：邮件（Resend）+ 机器人（Telegram / Server酱 / 通用 Webhook）。
 * 所有渠道都是“配了才发”，互相独立；任何一个失败都不会影响接口返回。
 *
 * 环境变量（均在 Cloudflare Pages → Settings → Variables and Secrets 配置）：
 *   邮件   RESEND_API_KEY(secret)  MAIL_FROM  NOTIFY_EMAIL
 *   TG     TG_BOT_TOKEN(secret)    TG_CHAT_ID
 *   Server酱 SERVERCHAN_KEY(secret)
 *   Webhook WEBHOOK_URL(secret)    WEBHOOK_TYPE = wecom | feishu | dingtalk | discord | json
 */
import { escapeHtml } from "./common.js";

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** 通过 Resend 发信。返回 true/false，不抛异常。 */
export async function sendMail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return false;
  try {
    const r = await post(
      "https://api.resend.com/emails",
      { from: env.MAIL_FROM, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) },
      { authorization: `Bearer ${env.RESEND_API_KEY}` }
    );
    return r.ok;
  } catch (e) {
    return false;
  }
}

/** 机器人群发：每个已配置的渠道各发一条纯文本。返回成功的渠道名数组。 */
export async function sendBots(env, { title, text, url }) {
  const jobs = [];
  const full = url ? `${text}\n${url}` : text;

  if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
    jobs.push(["telegram", post(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: env.TG_CHAT_ID, text: `${title}\n\n${full}`, disable_web_page_preview: true,
    })]);
  }
  if (env.SERVERCHAN_KEY) {
    jobs.push(["serverchan", fetch(`https://sctapi.ftqq.com/${env.SERVERCHAN_KEY}.send`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title, desp: full }),
    })]);
  }
  if (env.WEBHOOK_URL) {
    const msg = `${title}\n${full}`;
    const bodies = {
      wecom: { msgtype: "text", text: { content: msg } },
      feishu: { msg_type: "text", content: { text: msg } },
      dingtalk: { msgtype: "text", text: { content: msg } },
      discord: { content: msg.slice(0, 1900) },
      json: { title, text, url },
    };
    jobs.push(["webhook", post(env.WEBHOOK_URL, bodies[env.WEBHOOK_TYPE] || bodies.json)]);
  }

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  return jobs.filter((_, i) => settled[i].status === "fulfilled" && settled[i].value.ok).map(([n]) => n);
}

const wrap = (inner) =>
  `<div style="font:15px/1.7 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1b2340;max-width:560px">${inner}</div>`;
const quote = (s) =>
  `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #4f6bff;background:#f2f5fc;white-space:pre-wrap">${escapeHtml(s)}</blockquote>`;

/** 新评论 → 站主（邮件 + 机器人）；若是回复且对方留了邮箱 → 通知被回复者 */
export async function notifyComment(env, origin, c, parent) {
  const link = `${origin}${c.path}#comments`;
  const where = c.path === "/" ? "首页" : c.path;
  const who = c.replyTo ? `${c.name} 回复了 @${c.replyTo}` : `${c.name} 发表了评论`;
  const tasks = [];

  if (!c.isOwner) {
    tasks.push(sendBots(env, { title: `💬 ${c.pending ? "新评论（待审核）" : "新评论"}：${where}`, text: `${who}\n\n${c.body.slice(0, 500)}`, url: link }));
    tasks.push(sendMail(env, {
      to: env.NOTIFY_EMAIL,
      subject: `[${env.SITE_NAME || "博客"}] ${c.pending ? "待审核评论" : "新评论"}：${where}`,
      html: wrap(`<p><b>${escapeHtml(who)}</b>${c.email ? `（${escapeHtml(c.email)}）` : ""}</p>${quote(c.body)}<p><a href="${link}">在页面中查看并回复</a></p>`),
      text: `${who}\n\n${c.body}\n\n${link}`,
      replyTo: c.email || undefined,
    }));
  }

  // 回复通知：被回复者留了邮箱，且不是自己回复自己，且开启了 REPLY_NOTIFY
  if (env.REPLY_NOTIFY !== "0" && parent && parent.email && parent.email !== c.email) {
    tasks.push(sendMail(env, {
      to: parent.email,
      subject: `[${env.SITE_NAME || "博客"}] 你的评论有了新回复`,
      html: wrap(`<p>${escapeHtml(c.isOwner ? env.OWNER_NAME || "站长" : c.name)} 回复了你的评论：</p>${quote(c.body)}<p><a href="${link}">去看看</a></p>`),
      text: `${c.name} 回复了你的评论：\n\n${c.body}\n\n${link}`,
    }));
  }
  await Promise.allSettled(tasks);
}

/** 联系页留言 → 邮件（回复地址为访客邮箱）+ 机器人。返回 { mailed, bots } */
export async function notifyMessage(env, m) {
  const subject = m.subject || "来自博客的留言";
  const [mailed, bots] = await Promise.all([
    sendMail(env, {
      to: env.CONTACT_TO || env.NOTIFY_EMAIL,
      subject: `[留言] ${subject}`,
      html: wrap(`<p><b>${escapeHtml(m.name)}</b> &lt;${escapeHtml(m.email)}&gt;</p>${quote(m.body)}<p style="color:#5d6786;font-size:13px">直接回复这封邮件即可联系对方。</p>`),
      text: `${m.name} <${m.email}>\n\n${m.body}`,
      replyTo: m.email,
    }),
    sendBots(env, { title: `✉️ 新留言：${subject}`, text: `${m.name} <${m.email}>\n\n${m.body.slice(0, 600)}` }),
  ]);
  return { mailed, bots };
}
