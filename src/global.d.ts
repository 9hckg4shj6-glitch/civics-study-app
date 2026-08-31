import type { StudyCard, WrittenAttempt, WrittenDraft } from "./types";
import type { StoredSchedule } from "./types";
import type { SaveAttemptInput } from "./written";
import type { CardHomeSnapshot } from "./card-home";
import type { ImportStudyResult, StudyBackup } from "./backup";

declare global {
  interface Window {
    QUIZ_DATA?: Array<Record<string, unknown>>;
    TERM_CARDS?: Array<Record<string, unknown>>;
    __CUSTOM_TERM_CARDS?: Array<Record<string, unknown>>;
    /** 科目に同梱する公式の暗記デッキ（subjects.js の memoryDecks で読み込む）。 */
    MEMORY_DECKS?: Array<{
      id: string;
      subjectId: string;
      folder?: string;
      title: string;
      description?: string;
      cards: Array<{ id: string; front: string; back: string; explanation?: string; tags?: string[] }>;
    }>;
    __legacyAppRefresh?: () => void;
    STUDY_CORE?: {
      ui: {
        learningDestination: (mode: unknown) => "cardsView" | "inputView";
        primaryNavKey: (screenId: string) => "home" | "learn" | "practice" | "questions" | "search" | "review" | null;
      };
      scheduleReview: (progress: Record<string, unknown>, rating: 1 | 2 | 3 | 4, cardId: string) => Record<string, unknown>;
      refreshCustomCards: () => Promise<void>;
      saveLegacyProgress: (progress: Record<string, unknown>) => void;
      openCardManager: () => Promise<void>;
      cardHome: {
        snapshot: () => Promise<CardHomeSnapshot>;
      };
      memoryCards: {
        render: (root: HTMLElement, subject: { id: string; name: string; emoji?: string }) => Promise<void>;
      };
      backup: {
        exportStudy: () => Promise<StudyBackup>;
        importStudy: (payload: unknown, options?: { replace?: boolean }) => Promise<ImportStudyResult>;
      };
      undoLastReview: (cardId: string) => Promise<StoredSchedule | null>;
      memory: {
        retrievability: (progress: Record<string, unknown>, atMs?: number) => number | null;
        curve: (progress: Record<string, unknown>, dayOffsets: number[]) => (number | null)[];
        examGain: (progress: Record<string, unknown>, examMs: number) => number;
      };
      writtenAttempts: {
        saveAttempt: (input: SaveAttemptInput) => Promise<WrittenAttempt>;
        updateAttempt: (
          id: string,
          patch: { selectedRubricIds?: string[]; earnedPoints?: number | null; rating?: 1 | 2 | 3 | 4 | null; status?: "submitted" | "graded" },
        ) => Promise<WrittenAttempt | null>;
        getAttempt: (id: string) => Promise<WrittenAttempt | null>;
        listByQuestion: (questionId: string) => Promise<WrittenAttempt[]>;
        listPendingExamAttempts: () => Promise<WrittenAttempt[]>;
        saveDraft: (input: {
          subjectId: string;
          questionId: string;
          examSessionId?: string | null;
          mode?: "practice" | "exam";
          answers: Record<string, unknown>;
        }) => Promise<void>;
        getDraft: (questionId: string, examSessionId?: string | null) => Promise<WrittenDraft | null>;
        deleteDraft: (questionId: string, examSessionId?: string | null) => Promise<void>;
        deleteDraftsForSession: (examSessionId: string) => Promise<void>;
        exportAll: () => Promise<WrittenAttempt[]>;
        importMany: (rows: unknown[], options?: { replace?: boolean }) => Promise<{ imported: number; skipped: number }>;
        deleteAll: () => Promise<void>;
      };
    };
    __STUDY_CARDS?: StudyCard[];
  }
}

export {};
