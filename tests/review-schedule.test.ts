import "fake-indexeddb/auto";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { scheduleReview } from "../src/fsrs";

const html = fs.readFileSync("index.html", "utf8");
const functions = html.slice(html.indexOf("  function reviewAt("), html.indexOf("  function renderReviewSchedule("));
const now = new Date("2026-09-07T12:00:00Z").getTime();
const termFns = html.slice(html.indexOf("  function dueTermItems("), html.indexOf("  function dueReviewCards("));
function termApi(progress: any, terms: any[]) {
  return new Function("progress", "DATA", "termSources", `${functions}${termFns};return {dueTermItems};`)(progress, [], () => terms);
}
function api(progress: any, DATA: any[]) {
  return new Function("progress", "DATA", `${functions};return {reviewAt,reviewText,dueItems};`)(progress, DATA);
}
describe("復習の時刻判定", () => {
  it("10分後の問題は境界時刻になって初めて対象になる", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const r = { seen: 1, due: "2026-09-07", fsrs: { due: new Date(now + 600000).toISOString() } };
      const a = api({ q: r }, [{ id: "q" }]);
      expect(a.dueItems()).toEqual([]);
      expect(a.reviewText(r, now)).toContain("10分後");
      vi.setSystemTime(now + 600000);
      expect(a.dueItems()).toEqual([{ id: "q" }]);
    } finally { vi.useRealTimers(); }
  });
  it("旧日付を現地午前0時に解釈し、予定なしを区別する", () => {
    const a = api({}, []);
    expect(a.reviewAt({ due: "2026-09-08" })).toBe(new Date(2026, 8, 8).getTime());
    expect(a.reviewText({ seen: 1 })).toBe("予定未設定");
    expect(a.reviewText({})).toBe("未学習");
    expect(a.reviewText({ fsrs: { due: new Date(now - 172800000).toISOString() } }, now)).toContain("2日経過");
  });
  it("講義カードの復習も日付ではなく時刻で判定する", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const terms = [{ id: "t1", term: "国会" }];
      // 旧実装は due の日付だけを見ていたため、10分後の予定でもその日のうちは対象になっていた
      const progress = { t1: { seen: 1, due: "2026-09-07", fsrs: { due: new Date(now + 600000).toISOString() } } };
      const a = termApi(progress, terms);
      expect(a.dueTermItems()).toEqual([]);
      vi.setSystemTime(now + 600000);
      expect(a.dueTermItems()).toEqual(terms);
    } finally { vi.useRealTimers(); }
  });
  it("採点はすべて gradeCard を通す", () => {
    // scheduleSRS を直接呼ぶと冪等な eventId が付かず、採点し直すと反復回数が二重に増える。
    // 残ってよいのは定義そのものと、採点し直しの無いフラッシュカードの1か所だけ
    expect(html.match(/scheduleSRS\(/g)).toHaveLength(2);
    expect(html).toContain("gradeCard(isCorrect?3:1,cur,{defer:true})");   // まとめて採点
    expect(html).toContain("gradeCard(rating, cw.entry)");                 // 記述式
  });
  it("同一回答の手ごたえ更新は1イベント・1回分の反復になる", async () => {
    vi.stubGlobal("window", { dispatchEvent() {} });
    try {
      const first: any = {}, revised: any = {};
      scheduleReview("review-test", first, 3, new Date(now), null, "same-answer");
      scheduleReview("review-test", revised, 2, new Date(now), null, "same-answer");
      await vi.waitFor(async () => {
        expect((await db.reviewEvents.get("same-answer"))?.rating).toBe(2);
      });
      expect(await db.reviewEvents.where("cardId").equals("review-test").count()).toBe(1);
      expect(revised.fsrs.reps).toBe(first.fsrs.reps);
      expect((await db.schedules.get("review-test"))?.due).toBe(revised.fsrs.due);
    } finally { vi.unstubAllGlobals(); }
  });
});
