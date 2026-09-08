import fs from "node:fs";
import { createEmptyCard, fsrs } from "ts-fsrs";
import http from "node:http";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* 演習中に画面がホームへ戻らないこと、中断しても回答が消えないことを、
   ビルド済みアプリ（dist）を実際に読み込んで確かめる。

   利用者からの不具合報告:
   「復習で問題を選んで解いていると、突然ホーム画面に戻され、解いたデータも残らない」
   原因は (1) 同期・カード取り込みからの再描画依頼が renderHome() を呼んでいたこと、
   (2) Service Worker の自動更新が演習中でもページを再読み込みしていたこと。
   ここでは (1) をそのまま再現し、あわせて「読み込み直しても続きへ戻る」ことを見る。 */

const DIST = path.resolve("dist");
const SESSION_KEY = "civicsSession_v1";
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

/** アプリを1回起動する。storage を渡すと「その状態から読み込み直した」ことになる。 */
async function boot(storage?: Record<string, string>): Promise<any> {
  const html = await (await fetch(`${origin}/index.html`)).text();
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: `${origin}/index.html`,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // ES モジュール（src/main.ts）は jsdom が実行しないので、使う窓口だけ用意する
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

function visibleScreen(win: any): string {
  const ids = ["home", "quiz", "result", "search", "browse", "qbrowse", "flash", "subjectPicker"];
  return ids.find((id) => win.document.getElementById(id) && !win.document.getElementById(id)!.classList.contains("hidden")) ?? "";
}

function hub(win: any, name: string): any {
  const el = [...win.document.querySelectorAll("#hubGrid .hubBtn")]
    .find((b: any) => b.querySelector(".hubName")?.textContent === name);
  if (!el) throw new Error(`ホームに「${name}」のタイルがありません`);
  return el;
}

function click(win: any, selector: string): void {
  const el = win.document.querySelector(selector);
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  el.click();
}

/** テーマ別の先頭の項目を「まとめて採点」で開始する（採点前の回答＝消えると困る状態を作る） */
async function startBatchQuiz(win: any): Promise<void> {
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
  expect(win.document.getElementById("countModal")!.classList.contains("hidden")).toBe(false);
  click(win, "#gradingBatch");
  click(win, '#countChips .countChip[data-n="all"]');
  click(win, "#countStart");
  await tick(450);
  expect(visibleScreen(win)).toBe("quiz");
}

function snapshot(win: any): any {
  const raw = win.localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeAll(async () => { await start(); }, 30_000);
afterAll(() => { open.forEach((d) => d.window.close()); server?.close(); });

describe("演習中に画面をホームへ戻さない", () => {
  it("同期などからの再描画依頼（__legacyAppRefresh）が来ても演習画面のまま", async () => {
    const win = await boot();
    await startBatchQuiz(win);

    // 端末間同期のあとに呼ばれる窓口。以前はここが renderHome() を呼び、演習が中断されていた。
    win.__legacyAppRefresh();
    await tick(250);
    expect(visibleScreen(win)).toBe("quiz");

    // 自動更新（Service Worker）も、演習中は再読み込みを待たされる
    expect(win.__studyBusy()).toBe(true);
  });
});

describe("中断しても回答が消えない", () => {
  it("まとめて採点の途中で読み込み直しても、選んだ回答ごと演習へ戻る", async () => {
    const first = await boot();
    await startBatchQuiz(first);

    // 1問目の2番目の選択肢を選ぶ（まとめて採点なので、この時点では採点も記録もされない）
    const choices = first.document.querySelectorAll("#qBlocks .choice");
    expect(choices.length).toBeGreaterThan(1);
    (choices[1] as any).click();
    await tick(150);

    const saved = snapshot(first);
    expect(saved, "回答した時点で控えが保存されていない").toBeTruthy();
    expect(saved.batch).toBe(true);
    expect(saved.active).toBe(true);
    expect(saved.entries[0].picks).toEqual([1]);
    const pickedText = (choices[1] as any).textContent;

    // 端末に残っている内容ごと、アプリを読み込み直す（自動更新・メモリ解放と同じ状況）
    const carried: Record<string, string> = {};
    for (let i = 0; i < first.localStorage.length; i += 1) {
      const key = first.localStorage.key(i)!;
      carried[key] = first.localStorage.getItem(key)!;
    }

    const second = await boot(carried);
    await tick(500);
    expect(visibleScreen(second), "読み込み直したあと演習へ戻っていない").toBe("quiz");
    // 回答した問題は控えに残ったまま、続きの（未回答の）問題から再開する
    expect(snapshot(second).entries[0].picks).toEqual([1]);
    expect(second.document.getElementById("counter")!.textContent).toMatch(/^2 \//);

    // 前の問題へ戻ると、中断前に選んでいた選択肢がそのまま選ばれている
    click(second, "#prevBtn");
    await tick(250);
    const restored = second.document.querySelectorAll("#qBlocks .choice");
    const selected = [...restored].filter((b: any) => b.className.includes("selected"));
    expect(selected).toHaveLength(1);
    expect((selected[0] as any).textContent).toBe(pickedText);
  });

  it("自分でホームへ戻ったときは、ホームに「中断した演習」の案内が出る", async () => {
    const win = await boot();
    await startBatchQuiz(win);
    (win.document.querySelectorAll("#qBlocks .choice")[0] as any).click();
    await tick(150);

    // 主要ナビの「ホーム」で自分から離れる（勝手に戻されたのではない）
    click(win, '#primaryNav [data-primary="home"]');
    await tick(300);
    expect(visibleScreen(win)).toBe("home");
    expect(win.document.getElementById("resumeSection")!.classList.contains("hidden")).toBe(false);
    expect(win.document.getElementById("resumeSub")!.textContent).toContain("回答済み 1問");

    // 「続きから再開」でその演習へ戻る
    click(win, "#resumeContinue");
    await tick(400);
    expect(visibleScreen(win)).toBe("quiz");
  });

  it("一問ずつ採点で解いた分は、その場で記録に残る", async () => {
    const win = await boot();
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

    const shown = win.document.querySelector("#qBlocks .qtext")!.textContent!.trim();
    const q = win.QUIZ_DATA.find((x: any) => shown.startsWith(x.question.trim().slice(0, 30)));
    (win.document.querySelectorAll("#qBlocks .choice")[q.answer] as any).click();
    await tick(200);

    const progress = JSON.parse(win.localStorage.getItem("civicsProgress_v1") || "{}");
    expect(progress[q.id], "解いた直後に記録されていない").toBeTruthy();
    expect(progress[q.id].seen).toBeGreaterThan(0);
    // 控えにも「解き終えた問題」として残る
    expect(snapshot(win).entries.some((e: any) => e.id === q.id && e.done)).toBe(true);
  });
});
