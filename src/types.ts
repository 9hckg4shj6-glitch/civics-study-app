export type CardKind = "basic" | "multiple-choice" | "term";
export type ReviewRating = 1 | 2 | 3 | 4;
export type AuthProvider = "google" | "email";

export const DEFAULT_NEW_CARDS_PER_DAY = 20;
export const DEFAULT_REVIEWS_PER_DAY = 200;
export const DEFAULT_DESIRED_RETENTION = 0.9;

export interface AccountState {
  status: "loading" | "disabled" | "guest" | "authenticated" | "migrating" | "conflict";
  enabled: boolean;
  socialEnabled: boolean;
  localOwnerId: string | null;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  providers: AuthProvider[];
}

/* ============================================================
   問題データ（public/subjects/<id>/questions.js）の形
   ------------------------------------------------------------
   選択問題は歴史的に type を持たない。type:"constructed" が付いた
   ものだけ記述問題として扱う（後方互換のため既存データは無変更）。
   仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §5
   ※ index.html（素のJS）と scripts/validate-content.mjs が
      実際の読み手なので、ここは形の唯一の記述として置いている。
   ============================================================ */

export type QuestionType = "choice" | "constructed";
export type ConstructedPartKind = "short-text" | "long-text" | "numeric" | "drawing";

export interface SlideReference {
  deck: string;
  name: string;
  pages: number[];
  /** そのページのどのスライド（4-up配布資料の象限）が根拠か。
      植物生理編で追加した任意欄。持たない科目は従来どおり pages だけで動く。
      pages の型は変えない（validate-content.mjs と index.html が数値前提で組んである）。 */
  pageNotes?: SlidePageNote[] | null;
}

export interface SlidePageNote {
  page: number;
  /** 左上 / 右上 / 左下 / 右下 / 上段 / 下段 / 全体 */
  panel: string;
  label: string;
}

/** 大問の共通設問文。同じ大問に属する小問すべてが同じ内容を複製して持つ（案A）。
    選択問題・記述問題のどちらにも付く。 */
export interface StemFigure {
  src: string;
  alt?: string;
  label?: string;
}

export interface BaseResponsePart {
  id: string;
  kind: ConstructedPartKind;
  label: string;
  prompt?: string;
  /** 省略時は true */
  required?: boolean;
}

export interface ShortTextPart extends BaseResponsePart {
  kind: "short-text";
  /** 正規化後の完全一致でのみ仮正解。同義語はここに明示的に列挙する */
  acceptedAnswers: string[];
  placeholder?: string;
  /** 穴埋め問題で本文の空欄に添える原本どおりの記号（"1" / "①" など） */
  blankLabel?: string;
}

export interface LongTextPart extends BaseResponsePart {
  kind: "long-text";
  /** 「指定語句」。出現の有無を色分けするだけで、正誤は決めない */
  requiredTerms?: string[];
  placeholder?: string;
  /** 省略時 6 */
  rows?: number;
}

export interface NumericPart extends BaseResponsePart {
  kind: "numeric";
  expectedValue: number;
  absoluteTolerance?: number;
  relativeTolerance?: number;
  acceptedUnits: string[];
  placeholder?: string;
}

export interface DrawingPart extends BaseResponsePart {
  kind: "drawing";
  /** 既存図への描き込み問題で使う下敷き */
  backgroundImage?: string | null;
  backgroundImageAlt?: string;
  modelImage: string;
  modelImageAlt: string;
  /** 幅 / 高さ。省略時 4 / 3 */
  aspectRatio?: number;
  /** 「紙に描く」を許すか。免疫編では true */
  paperAllowed?: boolean;
}

export type ResponsePart = ShortTextPart | LongTextPart | NumericPart | DrawingPart;

export type RubricAutoCheck =
  | { kind: "short-match"; partId: string }
  | { kind: "numeric-match"; partId: string }
  | { kind: "terms-present"; partId: string; terms: string[]; mode: "all" | "any" };

export interface RubricCriterion {
  id: string;
  partIds: string[];
  text: string;
  points: number;
  /** 初期チェックの補助。学習者が必ず修正できる。作図は自動判定しない */
  autoCheck?: RubricAutoCheck;
}

export interface ConstructedQuestion {
  id: string;
  type: "constructed";
  year: string;
  category: string;
  field: string;
  question: string;
  points: number;
  responseParts: ResponsePart[];
  rubric: RubricCriterion[];
  /** 公式の採点細目か、学習用に分解したものか。画面に明示する */
  rubricSource: "official" | "derived";
  modelAnswer: string;
  explanation: string;
  image?: string | null;
  imageAlt?: string;
  explainImage?: string | null;
  explainImageAlt?: string;
  slideRefs?: SlideReference[] | null;
  /** 大問の共通設問文と、その大問に付く図 */
  stem?: string;
  stemTitle?: string;
  stemImages?: StemFigure[];
  /** 原本で下線が引かれている部分（question 内の部分文字列）。
      「下線部の現象を何というか」のような設問は、下線がないとどこを指すのか分からない */
  underlines?: string[];
  /** 配布された解答用紙の解答。アプリが書いた modelAnswer とは別に、そのまま出す */
  officialAnswer?: string;
  /** 解答用紙に本文ではなく参照先だけが書かれている場合の注記 */
  officialAnswerNote?: string;
  /** 穴埋め（クローズ）問題の本文。{1}{2}… が responseParts の n 番目に対応する。
      原本の空欄記号（① など）は ShortTextPart.blankLabel に持つ */
  passage?: string;
  /** 大問（原本で1つの設問にまとまっている小問群）。同じ groupId は1画面へまとめて出す */
  groupId?: string;
  groupTitle?: string;
  groupOrder?: number;
  groupSize?: number;
  groupPoints?: number;
  groupFigures?: StemFigure[];
}

