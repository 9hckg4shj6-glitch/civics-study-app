import { describe, expect, it } from "vitest";
import { learningDestination, primaryNavKey } from "../src/navigation";

describe("learning navigation", () => {
  it("カード型科目はカード学習へ進む", () => {
    expect(learningDestination("cards")).toBe("cardsView");
  });

  it("授業要点型と未指定科目は授業要点へ進む", () => {
    expect(learningDestination("lessons")).toBe("inputView");
    expect(learningDestination(undefined)).toBe("inputView");
  });
});

describe("primary navigation state", () => {
  it("詳細画面も親タブへ対応付ける", () => {
    expect(primaryNavKey("lessonView")).toBe("learn");
    expect(primaryNavKey("quiz")).toBe("practice");
    expect(primaryNavKey("themeFieldView")).toBe("practice");
    expect(primaryNavKey("qbrowse")).toBe("questions");
    expect(primaryNavKey("search")).toBe("search");
    expect(primaryNavKey("mistakesView")).toBe("review");
  });

  it("補助画面には主要タブを割り当てない", () => {
    expect(primaryNavKey("statsView")).toBeNull();
  });
});
