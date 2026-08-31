import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { StudyDatabase } from "../src/db";

describe("StudyDatabase", () => {
  const databases: StudyDatabase[] = [];

  afterEach(async () => {
    for (const database of databases) {
      database.close();
      await database.delete();
    }
    databases.length = 0;
  });

  it("カードと復習予定をIndexedDBへ保存できる", async () => {
    const database = new StudyDatabase();
    databases.push(database);
    await database.cards.put({
      id: "card-1", ownerId: null, builtIn: false, kind: "basic", deckId: "deck-personal",
      front: "表", back: "裏", choices: [], correctChoiceIndex: null, explanation: "", field: "",
      source: "自作", tags: [], image: null, imageAlt: "", version: 1,
      suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
      createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", deletedAt: null,
    });
    expect((await database.cards.get("card-1"))?.back).toBe("裏");
  });

  it("v2のカードとデッキへ最新の既定値を補完する", async () => {
    const legacy = new Dexie("civics-study-v1");
    legacy.version(2).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, *tags",
      decks: "&id, ownerId, order, updatedAt, deletedAt",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
      writtenAttempts: "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
      writtenDrafts: "&id, subjectId, questionId, examSessionId, updatedAt",
    });
    await legacy.table("cards").put({
      id: "legacy-card", ownerId: null, builtIn: false, kind: "basic", deckId: "legacy-deck",
      front: "旧カード", back: "", choices: [], correctChoiceIndex: null, explanation: "", field: "",
      source: "", tags: [], image: null, imageAlt: "", version: 1,
      createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", deletedAt: null,
    });
    await legacy.table("decks").put({
      id: "legacy-deck", ownerId: null, name: "旧デッキ", description: "", order: 0, version: 1,
      createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", deletedAt: null,
    });
    legacy.close();

    const database = new StudyDatabase();
    databases.push(database);
    const card = await database.cards.get("legacy-card");
    const deck = await database.decks.get("legacy-deck");

    expect(card).toMatchObject({ suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null });
    expect(deck).toMatchObject({
      newCardsPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9,
      system: "legacy", subjectId: "civics", originSharedDeckId: null, originVersion: null,
    });
  });
});