/* ============================================================
   記述問題の答案履歴
   ------------------------------------------------------------
   答案本文・描画ストロークは localStorage の progress には入れず、
   独立した IndexedDB テーブル（writtenAttempts / writtenDrafts）へ保存する。
   仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §10
   ============================================================ */

export type WrittenAttemptStatus = "draft" | "submitted" | "graded";
export type WrittenAttemptMode = "practice" | "exam";

export interface TextPartAnswer {
  kind: "short-text" | "long-text";
  text: string;
}

export interface NumericPartAnswer {
  kind: "numeric";
  rawValue: string;
  normalizedValue: number | null;
  unit: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawingStroke {
  tool: "pen" | "eraser";
  color: string;
  width: number;
  points: DrawingPoint[];
}

export interface DrawingPartAnswer {
  kind: "drawing";
  /** 「紙に描く」を選んだ場合は paper（描画データは保存しない） */
  mode: "canvas" | "paper";
  strokes: DrawingStroke[];
}

export type WrittenPartAnswer = TextPartAnswer | NumericPartAnswer | DrawingPartAnswer;

export interface WrittenAttempt {
  id: string;
  subjectId: string;
  questionId: string;
  examSessionId: string | null;
  mode: WrittenAttemptMode;
  /** draft は writtenDrafts 側に置くので、履歴は submitted / graded だけ */
  status: Exclude<WrittenAttemptStatus, "draft">;
  answers: Record<string, WrittenPartAnswer>;
  selectedRubricIds: string[];
  earnedPoints: number | null;
  maxPoints: number;
  rating: ReviewRating | null;
  durationMs: number | null;
  submittedAt: string;
  gradedAt: string | null;
  updatedAt: string;
  syncedAt: string | null;
}

export interface WrittenDraft {
  id: string;
  subjectId: string;
  questionId: string;
  examSessionId: string | null;
  mode: WrittenAttemptMode;
  answers: Record<string, WrittenPartAnswer>;
  updatedAt: string;
}

/** 暗記カードをめくったときの自己申告。ローカル専用で同期しない。 */
export type MemoryMarkStatus = "known" | "unsure";

export interface MemoryMark {
  cardId: string;
  deckId: string;
  status: MemoryMarkStatus;
  updatedAt: string;
}

export interface StudyCard {
  id: string;
  ownerId: string | null;
  builtIn: boolean;
  kind: CardKind;
  deckId: string;
  front: string;
  back: string;
  choices: string[];
  correctChoiceIndex: number | null;
  explanation: string;
  field: string;
  source: string;
  tags: string[];
  image: string | null;
  imageAlt: string;
  version: number;
  /** 復習キューから一時的に除外する。削除とは別扱い。 */
  suspendedAt: string | null;
  /** 共有デッキから取り込んだカードだけが持つ由来情報。 */
  originDeckId: string | null;
  originVersion: number | null;
  originCardId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Deck {
  id: string;
  ownerId: string | null;
  /** 既存の代謝カードと、全科目共通の暗記カードを混在させない。 */
  system: "legacy" | "memory";
  /** 暗記カードでは必須。既存カードは civics として移行する。 */
  subjectId: string | null;
  /** 「みんなのデッキ」から取り込んだ場合の公開元。 */
  originSharedDeckId: string | null;
  originVersion: number | null;
  name: string;
  description: string;
  order: number;
  newCardsPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReviewEvent {
  id: string;
  ownerId: string | null;
  cardId: string;
  deviceId: string;
  rating: ReviewRating;
  reviewedAt: string;
  durationMs: number | null;
  syncedAt: string | null;
}

export interface StoredSchedule {
  cardId: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  updatedAt: string;
}

export type SyncTable = "cards" | "decks" | "review_events" | "settings";

export interface OutboxRecord {
  seq?: number;
  operationId: string;
  table: SyncTable;
  recordId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "syncing" | "failed";
  lastError: string | null;
}

export interface SettingRecord {
  key: string;
  ownerId: string | null;
  value: unknown;
  updatedAt: string;
}

export interface LegacyProgress {
  seen?: number;
  correct?: number;
  wrong?: number;
  streak?: number;
  weak?: boolean;
  bookmarked?: boolean;
  reps?: number;
  interval?: number;
  ease?: number;
  due?: string;
  lastReviewed?: string;
  lastWrong?: string;
  fsrs?: StoredSchedule;
}

export interface SyncStatus {
  enabled: boolean;
  online: boolean;
  userEmail: string | null;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
}
