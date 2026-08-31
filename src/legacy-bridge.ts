import { db, nowIso, saveSetting } from "./db";
import type { LegacyProgress } from "./types";

/**
 * 旧 index.html（localStorage の `quizProgress_v1`）と、新 Dexie/FSRS/同期 の橋渡し。
 *
 * 背景（このモジュールが解決する2つの穴）:
 *  - W1: ホームの「今日の復習/次回予定」は localStorage 進捗の `due` を読むが、
 *        同期pullは Dexie の schedules しか更新しないため、別端末の復習がホームに出なかった。
 *  - W2: ブックマーク/苦手/演習統計は localStorage のみで、端末間で同期されなかった。
 *
 * 方針:
 *  - SRS 予定は review_events を真実とし、Dexie schedules → localStorage 進捗へ「反映」する（W1）。
 *  - 非SRSの学習状態（ブックマーク・演習統計）は settings レコードとして同期する（W2）。
 *    `weak` は wrong/streak から導出できるので保存せず、取り込み時に再計算する。
 */

const PROGRESS_KEY = "civicsProgress_v1"; // index.html の STORE_KEY と一致
const LEGACY_STATE_KEY = "legacyProgress"; // settings テーブルのキー
// index.html の WEAK_WRONGS / MASTER_HITS と一致させる（weak は導出値）
const WEAK_WRONGS = 2;
const MASTER_HITS = 2;

type ProgressMap = Record<string, LegacyProgress>;
/** 同期する非SRSフィールドだけを抜き出したコンパクト表現 */
type LegacyState = Pick<LegacyProgress, "seen" | "correct" | "wrong" | "streak" | "bookmarked" | "lastWrong">;

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function readLegacyProgress(): ProgressMap {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function writeLegacyProgress(progress: ProgressMap): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 容量超過などは無視 */
  }
}

function refreshLegacyUi(): void {
  if (typeof window !== "undefined") window.__legacyAppRefresh?.();
}

function toDateOnly(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankRecord(): LegacyProgress {
  return { seen: 0, correct: 0, wrong: 0, streak: 0, weak: false, bookmarked: false };
}

/**
 * Dexie の FSRS 予定を localStorage 進捗の SRS フィールド（due/reps/interval/lastReviewed/fsrs）へ反映。
 * 同期後や起動時に呼び、ホームの復習予定を Dexie と一致させる。非SRSフィールドは温存する。
 * 変更があれば true。
 */
export async function mirrorSchedulesToLegacy(): Promise<boolean> {
  const schedules = await db.schedules.toArray();
  if (!schedules.length) return false;
  const progress = readLegacyProgress();
  let changed = false;
  for (const schedule of schedules) {
    const record = progress[schedule.cardId] ?? blankRecord();
    const due = toDateOnly(schedule.due);
    const interval = Math.max(0, Math.round(schedule.scheduledDays));
    const lastReviewed = schedule.lastReview ? toDateOnly(schedule.lastReview) : record.lastReviewed;
    if (record.due !== due || record.reps !== schedule.reps || record.interval !== interval) changed = true;
    record.due = due;
    record.reps = schedule.reps;
    record.interval = interval;
    if (lastReviewed) record.lastReviewed = lastReviewed;
    record.fsrs = schedule;
    progress[schedule.cardId] = record;
  }
  if (changed) {
    writeLegacyProgress(progress);
    refreshLegacyUi();
  }
  return changed;
}

function toLegacyState(progress: ProgressMap): Record<string, LegacyState> {
  const compact: Record<string, LegacyState> = {};
  for (const [id, record] of Object.entries(progress)) {
    if (!record || typeof record !== "object") continue;
    if (record.bookmarked || record.seen || record.correct || record.wrong) {
      compact[id] = {
        seen: record.seen ?? 0,
        correct: record.correct ?? 0,
        wrong: record.wrong ?? 0,
        streak: record.streak ?? 0,
        bookmarked: Boolean(record.bookmarked),
        ...(record.lastWrong ? { lastWrong: record.lastWrong } : {}),
      };
    }
  }
  return compact;
}

/**
 * 非SRSの学習状態（ブックマーク・演習統計）を settings レコードへ保存する。
 * このアプリは端末内だけで完結するので、未送信の同キーは1件に保って outbox を肥大させない。
 */
export async function saveLegacyState(progress: ProgressMap): Promise<void> {
  const compact = toLegacyState(progress);
  const dupes = await db.outbox.where("recordId").equals(LEGACY_STATE_KEY).toArray();
  for (const item of dupes) {
    if (item.seq != null && item.status === "pending" && item.table === "settings") {
      await db.outbox.delete(item.seq);
    }
  }
  await saveSetting({ key: LEGACY_STATE_KEY, ownerId: null, value: compact, updatedAt: nowIso() });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgress: ProgressMap | null = null;

/** index.html の saveProgress から高頻度で呼ばれるので、2秒デバウンスしてまとめて保存する。 */
export function queueLegacyStateSave(progress: ProgressMap): void {
  pendingProgress = progress;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = pendingProgress;
    pendingProgress = null;
    if (snapshot) void saveLegacyState(snapshot);
  }, 2000);
}

/**
 * 同期で取り込んだ settings(legacyProgress) を localStorage 進捗へ union マージする。
 * カウンタは max、bookmarked は OR、weak は wrong/streak から再導出。変更があれば true。
 */
export async function restoreLegacyState(): Promise<boolean> {
  const setting = await db.settings.get(LEGACY_STATE_KEY);
  const remote = setting?.value as Record<string, LegacyState> | undefined;
  if (!remote || typeof remote !== "object") return false;
  const progress = readLegacyProgress();
  let changed = false;
  for (const [id, incoming] of Object.entries(remote)) {
    if (!incoming || typeof incoming !== "object") continue;
    const local = progress[id] ?? blankRecord();
    const seen = Math.max(local.seen ?? 0, incoming.seen ?? 0);
    const correct = Math.max(local.correct ?? 0, incoming.correct ?? 0);
    const wrong = Math.max(local.wrong ?? 0, incoming.wrong ?? 0);
    const streak = Math.max(local.streak ?? 0, incoming.streak ?? 0);
    const bookmarked = Boolean(local.bookmarked || incoming.bookmarked);
    const lastWrong = [local.lastWrong, incoming.lastWrong]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop();
    const weak = wrong >= WEAK_WRONGS && streak < MASTER_HITS;
    if (
      local.seen !== seen ||
      local.correct !== correct ||
      local.wrong !== wrong ||
      local.streak !== streak ||
      local.bookmarked !== bookmarked ||
      local.weak !== weak ||
      local.lastWrong !== lastWrong
    ) {
      changed = true;
    }
    local.seen = seen;
    local.correct = correct;
    local.wrong = wrong;
    local.streak = streak;
    local.bookmarked = bookmarked;
    local.weak = weak;
    if (lastWrong) local.lastWrong = lastWrong;
    progress[id] = local;
  }
  if (changed) writeLegacyProgress(progress);
  return changed;
}

/**
 * 同期直後（study:sync-changed）に呼ぶ統合処理:
 * 非SRS状態を復元 → SRS予定を反映 → 収束のため settings を再保存 → ホーム再描画。
 */
export async function reconcileLegacyAfterSync(): Promise<void> {
  const restored = await restoreLegacyState();
  const mirrored = await mirrorSchedulesToLegacy();
  if (restored) {
    await saveLegacyState(readLegacyProgress()); // union結果を settings へ収束
  }
  if (restored || mirrored) refreshLegacyUi();
}
