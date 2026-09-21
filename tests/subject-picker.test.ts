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
  it("起動直後に出て、公共政経・化学・日本史・化学（私立）のタイルが並ぶ", async () => {
    const win = await boot();
    expect(win.document.getElementById("subjectPicker")!.classList.contains("hidden")).toBe(false);
    const tiles = [...win.document.querySelectorAll("#spGrid .spCard")] as any[];
    expect(tiles.map((t) => t.dataset.subject)).toEqual(["civics", "chemistry", "japanese-history", "chemistry-private"]);
    // タイルを開く前は、その科目の問題データをまだ読み込んでいない
    expect(win.QUIZ_DATA ?? []).toHaveLength(0);
  }, 30_000);

  it("どの科目も準備中（draft）ではなく、タイルに「準備中」の札が出ない", async () => {
    const win = await boot();
    for (const tile of win.document.querySelectorAll("#spGrid .spCard") as any) {
      expect(tile.classList.contains("soon")).toBe(false);
      expect(tile.querySelector(".spTag")?.textContent ?? "").not.toBe("準備中");
    }
  }, 30_000);

  it("化学（私立対策）を選ぶと私立の問題だけを読み込み、ホームの見出しも私立対策になる", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry-private");
    const priv = win.SUBJECTS.find((s: any) => s.id === "chemistry-private");
    expect(win.QUIZ_DATA).toHaveLength(priv.expectQuestions);
    expect(win.QUIZ_DATA.every((q: any) => String(q.id).startsWith("chemp-"))).toBe(true);
    expect(win.document.getElementById("appTitle")!.textContent).toBe("化学（私立対策）");
    expect(win.document.getElementById("home")!.classList.contains("hidden")).toBe(false);
    // 問題の見出しには年度ではなく大学名入りの短い出典名が出る
    const hub = [...win.document.querySelectorAll("#hubGrid .hubBtn")]
      .find((b: any) => b.querySelector(".hubName")?.textContent === "問題検索") as any;
    hub.click();
    await tick(200);
    const inp = win.document.getElementById("searchInput") as any;
    inp.value = "電気分解"; inp.dispatchEvent(new win.Event("input", { bubbles: true }));
    await tick(300);
    const item = win.document.querySelector('.srItem[data-id="chemp-2025-jichi-6"]') as any;
    expect(item.querySelector(".srMeta span").textContent.startsWith("自治医科大2025年 ・ ")).toBe(true);
    item.click();
    await tick(400);
    expect(win.document.getElementById("qtag")!.textContent).toBe("自治医科大2025年 ・ 電池と電気分解");
  }, 30_000);

  it("日本史を選ぶと日本史の問題だけを読み込み、ホームの見出しも日本史になる", async () => {
    const win = await boot();
    await enterSubject(win, "japanese-history");
    const jhist = win.SUBJECTS.find((s: any) => s.id === "japanese-history");
    expect(win.QUIZ_DATA).toHaveLength(jhist.expectQuestions);
    expect(win.QUIZ_DATA.every((q: any) => String(q.id).startsWith("jhist-"))).toBe(true);
    expect(win.document.getElementById("appTitle")!.textContent).toBe("日本史（共テ対策）");
    expect(win.document.getElementById("home")!.classList.contains("hidden")).toBe(false);
  }, 30_000);

  it("化学を選ぶと化学の問題だけを読み込み、ホームの見出しも化学になる", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry");
    const chemistry = win.SUBJECTS.find((s: any) => s.id === "chemistry");
    expect(win.QUIZ_DATA).toHaveLength(chemistry.expectQuestions);
    expect(win.QUIZ_DATA.every((q: any) => String(q.id).startsWith("chem-"))).toBe(true);
    expect(win.document.getElementById("appTitle")!.textContent).toBe("化学（共テ対策）");
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
    expect(labels(win, "sourceList")).toEqual(["共通テスト「化学」", "センター試験「化学」", "自作の補強問題"]);
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

/* 大学別（化学（私立対策））。複数の大学の過去問を入れる科目では、問題演習と問題一覧に
   「大学別」の分類が出て、大学 → ランダム演習／年度別 の順に選べる。
   共テ対策の化学には university を持つ問題が無いので、枠そのものが出ない。 */
describe("大学別の演習と一覧", () => {
  const hubBtn = (win: any, name: string) => [...win.document.querySelectorAll("#hubGrid .hubBtn")]
    .find((b: any) => b.querySelector(".hubName")?.textContent === name) as any;
  const shown = (win: any, id: string) => !win.document.getElementById(id)!.classList.contains("hidden");

  it("問題演習：大学別 → 自治医科大学 → ランダム演習と年度別（新しい年度から）が選べる", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry-private");
    hubBtn(win, "問題演習").click();
    await tick(250);

    expect(shown(win, "universitySection")).toBe(true);
    if (!shown(win, "universityList")) win.document.querySelector('.sectToggle[data-toggle="universityList"]').click();
    await tick(120);
    // 問題数の多い大学から並ぶ（自治医科大99問 → 岩手医科大90問）
    expect(labels(win, "universityList")).toEqual(["自治医科大学", "岩手医科大学"]);
    expect(win.document.querySelector('.sectToggle[data-toggle="universityList"] .stCount')!.textContent).toBe("2件");
    const jichi = win.QUIZ_DATA.filter((q: any) => q.university === "自治医科大学").length;

    // 大学を押すと別画面へ移り、ランダム演習（その大学の全問数）と年度別の2項目が出る
    (win.document.querySelector("#universityList .cat") as any).click();
    await tick(250);
    expect(shown(win, "universityView")).toBe(true);
    expect(shown(win, "practiceView")).toBe(false);
    expect(win.document.getElementById("universityTitle")!.textContent).toBe("自治医科大学");
    expect(win.document.getElementById("universityRandomCount")!.textContent).toBe(String(jichi));

    // 年度別を開くと、その大学の年度が新しい順に並ぶ
    win.document.getElementById("universityYearToggle").click();
    await tick(120);
    expect(labels(win, "universityYearList")).toEqual(["2026年度", "2025年度", "2024年度", "2023年度", "2022年度", "2021年度", "2020年度"]);
    const badges = [...win.document.querySelectorAll("#universityYearList .cat .badge")].map((e: any) => e.textContent);
    expect(badges).toEqual(["11問", "15問", "12問", "12問", "14問", "17問", "18問"]);

    // 年度を押すと出題数のモーダルが「大学別演習」として開く
    (win.document.querySelector("#universityYearList .cat") as any).click();
    await tick(150);
    expect(shown(win, "countModal")).toBe(true);
    expect(win.document.getElementById("countKicker")!.textContent).toBe("大学別演習");
    expect(win.document.getElementById("countTitle")!.textContent).toBe("自治医科大学 ・ 2026年度");
    expect(win.document.getElementById("countTotal")!.textContent).toBe("11");
    win.document.getElementById("countClose")?.click();
    await tick(100);

    // ランダム演習はその大学の全問が対象（他の大学の問題は含まない）
    win.document.getElementById("universityRandom").click();
    await tick(150);
    expect(win.document.getElementById("countTitle")!.textContent).toBe("自治医科大学 ・ ランダム演習");
    expect(win.document.getElementById("countTotal")!.textContent).toBe(String(jichi));
    win.document.getElementById("countStart").click();
    await tick(400);
    expect(shown(win, "quiz")).toBe(true);

    // 「← 問題演習」で戻れる
    win.history.back(); await tick(300);
  }, 40_000);

  it("問題一覧：大学別 → 自治医科大学 → ランダム演習／年度別 → 年度の問題が並ぶ", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry-private");
    expect(hubBtn(win, "問題一覧").querySelector(".hubSub")?.textContent).toContain("大学別");
    hubBtn(win, "問題一覧").click();
    await tick(250);
    const folder = (title: string) => [...win.document.querySelectorAll("#qbrowseIndex .qbFolder")]
      .find((b: any) => b.querySelector(".brDeckTitle")?.textContent === title) as any;

    expect(folder("大学別")).toBeTruthy();
    folder("大学別").click(); await tick(150);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("大学別");
    expect(folder("自治医科大学")).toBeTruthy();
    folder("自治医科大学").click(); await tick(150);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("大学別 ・ 自治医科大学");
    expect(win.document.getElementById("qbrowseBackLabel")!.textContent).toBe("← 大学別");
    // 大学の中はランダム演習と年度別の2項目
    const entries = [...win.document.querySelectorAll("#qbrowseIndex .brDeck2 .brDeckTitle")].map((e: any) => e.textContent);
    expect(entries).toEqual(["ランダム演習", "年度別"]);

    folder("年度別").click(); await tick(150);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("自治医科大学 ・ 年度別");
    const years = [...win.document.querySelectorAll("#qbrowseIndex .brDeck2[data-key] .brDeckTitle")].map((e: any) => e.textContent);
    expect(years).toEqual(["2026年度", "2025年度", "2024年度", "2023年度", "2022年度", "2021年度", "2020年度"]);
    (win.document.querySelector('#qbrowseIndex .brDeck2[data-key="__u__自治医科大学::2025年度"]') as any).click();
    await tick(200);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("自治医科大学 ・ 2025年度");
    expect(win.document.querySelector("#qbrowseInfo .srCount")!.textContent).toContain("全15問");
    expect(win.document.querySelectorAll("#qbrowseList .qbItem").length).toBe(10);   // 1ページ10問

    // 戻るは 年度別 → 大学 → 大学別 → 最上位 の順
    win.document.getElementById("qbrowseBack").click(); await tick(120);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("自治医科大学 ・ 年度別");
    win.document.getElementById("qbrowseBack").click(); await tick(120);
    expect(win.document.getElementById("qbrowseTitle")!.textContent).toBe("大学別 ・ 自治医科大学");
    // ランダム演習はその大学の全問を出題数モーダルへ渡す
    (win.document.querySelector("#qbrowseIndex .qbUnivRandom") as any).click(); await tick(150);
    expect(shown(win, "countModal")).toBe(true);
    expect(win.document.getElementById("countKicker")!.textContent).toBe("大学別演習");
    expect(win.document.getElementById("countTotal")!.textContent)
      .toBe(String(win.QUIZ_DATA.filter((q: any) => q.university === "自治医科大学").length));
    win.document.getElementById("countClose")?.click(); await tick(100);
    // 岩手医科大学のフォルダも並ぶ（問題数の多い順なので自治医科大学の次）
    win.document.getElementById("qbrowseBack").click(); await tick(120);
    expect(folder("岩手医科大学")).toBeTruthy();
  }, 40_000);

  /* 私立対策は subjects.js の practiceScopes / browseFolders で、演習範囲を
     テーマ別 → 大学別 → 問い方別 の3つだけに、問題一覧を 分野別 → 大学別 → 年度別 の順にしている。
     共テ対策の化学は同じ配色を借りるだけで、こちらの並びは既定のまま。 */
  it("私立対策の演習範囲は テーマ別・大学別・問い方別 の3つだけ、問題一覧は 分野別・大学別・年度別 の順", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry-private");
    hubBtn(win, "問題演習").click();
    await tick(250);
    const visible = [...win.document.querySelectorAll("#practiceView .rangeSection")]
      .filter((el: any) => !el.classList.contains("hidden"))
      .map((el: any) => el.querySelector(".stLabel")!.textContent);
    expect(visible).toEqual(["テーマ別", "大学別", "問い方別"]);
    // 一覧の入口の説明もフォルダの順に合わせる
    expect(win.document.getElementById("qbrowseBtnTitle")!.textContent).toBe("問題一覧（分野別・大学別・年度別）");
    win.document.getElementById("qbrowseBtn").click();
    await tick(250);
    const titles = [...win.document.querySelectorAll("#qbrowseIndex .qbFolder .brDeckTitle")].map((e: any) => e.textContent);
    expect(titles).toEqual(["分野別", "大学別", "年度別"]);
  }, 30_000);

  it("共テ対策の化学には大学別の枠も一覧のフォルダも出ない", async () => {
    const win = await boot();
    await enterSubject(win, "chemistry");
    hubBtn(win, "問題演習").click();
    await tick(250);
    expect(shown(win, "universitySection")).toBe(false);
    const visible = [...win.document.querySelectorAll("#practiceView .rangeSection")]
      .filter((el: any) => !el.classList.contains("hidden"))
      .map((el: any) => el.querySelector(".stLabel")!.textContent);
    expect(visible).toEqual(["テーマ別", "問い方別", "分野別", "出典別", "年度別"]);
    expect(win.document.getElementById("qbrowseBtnTitle")!.textContent).toBe("問題一覧（年度別・分野別）");
    win.document.getElementById("qbrowseBtn").click();
    await tick(250);
    const titles = [...win.document.querySelectorAll("#qbrowseIndex .qbFolder .brDeckTitle")].map((e: any) => e.textContent);
    expect(titles).toEqual(["年度別", "分野別"]);
  }, 30_000);
});
