/* ビルド済みの dist/ を GitHub Pages（gh-pages ブランチ）へ公開する。
   `npm run deploy` から呼ぶ。

   なぜ GitHub Actions ではなくローカルから上げるのか:
   gh コマンドのトークンに workflow 権限が無く、.github/workflows/ を push できないため。
   `gh auth refresh -h github.com -s workflow` を通せば Actions 方式へ移せる（README参照）。

   手順は「検査 → 公開用に組み直し → gh-pages へ強制 push」。
   検査（npm run check）で落ちたら公開しないので、壊れた版が生徒に届くことはない。 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BRANCH = "gh-pages";
/* 公開先がサブディレクトリなので、資材の参照先をここへ合わせる。
   置き場所を変えるときは README の公開URLとここを必ず一緒に直す。 */
const BASE = process.env.APP_BASE_PATH || "/civics-study-app/";

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: ROOT, ...options });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// 1. 既定のベース（/）で組んでテストする。
//    tests/app-smoke.test.ts は dist をサイト直下として読むため、
//    ベースパスを付けたままだと資材の参照が合わず落ちる。
console.log("\n▶ 検査（ビルド → テスト）");
run(npm, ["run", "check"]);

// 2. 検査を通ったので、公開先のパスへ合わせて組み直す。
console.log(`\n▶ 公開用ビルド（base=${BASE}）`);
run(npm, ["run", "build"], { env: { ...process.env, APP_BASE_PATH: BASE } });

// 3. dist だけを持つ使い捨てのリポジトリを作り、gh-pages を置き換える。
//    履歴は要らない（公開物は毎回まるごと入れ替わる）ので force push でよい。
const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT })
  .toString().trim();
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "civics-pages-"));
try {
  fs.cpSync(DIST, stage, { recursive: true });
  // GitHub Pages の Jekyll 処理を止める。これが無いと _ で始まる名前が配信されない。
  fs.writeFileSync(path.join(stage, ".nojekyll"), "");
  const git = (...args) => run("git", args, { cwd: stage });
  git("init", "-q", "-b", BRANCH);
  git("add", "-A");
  git("-c", "user.name=deploy", "-c", "user.email=deploy@localhost",
      "commit", "-q", "-m", `公開 ${new Date().toISOString()}`);
  console.log(`\n▶ ${BRANCH} へ push`);
  git("push", "-q", "--force", remote, `${BRANCH}:${BRANCH}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

console.log("\n✅ 公開しました。反映まで1〜3分かかります。");
console.log(`   https://9hckg4shj6-glitch.github.io${BASE}`);
