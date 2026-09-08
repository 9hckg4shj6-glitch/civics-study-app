import fs from "node:fs";
import { createEmptyCard, fsrs } from "ts-fsrs";
import http from "node:http";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findShownQuestion } from "./shown-question";

/* 同じ問題を解いた回数の記録（基礎医学演習アプリから移植）を、
   ビルド済みアプリ（dist）を実際に読み込んで確かめる。

   解くたびに progress[問題ID].history へ「解いた時刻と正誤」を積み、
   解説と一覧には「何回目をいつ解いたか」を出す。履歴は直近5回だけ残す。 */

const DIST = path.resolve("dist");
const PROGRESS_KEY = "civicsProgress_v1";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".csv": "text/csv",
};

let server: http.Server;
let origin = "";
const open: JSDOM[] = [];

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

/** アプリを1回起動する。storage を渡すと「その記録を持つ端末で開いた」ことになる。 */
async function boot(storage?: Record<string, string>): Promise<any> {
  const html = await (await fetch(`${origin}/index.html`)).text();
  const dom = new JSDOM(html, {
    url: `${origin}/index.html`,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      (window as any).STUDY_CORE = { ready: true, scheduleReview: (r: any, rating: any) => {
        const card = fsrs().next(createEmptyCard(), new Date(), rating).card;
        r.fsrs = { due: card.due.toISOString() }; r.reps = card.reps;
        return r;
      } };
      if (storage) for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
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
  open.push(dom);
  const win: any = dom.window;
  for (let i = 0; i < 200 && !(win.document.getElementById("hubGrid")?.children.length); i += 1) await tick(25);
  return win;
}

function click(win: any, selector: string): void {
  const el = win.document.querySelector(selector);
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  el.click();
}

function hub(win: any, name: string): any {
  const el = [...win.document.querySelectorAll("#hubGrid .hubBtn")]
    .find((b: any) => b.querySelector(".hubName")?.textContent === name);
  if (!el) throw new Error(`ホームに「${name}」のタイルがありません`);
  return el;
}

/** テーマ別の先頭の項目を1問ずつ採点する形で開き、出ている問題に正解する。 */
async function answerFirstQuestion(win: any): Promise<any> {
  hub(win, "問題演習").click();
  await tick(250);
  if (win.document.getElementById("fieldList")!.classList.contains("hidden")) {
    click(win, '.sectToggle[data-toggle="fieldList"]');
    await tick(120);
  }
  click(win, "#fieldList .cat");
  await tick(250);
  click(win, "#themeFieldList .cat");
  await tick(250);
  if (!win.document.getElementById("countModal")!.classList.contains("hidden")) {
    click(win, '#countChips .countChip[data-n="all"]');
    click(win, "#countStart");
  }
  await tick(450);

  const q = findShownQuestion(win);
  expect(q, "出題中の問題を特定できません").toBeTruthy();
  (win.document.querySelectorAll("#qBlocks .choice")[q.answer] as any).click();
  await tick(250);
  return q;
}

let quizData: any[] = [];

beforeAll(async () => { await start(); }, 30_000);
afterAll(() => { open.forEach((d) => d.window.close()); server?.close(); });

describe("同じ問題を解いた回数", () => {
  it("初めて解くと「1回目」と日付・正誤が解説に出て、記録にも残る", async () => {
    const win = await boot();
    quizData = win.QUIZ_DATA;
    const q = await answerFirstQuestion(win);

    const log = win.document.querySelector("#qBlocks .attemptLog")!;
    expect(log, "解説に解答履歴が出ていない").toBeTruthy();
    const today = new Date();
    expect(log.textContent).toContain(`1回目 ${today.getMonth() + 1}/${today.getDate()} ⭕`);

    const record = JSON.parse(win.localStorage.getItem(PROGRESS_KEY) || "{}")[q.id];
    expect(record.seen).toBe(1);
    expect(record.history).toHaveLength(1);
    expect(record.history[0].c).toBe(1);
    expect(typeof record.history[0].t).toBe("number");
  }, 30_000);

  it("解き直すと通算の回数で数え、履歴は直近5回だけ残す", async () => {
    // すでに5回解いた端末を作る（過去5日ぶん）。範囲のどの問題が出ても同じ条件になるよう全問に入れる
    const day = 86400;
    const oldest = Math.floor(Date.now() / 1000) - 5 * day;
    const seeded: Record<string, unknown> = {};
    for (const q of quizData) {
      seeded[q.id] = {
        seen: 5, correct: 5, wrong: 0, streak: 5, weak: false, bookmarked: false,
        history: [0, 1, 2, 3, 4].map((i) => ({ t: oldest + i * day, c: 1 })),
      };
    }

    const win = await boot({ [PROGRESS_KEY]: JSON.stringify(seeded) });
    const q = await answerFirstQuestion(win);

    const log = win.document.querySelector("#qBlocks .attemptLog")!.textContent!;
    const today = new Date();
    expect(log).toContain(`6回目 ${today.getMonth() + 1}/${today.getDate()} ⭕`);
    expect(log).not.toContain("1回目"); // 6回目まで数えたうえで、表示は直近5回ぶん

    const record = JSON.parse(win.localStorage.getItem(PROGRESS_KEY) || "{}")[q.id];
    expect(record.seen).toBe(6);
    expect(record.history).toHaveLength(5);          // 直近5回だけ残す
    expect(record.history[0].t).toBe(oldest + day);  // いちばん古い1件は捨てる
  }, 40_000);
});
