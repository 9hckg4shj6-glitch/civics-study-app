import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error - 教材検証スクリプトは素のJS
import { ASK_TYPES, CHEM_DOMAINS, CHEM_SOURCE_TYPES, validateChemistry, validateChoice } from "../scripts/validate-content.mjs";

/* 化学の収録教材の検証（docs/化学科目_実装計画.md §2・§3・§5）。
   validate:content と同じ検査を npm test 側からも回して取りこぼしを防ぐ。 */

function loadBrowserData(file: string, globalName: string): any[] {
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window[globalName];
}

const subjects = loadBrowserData("public/subjects.js", "SUBJECTS");
const chemistry = subjects.find((s) => s.id === "chemistry");
const questions = loadBrowserData(path.join("public", chemistry.questions), "QUIZ_DATA");

describe("化学の科目設定", () => {
  it("公共・政治経済とは別のIDの接頭辞・保存領域を使う", () => {
    expect(chemistry.idPrefix).toBe("chem-");
    expect(chemistry.contentDir).toBe("content/chemistry/questions");
    expect(chemistry.questions).toBe("subjects/chemistry/questions.js");
  });

  it("分野の並び（domainOrder・fieldOrder）が宣言されている", () => {
    expect(chemistry.domainOrder).toEqual([...CHEM_DOMAINS]);
    expect(chemistry.fieldOrder.length).toBeGreaterThan(0);
    // 並び順の表に重複があると、画面の並びが不定になる
    expect(new Set(chemistry.fieldOrder).size).toBe(chemistry.fieldOrder.length);
  });

  it("出典区分の表示名が全種類そろっている", () => {
    expect(Object.keys(chemistry.sourceTypeLabels).sort()).toEqual([...CHEM_SOURCE_TYPES].sort());
  });
});

describe("化学の収録教材", () => {
  it("収録数と分野別の内訳が subjects.js の宣言と合っている", () => {
    expect(questions).toHaveLength(chemistry.expectQuestions);
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
    expect(counts).toEqual(chemistry.expectDomainCounts);
  });

  it("IDが重複せず、すべて chem- で始まる", () => {
    const ids = questions.map((q) => String(q.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("chem-")).toBe(true);
  });

  it("教材検証（分野・出典・問い方・解説・確認日）を通る", () => {
    const errors: string[] = [];
    for (const q of questions) {
      validateChoice("化学", q.id, q, errors);
      validateChemistry("化学", q.id, q, errors);
    }
    expect(errors).toEqual([]);
  });

  it("集めるのは正誤問題・正しいものを選ぶ問題・誤っているものを選ぶ問題だけ", () => {
    for (const q of questions) {
      expect([...ASK_TYPES]).toContain(q.askType);
      // 記述問題は化学では扱わない
      expect(q.type ?? "choice").toBe("choice");
      expect(Array.isArray(q.choices) && q.choices.length >= 2).toBe(true);
    }
  });

  it("field は fieldOrder の表にある単元だけを使う", () => {
    for (const q of questions) expect(chemistry.fieldOrder).toContain(q.field);
  });

  it("正誤の組合せ問題には noShuffle が付いている（並べ替えると選択肢が壊れるため）", () => {
    for (const q of questions) {
      if (q.askType === "true-false") expect(q.noShuffle).toBe(true);
    }
  });

  /* 構造式・反応式・実験の図は、文章に書き起こさず問題冊子の原図をそのまま載せる方針
     （docs/化学科目_実装計画.md）。参照が切れていると図なしの問題になってしまう。 */
  it("選択肢の図（choiceImages）は選択肢と同じ並びで、ファイルが実在し代替テキストをもつ", () => {
    for (const q of questions) {
      if (!q.choiceImages) continue;
      expect(q.choiceImages).toHaveLength(q.choices.length);
      for (const fig of q.choiceImages) {
        if (fig == null) continue;
        expect(fs.existsSync(path.join("public", fig.src))).toBe(true);
        expect(String(fig.alt ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("問題文の図（stemImages）は、ファイルが実在し代替テキストをもつ", () => {
    for (const q of questions) {
      for (const fig of q.stemImages ?? []) {
        expect(fs.existsSync(path.join("public", fig.src))).toBe(true);
        expect(String(fig.alt ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("問題文を折りたたむ問題（stemClosed）は、開く前でも何を問われているか分かる", () => {
    for (const q of questions) {
      if (!q.stemClosed) continue;
      // 畳んだままでも設問として読めるよう、リード文と図・見出しをそろえておく
      expect(String(q.stem ?? "").trim().length).toBeGreaterThan(0);
      expect((q.stemImages ?? []).length).toBeGreaterThan(0);
      expect(String(q.stemTitle ?? "").trim().length).toBeGreaterThan(0);
    }
  });
});
