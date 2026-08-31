import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

// node 環境には localStorage が無いので最小実装を注入する（ブラウザでは native を使用）
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}
globalThis.localStorage = createMemoryStorage();

import { db, nowIso } from "../src/db";
import {
  mirrorSchedulesToLegacy,
  readLegacyProgress,
  restoreLegacyState,
  saveLegacyState,
  writeLegacyProgress,
} from "../src/legacy-bridge";
import type { StoredSchedule } from "../src/types";

const PROGRESS_KEY = "quizProgress_v1";
const LEGACY_STATE_KEY = "legacyProgress";

function schedule(cardId: string, due: string, scheduledDays: number, reps: number): StoredSchedule {
  return {
    cardId,
    due,
    stability: scheduledDays,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays,
    learningSteps: 0,
    reps,
    lapses: 0,
    state: 2,
    lastReview: "2026-07-10T00:00:00.000Z",
    updatedAt: nowIso(),
  };
}

beforeEach(async () => {
  localStorage.clear();
  await db.schedules.clear();
  await db.settings.clear();
  await db.outbox.clear();
});

describe("legacy-bridge", () => {
  it("mirrorSchedulesToLegacy は Dexie 予定を進捗の SRS フィールドへ反映し、非SRSフィールドを温存する", async () => {
    writeLegacyProgress({
      c1: { seen: 3, correct: 2, wrong: 1, streak: 1, weak: false, bookmarked: true },
    });
    await db.schedules.put(schedule("c1", "2026-07-20T09:00:00.000Z", 8, 4));

    const changed = await mirrorSchedulesToLegacy();
    expect(changed).toBe(true);

    const record = readLegacyProgress().c1;
    expect(record.due).toBe("2026-07-20");
    expect(record.reps).toBe(4);
    expect(record.interval).toBe(8);
    // 非SRSフィールドは保持される
    expect(record.bookmarked).toBe(true);
    expect(record.seen).toBe(3);
  });

  it("saveLegacyState → restoreLegacyState でブックマークと統計が別端末へ復元される", async () => {
    writeLegacyProgress({
      c1: { seen: 4, correct: 2, wrong: 2, streak: 0, weak: false, bookmarked: true },
    });
    await saveLegacyState(readLegacyProgress());

    // 別端末を模して localStorage を空にしてから復元
    localStorage.clear();
    const changed = await restoreLegacyState();
    expect(changed).toBe(true);

    const record = readLegacyProgress().c1;
    expect(record.bookmarked).toBe(true);
    expect(record.wrong).toBe(2);
    // weak は wrong>=2 && streak<2 から再導出される
    expect(record.weak).toBe(true);
  });

  it("restoreLegacyState はカウンタを max、bookmark を OR で union マージする", async () => {
    await db.settings.put({
      key: LEGACY_STATE_KEY,
      ownerId: null,
      value: { c1: { seen: 5, correct: 5, wrong: 0, streak: 3, bookmarked: false } },
      updatedAt: nowIso(),
    });
    writeLegacyProgress({
      c1: { seen: 2, correct: 1, wrong: 1, streak: 0, weak: false, bookmarked: true },
    });

    await restoreLegacyState();

    const record = readLegacyProgress().c1;
    expect(record.seen).toBe(5); // max
    expect(record.wrong).toBe(1); // max(1,0)
    expect(record.streak).toBe(3); // max
    expect(record.bookmarked).toBe(true); // OR
    expect(record.weak).toBe(false); // wrong(1) < 2
  });

  it("saveLegacyState は未送信の同キー outbox を1件に保つ（ゲストでも肥大しない）", async () => {
    writeLegacyProgress({ c1: { seen: 1, correct: 1, wrong: 0, streak: 1, weak: false, bookmarked: true } });
    await saveLegacyState(readLegacyProgress());
    await saveLegacyState(readLegacyProgress());
    await saveLegacyState(readLegacyProgress());
    const pending = await db.outbox.where("recordId").equals(LEGACY_STATE_KEY).count();
    expect(pending).toBe(1);
  });

  it("readLegacyProgress は壊れた JSON でも空オブジェクトを返す", () => {
    localStorage.setItem(PROGRESS_KEY, "{壊れた");
    expect(readLegacyProgress()).toEqual({});
  });
});
