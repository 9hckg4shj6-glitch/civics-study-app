import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* ビルド済みアプリ（dist）を実際に読み込んで、起動と演習が動くかを確かめる煙感知テスト。
   index.html の大改修（アカウント・同期・ランキング・掲示板の削除）で
   参照切れが残っていないかを検出するのが目的。
   ES モジュール（src/main.ts のバンドル）は jsdom が実行しないため、
   ここで確認できるのは index.html 側の従来UIのみ。STUDY_CORE 未定義でも動くこと自体が要件。 */

const DIST = path.resolve("dist");
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
let dom: JSDOM;
let win: any;
const errors: string[] = [];

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

function hub(name: string): any {
  const el = [...win.document.querySelectorAll("#hubGrid .hubBtn")]
    .find((b: any) => b.querySelector(".hubName")?.textContent === name);
  if (!el) throw new Error(`ホームに「${name}」のタイルがありません`);
  return el;
}
function click(selector: string): void {
  const el = win.document.querySelector(selector);
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  el.click();
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 「今の画面」を id で返す。hidden が外れている section を探す。 */
function visibleScreen(): string {
  const ids = ["home", "quiz", "result", "search", "browse", "qbrowse", "flash", "subjectPicker"];
  return ids.find((id) => win.document.getElementById(id) && !win.document.getElementById(id)!.classList.contains("hidden")) ?? "";
}

beforeAll(async () => {
  await start();
  const html = await (await fetch(`${origin}/index.html`)).text();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e: Error) => errors.push(String(e.message)));
  virtualConsole.on("error", (...args: unknown[]) => errors.push(args.map(String).join(" ")));

  dom = new JSDOM(html, {
    url: `${origin}/index.html`,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // jsdom に無い API のうち、起動経路で必ず呼ばれるものだけを最小限に補う
      (window as any).matchMedia = (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      (window as any).scrollTo = () => {};
      (window as any).confirm = () => true;
      (window as any).alert = () => {};
      (window as any).navigator.serviceWorker = undefined;
    },
  });
  win = dom.window;
  // subjects.js → questions.js の順に読み込まれるので、DATA が入るまで待つ
  for (let i = 0; i < 200 && !(win.document.getElementById("hubGrid")?.children.length); i += 1) {
    await new Promise((r) => setTimeout(r, 25));
  }
}, 30_000);

afterAll(() => { dom?.window?.close(); server?.close(); });

describe("ビルド済みアプリの起動", () => {
  it("スクリプトエラーなしで起動する", () => {
    const fatal = errors.filter((e) => !/Not implemented|Could not parse CSS|serviceWorker/i.test(e));
    expect(fatal).toEqual([]);
  });

  it("ログイン画面も科目えらび画面も出さず、いきなりホームを表示する", () => {
    expect(win.document.getElementById("accountChoiceBackdrop")).toBeNull();
    expect(win.document.getElementById("rankView")).toBeNull();
    expect(win.document.getElementById("communityView")).toBeNull();
    expect(visibleScreen()).toBe("home");
    expect(win.document.getElementById("subjectPicker")!.classList.contains("hidden")).toBe(true);
  });

  it("公共・政治経済の30問を読み込んでいる", () => {
    expect(win.QUIZ_DATA).toHaveLength(30);
    expect(win.SUBJECTS).toHaveLength(1);
    expect(win.document.getElementById("appTitle")!.textContent).toContain("公共・政治経済");
  });

  it("ホームに総合演習カードが出て、30問・60分と案内される", () => {
    const section = win.document.getElementById("examSection")!;
    expect(section.classList.contains("hidden")).toBe(false);
    expect(win.document.getElementById("examCardTitle")!.textContent).toContain("総合演習");
    const sub = win.document.getElementById("examCardSub")!.textContent!;
    expect(sub).toContain("30問");
    expect(sub).toContain("60分");
  });

  it("ホームのハブに総合演習が並び、「学習」は出ない", () => {
    const names = [...win.document.querySelectorAll("#hubGrid .hubName")].map((e: any) => e.textContent);
    expect(names).toContain("総合演習");
    expect(names).not.toContain("学習");
    expect(names).toEqual(expect.arrayContaining(["問題演習", "問題一覧", "復習", "暗記カード", "問題検索"]));
  });

  it("演習画面に分野・出典・年度・テーマの絞り込みが並ぶ", async () => {
    hub("問題演習").click();
    await tick(250);
    expect(win.document.getElementById("practiceView")!.classList.contains("hidden")).toBe(false);

    const labels = (id: string) =>
      [...win.document.querySelectorAll(`#${id} .cat h3`)].map((e: any) => e.textContent);

    // domain：公共・政治・経済の3つが、この順で並ぶ
    expect(labels("domainList")).toEqual(["公共", "政治", "経済"]);
    // sourceType：収録した2つの出典区分が表示名で並ぶ
    expect(labels("sourceList")).toEqual([
      "共通テスト「公共，政治・経済」（新課程）",
      "共通テスト「政治・経済」（旧課程）",
    ]);
    // year：新しい年度から並ぶ
    expect(labels("yearList")).toEqual(["令和8年度", "令和7年度", "令和6年度"]);
    // field：細かい単元
    expect(labels("fieldList").length).toBeGreaterThan(5);

    // 各分野が10問ずつであることが画面にも出ている
    const badges = [...win.document.querySelectorAll("#domainList .cat .badge")].map((e: any) => e.textContent);
    expect(badges).toEqual(["10問", "10問", "10問"]);
  });
});

