import { describe, expect, it } from "vitest";
import { cardToStored, legacyToFsrs, storedToCard } from "../src/fsrs";

describe("FSRS migration", () => {
  it("未学習カードをNewとして作成する", () => {
    const card = legacyToFsrs({}, new Date("2026-07-13T00:00:00.000Z"));
    expect(card.reps).toBe(0);
    expect(card.state).toBe(0);
  });

  it("旧間隔と予定日を保持してReviewへ移行する", () => {
    const card = legacyToFsrs({ reps: 4, interval: 12, ease: 2.5, due: "2026-07-20", lastReviewed: "2026-07-08", wrong: 1 });
    expect(card.reps).toBe(4);
    expect(card.stability).toBe(12);
    expect(card.state).toBe(2);
    expect(card.due.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("保存形式との往復で主要値を維持する", () => {
    const original = legacyToFsrs({ reps: 2, interval: 3, due: "2026-07-16", lastReviewed: "2026-07-13" });
    const restored = storedToCard(cardToStored("card-1", original));
    expect(restored.due.toISOString()).toBe(original.due.toISOString());
    expect(restored.stability).toBe(original.stability);
    expect(restored.reps).toBe(original.reps);
  });
});
