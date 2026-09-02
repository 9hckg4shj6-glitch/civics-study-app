export type LearningMode = "cards" | "lessons";

export type PrimaryNavKey = "home" | "learn" | "practice" | "questions" | "search" | "review";

const SCREEN_TO_NAV: Record<string, PrimaryNavKey> = {
  home: "home",
  inputView: "learn",
  lessonView: "learn",
  cardsView: "learn",
  browse: "learn",
  flash: "learn",
  practiceView: "practice",
  themeFieldView: "practice",
  quiz: "practice",
  result: "practice",
  qbrowse: "questions",
  search: "search",
  reviewView: "review",
  mistakesView: "review",
  weakFieldView: "review",
};

export function learningDestination(mode: unknown): "cardsView" | "inputView" {
  return mode === "cards" ? "cardsView" : "inputView";
}

export function primaryNavKey(screenId: string): PrimaryNavKey | null {
  return SCREEN_TO_NAV[screenId] ?? null;
}