describe("演習と採点", () => {
  it("分野を選んで演習を始め、正解を押すと正誤と解説が出る", async () => {
    hub("問題演習").click();
    await tick(250);
    click('.sectToggle[data-toggle="fieldList"]');      // 分野別を開く
    await tick(120);
    click("#fieldList .cat");                          // 先頭の分野で演習を始める
    await tick(450);
    expect(visibleScreen()).toBe("quiz");

    // いま出ている問題を、問題文から教材データ側で特定する
    const shown = win.document.querySelector("#qBlocks .qtext")!.textContent!.trim();
    const q = win.QUIZ_DATA.find((x: any) => shown.startsWith(x.question.trim().slice(0, 30)));
    expect(q, `出題中の問題を特定できません: ${shown.slice(0, 40)}`).toBeTruthy();

    const choices = win.document.querySelectorAll("#qBlocks .choice");
    expect(choices.length).toBe(q.choices.length);

    // noShuffle:true なので原本の並び順のまま。正解の選択肢を押す
    (choices[q.answer] as any).click();
    await tick(250);
    expect((choices[q.answer] as any).className).toContain("correct");

    const explain = win.document.querySelector("#qBlocks .explain")!;
    expect(explain.textContent).toContain(q.explanation.slice(0, 20));

    // 採点後は選択肢をもう一度押すと、その選択肢の解説が開く
    (choices[q.answer] as any).click();
    await tick(120);
    const notes = win.document.querySelectorAll("#qBlocks .choiceNote");
    expect(notes[q.answer].textContent).toContain(q.choiceNotes[q.answer].slice(0, 15));
  });

  it("60分の総合演習は30問で始まり、提出まで正誤も解説も出さない", async () => {
    hub("総合演習").click();
    await tick(300);
    expect(win.document.getElementById("practiceView")!.classList.contains("hidden")).toBe(false);
    click("#examCard");                        // confirm はテスト側で true
    await tick(450);
    expect(visibleScreen()).toBe("quiz");

    const timer = win.document.getElementById("examTimer")!;
    expect(timer.classList.contains("hidden")).toBe(false);
    expect(timer.textContent).toMatch(/^⏱ (59|60):/);

    // 出題数は総合演習セットの30問
    expect(win.document.querySelectorAll("#qBlocks .qtext").length).toBeGreaterThan(0);
    expect(win.document.getElementById("counter")!.textContent).toContain("/ 30");

    // 解答しても、提出するまで正誤も解説も出さない
    const choices = win.document.querySelectorAll("#qBlocks .choice");
    (choices[0] as any).click();
    await tick(200);
    expect(win.document.querySelector("#qBlocks .choice.correct")).toBeNull();
    expect(win.document.querySelector("#qBlocks .choice.wrong")).toBeNull();
    const explain = win.document.querySelector("#qBlocks .explain") as HTMLElement | null;
    expect(explain === null || explain.classList.contains("hidden") || !explain.textContent!.trim()).toBe(true);
  });
});

