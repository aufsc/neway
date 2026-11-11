import * as comment from "../functions/api/comment.js";
import * as contact from "../functions/api/contact.js";
import * as hit from "../functions/api/hit.js";
import * as admin from "../functions/api/admin/[[path]].js";
import * as media from "../functions/media/[[key]].js";

const ROUTES = [
  { hit: (p) => p === "/api/comment" || p === "/api/comment/", mod: comment, params: () => ({}) },
  { hit: (p) => p === "/api/contact" || p === "/api/contact/", mod: contact, params: () => ({}) },
  { hit: (p) => p === "/api/hit" || p === "/api/hit/", mod: hit, params: () => ({}) },
  {
    hit: (p) => p === "/api/admin" || p.startsWith("/api/admin/"),
    mod: admin,
    params: (p) => ({ path: p.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean).map(decodeURIComponent) }),
  },
  {
    hit: (p) => p.startsWith("/media/"),
    mod: media,
    params: (p) => ({ key: p.replace(/^\/media\//, "").split("/").map(decodeURIComponent) }),
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.hit(url.pathname));

    if (!route) return env.ASSETS.fetch(request);

    try {
      return await route.mod.onRequest({
        request,
        env,
        params: route.params(url.pathname),
        waitUntil: (p) => ctx.waitUntil(p),
        next: () => env.ASSETS.fetch(request),
      });
    } catch (e) {
      console.error("[worker]", e && e.stack ? e.stack : e);
      return new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  },
};
