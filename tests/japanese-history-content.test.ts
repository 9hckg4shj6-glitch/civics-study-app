import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error - 教材検証スクリプトは素のJS
import { JHIST_DOMAINS, JHIST_SOURCE_TYPES, validateChoice, validateJapaneseHistory } from "../scripts/validate-content.mjs";

/* 日本史（共テ対策）の収録教材の検証（docs/japanese-history/ の設計文書に対応）。
   validate:content と同じ検査を npm test 側からも回して取りこぼしを防ぐ。 */

function loadBrowserData(file: string, globalName: string): any[] {
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window[globalName];
}

const subjects = loadBrowserData("public/subjects.js", "SUBJECTS");
const jhist = subjects.find((s) => s.id === "japanese-history");
const questions = loadBrowserData(path.join("public", jhist.questions), "QUIZ_DATA");

describe("日本史の科目設定", () => {
  it("他科目とは別のIDの接頭辞・保存領域を使い、準備中ではない", () => {
    expect(jhist.idPrefix).toBe("jhist-");
    expect(jhist.contentDir).toBe("content/japanese-history/questions");
    expect(jhist.questions).toBe("subjects/japanese-history/questions.js");
    expect(jhist.draft).toBeUndefined();
  });

  it("時代区分（domainOrder）と小分野（fieldOrder）が宣言されている", () => {
    expect(jhist.domainOrder).toEqual([...JHIST_DOMAINS]);
    expect(jhist.fieldOrder.length).toBeGreaterThan(0);
    expect(new Set(jhist.fieldOrder).size).toBe(jhist.fieldOrder.length);
  });

  it("出典区分の表示名が全種類そろっている", () => {
    expect(Object.keys(jhist.sourceTypeLabels).sort()).toEqual([...JHIST_SOURCE_TYPES].sort());
  });
});

describe("日本史の収録教材", () => {
  it("収録数と時代別の内訳が subjects.js の宣言と合っている", () => {
    expect(questions).toHaveLength(jhist.expectQuestions);
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
    expect(counts).toEqual(jhist.expectDomainCounts);
  });

  it("IDが重複せず、すべて jhist- で始まる", () => {
    const ids = questions.map((q) => String(q.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("jhist-")).toBe(true);
  });

  it("教材検証（時代区分・出典・年度・解説・確認日）を通る", () => {
    const errors: string[] = [];
    for (const q of questions) {
      validateChoice("日本史", q.id, q, errors);
      validateJapaneseHistory("日本史", q.id, q, errors);
    }
    expect(errors).toEqual([]);
  });

  it("field は fieldOrder の表にある単元だけを使う", () => {
    for (const q of questions) expect(jhist.fieldOrder).toContain(q.field);
  });

  /* 過去問は出典（年度・大問・問・解答番号）で一意にする。同じ解答番号を二重に収録しない。
     連動型（2026年度 第3問 問3）だけは「あ」「い」を選んだ場合の2問に分けるので、末尾の注記で区別する。 */
  it("過去問は sourceQuestion を持ち、同じ出典の設問を二重に収録していない", () => {
    const seen = new Set<string>();
    for (const q of questions) {
      if (q.sourceType === "original") continue;
      expect(String(q.sourceQuestion ?? "").trim().length).toBeGreaterThan(0);
      const key = `${q.sourceLabel}|${q.sourceQuestion}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  /* 2文正誤・メモ正誤・組合せ・整序は選択肢の並びに意味があるので、並べ替えを止める。 */
  it("組合せ型・整序型の選択肢には noShuffle が付いている", () => {
    for (const q of questions) {
      const combo = q.choices.some((c: string) => /^(あ|い|う|え|ア|ウ|オ|メモ|下線部|Ⅰ|Ⅱ|Ⅲ)/.test(String(c)) || /―/.test(String(c)));
      if (combo) expect(q.noShuffle).toBe(true);
    }
  });

  /* 資料の図は問題冊子の原図を切り出して載せる方針（docs/japanese-history/question-authoring-guidelines.md 1.6）。
     参照が切れていると図なしの問題になってしまう。 */
  it("問題文の図（stemImages）は、ファイルが実在し代替テキストをもつ", () => {
    for (const q of questions) {
      for (const fig of q.stemImages ?? []) {
        expect(fs.existsSync(path.join("public", fig.src))).toBe(true);
        expect(String(fig.alt ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("問題文に図をもつ問題は、リード文と見出しがそろっていて畳まずに始まる", () => {
    for (const q of questions) {
      if (!(q.stemImages ?? []).length) continue;
      expect(String(q.stem ?? "").trim().length).toBeGreaterThan(0);
      expect(String(q.stemTitle ?? "").trim().length).toBeGreaterThan(0);
      expect(q.stemClosed).toBeUndefined();
    }
  });
});
