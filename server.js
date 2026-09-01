import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "dist");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const APP_USER = process.env.APP_USER || "quiz";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".map": "application/json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", ...headers });
  res.end(body);
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    return decoded === `${APP_USER}:${APP_PASSWORD}`;
  } catch { return false; }
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flatMap((items) => (items || [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}/`));
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    send(res, 401, "Authentication required\n", { "WWW-Authenticate": 'Basic realm="Study App"', "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { send(res, 400, "Bad request\n"); return; }
  if (pathname === "/health") { send(res, 200, '{"ok":true}\n', { "Content-Type": "application/json" }); return; }
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== path.join(ROOT, "index.html")) { send(res, 404, "Not found\n"); return; }
  try {
    let data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
    send(res, 200, data, { "Content-Type": MIME[extension] || "application/octet-stream", "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  } catch (error) {
    if (error && error.code === "ENOENT" && !path.extname(requested)) {
      filePath = path.join(ROOT, "index.html");
      try { send(res, 200, await fs.readFile(filePath), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" }); return; } catch {}
    }
    send(res, error && error.code === "ENOENT" ? 404 : 500, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
  }
});

fs.access(ROOT).then(() => server.listen(PORT, HOST, () => {
  console.log("公共・政治経済 演習アプリを同じLAN内に配信しています。");
  console.log(`このパソコン: http://localhost:${PORT}/`);
  localAddresses().forEach((url) => console.log(`同じWi-Fi/LAN: ${url}`));
  console.log(APP_PASSWORD ? `簡易認証: ${APP_USER} / APP_PASSWORDの値` : "簡易認証: 無効");
  console.log("終了: Control + C");
})).catch(() => {
  console.error("dist がありません。先に npm run build を実行してください。");
  process.exitCode = 1;
});
