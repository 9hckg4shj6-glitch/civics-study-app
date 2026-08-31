import { describe, expect, it } from "vitest";
// @ts-expect-error - 教材検証スクリプトは素のJS（型定義は src/types.ts 側にある）
import { questionType, validateChoice, validateConstructed } from "../scripts/validate-content.mjs";

/* 記述問題（type:"constructed"）の教材検証。
   画像の実在検査があるので、fixture の modelImage には
   リポジトリに実在するファイルを使う。 */
const EXISTING_IMAGE = "icons/icon-192.png";

/** 仕様書 §5.5（R5設問2）を最小化した、検証を通るべき記述問題 */
function validFixture(): any {
  return {
    id: "immunology2-r5-written-02",
    type: "constructed",
    year: "令和5年度",
    category: "免疫学",
    field: "B細胞活性化",
    question: "BCRが抗原により架橋される様子を図示し、架橋が必要な理由を指定語句を用いて説明しなさい。",
    points: 5,
    rubricSource: "derived",
    modelAnswer: "模範解答本文",
    explanation: "授業資料に基づく解説",
    responseParts: [
      {
        id: "diagram",
        kind: "drawing",
        label: "BCR架橋の図",
        modelImage: EXISTING_IMAGE,
        modelImageAlt: "抗原が複数のBCRを架橋する模範図",
        aspectRatio: 1.5,
        paperAllowed: true,
      },
      {
        id: "reason",
        kind: "long-text",
        label: "架橋が必要な理由",
        requiredTerms: ["Igα/β", "チロシンキナーゼ"],
        rows: 7,
      },
    ],
    rubric: [
      { id: "crosslink", partIds: ["diagram"], text: "抗原が複数のBCRを架橋している", points: 2 },
      {
        id: "kinase",
        partIds: ["reason"],
        text: "架橋によりチロシンキナーゼがBCR周囲へ集まる",
        points: 1,
        autoCheck: { kind: "terms-present", partId: "reason", terms: ["チロシンキナーゼ"], mode: "all" },
      },
      { id: "signal", partIds: ["reason"], text: "Igα/βのリン酸化と下流への情報伝達を説明している", points: 2 },
    ],
  };
}

function check(question: any): string[] {
  const errors: string[] = [];
  validateConstructed("免疫学（2年次）", String(question.id), question, errors);
  return errors;
}

/** fixture を1箇所だけ壊して、その1件だけがエラーになることを確かめる */
function expectSingleError(mutate: (q: any) => void, fragment: string) {
  const q = validFixture();
  mutate(q);
  const errors = check(q);
  expect(errors.join("\n")).toContain(fragment);
  expect(errors).toHaveLength(1);
}

/** 壊し方によっては芋づるでエラーが増える。その場合は文言だけ確かめる */
function expectError(mutate: (q: any) => void, fragment: string) {
  const q = validFixture();
  mutate(q);
  expect(check(q).join("\n")).toContain(fragment);
}

describe("questionType", () => {
  it("type が無い既存の選択問題は choice のまま", () => {
    expect(questionType({ id: "genome-2025-001", choices: ["a", "b"] })).toBe("choice");
    expect(questionType(null)).toBe("choice");
    expect(questionType({ type: "constructed" })).toBe("constructed");
  });
});

describe("validateConstructed", () => {
  it("仕様書 §5.5 の形は検証を通る", () => {
    expect(check(validFixture())).toEqual([]);
  });

  it("rubric の配点合計が満点と違えば落とす", () => {
    expectSingleError((q) => { q.rubric[0].points = 3; }, "配点合計が満点と一致しません (6 / 5)");
  });

  it("points が正の数でなければ落とす", () => {
    expectError((q) => { q.points = 0; }, "points は正の数");
    expectError((q) => { q.points = -1; }, "points は正の数");
  });

  // 原本の配点が 2.5 点・3.5 点のことがある（R4 植物生理の問11など）ので、小数は通す
  it("points が小数でも rubric の合計が合っていれば通る", () => {
    const q = validFixture();
    q.points = 2.5;
    q.rubric = [{ ...q.rubric[0], points: 2.5 }];
    expect(check(q)).toEqual([]);
  });

  it("rubricSource は official / derived だけ許す", () => {
    expectSingleError((q) => { q.rubricSource = "official-ish"; }, "rubricSource");
  });

  it("responseParts が空なら落とす", () => {
    const q = validFixture();
    q.responseParts = [];
    expect(check(q).join("\n")).toContain("responseParts が1件もありません");
  });

  it("パーツIDの重複を検出する", () => {
    // ID が潰れると rubric の参照先も消えるので、芋づるでエラーが増えるのが正しい
    expectError((q) => { q.responseParts[1].id = "diagram"; }, "パーツIDが重複");
  });

  it("short-text は acceptedAnswers が要る", () => {
    expectSingleError(
      (q) => { q.responseParts[1] = { id: "reason", kind: "short-text", label: "語句", acceptedAnswers: [] }; },
      "acceptedAnswers を1件以上",
    );
  });

  it("numeric は expectedValue・単位・許容誤差が要る", () => {
    const q = validFixture();
    q.responseParts[1] = { id: "reason", kind: "numeric", label: "細胞数", expectedValue: NaN, acceptedUnits: [] };
    const joined = check(q).join("\n");
    expect(joined).toContain("expectedValue が有限の数値ではありません");
    expect(joined).toContain("acceptedUnits を1件以上");
    expect(joined).toContain("absoluteTolerance か relativeTolerance");
  });

  it("drawing は模範図の実在を検査する", () => {
    expectSingleError((q) => { q.responseParts[0].modelImage = "images/immunology2/answers/none.webp"; }, "模範図の画像がありません");
  });

  it("背景図（描き込み問題）も実在を検査する", () => {
    expectSingleError((q) => { q.responseParts[0].backgroundImage = "images/immunology2/answers/none.webp"; }, "背景図の画像がありません");
  });

  it("rubric が存在しない回答パーツを指していれば落とす", () => {
    expectSingleError((q) => { q.rubric[0].partIds = ["nope"]; }, "存在しない回答パーツ");
  });

  it("autoCheck の参照先も検査する", () => {
    expectSingleError((q) => { q.rubric[1].autoCheck.partId = "nope"; }, "autoCheck.partId が存在しない回答パーツ");
  });

  it("作図パーツは自動判定させない", () => {
    expectSingleError(
      (q) => { q.rubric[0].autoCheck = { kind: "short-match", partId: "diagram" }; },
      "作図パーツは自動判定しません",
    );
  });

  it("模範解答が無ければ落とす", () => {
    expectSingleError((q) => { q.modelAnswer = ""; }, "modelAnswer");
  });
});

describe("validateChoice", () => {
  it("既存の選択問題の検査は変わっていない", () => {
    const errors: string[] = [];
    validateChoice("ゲノム", "genome-2025-001", { choices: ["a", "b", "c"], answer: 1 }, errors);
    expect(errors).toEqual([]);
  });

  it("記述問題の欄を持たない選択問題でも、選択肢不足は従来どおり落とす", () => {
    const errors: string[] = [];
    validateChoice("ゲノム", "genome-2025-002", { choices: ["a"], answer: 0 }, errors);
    expect(errors.join("\n")).toContain("選択肢が不足");
  });
});
