import { describe, expect, it } from "vitest";
import { cardSchema, importBundleSchema } from "../src/schema";

const baseCard = {
  id: "card-1",
  ownerId: null,
  builtIn: false,
  kind: "basic" as const,
  deckId: "deck-personal",
  front: "ATPとは何か",
  back: "アデノシン三リン酸",
  choices: [],
  correctChoiceIndex: null,
  explanation: "",
  field: "生化学",
  source: "自作",
  tags: ["ATP"],
  image: null,
  imageAlt: "",
  version: 1,
  suspendedAt: null,
  originDeckId: null,
  originVersion: null,
  originCardId: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  deletedAt: null,
};

describe("cardSchema", () => {
  it("基本カードを受理する", () => {
    expect(cardSchema.parse(baseCard).front).toBe("ATPとは何か");
  });

  it("選択肢不足を拒否する", () => {
    const result = cardSchema.safeParse({ ...baseCard, kind: "multiple-choice", choices: ["1個だけ"], correctChoiceIndex: 0 });
    expect(result.success).toBe(false);
  });

  it("範囲外の正解番号を拒否する", () => {
    const result = cardSchema.safeParse({ ...baseCard, kind: "multiple-choice", choices: ["A", "B"], correctChoiceIndex: 2 });
    expect(result.success).toBe(false);
  });

  it("共有元情報の一部だけがあるカードを拒否する", () => {
    const result = cardSchema.safeParse({ ...baseCard, originDeckId: "shared-deck" });
    expect(result.success).toBe(false);
  });
});

describe("importBundleSchema", () => {
  it("v2バックアップへv3の既定値を補完する", () => {
    const {
      suspendedAt: _suspendedAt,
      originDeckId: _originDeckId,
      originVersion: _originVersion,
      originCardId: _originCardId,
      ...v2Card
    } = baseCard;
    const parsed = importBundleSchema.parse({
      app: "civics-study",
      schemaVersion: 2,
      exportedAt: "2026-08-26T00:00:00.000Z",
      cards: [v2Card],
      decks: [{ id: "deck-personal", name: "自作", description: "", order: 0 }],
      reviewEvents: [],
    });

    expect(parsed.cards[0]).toMatchObject({
      suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
    });
    expect(parsed.decks[0]).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9,
      system: "legacy", subjectId: "civics", originSharedDeckId: null, originVersion: null,
    });
  });
});
