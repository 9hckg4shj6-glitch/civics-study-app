import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { db, enqueue, getDeviceId, nowIso, uuid } from "./db";
import type { LegacyProgress, ReviewEvent, ReviewRating, StoredSchedule } from "./types";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export function legacyToFsrs(progress: LegacyProgress, now = new Date()): FsrsCard {
  const stored = progress.fsrs;
  if (stored) return storedToCard(stored);

  const reps = Math.max(0, progress.reps ?? 0);
  if (!reps && !progress.lastReviewed) return createEmptyCard(now);

  const interval = Math.max(1, progress.interval ?? 1);
  const ease = Math.max(1.3, Math.min(2.8, progress.ease ?? 2.5));
  const due = progress.due ? new Date(`${progress.due}T12:00:00`) : new Date(now.getTime() + interval * 86_400_000);
  const lastReview = progress.lastReviewed
    ? new Date(`${progress.lastReviewed}T12:00:00`)
    : new Date(due.getTime() - interval * 86_400_000);

  return {
    due,
    stability: interval,
    difficulty: Math.max(1, Math.min(10, 11 - ease * 2.6)),
    elapsed_days: interval,
    scheduled_days: interval,
    learning_steps: 0,
    reps,
    lapses: Math.max(0, progress.wrong ?? 0),
    state: State.Review,
    last_review: lastReview,
  };
}

export function cardToStored(cardId: string, card: FsrsCard): StoredSchedule {
  return {
    cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString() ?? null,
    updatedAt: nowIso(),
  };
}

export function storedToCard(card: StoredSchedule): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  };
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function scheduleReview(
  cardId: string,
  progress: LegacyProgress,
  rating: ReviewRating,
  reviewedAt = new Date(),
  durationMs: number | null = null,
): LegacyProgress {
  const result = scheduler.next(legacyToFsrs(progress, reviewedAt), reviewedAt, rating as Grade);
  const stored = cardToStored(cardId, result.card);
  progress.reps = result.card.reps;
  progress.interval = Math.max(0, result.card.scheduled_days);
  progress.due = toDateOnly(result.card.due);
  progress.lastReviewed = toDateOnly(reviewedAt);
  progress.fsrs = stored;
  void persistReview(cardId, rating, stored, reviewedAt, durationMs);
  return progress;
}

async function persistReview(
  cardId: string,
  rating: ReviewRating,
  schedule: StoredSchedule,
  reviewedAt: Date,
  durationMs: number | null,
): Promise<void> {
  const event: ReviewEvent = {
    id: uuid(),
    ownerId: null,
    cardId,
    deviceId: await getDeviceId(),
    rating,
    reviewedAt: reviewedAt.toISOString(),
    durationMs,
    syncedAt: null,
  };
  await db.transaction("rw", db.reviewEvents, db.schedules, db.outbox, async () => {
    await db.reviewEvents.add(event);
    await db.schedules.put(schedule);
    await enqueue("review_events", event.id, "upsert", event as unknown as Record<string, unknown>);
  });
  window.dispatchEvent(new CustomEvent("study:review-saved", { detail: event }));
}

export async function rebuildScheduleFromEvents(cardId: string): Promise<StoredSchedule> {
  const events = await db.reviewEvents.where("cardId").equals(cardId).sortBy("reviewedAt");
  const ordered = events.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id));
  let card = createEmptyCard(new Date(ordered[0]?.reviewedAt ?? Date.now()));
  for (const event of ordered) card = scheduler.next(card, new Date(event.reviewedAt), event.rating as Grade).card;
  const stored = cardToStored(cardId, card);
  await db.schedules.put(stored);
  return stored;
}

export async function undoLastReview(cardId: string): Promise<StoredSchedule | null> {
  const events = await db.reviewEvents.where("cardId").equals(cardId).sortBy("reviewedAt");
  const latest = events.at(-1);
  if (!latest) return null;
  await db.reviewEvents.delete(latest.id);
  const queued = await db.outbox.where("recordId").equals(latest.id).toArray();
  await db.outbox.bulkDelete(queued.flatMap((item) => item.seq == null ? [] : [item.seq]));
  if (latest.syncedAt || latest.ownerId) {
    await enqueue("review_events", latest.id, "delete", latest as unknown as Record<string, unknown>);
  }
  return rebuildScheduleFromEvents(cardId);
}

/* ---------- 忘却曲線（可視化・優先順位付け） ----------
   FSRSは各カードの stability（＝R が90%まで下がるまでの日数）を持っている。
   ここから任意の日時の想起確率 R を引けるが、これまで保存するだけで使っていなかった。 */

// 一度も復習していないカードは忘却曲線を描けないので null を返す
function reviewedCard(progress: LegacyProgress, at: Date): FsrsCard | null {
  if (!progress) return null;
  if (!progress.fsrs && !progress.reps && !progress.lastReviewed) return null;
  const card = legacyToFsrs(progress, at);
  if (card.state === State.New || !card.last_review) return null;
  return card;
}

// 指定時点の想起確率（0〜1）。未学習は null。
export function retrievabilityAt(progress: LegacyProgress, at: Date = new Date()): number | null {
  const card = reviewedCard(progress, at);
  if (!card) return null;
  return scheduler.get_retrievability(card, at, false) as number;
}

// 何日後にRがどうなるかをまとめて返す（グラフ用。カード生成を1回で済ませる）
export function retrievabilityCurve(
  progress: LegacyProgress,
  dayOffsets: number[],
  from: Date = new Date(),
): (number | null)[] {
  const card = reviewedCard(progress, from);
  if (!card) return dayOffsets.map(() => null);
  return dayOffsets.map(
    (d) => scheduler.get_retrievability(card, new Date(from.getTime() + d * 86_400_000), false) as number,
  );
}

// 今日この問題を復習すると、試験日の想起確率が何ポイント上がるか（限界効用）。
// 未学習の問題は「今は0%、学べばR」なので伸びがそのままRになる。
export function examGain(progress: LegacyProgress, examAt: Date, now: Date = new Date()): number {
  const card = reviewedCard(progress, now);
  if (!card) {
    const learned = scheduler.next(createEmptyCard(now), now, Rating.Good as Grade).card;
    return scheduler.get_retrievability(learned, examAt, false) as number;
  }
  // 端末の時計ずれ等で最終復習が未来だと next() が例外を投げるため、その場合は対象外にする
  if (card.last_review && card.last_review.getTime() > now.getTime()) return 0;
  const before = scheduler.get_retrievability(card, examAt, false) as number;
  const after = scheduler.get_retrievability(
    scheduler.next(card, now, Rating.Good as Grade).card,
    examAt,
    false,
  ) as number;
  return after - before;
}

export const ratingLabels: Record<ReviewRating, string> = {
  [Rating.Again]: "もう一度",
  [Rating.Hard]: "難しい",
  [Rating.Good]: "できた",
  [Rating.Easy]: "簡単",
};
