import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* このアプリは基礎医学演習アプリの画面をもとに作ったので、
   生化学の用語や医師のキャリアを使った文言が残りやすい。
   高校生が「公共，政治・経済」を解く画面に医学の言葉が出ると、
   それだけで別のアプリに見えてしまうため、残骸を機械的に見張る。

   dist/ を見るのは、実際に生徒の端末へ届くのが dist/ の中身だから。
   （`npm run build` を先に実行しておくこと） */

const DIST = path.resolve("dist");

/** 生徒の画面に絶対に出てはいけない、医学アプリ由来の語 */
const LEFTOVERS = [
  "ケトン体", "尿素回路", "フェロケラターゼ", "解糖系", "糖代謝",
  "研修医", "専攻医", "専門医", "指導医", "准教授",
  "基礎医学", "ウシガエル",
];

function distFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(html|js|css|webmanifest|csv)$/.test(name) && !name.endsWith(".map")) out.push(full);
    }
  };
  walk(DIST);
  return out;
}

describe("医学アプリ由来の文言が残っていないこと", () => {
  it("dist に配る成果物へ医学の語が混ざっていない", () => {
    expect(fs.existsSync(DIST), "先に npm run build を実行してください").toBe(true);
    const hits: string[] = [];
    for (const file of distFiles()) {
      const text = fs.readFileSync(file, "utf8");
      for (const word of LEFTOVERS) {
        if (text.includes(word)) hits.push(`${path.relative(DIST, file)}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("問題データを端末から差し替える口を持たない", () => {
    // 医学アプリにあったCSV/JSON取り込みは、
    // このアプリの出典・選択肢別解説を持たない問題を混ぜてしまうので外してある。
    const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    expect(html).not.toContain('id="importBtn"');
    expect(html).not.toContain("parseCSV");
    expect(fs.existsSync(path.join(DIST, "template.csv"))).toBe(false);
  });

  it("問題検索の案内が公共・政治経済の語になっている", () => {
    const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    expect(html).toContain("キーワード（例：国会、社会保障）");
  });

  it("アプリの表示言語が日本語として宣言されている", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
    expect(manifest.lang).toBe("ja");
  });
});
