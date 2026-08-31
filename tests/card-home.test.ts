import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getCardHomeSnapshot } from "../src/card-home";
import { db } from "../src/db";
import type { Deck, StudyCard } from "../src/types";

const NOW = "2026-08-26T09:00:00.000Z";

function deck(id: string, order: number): Deck {
  return {
    id, ownerId: null, name: id, description: "", order,
    system: "legacy", subjectId: "civics", originSharedDeckId: null, originVersion: null,
    newCardsPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9,
    version: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null,
  };
}

function card(id: string, deckId: string, suspendedAt: string | null = null): StudyCard {
  return {
    id, ownerId: null, builtIn: false, kind: "basic", deckId,
    front: id, back: "", choices: [], correctChoiceIndex: null, explanation: "", field: "",
    source: "", tags: [], image: null, imageAlt: "", version: 1,
    suspendedAt, originDeckId: null, originVersion: null, originCardId: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
  };
}

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.decks.clear(), db.schedules.clear()]);
});

describe("getCardHomeSnapshot", () => {
  it("デッキ順に新規・復習・休止カードを集計する", async () => {
    await db.decks.bulkPut([
      deck("deck-b", 2),
      deck("deck-a", 1),
      { ...deck("memory-deck", 3), system: "memory", subjectId: "immunology2" },
    ]);
    await db.cards.bulkPut([
      card("new", "deck-a"),
      card("due", "deck-a"),
      card("future", "deck-b"),
      card("suspended", "deck-b", NOW),
      card("memory-card", "memory-deck"),
    ]);
    await db.schedules.bulkPut([
      {
        cardId: "due", due: "2026-08-25T09:00:00.000Z", stability: 2, difficulty: 5,
        elapsedDays: 2, scheduledDays: 2, learningSteps: 0, reps: 1, lapses: 0,
        state: 2, lastReview: "2026-08-23T09:00:00.000Z", updatedAt: NOW,
      },
      {
        cardId: "future", due: "2026-08-30T09:00:00.000Z", stability: 4, difficulty: 5,
        elapsedDays: 1, scheduledDays: 4, learningSteps: 0, reps: 1, lapses: 0,
        state: 2, lastReview: "2026-08-26T08:00:00.000Z", updatedAt: NOW,
      },
    ]);

    const snapshot = await getCardHomeSnapshot(new Date(NOW));

    expect(snapshot).toMatchObject({
      totalCards: 4, activeCards: 3, newCards: 1, dueCards: 1, learnedCards: 2, suspendedCards: 1,
    });
    expect(snapshot.decks.map((item) => item.id)).toEqual(["deck-a", "deck-b"]);
    expect(snapshot.decks[0]).toMatchObject({ totalCards: 2, newCards: 1, dueCards: 1, learnedCards: 1 });
    expect(snapshot.decks[1]).toMatchObject({ totalCards: 2, activeCards: 1, suspendedCards: 1, dueCards: 0 });
  });
});
