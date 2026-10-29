/**
 * 通过 GitHub Contents API 读写 posts/*.md。每次保存 = 一次 commit，Pages 监听仓库自动重建。
 * 环境变量：GITHUB_TOKEN(secret, 细粒度，仅该仓库 Contents 读写)  GITHUB_REPO=owner/name  GITHUB_BRANCH=main  POSTS_DIR=posts
 */
import { HttpError } from "./auth.js";

const API = "https://api.github.com";
export const NAME_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,120}\.md$/;

export function checkName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name) || name.startsWith(".") || name.includes("..")) throw new HttpError(400, "bad file name");
  return name;
}

function cfg(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new HttpError(503, "未配置 GITHUB_TOKEN / GITHUB_REPO");
  return { repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || "main", dir: (env.POSTS_DIR || "posts").replace(/^\/+|\/+$/g, "") };
}

async function gh(env, path, init = {}) {
  const r = await fetch(`${API}/repos/${cfg(env).repo}${path ? "/" + path : ""}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "new-way-admin", "content-type": "application/json",
    },
  });
  if (r.status === 404) throw new HttpError(404, "not found");
  if (r.status === 409 || r.status === 422) throw new HttpError(409, "文件已被别处修改，请重新载入后再保存");
  if (!r.ok) throw new HttpError(502, `GitHub ${r.status}`);
  return r.json();
}

export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const pathOf = (env, name) => `${cfg(env).dir}/${encodeURIComponent(name)}`;

export async function listPosts(env) {
  const { dir, branch } = cfg(env);
  let items;
  try {
    items = await gh(env, `contents/${dir}?ref=${encodeURIComponent(branch)}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    // 404 有两种可能：posts 目录还不存在（正常，返回空列表）／仓库名、分支名错或 Token 无权访问（要明确报错）
    try { await gh(env, ""); } catch (e2) {
      if (e2.status === 404) throw new HttpError(404, "找不到仓库：请检查 GITHUB_REPO 是否为「用户名/仓库名」，以及 Token 是否授权了该仓库");
      throw e2;
    }
    try { await gh(env, `branches/${encodeURIComponent(branch)}`); } catch (e3) {
      if (e3.status === 404) throw new HttpError(404, `仓库里没有分支 ${branch}：请检查 GITHUB_BRANCH`);
      throw e3;
    }
    return [];
  }
  return items.filter((f) => f.type === "file" && f.name.endsWith(".md")).map((f) => ({ name: f.name, sha: f.sha, size: f.size }));
}

export async function getPost(env, name) {
  const f = await gh(env, `contents/${pathOf(env, checkName(name))}?ref=${encodeURIComponent(cfg(env).branch)}`);
  return { name, sha: f.sha, content: b64decode(f.content || "") };
}

export async function putPost(env, name, text, sha, message) {
  const r = await gh(env, `contents/${pathOf(env, checkName(name))}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64encode(text), branch: cfg(env).branch, ...(sha ? { sha } : {}) }),
  });
  return { sha: r.content.sha, commit: r.commit && r.commit.html_url };
}

export async function deletePost(env, name, sha, message) {
  const r = await gh(env, `contents/${pathOf(env, checkName(name))}`, {
    method: "DELETE", body: JSON.stringify({ message, sha, branch: cfg(env).branch }),
  });
  return { commit: r.commit && r.commit.html_url };
}

/** 解析文章头部（与 build.py 的 parse_post 一致：前 6 行为头部） */
export function parseHeader(text) {
  const L = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const g = (i) => (L[i] || "").trim();
  const strip = (s) => s.replace(/^#+\s*/, "").trim();
  let cover = g(1).replace(/^cover\s*[:：]\s*/i, "").trim();
  const m = cover.match(/^!\[.*?\]\((.*?)\)/);
  if (m) cover = m[1].trim();
  return { title: strip(g(0)), cover, date: g(2), category: g(3), tags: g(4) };
}
