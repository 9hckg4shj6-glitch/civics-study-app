import { db, nowIso, uuid } from "./db";
import type {
  DrawingPartAnswer,
  DrawingStroke,
  NumericPartAnswer,
  ReviewRating,
  TextPartAnswer,
  WrittenAttempt,
  WrittenDraft,
  WrittenPartAnswer,
} from "./types";

/* ============================================================
   記述問題の答案履歴（仕様書 §10）
   ------------------------------------------------------------
   index.html（素のJS）は Dexie を直接触らず、この層だけを
   window.STUDY_CORE.writtenAttempts 経由で呼ぶ。
   ・採点済み答案は編集しない。再挑戦は新しいIDの答案として増える。
   ・全履歴を保持し、自動削除しない。
   ・draft はローカル専用（同期・バックアップの対象外）。
   ============================================================ */

/** 1作図あたりの点の上限（仕様書 §6.4）。壊れたデータの取り込みも同じ上限で切る */
const MAX_DRAWING_POINTS = 20000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function sanitizeStroke(raw: unknown): DrawingStroke | null {
  if (!isPlainObject(raw)) return null;
  const tool = raw.tool === "eraser" ? "eraser" : "pen";
  const width = Number(raw.width);
  const points = Array.isArray(raw.points) ? raw.points : [];
  const clean: DrawingStroke["points"] = [];
  for (const point of points) {
    if (!isPlainObject(point)) continue;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pressure = Number(point.pressure);
    clean.push(
      Number.isFinite(pressure)
        ? { x, y, pressure }
        : { x, y },
    );
  }
  if (!clean.length) return null;
  return {
    tool,
    color: typeof raw.color === "string" ? raw.color : "#111111",
    width: Number.isFinite(width) && width > 0 ? width : 3,
    points: clean,
  };
}

/** 取り込んだ答案の1パーツを検査する。未知の kind は捨てる（仕様書 §12.1） */
export function sanitizePartAnswer(raw: unknown): WrittenPartAnswer | null {
  if (!isPlainObject(raw)) return null;
  if (raw.kind === "short-text" || raw.kind === "long-text") {
    const answer: TextPartAnswer = { kind: raw.kind, text: typeof raw.text === "string" ? raw.text : "" };
    return answer;
  }
  if (raw.kind === "numeric") {
    const normalized = Number(raw.normalizedValue);
    const answer: NumericPartAnswer = {
      kind: "numeric",
      rawValue: typeof raw.rawValue === "string" ? raw.rawValue : "",
      normalizedValue: raw.normalizedValue == null || !Number.isFinite(normalized) ? null : normalized,
      unit: typeof raw.unit === "string" ? raw.unit : "",
    };
    return answer;
  }
  if (raw.kind === "drawing") {
    const strokes: DrawingStroke[] = [];
    let points = 0;
    for (const item of Array.isArray(raw.strokes) ? raw.strokes : []) {
      const stroke = sanitizeStroke(item);
      if (!stroke) continue;
      if (points + stroke.points.length > MAX_DRAWING_POINTS) break;
      points += stroke.points.length;
      strokes.push(stroke);
    }
    const answer: DrawingPartAnswer = {
      kind: "drawing",
      mode: raw.mode === "paper" ? "paper" : "canvas",
      strokes: raw.mode === "paper" ? [] : strokes,
    };
    return answer;
  }
  return null;
}

function sanitizeAnswers(raw: unknown): Record<string, WrittenPartAnswer> {
  const out: Record<string, WrittenPartAnswer> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const answer = sanitizePartAnswer(value);
    if (answer) out[String(key)] = answer;
  }
  return out;
}

/**
 * 外部（バックアップ・同期）から来た答案1件を検査する。
 * 壊れた行を黙って保存すると結果画面の集計が破綻するので、不正なら null を返す。
 */
