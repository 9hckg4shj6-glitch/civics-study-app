import { db } from "./db";
import type { Deck, StoredSchedule, StudyCard } from "./types";

export interface CardDeckSummary {
  id: string;
  name: string;
  description: string;
  totalCards: number;
  activeCards: number;
  newCards: number;
  dueCards: number;
  learnedCards: number;
  suspendedCards: number;
  newCardsPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
}

export interface CardHomeSnapshot {
  totalCards: number;
  activeCards: number;
  newCards: number;
  dueCards: number;
  learnedCards: number;
  suspendedCards: number;
  decks: CardDeckSummary[];
}

function summarizeDeck(
  deck: Deck,
  cards: StudyCard[],
  schedules: Map<string, StoredSchedule>,
  nowMs: number,
): CardDeckSummary {
  const active = cards.filter((card) => !card.suspendedAt);
  const learned = active.filter((card) => schedules.has(card.id));
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    totalCards: cards.length,
    activeCards: active.length,
    newCards: active.length - learned.length,
    dueCards: learned.filter((card) => new Date(schedules.get(card.id)!.due).getTime() <= nowMs).length,
    learnedCards: learned.length,
    suspendedCards: cards.length - active.length,
    newCardsPerDay: deck.newCardsPerDay,
    reviewsPerDay: deck.reviewsPerDay,
    desiredRetention: deck.desiredRetention,
  };
}

export async function getCardHomeSnapshot(now = new Date()): Promise<CardHomeSnapshot> {
  const [allCards, allDecks, allSchedules] = await Promise.all([
    db.cards.filter((card) => !card.builtIn && !card.deletedAt).toArray(),
    db.decks.filter((deck) => !deck.deletedAt && deck.system !== "memory").sortBy("order"),
    db.schedules.toArray(),
  ]);
  const schedules = new Map(allSchedules.map((schedule) => [schedule.cardId, schedule]));
  const cardsByDeck = new Map<string, StudyCard[]>();
  const legacyDeckIds = new Set(allDecks.map((deck) => deck.id));
  const legacyCards = allCards.filter((card) => legacyDeckIds.has(card.deckId));
  for (const card of legacyCards) {
    const cards = cardsByDeck.get(card.deckId) ?? [];
    cards.push(card);
    cardsByDeck.set(card.deckId, cards);
  }

  const decks = allDecks.map((deck) => summarizeDeck(deck, cardsByDeck.get(deck.id) ?? [], schedules, now.getTime()));
  const active = legacyCards.filter((card) => !card.suspendedAt);
  const learned = active.filter((card) => schedules.has(card.id));
  return {
    totalCards: legacyCards.length,
    activeCards: active.length,
    newCards: active.length - learned.length,
    dueCards: learned.filter((card) => new Date(schedules.get(card.id)!.due).getTime() <= now.getTime()).length,
    learnedCards: learned.length,
    suspendedCards: legacyCards.length - active.length,
    decks,
  };
}
