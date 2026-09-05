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

/** 折りたたみの開閉状態は localStorage に残るので、閉じているときだけ開く。 */
function openFieldSection(): void {
  if (win.document.getElementById("fieldList")!.classList.contains("hidden")) {
    click('.sectToggle[data-toggle="fieldList"]');
  }
}

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

  it("subjects.js が宣言した問題数をそのまま読み込んでいる", () => {
    expect(win.QUIZ_DATA).toHaveLength(win.SUBJECTS[0].expectQuestions);
    expect(win.SUBJECTS).toHaveLength(1);
    expect(win.document.getElementById("appTitle")!.textContent).toContain("公共・政治経済");
  });

  it("ホームのハブに「学習」も「総合演習」も出ない", () => {
    const names = [...win.document.querySelectorAll("#hubGrid .hubName")].map((e: any) => e.textContent);
    expect(names).not.toContain("総合演習");
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
    // sourceType：収録した3つの出典区分が表示名で並ぶ
    expect(labels("sourceList")).toEqual([
      "共通テスト「公共，政治・経済」（新課程）",
      "共通テスト「政治・経済」（旧課程）",
      "センター試験「政治・経済」",
    ]);
    // year：新しい年度から並ぶ
    expect(labels("yearList")).toEqual([
      "令和8年度",
      "令和7年度",
      "令和6年度",
      "令和5年度",
      "令和4年度",
      "令和3年度",
      "令和2年度",
      "平成31年度",
      "平成30年度",
      "平成29年度",
    ]);
    // テーマ別：まず公共・政治・経済の三択が出る（項目はこのあとの画面）
    expect(labels("fieldList")).toEqual(["公共", "政治", "経済"]);

    // 分野ごとの問題数が subjects.js の宣言どおり画面にも出ている
    const counts = win.SUBJECTS[0].expectDomainCounts;
    const badges = [...win.document.querySelectorAll("#domainList .cat .badge")].map((e: any) => e.textContent);
    expect(badges).toEqual(["公共", "政治", "経済"].map((d) => `${counts[d]}問`));
  });
});

describe("テーマ別の階層", () => {
  it("テーマ別 →（公共・政治・経済）→ その分野の項目、の順に進む", async () => {
    hub("問題演習").click();
    await tick(250);
    openFieldSection();                                // テーマ別を開く
    await tick(120);

    // 2段目は別画面。政治を選ぶと、政治に属する単元だけが並ぶ
    const seiji = [...win.document.querySelectorAll("#fieldList .cat")]
      .find((el: any) => el.querySelector("h3")?.textContent === "政治");
    expect(seiji).toBeTruthy();
    (seiji as any).click();
    await tick(250);
    expect(win.document.getElementById("themeFieldView")!.classList.contains("hidden")).toBe(false);
    expect(win.document.getElementById("practiceView")!.classList.contains("hidden")).toBe(true);

    const fields = [...win.document.querySelectorAll("#themeFieldList .cat h3")].map((e: any) => e.textContent);
    expect(fields.length).toBeGreaterThan(1);
    const seijiFields = new Set(
      win.QUIZ_DATA.filter((q: any) => q.domain === "政治").map((q: any) => q.field),
    );
    expect(new Set(fields)).toEqual(seijiFields);
    // 政治経済塾の単元順（民主政治→…→国際連合）で並ぶ
    expect(fields[0]).toBe("民主政治");

    // 「← 問題演習」で1段目へ戻る
    click("#themeFieldBack");
    await tick(250);
    expect(win.document.getElementById("practiceView")!.classList.contains("hidden")).toBe(false);
  });
});

describe("演習と採点", () => {
  it("テーマ別の項目を選んで演習を始め、正解を押すと正誤と解説が出る", async () => {
    hub("問題演習").click();
    await tick(250);
    openFieldSection();                                // テーマ別を開く
    await tick(120);
    click("#fieldList .cat");                          // 先頭の分野（公共）を選ぶ
    await tick(250);
    click("#themeFieldList .cat");                     // その分野の先頭の項目を選ぶ
    await tick(200);
    // 2問以上ある範囲では出題数のモーダルが挟まるので、「全部」を選んで開始する
    if (!win.document.getElementById("countModal")!.classList.contains("hidden")) {
      click('#countChips .countChip[data-n="all"]');
      click("#countStart");
    }
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
