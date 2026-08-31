import { describe, expect, it } from "vitest";
import { examGain, retrievabilityAt, retrievabilityCurve } from "../src/fsrs";
import type { LegacyProgress } from "../src/types";

// 本番コード（legacyToFsrs）は "YYYY-MM-DD" を「ローカル正午」として解釈する。
// テストもローカル正午を基準にしないと、UTCのCIとJSTの手元で経過日数がずれる。
const NOW = new Date(2026, 6, 17, 12, 0, 0);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => ymd(new Date(NOW.getTime() - n * 86_400_000));

// interval を stability として引き継ぐので、これで「安定度Sで、n日前に復習した」カードを作れる
const studied = (stability: number, reviewedDaysAgo: number): LegacyProgress => ({
  reps: 3,
  interval: stability,
  ease: 2.5,
  lastReviewed: daysAgo(reviewedDaysAgo),
  due: daysAgo(reviewedDaysAgo - stability),
});

describe("忘却曲線（想起確率）", () => {
  it("未学習の問題はRを出せない（null）", () => {
    expect(retrievabilityAt({}, NOW)).toBeNull();
    expect(retrievabilityAt({ seen: 3, correct: 1 } as LegacyProgress, NOW)).toBeNull();
  });

  it("最終復習からの経過が長いほどRは下がる", () => {
    const fresh = retrievabilityAt(studied(10, 1), NOW)!;
    const mid = retrievabilityAt(studied(10, 10), NOW)!;
    const old = retrievabilityAt(studied(10, 60), NOW)!;
    expect(fresh).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it("t=S（安定度と同じ日数が経過）でRは約90%になる", () => {
    // FSRSにおける stability の定義そのもの
    expect(retrievabilityAt(studied(10, 10), NOW)!).toBeCloseTo(0.9, 2);
    expect(retrievabilityAt(studied(30, 30), NOW)!).toBeCloseTo(0.9, 2);
  });

  it("同じ経過日数なら、安定度が高いほど忘れにくい", () => {
    const weak = retrievabilityAt(studied(5, 20), NOW)!;
    const strong = retrievabilityAt(studied(50, 20), NOW)!;
    expect(strong).toBeGreaterThan(weak);
  });

  it("曲線は単調に減少し、未学習ならnullを並べて返す", () => {
    const curve = retrievabilityCurve(studied(10, 1), [0, 7, 30, 90], NOW) as number[];
    expect(curve).toHaveLength(4);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThan(curve[i - 1]);
    expect(retrievabilityCurve({}, [0, 7], NOW)).toEqual([null, null]);
  });
});

describe("試験日モードの限界効用", () => {
  const exam = new Date(NOW.getTime() + 30 * 86_400_000);

  it("今日復習すると試験日のRが上がる（伸びは正）", () => {
    expect(examGain(studied(10, 20), exam, NOW)).toBeGreaterThan(0);
  });

  it("忘れかけている問題ほど、復習したときの伸びが大きい", () => {
    const almostForgotten = examGain(studied(10, 60), exam, NOW);
    const wellRemembered = examGain(studied(60, 2), exam, NOW);
    expect(almostForgotten).toBeGreaterThan(wellRemembered);
  });

  it("未学習の問題は伸びがそのまま試験日のRになる（0からの上積み）", () => {
    const gain = examGain({}, exam, NOW);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(1);
  });

  it("最終復習が未来でも例外を投げない（時計ずれへの保険）", () => {
    const future: LegacyProgress = { reps: 2, interval: 10, lastReviewed: "2026-08-01", due: "2026-08-11" };
    expect(() => examGain(future, exam, NOW)).not.toThrow();
    expect(examGain(future, exam, NOW)).toBe(0);
  });
});
