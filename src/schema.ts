import { z } from "zod";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
} from "./types";

export const cardSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().nullable(),
  builtIn: z.boolean(),
  kind: z.enum(["basic", "multiple-choice", "term"]),
  deckId: z.string().min(1),
  front: z.string().trim().min(1),
  back: z.string(),
  choices: z.array(z.string()),
  correctChoiceIndex: z.number().int().nonnegative().nullable(),
  explanation: z.string(),
  field: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  image: z.string().nullable(),
  imageAlt: z.string(),
  version: z.number().int().positive(),
  suspendedAt: z.string().datetime().nullable().default(null),
  originDeckId: z.string().min(1).nullable().default(null),
  originVersion: z.number().int().positive().nullable().default(null),
  originCardId: z.string().min(1).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
}).superRefine((card, ctx) => {
  if (card.kind === "multiple-choice") {
    if (card.choices.length < 2) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "選択問題には2個以上の選択肢が必要です" });
    }
    if (card.correctChoiceIndex === null || card.correctChoiceIndex >= card.choices.length) {
      ctx.addIssue({ code: "custom", path: ["correctChoiceIndex"], message: "正解の選択肢を指定してください" });
    }
  }
  const originValues = [card.originDeckId, card.originVersion, card.originCardId];
  const hasAnyOrigin = originValues.some((value) => value !== null);
  const hasEveryOrigin = originValues.every((value) => value !== null);
  if (hasAnyOrigin && !hasEveryOrigin) {
    ctx.addIssue({ code: "custom", path: ["originDeckId"], message: "共有元情報はデッキ・バージョン・カードをまとめて指定してください" });
  }
});

export const deckSchema = z.object({
  id: z.string().min(1),
  system: z.enum(["legacy", "memory"]).default("legacy"),
  subjectId: z.string().nullable().default("civics"),
  originSharedDeckId: z.string().nullable().default(null),
  originVersion: z.number().int().positive().nullable().default(null),
  name: z.string(),
  description: z.string(),
  order: z.number(),
  newCardsPerDay: z.number().int().min(0).max(1000).default(DEFAULT_NEW_CARDS_PER_DAY),
  reviewsPerDay: z.number().int().min(0).max(5000).default(DEFAULT_REVIEWS_PER_DAY),
  desiredRetention: z.number().min(0.7).max(0.99).default(DEFAULT_DESIRED_RETENTION),
});

export const importBundleSchema = z.object({
  app: z.literal("civics-study"),
  schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  exportedAt: z.string().datetime(),
  cards: z.array(cardSchema),
  decks: z.array(deckSchema),
  reviewEvents: z.array(z.object({
    id: z.string(),
    cardId: z.string(),
    deviceId: z.string(),
    rating: z.number().int().min(1).max(4),
    reviewedAt: z.string().datetime(),
    durationMs: z.number().nullable(),
  })),
});

export type ImportBundle = z.infer<typeof importBundleSchema>;
