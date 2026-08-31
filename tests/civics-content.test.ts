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
const examSets = loadBrowserData("public/subjects.js", "EXAM_SETS");
const civics = subjects.find((s) => s.id === "civics");
const questions = loadBrowserData(path.join("public", civics.questions), "QUIZ_DATA");

describe("公共・政治経済の収録教材", () => {
  it("科目は公共・政治経済の1件だけで、科目えらび画面を挟まない", () => {
    expect(subjects).toHaveLength(1);
    expect(civics.idPrefix).toBe("civics-");
  });

  it("問題総数が30問である", () => {
    expect(questions).toHaveLength(30);
    expect(civics.expectQuestions).toBe(30);
  });

  it("公共・政治・経済が各10問である", () => {
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
    expect(counts).toEqual({ 公共: 10, 政治: 10, 経済: 10 });
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

  it("総合演習 pilot-001 に30問すべてが登録され、出題順に重複がない", () => {
    const set = examSets.find((s) => s.id === "pilot-001");
    expect(set).toBeTruthy();
    expect(set.durationMinutes).toBe(60);
    const members = questions.filter((q) => q.examSetId === "pilot-001");
    expect(members).toHaveLength(set.questionCount);
    expect(members).toHaveLength(30);
    const orders = members.map((q) => q.examOrder);
    expect(new Set(orders).size).toBe(orders.length);
    expect(Math.min(...orders)).toBe(1);
    expect(Math.max(...orders)).toBe(30);
  });

  it("出典区分ごとの内訳を記録する（配分が変わったら気づけるように）", () => {
    const counts: Record<string, number> = {};
    for (const q of questions) counts[q.sourceType] = (counts[q.sourceType] ?? 0) + 1;
    // 新課程「公共，政治・経済」16問／旧課程の共通テスト「政治・経済」14問。
    // センター試験は大学入試センターが問題・正解を公開していないため試作版では収録していない。
    expect(counts).toEqual({ "common-new": 16, "common-legacy": 14 });
  });
});
