import { cardToStored, legacyToFsrs } from "./fsrs";
import { db, nowIso, saveCard, saveDeck, saveSetting, uuid } from "./db";
import { cardSchema } from "./schema";
import type { LegacyProgress, StudyCard } from "./types";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
} from "./types";

const MIGRATION_KEY = "civics.migration.localStorage.v1";
const CUSTOM_DATA_KEY = "civicsCustomData_v1";
const PROGRESS_KEY = "civicsProgress_v1";
const META_KEY = "civicsMeta_v1";
const DEFAULT_DECK_ID = "deck-personal";

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function legacyQuestionToCard(question: Record<string, unknown>, index: number): StudyCard | null {
  const choices = Array.isArray(question.choices) ? question.choices.map(String).filter(Boolean) : [];
  const front = String(question.question ?? "").trim();
  if (!front) return null;
  const timestamp = nowIso();
  const answer = Number(question.answer ?? 0);
  const candidate: StudyCard = {
    id: String(question.id ?? `legacy-${index}-${uuid()}`),
    ownerId: null,
    builtIn: false,
    kind: "multiple-choice",
    deckId: DEFAULT_DECK_ID,
    front,
    back: choices[answer] ?? "",
    choices,
    correctChoiceIndex: Number.isInteger(answer) && answer >= 0 && answer < choices.length ? answer : 0,
    explanation: String(question.explanation ?? ""),
    field: String(question.field ?? ""),
    source: String(question.mockTitle ?? question.year ?? "旧データから移行"),
    tags: [String(question.category ?? "")].filter(Boolean),
    image: typeof question.image === "string" ? question.image : null,
    imageAlt: String(question.imageAlt ?? ""),
    version: 1,
    suspendedAt: null,
    originDeckId: null,
    originVersion: null,
    originCardId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  const parsed = cardSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function migrateLegacyStorage(): Promise<void> {
  if ((await db.settings.get(MIGRATION_KEY))?.value === true) return;

  const timestamp = nowIso();
  await saveDeck({
    id: DEFAULT_DECK_ID,
    ownerId: null,
    system: "legacy",
    subjectId: "civics",
    originSharedDeckId: null,
    originVersion: null,
    name: "自作カード",
    description: "この端末で作成・取り込みしたカード",
    order: 0,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
    reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }, false);

  const legacyCards = readJson<Array<Record<string, unknown>>>(CUSTOM_DATA_KEY, []);
  for (const [index, item] of legacyCards.entries()) {
    const card = legacyQuestionToCard(item, index);
    if (card) await saveCard(card, false);
  }

  const progress = readJson<Record<string, LegacyProgress>>(PROGRESS_KEY, {});
  for (const [cardId, record] of Object.entries(progress)) {
    if (!record || typeof record !== "object" || (!record.due && !record.lastReviewed)) continue;
    await db.schedules.put(cardToStored(cardId, legacyToFsrs(record)));
  }

  const meta = readJson<Record<string, unknown>>(META_KEY, {});
  await saveSetting({ key: "legacyMeta", ownerId: null, value: meta, updatedAt: timestamp }, false);
  await saveSetting({ key: MIGRATION_KEY, ownerId: null, value: true, updatedAt: timestamp }, false);
}

export async function mirrorCustomCardsToLegacy(): Promise<void> {
  const legacyDeckIds = new Set((await db.decks.filter((deck) => deck.system !== "memory").toArray()).map((deck) => deck.id));
  const cards = await db.cards.filter((card) => !card.builtIn && !card.deletedAt && legacyDeckIds.has(card.deckId)).toArray();
  const questions = cards.filter((card) => card.kind === "multiple-choice").map((card) => ({
    id: card.id,
    year: "自作",
    field: card.field,
    category: card.tags[0] ?? "自作カード",
    mockTitle: card.source,
    question: card.front,
    choices: card.choices,
    answer: card.correctChoiceIndex ?? 0,
    explanation: card.explanation || card.back,
    image: card.image,
    imageAlt: card.imageAlt,
  }));
  localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(questions));

  window.__CUSTOM_TERM_CARDS = cards.filter((card) => card.kind !== "multiple-choice").map((card) => ({
    id: card.id,
    term: card.front,
    desc: card.back || card.explanation,
    field: card.field,
    src: card.source || "自作カード",
    image: card.image,
    imageAlt: card.imageAlt,
  }));
  window.__STUDY_CARDS = cards;
  window.__legacyAppRefresh?.();
}

export function builtInCards(): StudyCard[] {
  const now = new Date(0).toISOString();
  const questions = (window.QUIZ_DATA ?? []).flatMap((question, index) => {
    const front = String(question.question ?? "").trim();
    const choices = Array.isArray(question.choices) ? question.choices.map(String) : [];
    if (!front || choices.length < 2) return [];
    const answer = Number(question.answer ?? 0);
    return [{
      id: String(question.id ?? `question-${index}`), ownerId: null, builtIn: true,
      kind: "multiple-choice" as const, deckId: `builtin-${String(question.field ?? "other")}`,
      front, back: choices[answer] ?? "", choices, correctChoiceIndex: answer,
      explanation: String(question.explanation ?? ""), field: String(question.field ?? ""),
      source: String(question.mockTitle ?? question.year ?? "標準問題"),
      tags: [String(question.category ?? "")].filter(Boolean),
      image: typeof question.image === "string" ? question.image : null, imageAlt: String(question.imageAlt ?? ""),
      suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
      version: 1, createdAt: now, updatedAt: now, deletedAt: null,
    }];
  });
  const terms = (window.TERM_CARDS ?? []).flatMap((term, index) => {
    const front = String(term.term ?? "").trim();
    if (!front) return [];
    return [{
      id: String(term.id ?? `term-${index}`), ownerId: null, builtIn: true,
      kind: "term" as const, deckId: `builtin-${String(term.src ?? "terms")}`,
      front, back: String(term.desc ?? ""), choices: [], correctChoiceIndex: null, explanation: "",
      field: String(term.field ?? ""), source: String(term.src ?? "標準用語カード"), tags: [],
      image: typeof term.image === "string" ? term.image : null, imageAlt: String(term.imageAlt ?? ""),
      suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
      version: 1, createdAt: now, updatedAt: now, deletedAt: null,
    }];
  });
  return [...questions, ...terms];
}