export function sanitizeAttempt(raw: unknown): WrittenAttempt | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const questionId = typeof raw.questionId === "string" ? raw.questionId : "";
  if (!id || !questionId) return null;
  if (raw.status !== "submitted" && raw.status !== "graded") return null;
  if (!isIsoDate(raw.submittedAt) || !isIsoDate(raw.updatedAt)) return null;
  if (raw.gradedAt != null && !isIsoDate(raw.gradedAt)) return null;

  const maxPoints = Number(raw.maxPoints);
  if (!Number.isFinite(maxPoints) || maxPoints <= 0) return null;
  const earnedRaw = raw.earnedPoints;
  let earnedPoints: number | null = null;
  if (earnedRaw != null) {
    const earned = Number(earnedRaw);
    if (!Number.isFinite(earned) || earned < 0 || earned > maxPoints) return null;
    earnedPoints = earned;
  }
  const rating = Number(raw.rating);

  return {
    id,
    subjectId: typeof raw.subjectId === "string" ? raw.subjectId : "",
    questionId,
    examSessionId: typeof raw.examSessionId === "string" ? raw.examSessionId : null,
    mode: raw.mode === "exam" ? "exam" : "practice",
    status: raw.status,
    answers: sanitizeAnswers(raw.answers),
    selectedRubricIds: Array.isArray(raw.selectedRubricIds) ? raw.selectedRubricIds.map(String) : [],
    earnedPoints,
    maxPoints,
    rating: rating >= 1 && rating <= 4 ? (rating as ReviewRating) : null,
    durationMs: Number.isFinite(Number(raw.durationMs)) ? Number(raw.durationMs) : null,
    submittedAt: raw.submittedAt,
    gradedAt: typeof raw.gradedAt === "string" ? raw.gradedAt : null,
    updatedAt: raw.updatedAt,
    syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : null,
  };
}

export interface SaveAttemptInput {
  subjectId: string;
  questionId: string;
  examSessionId?: string | null;
  mode?: WrittenAttempt["mode"];
  status?: WrittenAttempt["status"];
  answers: Record<string, unknown>;
  selectedRubricIds?: string[];
  earnedPoints?: number | null;
  maxPoints: number;
  rating?: ReviewRating | null;
  durationMs?: number | null;
}

/** 回答確定時に呼ぶ。常に新しいIDで1件増やす（過去の答案は書き換えない） */
export async function saveAttempt(input: SaveAttemptInput): Promise<WrittenAttempt> {
  const at = nowIso();
  const status = input.status === "submitted" ? "submitted" : "graded";
  const attempt: WrittenAttempt = {
    id: uuid(),
    subjectId: String(input.subjectId || ""),
    questionId: String(input.questionId),
    examSessionId: input.examSessionId ?? null,
    mode: input.mode === "exam" ? "exam" : "practice",
    status,
    answers: sanitizeAnswers(input.answers),
    selectedRubricIds: (input.selectedRubricIds || []).map(String),
    earnedPoints: input.earnedPoints == null ? null : Number(input.earnedPoints),
    maxPoints: Number(input.maxPoints),
    rating: input.rating ?? null,
    durationMs: input.durationMs ?? null,
    submittedAt: at,
    gradedAt: status === "graded" ? at : null,
    updatedAt: at,
    syncedAt: null,
  };
  await db.writtenAttempts.put(attempt);
  return attempt;
}

/** 本番モードの自己採点で submitted → graded にするときだけ使う */
export async function updateAttempt(
  id: string,
  patch: { selectedRubricIds?: string[]; earnedPoints?: number | null; rating?: ReviewRating | null; status?: WrittenAttempt["status"] },
): Promise<WrittenAttempt | null> {
  const current = await db.writtenAttempts.get(id);
  if (!current) return null;
  const at = nowIso();
  const status = patch.status ?? current.status;
  const next: WrittenAttempt = {
    ...current,
    selectedRubricIds: patch.selectedRubricIds ? patch.selectedRubricIds.map(String) : current.selectedRubricIds,
    earnedPoints: patch.earnedPoints === undefined ? current.earnedPoints : patch.earnedPoints,
    rating: patch.rating === undefined ? current.rating : patch.rating,
    status,
    gradedAt: status === "graded" ? (current.gradedAt ?? at) : current.gradedAt,
    updatedAt: at,
    syncedAt: null,
  };
  await db.writtenAttempts.put(next);
  return next;
}

export async function getAttempt(id: string): Promise<WrittenAttempt | null> {
  return (await db.writtenAttempts.get(id)) ?? null;
}

