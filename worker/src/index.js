/**
 * 同期コード方式の中継サーバー（Cloudflare Worker）。
 *
 * ここが預かるのは「部屋ID」と「暗号文」だけで、学習記録の中身も同期コードも届かない。
 * 部屋IDは同期コードのSHA-256、復号鍵も同期コードから作るので、
 * このサーバーの管理者（＝あなた）でも保存されている記録は読めない。
 *
 *   GET    /v1/rooms/:roomId  → { rev, updatedAt, blob }（無ければ 404）
 *   PUT    /v1/rooms/:roomId  → { rev, updatedAt }
 *          If-Match: <rev>  直前に読んだ版。食い違えば 412（＝別端末が先に書いた）
 *          If-Match: *      まだ誰も書いていないときだけ通す
 *   DELETE /v1/rooms/:roomId  → 204
 *   GET    /health            → { ok: true }
 *
 * 部屋は最後に書いてから400日で自動的に消える（書くたびに延びる）。
 */

const MAX_BLOB_BYTES = 4 * 1024 * 1024;   // 学習記録は圧縮後で数十KB。桁違いの物だけ弾く
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 400;
const ROOM_ID = /^[0-9a-f]{32}$/;

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowList = (env.ALLOWED_ORIGINS || "*").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowList.includes("*")) return origin || "*";
  return allowList.includes(origin) ? origin : "";
}

function headers(origin) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-Match",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
    if (!origin) return json({ error: "この配信元からは利用できません" }, 403, "");

    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true }, 200, origin);

    const match = url.pathname.match(/^\/v1\/rooms\/([^/]+)$/);
    if (!match) return json({ error: "見つかりません" }, 404, origin);
    const roomId = match[1];
    if (!ROOM_ID.test(roomId)) return json({ error: "部屋IDの形式が正しくありません" }, 400, origin);
    if (!env.SYNC_ROOMS) return json({ error: "KVが設定されていません" }, 500, origin);

    if (request.method === "GET") {
      const { value, metadata } = await env.SYNC_ROOMS.getWithMetadata(roomId, { type: "text" });
      if (value == null) return json({ error: "まだ何も保存されていません" }, 404, origin);
      return json({ rev: (metadata && metadata.rev) || null, updatedAt: (metadata && metadata.updatedAt) || null, blob: value }, 200, origin);
    }

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "本文が読めません" }, 400, origin);
      }
      const blob = body && typeof body.blob === "string" ? body.blob : null;
      if (!blob) return json({ error: "blob がありません" }, 400, origin);
      if (blob.length > MAX_BLOB_BYTES) return json({ error: "データが大きすぎます" }, 413, origin);

      const expected = request.headers.get("If-Match");
      const current = await env.SYNC_ROOMS.getWithMetadata(roomId, { type: "text" });
      const currentRev = current.value == null ? null : ((current.metadata && current.metadata.rev) || null);
      // 「読んだときの版」と食い違うなら、別端末が先に書いている。統合し直してもらう
      if (expected === "*" ? currentRev != null : expected && expected !== currentRev) {
        return json({ error: "ほかの端末が先に更新しました", rev: currentRev }, 412, origin);
      }

      const rev = crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      await env.SYNC_ROOMS.put(roomId, blob, { metadata: { rev, updatedAt }, expirationTtl: ROOM_TTL_SECONDS });
      return json({ rev, updatedAt }, 200, origin);
    }

    if (request.method === "DELETE") {
      await env.SYNC_ROOMS.delete(roomId);
      return new Response(null, { status: 204, headers: headers(origin) });
    }

    return json({ error: "この操作には対応していません" }, 405, origin);
  },
};
