import fs from "node:fs";
import { describe, expect, it } from "vitest";

/* index.html の中にある「記述問題の仮判定」まわりの純粋な関数を取り出して検査する。
   UIから切り離せる部分だけを対象にしている。
   仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §6・§8 */

const source = fs.readFileSync("index.html", "utf8");

function extract(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`index.html に function ${name} が見つかりません`);
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") {
      depth += 1;
      seen = true;
    } else if (source[i] === "}") {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} の終わりが見つかりません`);
}

const names = [
  "normWritten",
  "shortTextHit",
  "parseNumericInput",
  "numericHit",
  "termHits",
  "rubricPoints",
  "writtenPoints",
  "suggestWrittenRating",
  "allowedWrittenRatings",
  "autoCheckPasses",
];
const api = new Function(`${names.map(extract).join("\n")}\nreturn {${names.join(",")}};`)() as {
  normWritten: (s: unknown) => string;
  shortTextHit: (part: { acceptedAnswers: string[] }, text: string) => boolean;
  parseNumericInput: (raw: string) => number | null;
  numericHit: (part: Record<string, unknown>, value: number | null) => boolean;
  termHits: (text: string, terms: string[]) => Array<{ term: string; used: boolean }>;
  rubricPoints: (q: { rubric: Array<{ id: string; points: number }> }, ids: string[]) => number;
  writtenPoints: (q: { points?: unknown }) => number;
  suggestWrittenRating: (earned: number, max: number) => number;
  allowedWrittenRatings: (earned: number, max: number) => number[];
  autoCheckPasses: (q: Record<string, unknown>, crit: Record<string, unknown>, answers: Record<string, unknown>) => boolean;
};

describe("短答の正規化（§6.1）", () => {
  it("NFKC・前後空白・連続空白・大小文字を吸収する", () => {
    expect(api.normWritten("　ＩｇＡ　")).toBe("iga");
    expect(api.normWritten("IgA  抗体")).toBe("iga 抗体");
    expect(api.normWritten("ﾊﾟｰﾌｫﾘﾝ")).toBe("パーフォリン");
  });

  it("別解は acceptedAnswers に登録したものだけを正解にする", () => {
    const part = { acceptedAnswers: ["パーフォリン", "perforin"] };
    expect(api.shortTextHit(part, " ﾊﾟｰﾌｫﾘﾝ ")).toBe(true);
    expect(api.shortTextHit(part, "Perforin")).toBe(true);
    expect(api.shortTextHit(part, "")).toBe(false);
  });

  it("部分一致は正解にしない", () => {
    const part = { acceptedAnswers: ["パーフォリン"] };
    expect(api.shortTextHit(part, "パーフォ")).toBe(false);
    expect(api.shortTextHit(part, "パーフォリンとグランザイム")).toBe(false);
  });
});

describe("数値の正規化と判定（§6.3）", () => {
  it("指数表記・科学表記・そのままの数を同じ値として読む", () => {
    expect(api.parseNumericInput("5.1e7")).toBe(5.1e7);
    expect(api.parseNumericInput("5.1E7")).toBe(5.1e7);
    expect(api.parseNumericInput("5.1×10^7")).toBe(5.1e7);
    expect(api.parseNumericInput("5.1x10^7")).toBe(5.1e7);
    expect(api.parseNumericInput("51000000")).toBe(5.1e7);
    expect(api.parseNumericInput("51,000,000")).toBe(5.1e7);
    expect(api.parseNumericInput("５１００００００")).toBe(5.1e7);
    expect(api.parseNumericInput("10^-4")).toBe(1e-4);
  });

  it("ふつうの整数を指数と読み違えない", () => {
    expect(api.parseNumericInput("2107")).toBe(2107);
    expect(api.parseNumericInput("")).toBeNull();
    expect(api.parseNumericInput("だいたい100")).toBeNull();
  });

  it("絶対誤差・相対誤差のどちらかを満たせば仮正解にする", () => {
    expect(api.numericHit({ expectedValue: 1e-4, relativeTolerance: 0.01 }, 1.005e-4)).toBe(true);
    expect(api.numericHit({ expectedValue: 1e-4, relativeTolerance: 0.01 }, 2e-4)).toBe(false);
    expect(api.numericHit({ expectedValue: 100, absoluteTolerance: 5 }, 104)).toBe(true);
    expect(api.numericHit({ expectedValue: 100, absoluteTolerance: 5, relativeTolerance: 0.5 }, 140)).toBe(true);
    expect(api.numericHit({ expectedValue: 100, absoluteTolerance: 5 }, null)).toBe(false);
  });
});

describe("指定語句と採点基準（§6.2・§8.1）", () => {
  it("指定語句の使用／不足を判定する", () => {
    const hits = api.termHits("TLRでPAMPsを認識し、ケモカインを出す", ["TLR", "サイトカイン", "ケモカイン"]);
    expect(hits.map((hit) => hit.used)).toEqual([true, false, true]);
  });

  it("チェックした採点項目の配点を合計する", () => {
    const q = { rubric: [{ id: "a", points: 2 }, { id: "b", points: 1 }, { id: "c", points: 2 }] };
    expect(api.rubricPoints(q, ["a", "c"])).toBe(4);
    expect(api.rubricPoints(q, [])).toBe(0);
    expect(api.rubricPoints(q, ["a", "b", "c"])).toBe(5);
  });

  it("満点は points、壊れていれば1にフォールバックする", () => {
    expect(api.writtenPoints({ points: 7 })).toBe(7);
    expect(api.writtenPoints({ points: 0 })).toBe(1);
    expect(api.writtenPoints({})).toBe(1);
  });
});

describe("FSRS評価の候補（§8.2）", () => {
  it("0点はAgain、部分点はHard、満点はGoodを初期候補にする", () => {
    expect(api.suggestWrittenRating(0, 5)).toBe(1);
    expect(api.suggestWrittenRating(3, 5)).toBe(2);
    expect(api.suggestWrittenRating(5, 5)).toBe(3);
  });

  it("部分点ではGood・Easyを選べない", () => {
    expect(api.allowedWrittenRatings(0, 5)).toEqual([1, 2]);
    expect(api.allowedWrittenRatings(3, 5)).toEqual([1, 2]);
    expect(api.allowedWrittenRatings(5, 5)).toEqual([2, 3, 4]);
  });
});

describe("autoCheck による初期チェック（§5.4）", () => {
  const q = {
    responseParts: [
      { id: "body", kind: "long-text", requiredTerms: ["TLR"] },
      { id: "vol", kind: "numeric", expectedValue: 1e-4, relativeTolerance: 0.01 },
      { id: "word", kind: "short-text", acceptedAnswers: ["ADCC"] },
    ],
  };

  it("terms-present は all / any を区別する", () => {
    const answers = { body: { kind: "long-text", text: "TLRで認識する" } };
    expect(api.autoCheckPasses(q, { autoCheck: { kind: "terms-present", partId: "body", terms: ["TLR", "ケモカイン"], mode: "all" } }, answers)).toBe(false);
    expect(api.autoCheckPasses(q, { autoCheck: { kind: "terms-present", partId: "body", terms: ["TLR", "ケモカイン"], mode: "any" } }, answers)).toBe(true);
  });

  it("numeric-match と short-match が動く", () => {
    const answers = {
      vol: { kind: "numeric", rawValue: "1e-4", normalizedValue: 1e-4, unit: "mL" },
      word: { kind: "short-text", text: " adcc " },
    };
    expect(api.autoCheckPasses(q, { autoCheck: { kind: "numeric-match", partId: "vol" } }, answers)).toBe(true);
    expect(api.autoCheckPasses(q, { autoCheck: { kind: "short-match", partId: "word" } }, answers)).toBe(true);
  });

  it("答案が無い・autoCheckが無いときは初期チェックしない", () => {
    expect(api.autoCheckPasses(q, {}, {})).toBe(false);
    expect(api.autoCheckPasses(q, { autoCheck: { kind: "terms-present", partId: "body", terms: ["TLR"], mode: "all" } }, {})).toBe(false);
  });
});