/** 問題別の答案履歴。新しい順 */
export async function listByQuestion(questionId: string): Promise<WrittenAttempt[]> {
  const rows = await db.writtenAttempts.where("questionId").equals(questionId).toArray();
  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** 「採点待ちの試験」。提出したが自己採点が終わっていない答案 */
export async function listPendingExamAttempts(): Promise<WrittenAttempt[]> {
  const rows = await db.writtenAttempts.toArray();
  return rows
    .filter((row) => row.status === "submitted" && row.mode === "exam")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

function draftKey(questionId: string, examSessionId: string | null): string {
  return examSessionId ? `${examSessionId}::${questionId}` : `practice::${questionId}`;
}

export async function saveDraft(input: {
  subjectId: string;
  questionId: string;
  examSessionId?: string | null;
  mode?: WrittenDraft["mode"];
  answers: Record<string, unknown>;
}): Promise<void> {
  const examSessionId = input.examSessionId ?? null;
  const draft: WrittenDraft = {
    id: draftKey(String(input.questionId), examSessionId),
    subjectId: String(input.subjectId || ""),
    questionId: String(input.questionId),
    examSessionId,
    mode: input.mode === "exam" ? "exam" : "practice",
    answers: sanitizeAnswers(input.answers),
    updatedAt: nowIso(),
  };
  await db.writtenDrafts.put(draft);
}

export async function getDraft(questionId: string, examSessionId?: string | null): Promise<WrittenDraft | null> {
  return (await db.writtenDrafts.get(draftKey(String(questionId), examSessionId ?? null))) ?? null;
}

export async function deleteDraft(questionId: string, examSessionId?: string | null): Promise<void> {
  await db.writtenDrafts.delete(draftKey(String(questionId), examSessionId ?? null));
}

export async function deleteDraftsForSession(examSessionId: string): Promise<void> {
  await db.writtenDrafts.where("examSessionId").equals(examSessionId).delete();
}

/** 学習記録バックアップ（v2）へ入れる全答案 */
export async function exportAll(): Promise<WrittenAttempt[]> {
  const rows = await db.writtenAttempts.toArray();
  return rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * バックアップ・同期からの取り込み。
 * 同じIDは updatedAt が新しい方を採用する（仕様書 §12.1）。
 */
export async function importMany(rows: unknown[], options?: { replace?: boolean }): Promise<{ imported: number; skipped: number }> {
  if (options?.replace) await db.writtenAttempts.clear();
  let imported = 0;
  let skipped = 0;
  const clean: WrittenAttempt[] = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const attempt = sanitizeAttempt(raw);
    if (!attempt) {
      skipped += 1;
      continue;
    }
    clean.push(attempt);
  }
  for (const attempt of clean) {
    const existing = await db.writtenAttempts.get(attempt.id);
    if (existing && existing.updatedAt >= attempt.updatedAt) {
      skipped += 1;
      continue;
    }
    await db.writtenAttempts.put(attempt);
    imported += 1;
  }
  return { imported, skipped };
}

export async function deleteAll(): Promise<void> {
  await db.writtenAttempts.clear();
  await db.writtenDrafts.clear();
}

/* ---------- 差分同期の下ごしらえ（仕様書 §11.4） ---------- */

/** まだ送っていない、または採点更新で新しくなった採点済み答案 */
export async function listUnsynced(): Promise<WrittenAttempt[]> {
  const rows = await db.writtenAttempts.toArray();
  return rows
    .filter((row) => row.status === "graded" && (!row.syncedAt || row.updatedAt > row.syncedAt))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** push が成功した行だけ syncedAt を進める */
export async function markSynced(ids: string[]): Promise<void> {
  const at = nowIso();
  for (const id of ids) {
    const row = await db.writtenAttempts.get(id);
    if (!row) continue;
    await db.writtenAttempts.put({ ...row, syncedAt: at });
  }
}

/** pull した行をローカルへ反映する。競合は updatedAt が新しい方を採用 */
export async function upsertFromRemote(rows: unknown[]): Promise<number> {
  let applied = 0;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const attempt = sanitizeAttempt(raw);
    if (!attempt) continue;
    const existing = await db.writtenAttempts.get(attempt.id);
    if (existing && existing.updatedAt >= attempt.updatedAt) continue;
    await db.writtenAttempts.put({ ...attempt, syncedAt: nowIso() });
    applied += 1;
  }
  return applied;
}
