import { z } from "zod";
import { db, nowIso } from "./db";
import { cardSchema, deckSchema } from "./schema";
import { mirrorCustomCardsToLegacy } from "./migration";
import { mirrorSchedulesToLegacy } from "./legacy-bridge";
import {
  type Deck,
  type MemoryMark,
  type ReviewEvent,
  type StoredSchedule,
  type StudyCard,
} from "./types";

/**
 * 手動バックアップ（設定・データ）に載せる、IndexedDB 側の学習データ。
 * localStorage の progress / meta は index.html が別に持つので、ここでは扱わない。
 */
export interface StudyBackup {
  decks: Deck[];
  cards: StudyCard[];
  reviewEvents: Array<Omit<ReviewEvent, "ownerId" | "syncedAt">>;
  schedules: StoredSchedule[];
  memoryMarks: MemoryMark[];
}

const reviewEventSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  deviceId: z.string(),
  rating: z.number().int().min(1).max(4),
  reviewedAt: z.string().datetime(),
  durationMs: z.number().nullable().default(null),
});

const scheduleSchema = z.object({
  cardId: z.string().min(1),
  due: z.string().min(1),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: z.number().default(0),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.number().int(),
  lastReview: z.string().nullable().default(null),
  updatedAt: z.string().default(() => nowIso()),
});

const memoryMarkSchema = z.object({
  cardId: z.string().min(1),
  deckId: z.string().min(1),
  status: z.enum(["known", "unsure"]),
  updatedAt: z.string().default(() => nowIso()),
});

/** 壊れた1件でバックアップ全体を捨てないよう、行ごとに検証して通ったものだけ返す。 */
const studyBackupSchema = z.object({
  decks: z.array(z.unknown()).default([]),
  cards: z.array(z.unknown()).default([]),
  reviewEvents: z.array(z.unknown()).default([]),
  schedules: z.array(z.unknown()).default([]),
  memoryMarks: z.array(z.unknown()).default([]),
});

function keepValid<T>(rows: unknown[], schema: z.ZodType<T>): { rows: T[]; skipped: number } {
  const out: T[] = [];
  let skipped = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else skipped += 1;
  }
  return { rows: out, skipped };
}

export async function exportStudyData(): Promise<StudyBackup> {
  return {
    decks: await db.decks.toArray(),
    // 組み込みカードは教材から毎回作り直せるので持ち出さない。
    cards: await db.cards.filter((card) => !card.builtIn).toArray(),
    reviewEvents: (await db.reviewEvents.toArray()).map(
      ({ syncedAt: _syncedAt, ownerId: _ownerId, ...event }) => event,
    ),
    schedules: await db.schedules.toArray(),
    memoryMarks: await db.memoryMarks.toArray(),
  };
}

export interface ImportStudyResult {
  imported: number;
  skipped: number;
}

/**
 * バックアップの学習データを取り込む。replace ならこの端末の該当テーブルを先に空にする。
 * 取り込み後は localStorage 側（ホームの復習予定・自作カード一覧）へ反映する。
 */
export async function importStudyData(
  payload: unknown,
  options: { replace?: boolean } = {},
): Promise<ImportStudyResult> {
  const outer = studyBackupSchema.safeParse(payload);
  if (!outer.success) return { imported: 0, skipped: 0 };
  const raw = outer.data;

  const decks = keepValid(raw.decks, deckSchema);
  const cards = keepValid(raw.cards, cardSchema);
  const events = keepValid(raw.reviewEvents, reviewEventSchema);
  const schedules = keepValid(raw.schedules, scheduleSchema);
  const marks = keepValid(raw.memoryMarks, memoryMarkSchema);
  const skipped = decks.skipped + cards.skipped + events.skipped + schedules.skipped + marks.skipped;

  const timestamp = nowIso();
  await db.transaction(
    "rw",
    db.cards, db.decks, db.reviewEvents, db.schedules, db.memoryMarks,
    async () => {
      if (options.replace) {
        await db.cards.filter((card) => !card.builtIn).delete();
        await db.decks.clear();
        await db.reviewEvents.clear();
        await db.schedules.clear();
        await db.memoryMarks.clear();
      }
      // deckSchema が newCardsPerDay などの既定値を補うので、ここでは詰め直さない。
      await db.decks.bulkPut(decks.rows.map((deck) => ({
        ...deck,
        ownerId: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }) as Deck));
      await db.cards.bulkPut(cards.rows as StudyCard[]);
      await db.reviewEvents.bulkPut(events.rows.map((event) => ({
        ...event,
        rating: event.rating as 1 | 2 | 3 | 4,
        ownerId: null,
        syncedAt: null,
      })));
      await db.schedules.bulkPut(schedules.rows as StoredSchedule[]);
      await db.memoryMarks.bulkPut(marks.rows as MemoryMark[]);
    },
  );

  await mirrorCustomCardsToLegacy();
  await mirrorSchedulesToLegacy();
  return {
    imported: decks.rows.length + cards.rows.length + events.rows.length + schedules.rows.length + marks.rows.length,
    skipped,
  };
}
