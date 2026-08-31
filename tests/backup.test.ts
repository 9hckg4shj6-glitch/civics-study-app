import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// node 環境には localStorage が無いので最小実装を注入する（ブラウザでは native を使用）
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.has(key) ? (store.get(key) as string) : null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, String(value)); },
  } as Storage;
}
globalThis.localStorage = createMemoryStorage();
// 取り込み後に旧UI（index.html 側）へ反映する処理が window を触るので、器だけ用意する
(globalThis as any).window = globalThis;

import { db, uuid } from "../src/db";
import { exportStudyData, importStudyData } from "../src/backup";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type Deck,
  type StudyCard,
} from "../src/types";

/* 手動バックアップ（実装計画 §9）の往復試験。
   端末を移したときに、暗記カード・デッキ・復習予定・「覚えた／まだ」が
   そのまま復元されることを確かめる。 */

const NOW = "2026-08-31T00:00:00.000Z";

function deck(id: string, name: string): Deck {
  return {
    id, ownerId: null, system: "memory", subjectId: "civics",
    originSharedDeckId: null, originVersion: null,
    name, description: "", order: 0,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
  };
}

function card(id: string, deckId: string, front: string): StudyCard {
  return {
    id, ownerId: null, builtIn: false, kind: "basic", deckId,
    front, back: "うら", choices: [], correctChoiceIndex: null,
    explanation: "", field: "政治", source: "", tags: ["国会"],
    image: null, imageAlt: "", version: 1, suspendedAt: null,
    originDeckId: null, originVersion: null, originCardId: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
  };
}

async function seed(): Promise<void> {
  await db.decks.put(deck("deck-1", "国会のはたらき"));
  await db.cards.put(card("card-1", "deck-1", "衆議院の優越が認められるのは？"));
  await db.cards.put(card("card-2", "deck-1", "内閣不信任決議ができるのは？"));
  await db.reviewEvents.put({
    id: uuid(), ownerId: null, cardId: "card-1", deviceId: "dev-1",
    rating: 3, reviewedAt: NOW, durationMs: 4200, syncedAt: null,
  });
  await db.schedules.put({
    cardId: "card-1", due: "2026-09-07T00:00:00.000Z", stability: 8.5, difficulty: 5.1,
    elapsedDays: 1, scheduledDays: 7, learningSteps: 0, reps: 2, lapses: 0, state: 2,
    lastReview: NOW, updatedAt: NOW,
  });
  await db.memoryMarks.put({ cardId: "card-2", deckId: "deck-1", status: "unsure", updatedAt: NOW });
}

async function clearAll(): Promise<void> {
  await db.cards.clear();
  await db.decks.clear();
  await db.reviewEvents.clear();
  await db.schedules.clear();
  await db.memoryMarks.clear();
  await db.outbox.clear();
  await db.settings.clear();
}

describe("手動バックアップの往復", () => {
  beforeEach(async () => { await clearAll(); await seed(); });
  afterEach(async () => { await clearAll(); });

  it("書き出した内容を空の端末へ復元すると、元と一致する", async () => {
    const backup = JSON.parse(JSON.stringify(await exportStudyData()));
    expect(backup.decks).toHaveLength(1);
    expect(backup.cards).toHaveLength(2);
    expect(backup.schedules).toHaveLength(1);
    expect(backup.memoryMarks).toHaveLength(1);

    await clearAll();                       // 別端末に見立てる
    expect(await db.cards.count()).toBe(0);

    const result = await importStudyData(backup, { replace: true });
    expect(result.skipped).toBe(0);

    expect(await db.decks.count()).toBe(1);
    expect(await db.cards.count()).toBe(2);
    expect((await db.cards.get("card-1"))!.front).toBe("衆議院の優越が認められるのは？");
    // FSRSの復習予定が日付ごと戻る
    const schedule = await db.schedules.get("card-1");
    expect(schedule!.due).toBe("2026-09-07T00:00:00.000Z");
    expect(schedule!.reps).toBe(2);
    // 「覚えた／まだ」も戻る
    expect((await db.memoryMarks.get("card-2"))!.status).toBe("unsure");
    expect(await db.reviewEvents.count()).toBe(1);
  });

  it("replace 指定では、取り込み先に残っていた自作カードを消してから入れ替える", async () => {
    const backup = JSON.parse(JSON.stringify(await exportStudyData()));
    await db.cards.put(card("card-old", "deck-1", "この端末にしかない古いカード"));

    await importStudyData(backup, { replace: true });
    expect(await db.cards.get("card-old")).toBeUndefined();
    expect(await db.cards.count()).toBe(2);
  });

  it("統合（replace なし）では、この端末のカードを消さない", async () => {
    const backup = JSON.parse(JSON.stringify(await exportStudyData()));
    await clearAll();
    await db.decks.put(deck("deck-2", "この端末だけのデッキ"));
    await db.cards.put(card("card-old", "deck-2", "この端末だけのカード"));

    await importStudyData(backup, { replace: false });
    expect(await db.cards.get("card-old")).toBeTruthy();
    expect(await db.cards.count()).toBe(3);
    expect(await db.decks.count()).toBe(2);
  });

  it("壊れた行は取り込まず、健全な行だけを入れる", async () => {
    const backup: any = JSON.parse(JSON.stringify(await exportStudyData()));
    backup.cards.push({ id: "", front: "" });                    // 必須項目が空
    backup.schedules.push({ cardId: "card-9" });                 // 予定の中身が無い
    backup.memoryMarks.push({ cardId: "card-9", deckId: "d", status: "maybe", updatedAt: NOW });

    const result = await importStudyData(backup, { replace: true });
    expect(result.skipped).toBe(3);
    expect(await db.cards.count()).toBe(2);
    expect(await db.schedules.count()).toBe(1);
    expect(await db.memoryMarks.count()).toBe(1);
  });

  it("バックアップでないものを渡しても壊れず、何も取り込まない", async () => {
    for (const bad of [null, undefined, 42, "文字列", [], { decks: "配列ではない" }]) {
      const result = await importStudyData(bad as unknown);
      expect(result.imported).toBe(0);
    }
    // 元のデータは無傷
    expect(await db.cards.count()).toBe(2);
  });
});
