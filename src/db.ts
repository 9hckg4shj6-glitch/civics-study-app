import Dexie, { type EntityTable } from "dexie";
import type {
  Deck,
  MemoryMark,
  OutboxRecord,
  ReviewEvent,
  SettingRecord,
  StoredSchedule,
  StudyCard,
  SyncTable,
  WrittenAttempt,
  WrittenDraft,
} from "./types";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
} from "./types";

export class StudyDatabase extends Dexie {
  cards!: EntityTable<StudyCard, "id">;
  decks!: EntityTable<Deck, "id">;
  reviewEvents!: EntityTable<ReviewEvent, "id">;
  schedules!: EntityTable<StoredSchedule, "cardId">;
  outbox!: EntityTable<OutboxRecord, "seq">;
  settings!: EntityTable<SettingRecord, "key">;
  /** 記述問題の採点済み・提出済み答案（仕様書 §10.2） */
  writtenAttempts!: EntityTable<WrittenAttempt, "id">;
  /** 入力途中の下書き。ローカル専用で同期・バックアップの対象外 */
  writtenDrafts!: EntityTable<WrittenDraft, "id">;
  /** 暗記カードの「覚えた／まだ」。端末内だけで持つ（同期しない） */
  memoryMarks!: EntityTable<MemoryMark, "cardId">;

  constructor() {
    super("civics-study-v1");
    this.version(1).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, *tags",
      decks: "&id, ownerId, order, updatedAt, deletedAt",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
    });
    // version 1 の定義は消さずに追加する（既存データの移行処理は不要）
    this.version(2).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, *tags",
      decks: "&id, ownerId, order, updatedAt, deletedAt",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
      writtenAttempts: "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
      writtenDrafts: "&id, subjectId, questionId, examSessionId, updatedAt",
    });
    this.version(3).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, suspendedAt, originDeckId, [originDeckId+originCardId], *tags",
      decks: "&id, ownerId, order, updatedAt, deletedAt",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
      writtenAttempts: "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
      writtenDrafts: "&id, subjectId, questionId, examSessionId, updatedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("cards").toCollection().modify((card: Partial<StudyCard>) => {
        card.suspendedAt ??= null;
        card.originDeckId ??= null;
        card.originVersion ??= null;
        card.originCardId ??= null;
      });
      await transaction.table("decks").toCollection().modify((deck: Partial<Deck>) => {
        deck.newCardsPerDay ??= DEFAULT_NEW_CARDS_PER_DAY;
        deck.reviewsPerDay ??= DEFAULT_REVIEWS_PER_DAY;
        deck.desiredRetention ??= DEFAULT_DESIRED_RETENTION;
      });
    });
    this.version(4).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, suspendedAt, originDeckId, [originDeckId+originCardId], *tags",
      decks: "&id, ownerId, system, subjectId, [system+subjectId], order, updatedAt, deletedAt, originSharedDeckId",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
      writtenAttempts: "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
      writtenDrafts: "&id, subjectId, questionId, examSessionId, updatedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("decks").toCollection().modify((deck: Partial<Deck>) => {
        deck.system ??= "legacy";
        deck.subjectId ??= "civics";
        deck.originSharedDeckId ??= null;
        deck.originVersion ??= null;
      });
    });
    this.version(5).stores({
      cards: "&id, ownerId, deckId, kind, updatedAt, deletedAt, suspendedAt, originDeckId, [originDeckId+originCardId], *tags",
      decks: "&id, ownerId, system, subjectId, [system+subjectId], order, updatedAt, deletedAt, originSharedDeckId",
      reviewEvents: "&id, ownerId, cardId, reviewedAt, [cardId+reviewedAt], syncedAt",
      schedules: "&cardId, due, state, updatedAt",
      outbox: "++seq, &operationId, table, recordId, status, createdAt",
      settings: "&key, ownerId, updatedAt",
      writtenAttempts: "&id, subjectId, questionId, gradedAt, updatedAt, syncedAt, [questionId+gradedAt]",
      writtenDrafts: "&id, subjectId, questionId, examSessionId, updatedAt",
      memoryMarks: "&cardId, deckId, status, updatedAt",
    });
  }
}

export const db = new StudyDatabase();

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function enqueue(
  table: SyncTable,
  recordId: string,
  operation: OutboxRecord["operation"],
  payload: Record<string, unknown>,
): Promise<void> {
  await db.outbox.add({
    operationId: uuid(),
    table,
    recordId,
    operation,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: "pending",
    lastError: null,
  });
}

export async function saveCard(card: StudyCard, queue = true): Promise<void> {
  await db.cards.put(card);
  if (queue && !card.builtIn) {
    await enqueue("cards", card.id, card.deletedAt ? "delete" : "upsert", card as unknown as Record<string, unknown>);
  }
}

export async function saveDeck(deck: Deck, queue = true): Promise<void> {
  await db.decks.put(deck);
  if (queue) await enqueue("decks", deck.id, deck.deletedAt ? "delete" : "upsert", deck as unknown as Record<string, unknown>);
}

export async function saveSetting(setting: SettingRecord, queue = true): Promise<void> {
  await db.settings.put(setting);
  if (queue) await enqueue("settings", setting.key, "upsert", setting as unknown as Record<string, unknown>);
}

export async function getDeviceId(): Promise<string> {
  const existing = await db.settings.get("deviceId");
  if (typeof existing?.value === "string") return existing.value;
  const value = uuid();
  await saveSetting({ key: "deviceId", ownerId: null, value, updatedAt: nowIso() }, false);
  return value;
}
