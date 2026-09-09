import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enterSubject } from "./enter-subject";

/* 科目えらび画面と、2科目め（化学）のホームをビルド済みアプリで確かめる。
   仕様: docs/化学科目_実装計画.md §6
   - 科目が2つ以上あると、起動直後に科目えらび画面が出る
   - 選んだ科目のデータだけを後から読み込む（起動時に全科目を読まない）
   - 出典名・分野の並び・演習範囲の枠は、選んだ科目の設定で切り替わる */

const DIST = path.resolve("dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

let server: http.Server;
let origin = "";
const opened: JSDOM[] = [];

function start(): Promise<void> {
  server = http.createServer((req, res) => {
    const file = path.join(DIST, decodeURIComponent((req.url || "/").split("?")[0]));
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
    if (!target.startsWith(DIST) || !fs.existsSync(target)) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", TYPES[path.extname(target)] ?? "application/octet-stream");
    res.end(fs.readFileSync(target));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
    resolve();
  }));
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(): Promise<any> {
  const html = await (await fetch(`${origin}/index.html`)).text();
  const dom = new JSDOM(html, {
    url: `${origin}/index.html`,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      (window as any).STUDY_CORE = { ready: true, scheduleReview: (r: any) => r };
      (window as any).matchMedia = (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      (window as any).scrollTo = () => {};
      (window as any).Element.prototype.scrollIntoView = () => {};
      (window as any).confirm = () => true;
      (window as any).alert = () => {};
      (window as any).navigator.serviceWorker = undefined;
    },
  });
  opened.push(dom);
  const win: any = dom.window;
  for (let i = 0; i < 200 && !win.document.querySelector("#spGrid .spCard"); i += 1) await tick(25);
  return win;
}

function labels(win: any, id: string): string[] {
  return [...win.document.querySelectorAll(`#${id} .cat h3`)].map((e: any) => e.textContent);
}

beforeAll(async () => { await start(); }, 30_000);
afterAll(() => { opened.forEach((d) => d.window.close()); server?.close(); });

describe("科目えらび画面", () => {
  it("起動直後に出て、公共政経と化学のタイルが並ぶ", async () => {
    const win = await boot();
    expect(win.document.getElementById("subjectPicker")!.classList.contains("hidden")).toBe(false);
    const tiles = [...win.document.querySelectorAll("#spGrid .spCard")] as any[];
    expect(tiles.map((t) => t.dataset.subject)).toEqual(["civics", "chemistry"]);
    // タイルを開く前は、その科目の問題データをまだ読み込んでいない
    expect(win.QUIZ_DATA ?? []).toHaveLength(0);
  }, 30_000);

  it("化学を選ぶと化学の問題だけを読み込み、ホームの見出しも化学になる", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry");
    const chemistry = win.SUBJECTS.find((s: any) => s.id === "chemistry");
    expect(win.QUIZ_DATA).toHaveLength(chemistry.expectQuestions);
    expect(win.QUIZ_DATA.every((q: any) => String(q.id).startsWith("chem-"))).toBe(true);
    expect(win.document.getElementById("appTitle")!.textContent).toBe("化学");
    expect(win.document.getElementById("home")!.classList.contains("hidden")).toBe(false);
  }, 30_000);
});

describe("化学の演習範囲", () => {
  it("分野・出典・問い方が化学の設定どおりに並ぶ", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry");
    const hub = [...win.document.querySelectorAll("#hubGrid .hubBtn")]
      .find((b: any) => b.querySelector(".hubName")?.textContent === "問題演習") as any;
    hub.click();
    await tick(250);

    expect(labels(win, "domainList")).toEqual(["理論化学", "無機化学", "有機化学", "高分子化合物"]);
    expect(labels(win, "sourceList")).toEqual(["自作の補強問題"]);
    // 化学だけの枠。問い方（正しいもの／誤っているもの／正誤の組合せ）から選べる
    expect(win.document.getElementById("askSection")!.classList.contains("hidden")).toBe(false);
    expect(labels(win, "askList")).toEqual([
      "正しいものを選ぶ問題",
      "誤っているものを選ぶ問題",
      "正誤の組合せ問題",
    ]);
    // 枠の説明文も科目の大分野から作る
    const hint = win.document.querySelector('.sectToggle[data-toggle="domainList"] .stHint')!.textContent;
    expect(hint).toBe("理論化学・無機化学・有機化学・高分子化合物から選ぶ");
  }, 30_000);
});
