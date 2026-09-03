import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error - 教材検証スクリプトは素のJS
import { DOMAINS, SOURCE_TYPES, questionType, validateChoice, validateCivics } from "../scripts/validate-content.mjs";

/* 収録教材そのものの検証（実装計画 §11「教材検証」）。
   validate:content と同じ検査を、npm test 側からも回して取りこぼしを防ぐ。 */

function loadBrowserData(file: string, globalName: string): any[] {
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window[globalName];
}

const subjects = loadBrowserData("public/subjects.js", "SUBJECTS");
const civics = subjects.find((s) => s.id === "civics");
const questions = loadBrowserData(path.join("public", civics.questions), "QUIZ_DATA");

describe("公共・政治経済の収録教材", () => {
  it("科目は公共・政治経済の1件だけで、科目えらび画面を挟まない", () => {
    expect(subjects).toHaveLength(1);
    expect(civics.idPrefix).toBe("civics-");
  });

  it("収録数が subjects.js の宣言と合っている", () => {
    expect(questions).toHaveLength(civics.expectQuestions);
  });

  it("分野ごとの内訳が subjects.js の宣言と合っている", () => {
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
    expect(counts).toEqual(civics.expectDomainCounts);
  });

  it("1問だけで解ける（資料は stem に転記し、外部の資料を参照させない）", () => {
    // 会話文・メモ・表を前提にする問題も、その資料を stem へ転記して1問で完結させたうえで収録する。
    // 転記しきれない長い共通資料や、図そのものを読み取る問題は content/excluded/ に置く。
    for (const q of questions) {
      const stem = String(q.stem ?? "").trim();
      if (!stem) continue;
      // 資料があるのに見出しが無いと、折りたたみが何の資料か分からない
      expect(String(q.stemTitle ?? "").trim().length).toBeGreaterThan(0);
      // スマートフォンで読み通せる長さに収める
      expect(stem.length).toBeLessThanOrEqual(1200);
      // 画像に頼る資料は載せない（stem の文章だけで解けること）
      expect(q.stemImages ?? []).toEqual([]);
    }
  });

  it("IDが重複せず、すべて civics- で始まる", () => {
    const ids = questions.map((q) => String(q.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("civics-")).toBe(true);
  });

  it("answer・answers が選択肢の範囲内である", () => {
    const errors: string[] = [];
    for (const q of questions) {
      expect(questionType(q)).toBe("choice");
      validateChoice("公共・政治経済", String(q.id), q, errors);
    }
    expect(errors).toEqual([]);
  });

  it("choiceNotes の件数が選択肢と一致し、出典・分野・確認日がそろっている", () => {
    const errors: string[] = [];
    for (const q of questions) validateCivics("公共・政治経済", String(q.id), q, errors);
    expect(errors).toEqual([]);
  });

  it("domain と sourceType は決められた値だけを使う", () => {
    for (const q of questions) {
      expect(DOMAINS.has(q.domain)).toBe(true);
      expect(SOURCE_TYPES.has(q.sourceType)).toBe(true);
    }
  });

  it("画像を参照している問題は、ファイルが実在し代替テキストをもつ", () => {
    for (const q of questions) {
      for (const [key, altKey] of [["image", "imageAlt"], ["explainImage", "explainImageAlt"]] as const) {
        if (!q[key]) continue;
        expect(fs.existsSync(path.join("public", q[key]))).toBe(true);
        expect(String(q[altKey] ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("出典区分ごとの内訳を記録する（配分が変わったら気づけるように）", () => {
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.sourceType] = (counts[q.sourceType] ?? 0) + 1;
    // 新課程「公共，政治・経済」54問（令和8年度26問、令和7年度28問）／
    // 旧課程の共通テスト「政治・経済」96問
    //（令和7年度「旧政治・経済」3問、令和6年度26問、令和5年度24問、令和4年度16問、令和3年度第1日程27問）。
    // センター試験は大学入試センターが問題・正解を公開していないため収録していない。
    expect(counts).toEqual({ "common-new": 54, "common-legacy": 96 });
  });
});