describe("総合演習の提出と結果", () => {
  it("30問すべてに答えて提出すると、得点と結果が出る", async () => {
    hub("総合演習").click();
    await tick(300);
    click("#examCard");
    await tick(450);
    expect(visibleScreen()).toBe("quiz");

    // 30ページを順に、その問題の正解を選んで進む
    let answered = 0;
    for (let page = 0; page < 30; page += 1) {
      const shown = win.document.querySelector("#qBlocks .qtext")!.textContent!.trim();
      const q = win.QUIZ_DATA.find((x: any) => shown.startsWith(x.question.trim().slice(0, 30)));
      expect(q, `${page + 1}ページ目の問題を特定できません`).toBeTruthy();
      const choices = win.document.querySelectorAll("#qBlocks .choice");
      expect(choices.length).toBe(q.choices.length);
      (choices[q.answer] as any).click();
      answered += 1;
      await tick(30);
      click("#nextBtn");                    // 最後の1回で提出（confirm はテスト側で true）
      await tick(60);
    }
    expect(answered).toBe(30);
    await tick(400);

    expect(visibleScreen()).toBe("result");
    const result = win.document.getElementById("result")!.textContent!;
    // 全問正解なので満点。配点の合計は93点
    expect(result).toContain("93");
    expect(result).toContain("公共・政治経済 総合演習 第1回");
  }, 30_000);
});

describe("手動バックアップ（画面から）", () => {
  const PROGRESS_KEY = "civicsProgress_v1";
  let exported = "";

  function progressRecords(): Record<string, any> {
    try { return JSON.parse(win.localStorage.getItem(PROGRESS_KEY) || "{}"); } catch { return {}; }
  }

  it("書き出したJSONが common-test-civics 形式になっている", async () => {
    // ここまでのテストで少なくとも1問は解答済み
    expect(Object.keys(progressRecords()).length).toBeGreaterThan(0);

    click('#menuBtn');
    await tick(80);
    click('#menuPanel [data-menu-view="moreView"]');
    await tick(250);
    click("#backupBtn");
    await tick(300);

    exported = (win.document.getElementById("bkExport") as any).value;
    const parsed = JSON.parse(exported);
    expect(parsed.app).toBe("common-test-civics");
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(typeof parsed.data.progress).toBe("object");
    expect(typeof parsed.data.meta).toBe("object");
    expect(Object.keys(parsed.data.progress).length).toBeGreaterThan(0);
  });

  it("別アプリのバックアップや壊れたJSONは取り込まない", async () => {
    const before = JSON.stringify(progressRecords());
    const paste = (text: string) => {
      (win.document.getElementById("bkImport") as any).value = text;
      click("#bkMerge");
    };

    for (const bad of [
      "",
      "{壊れたJSON",
      JSON.stringify({ app: "metabolism-quiz", v: 2, progress: {}, meta: {} }),   // 医学アプリの記録
      JSON.stringify({ app: "common-test-civics", version: 99, data: { progress: {} } }),
      JSON.stringify({ app: "common-test-civics", version: 1, data: { progress: "配列でも辞書でもない" } }),
    ]) {
      paste(bad);
      await tick(60);
      expect(JSON.stringify(progressRecords())).toBe(before);
    }
  });

  it("記録をリセットしても、書き出したJSONから元どおり復元できる", async () => {
    const before = progressRecords();
    const answered = Object.keys(before);

    click("#resetBtn");                 // confirm はテスト側で true
    await tick(200);
    expect(Object.keys(progressRecords())).toHaveLength(0);

    click("#backupBtn");
    await tick(200);
    (win.document.getElementById("bkImport") as any).value = exported;
    click("#bkReplace");                // confirm はテスト側で true
    await tick(300);

    const after = progressRecords();
    for (const id of answered) {
      expect(after[id], `問題 ${id} の記録が戻っていません`).toBeTruthy();
      expect(after[id].seen).toBe(before[id].seen);
      expect(after[id].correct).toBe(before[id].correct);
    }
  });
});
