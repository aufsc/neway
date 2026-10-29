/**
 * 管理员认证：PBKDF2 密码哈希 + D1 会话 + HttpOnly Cookie。
 * CSRF：Cookie 为 SameSite=Strict，且所有写请求必须同源并带 X-Requested-With: nw。
 */
import { json, sha256, secretEquals, sameOrigin } from "./common.js";

const ITER = 100000; // Workers 的 PBKDF2 迭代上限
const COOKIE = "nw_sess";
const SESSION_MS = 7 * 86400000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map((x) => parseInt(x, 16)));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function hashPassword(pw, saltHex = hex(crypto.getRandomValues(new Uint8Array(16))), iter = ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${saltHex}$${hex(bits)}`;
}

export async function verifyPassword(pw, stored) {
  const [, iter, salt] = String(stored).split("$");
  if (!iter || !salt) return false;
  return secretEquals(await hashPassword(pw, salt, Number(iter)), stored);
}

export const validUsername = (u) => typeof u === "string" && /^[A-Za-z0-9_.-]{3,32}$/.test(u);
export const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 200;

export function cookieValue(request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : "";
}

export const sessionCookie = (token, request, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;

export async function createSession(db, adminId) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), adminId, now, now + SESSION_MS).run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  return token;
}

/** 返回当前登录的管理员 {id, username, role}，未登录或被停用返回 null */
export async function getAdmin(request, env) {
  const token = cookieValue(request);
  if (!token) return null;
  return await env.DB.prepare(
    `SELECT a.id, a.username, a.role FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.disabled = 0`
  ).bind(await sha256(token), Date.now()).first();
}

export const destroySessions = (db, adminId) => db.prepare("DELETE FROM sessions WHERE admin_id = ?").bind(adminId).run();

/** 写请求必须同源 + 自定义头 */
export function csrfOk(request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  return sameOrigin(request) && request.headers.get("x-requested-with") === "nw";
}

export async function readJson(request) {
  try { const v = await request.json(); return v && typeof v === "object" ? v : {}; } catch { throw new HttpError(400, "bad request"); }
}

export const ok = (data = {}) => json({ ok: true, ...data });
