import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import {
  deleteAll,
  exportAll,
  importMany,
  listByQuestion,
  listPendingExamAttempts,
  listUnsynced,
  markSynced,
  sanitizeAttempt,
  sanitizePartAnswer,
  saveAttempt,
  saveDraft,
  getDraft,
  deleteDraft,
  upsertFromRemote,
} from "../src/written";

const base = {
  id: "a1",
  subjectId: "immunology2",
  questionId: "immunology2-2024-w02",
  examSessionId: null,
  mode: "practice",
  status: "graded",
  answers: { body: { kind: "long-text", text: "TLRで認識する" } },
  selectedRubricIds: ["tlr"],
  earnedPoints: 3,
  maxPoints: 5,
  rating: 2,
  durationMs: 1000,
  submittedAt: "2026-07-27T00:00:00.000Z",
  gradedAt: "2026-07-27T00:01:00.000Z",
  updatedAt: "2026-07-27T00:01:00.000Z",
  syncedAt: null,
};

describe("記述問題の答案履歴", () => {
  afterEach(async () => {
    await deleteAll();
  });

  it("未知の part kind は取り込まない", () => {
    expect(sanitizePartAnswer({ kind: "long-text", text: "あ" })).toEqual({ kind: "long-text", text: "あ" });
    expect(sanitizePartAnswer({ kind: "video", url: "x" })).toBeNull();
    expect(sanitizePartAnswer(null)).toBeNull();
  });

  it("紙に描いた作図はストロークを保存しない", () => {
    const answer = sanitizePartAnswer({ kind: "drawing", mode: "paper", strokes: [{ tool: "pen", color: "#000", width: 3, points: [{ x: 0.1, y: 0.2 }] }] });
    expect(answer).toEqual({ kind: "drawing", mode: "paper", strokes: [] });
  });

  it("描画の正規化座標をそのまま復元できる", () => {
    const strokes = [{ tool: "pen", color: "#111827", width: 3, points: [{ x: 0.1, y: 0.2, pressure: 0.5 }, { x: 0.3, y: 0.4 }] }];
    const answer = sanitizePartAnswer({ kind: "drawing", mode: "canvas", strokes }) as { strokes: unknown[] };
    expect(answer.strokes).toEqual(strokes);
  });

  it("点数が範囲外・status が未知・日付が不正な答案は拒否する", () => {
    expect(sanitizeAttempt(base)).not.toBeNull();
    expect(sanitizeAttempt({ ...base, earnedPoints: 9 })).toBeNull();
    expect(sanitizeAttempt({ ...base, earnedPoints: -1 })).toBeNull();
    expect(sanitizeAttempt({ ...base, status: "draft" })).toBeNull();
    expect(sanitizeAttempt({ ...base, updatedAt: "きのう" })).toBeNull();
    expect(sanitizeAttempt({ ...base, maxPoints: 0 })).toBeNull();
    expect(sanitizeAttempt({ ...base, id: "" })).toBeNull();
  });

  it("同じIDを取り込んでも重複せず、updatedAt が新しい方を採用する", async () => {
    await importMany([base]);
    await importMany([{ ...base, earnedPoints: 5, updatedAt: "2026-07-28T00:00:00.000Z" }]);
    const rows = await exportAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].earnedPoints).toBe(5);

    // 古い方は採用しない
    await importMany([{ ...base, earnedPoints: 1, updatedAt: "2026-07-26T00:00:00.000Z" }]);
    expect((await exportAll())[0].earnedPoints).toBe(5);
  });

  it("置き換え読込では既存の答案を消してから取り込む", async () => {
    await importMany([base]);
    const result = await importMany([{ ...base, id: "a2" }], { replace: true });
    expect(result.imported).toBe(1);
    const rows = await exportAll();
    expect(rows.map((row) => row.id)).toEqual(["a2"]);
  });

  it("採点のたびに新しいIDの答案が増え、過去の答案は書き換わらない", async () => {
    const first = await saveAttempt({ subjectId: "immunology2", questionId: "q1", answers: {}, maxPoints: 5, earnedPoints: 2, selectedRubricIds: [] });
    const second = await saveAttempt({ subjectId: "immunology2", questionId: "q1", answers: {}, maxPoints: 5, earnedPoints: 5, selectedRubricIds: [] });
    expect(first.id).not.toBe(second.id);
    const rows = await listByQuestion("q1");
    expect(rows).toHaveLength(2);
  });

  it("採点待ちの試験だけを列挙する", async () => {
    await saveAttempt({ subjectId: "s", questionId: "q1", mode: "exam", status: "submitted", examSessionId: "e1", answers: {}, maxPoints: 5 });
    await saveAttempt({ subjectId: "s", questionId: "q2", mode: "exam", status: "graded", examSessionId: "e1", answers: {}, maxPoints: 5, earnedPoints: 5 });
    await saveAttempt({ subjectId: "s", questionId: "q3", mode: "practice", answers: {}, maxPoints: 5, earnedPoints: 1 });
    const pending = await listPendingExamAttempts();
    expect(pending.map((row) => row.questionId)).toEqual(["q1"]);
  });

  it("draft はローカル専用でバックアップに含まれない", async () => {
    await saveDraft({ subjectId: "s", questionId: "q1", answers: { body: { kind: "long-text", text: "途中" } } });
    expect((await getDraft("q1"))?.answers.body).toEqual({ kind: "long-text", text: "途中" });
    expect(await exportAll()).toHaveLength(0);
    await deleteDraft("q1");
    expect(await getDraft("q1")).toBeNull();
    expect(await db.writtenDrafts.count()).toBe(0);
  });

  it("同期対象は採点済みで未送信のものだけ", async () => {
    await saveAttempt({ subjectId: "s", questionId: "q1", answers: {}, maxPoints: 5, earnedPoints: 5 });
    await saveAttempt({ subjectId: "s", questionId: "q2", mode: "exam", status: "submitted", answers: {}, maxPoints: 5 });
    const unsynced = await listUnsynced();
    expect(unsynced.map((row) => row.questionId)).toEqual(["q1"]);

    await markSynced(unsynced.map((row) => row.id));
    expect(await listUnsynced()).toHaveLength(0);
  });

  it("リモートから来た答案は updatedAt が新しいときだけ反映する", async () => {
    await importMany([base]);
    expect(await upsertFromRemote([{ ...base, earnedPoints: 1, updatedAt: "2026-07-26T00:00:00.000Z" }])).toBe(0);
    expect(await upsertFromRemote([{ ...base, earnedPoints: 4, updatedAt: "2026-07-29T00:00:00.000Z" }])).toBe(1);
    expect((await exportAll())[0].earnedPoints).toBe(4);
  });
});
