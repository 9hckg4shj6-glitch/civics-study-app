import { db, nowIso, saveCard, saveDeck, uuid } from "./db";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type Deck,
  type MemoryMarkStatus,
  type StudyCard,
} from "./types";

export interface MemoryCardSubject {
  id: string;
  name: string;
  emoji?: string;
}

interface SharedDeckRow {
  id: string;
  owner_id: string;
  subject_id: string;
  title: string;
  description: string;
  version: number;
  card_count: number;
  published_at: string;
  /** 公式デッキをまとめる箱の名前（無い場合は一覧に直接並ぶ）。 */
  folder?: string;
}

interface SharedCardRow {
  id: string;
  shared_deck_id: string;
  origin_card_id: string;
  front: string;
  back: string;
  explanation: string;
  tags: string[];
  position: number;
}

/** アプリに同梱する公式デッキ（public/subjects/<id>/memory-deck.js）。通信なしで開ける。 */
interface BundledDeck {
  id: string;
  subjectId: string;
  folder?: string;
  title: string;
  description?: string;
  cards: Array<{ id: string; front: string; back: string; explanation?: string; tags?: string[] }>;
}

const OFFICIAL_OWNER = "official";

type EditorState =
  | { kind: "deck" }
  | { kind: "card"; cardId: string | null }
  | null;

let rootNode: HTMLElement | null = null;
let studyFlipIn = false;
const FLIP_HALF_MS = 150;
let activeSubject: MemoryCardSubject | null = null;
let activeTab: "mine" | "public" = "mine";
let selectedDeckId: string | null = null;
let selectedSharedDeckId: string | null = null;
let openFolder: string | null = null;
let editor: EditorState = null;
let message = "";
let messageKind: "info" | "error" | "success" = "info";
let sharedDecks: SharedDeckRow[] = [];
let sharedCards: SharedCardRow[] = [];
let studyIndex = 0;
let studyRevealed = false;
/** カード一覧と「めくる」対象の絞り込み。 */
type MarkFilter = "all" | "known" | "unsure" | "unmarked";
let deckFilter: MarkFilter = "all";
/** めくり始めた時点の並び。途中で分類が変わっても順番がずれないよう固定する。 */
let studyCardIds: string[] = [];

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(next: string, kind: typeof messageKind = "info"): void {
  message = next;
  messageKind = kind;
}

// 全件スキャンだとカードが増えるほど再描画が重くなるため、索引で引く。
async function memoryDecks(): Promise<Deck[]> {
  if (!activeSubject) return [];
  const decks = await db.decks.where("[system+subjectId]").equals(["memory", activeSubject.id]).toArray();
  return decks.filter((deck) => !deck.deletedAt).sort((a, b) => a.order - b.order);
}

async function cardsFor(deckId: string): Promise<StudyCard[]> {
  const cards = await db.cards.where("deckId").equals(deckId).toArray();
  return cards
    .filter((card) => !card.deletedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

async function marksFor(deckId: string): Promise<Map<string, MemoryMarkStatus>> {
  const marks = await db.memoryMarks.where("deckId").equals(deckId).toArray();
  return new Map(marks.map((mark) => [mark.cardId, mark.status]));
}

function markOf(marks: Map<string, MemoryMarkStatus>, cardId: string): MarkFilter {
  return marks.get(cardId) ?? "unmarked";
}

function countMarks(cards: StudyCard[], marks: Map<string, MemoryMarkStatus>): Record<MarkFilter, number> {
  const counts: Record<MarkFilter, number> = { all: cards.length, known: 0, unsure: 0, unmarked: 0 };
  for (const card of cards) counts[markOf(marks, card.id)] += 1;
  return counts;
}

function filterByMark(cards: StudyCard[], marks: Map<string, MemoryMarkStatus>, filter: MarkFilter): StudyCard[] {
  return filter === "all" ? cards : cards.filter((card) => markOf(marks, card.id) === filter);
}

const MARK_LABEL: Record<MarkFilter, string> = { all: "すべて", known: "◯ 覚えた", unsure: "△ まだ", unmarked: "未分類" };

function shell(content: string): string {
  const subject = activeSubject!;
  return `
    <div class="memoryCardsShell">
      <div class="memoryCardsHero">
        <div>
          <span class="memoryCardsEyebrow">${esc(subject.emoji || "▧")} ${esc(subject.name)}</span>
          <h2>暗記カード</h2>
          <p>自分専用のデッキを作り、必要なものだけ科目別に共有できます。</p>
        </div>
        <button type="button" class="btn primary" data-memory-action="new-deck">＋ デッキを作成</button>
      </div>
      <div class="memoryCardsTabs" role="tablist" aria-label="暗記カードメニュー">
        <button type="button" role="tab" aria-selected="${activeTab === "mine"}" class="${activeTab === "mine" ? "active" : ""}" data-memory-action="tab-mine">自分のデッキ</button>
        <button type="button" role="tab" aria-selected="${activeTab === "public"}" class="${activeTab === "public" ? "active" : ""}" data-memory-action="tab-public">公式デッキ</button>
      </div>
      ${message ? `<div class="memoryCardsMessage ${messageKind}" role="status">${esc(message)}</div>` : ""}
      ${content}
    </div>`;
}

async function renderMine(): Promise<string> {
  if (editor?.kind === "deck") return renderDeckForm();
  if (selectedDeckId) return renderDeckDetail(selectedDeckId);
  const decks = await memoryDecks();
  const counts = new Map<string, { total: number; known: number }>();
  await Promise.all(decks.map(async (deck) => {
    const cards = await cardsFor(deck.id);
    const marks = await marksFor(deck.id);
    counts.set(deck.id, { total: cards.length, known: countMarks(cards, marks).known });
  }));
  if (!decks.length) {
    return shell(`
      <div class="memoryCardsEmpty">
        <span>🗂️</span><h3>${esc(activeSubject!.name)}のデッキはまだありません</h3>
        <p>まずデッキを作り、その中に暗記カードを追加しましょう。</p>
        <button type="button" class="btn primary" data-memory-action="new-deck">最初のデッキを作る</button>
      </div>`);
  }
  return shell(`<div class="memoryDeckGrid">${decks.map((deck) => `
    <article class="memoryDeckCard">
      <button type="button" class="memoryDeckOpen" data-memory-action="open-deck" data-deck-id="${esc(deck.id)}">
        <span class="memoryDeckIcon">🗂️</span>
        <span><strong>${esc(deck.name)}</strong><small>${esc(deck.description || "説明なし")}</small></span>
        <b>${counts.get(deck.id)?.total ?? 0}枚</b>
      </button>
      ${counts.get(deck.id)?.total ? `<span class="memoryDeckProgress">◯ 覚えた ${counts.get(deck.id)!.known} / ${counts.get(deck.id)!.total}枚</span>` : ""}
      ${deck.originSharedDeckId ? `<span class="memoryOrigin">公式デッキから追加</span>` : ""}
    </article>`).join("")}</div>`);
}

function renderDeckForm(): string {
  return shell(`
    <form class="memoryEditor" id="memoryDeckForm">
      <div class="memoryEditorHead"><div><small>NEW DECK</small><h3>新しいデッキ</h3></div><button type="button" class="btn ghost small" data-memory-action="cancel-editor">キャンセル</button></div>
      <label>デッキ名<input name="name" maxlength="80" required placeholder="例：国会と内閣のはたらき"></label>
      <label>説明<textarea name="description" maxlength="500" rows="3" placeholder="このデッキで覚える内容"></textarea></label>
      <div class="memoryEditorNote">このデッキは「${esc(activeSubject!.name)}」専用として保存されます。</div>
      <button type="submit" class="btn primary">デッキを保存</button>
    </form>`);
}

async function renderDeckDetail(deckId: string): Promise<string> {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.deletedAt || deck.system !== "memory") {
    selectedDeckId = null;
    return renderMine();
  }
  const cards = await cardsFor(deckId);
  if (editor?.kind === "card") {
    const cardEditor = editor;
    const card = cardEditor.cardId ? cards.find((item) => item.id === cardEditor.cardId) : null;
    return shell(renderCardForm(deck, card ?? null));
  }
  const marks = await marksFor(deckId);
  if (rootNode?.dataset.studyMode === "true") {
    const session = studyCardIds
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is StudyCard => Boolean(card));
    if (session.length) {
      studyIndex = Math.min(studyIndex, session.length - 1);
      return shell(renderStudy(deck, session, marks));
    }
    rootNode.dataset.studyMode = "false";
  }
  const counts = countMarks(cards, marks);
  const visible = filterByMark(cards, marks, deckFilter);
  return shell(`
    <div class="memoryDeckDetail">
      <div class="memoryDeckDetailHead">
        <button type="button" class="btn ghost small" data-memory-action="back-decks">← デッキ一覧</button>
        <div class="memoryDeckActions">
          ${deck.originSharedDeckId ? `<span class="memoryOrigin">公式デッキから追加したコピー</span>` : ""}
          <button type="button" class="btn danger small" data-memory-action="delete-deck">削除</button>
        </div>
      </div>
      <div class="memoryDeckTitle"><div><span>MY DECK</span><h3>${esc(deck.name)}</h3><p>${esc(deck.description || "説明なし")}</p></div><strong>${cards.length}枚</strong></div>
      ${cards.length ? `<div class="memoryProgress">
        <div class="memoryProgressBar"><span class="known" style="width:${Math.round((counts.known / cards.length) * 100)}%"></span><span class="unsure" style="width:${Math.round((counts.unsure / cards.length) * 100)}%"></span></div>
        <div class="memoryFilterRow">${(["all", "unsure", "unmarked", "known"] as MarkFilter[]).map((filter) => `
          <button type="button" class="memoryFilterChip ${deckFilter === filter ? "active" : ""}" data-memory-action="set-filter" data-filter="${filter}">${MARK_LABEL[filter]} ${counts[filter]}</button>`).join("")}
          <button type="button" class="memoryFilterChip reset" data-memory-action="reset-marks" ${counts.known + counts.unsure ? "" : "disabled"}>分類をリセット</button>
        </div>
      </div>` : ""}
      <div class="memoryDeckActionRow">
        <button type="button" class="btn primary" data-memory-action="new-card">＋ カードを作成</button>
        <button type="button" class="btn ghost" data-memory-action="study-deck" ${visible.length ? "" : "disabled"}>${deckFilter === "all" ? "カードをめくる" : `${MARK_LABEL[deckFilter]}をめくる（${visible.length}枚）`}</button>
      </div>
      ${cards.length ? (visible.length ? `<div class="memoryCardList">${visible.map((card, index) => `
        <article class="memoryCardRow">
          <span class="memoryCardNumber">${index + 1}</span>
          <button type="button" class="memoryCardBody" data-memory-action="edit-card" data-card-id="${esc(card.id)}"><strong>${esc(card.front)}</strong><small>${esc(card.back)}</small></button>
          <span class="memoryMarkBadge ${markOf(marks, card.id)}">${MARK_LABEL[markOf(marks, card.id)]}</span>
          <button type="button" class="memoryCardDelete" aria-label="カードを削除" data-memory-action="delete-card" data-card-id="${esc(card.id)}">✕</button>
        </article>`).join("")}</div>` : `<div class="memoryCardsEmpty compact"><p>「${MARK_LABEL[deckFilter]}」のカードはありません。</p></div>`) : `<div class="memoryCardsEmpty compact"><p>カードはまだありません。</p></div>`}
    </div>`);
}

function renderCardForm(deck: Deck, card: StudyCard | null): string {
  return `
    <form class="memoryEditor" id="memoryCardForm" data-card-id="${esc(card?.id || "")}">
      <div class="memoryEditorHead"><div><small>${card ? "EDIT CARD" : "NEW CARD"}</small><h3>${card ? "カードを編集" : "カードを作成"}</h3><p>${esc(deck.name)}</p></div><button type="button" class="btn ghost small" data-memory-action="cancel-editor">キャンセル</button></div>
      <label>表（質問・用語）<textarea name="front" maxlength="2000" rows="3" required>${esc(card?.front || "")}</textarea></label>
      <label>裏（答え）<textarea name="back" maxlength="4000" rows="4" required>${esc(card?.back || "")}</textarea></label>
      <label>補足・解説<textarea name="explanation" maxlength="4000" rows="3">${esc(card?.explanation || "")}</textarea></label>
      <label>タグ（カンマ区切り）<input name="tags" maxlength="300" value="${esc(card?.tags.join(", ") || "")}" placeholder="重要, 試験頻出"></label>
      <button type="submit" class="btn primary">カードを保存</button>
    </form>`;
}

function renderStudy(deck: Deck, cards: StudyCard[], marks: Map<string, MemoryMarkStatus>): string {
  const card = cards[studyIndex];
  const status = markOf(marks, card.id);
  const html = `
    <div class="memoryStudy">
      <div class="memoryDeckDetailHead"><button type="button" class="btn ghost small" data-memory-action="stop-study">← ${esc(deck.name)}</button><span>${studyIndex + 1} / ${cards.length}<b class="memoryMarkBadge ${status}">${MARK_LABEL[status]}</b></span></div>
      <button type="button" class="memoryStudyCard ${studyRevealed ? "revealed" : ""} ${studyFlipIn ? "flipIn" : ""}" data-memory-action="reveal-card">
        <small>${studyRevealed ? "答え" : "質問"}</small>
        <strong>${esc(studyRevealed ? card.back : card.front)}</strong>
        ${studyRevealed && card.explanation ? `<p>${esc(card.explanation)}</p>` : ""}
        <span>${studyRevealed ? "もう一度押すと質問へ戻ります" : "押して答えを見る"}</span>
      </button>
      <div class="memoryStudyMarks">
        <button type="button" class="memoryMarkBtn unsure ${status === "unsure" ? "active" : ""}" data-memory-action="mark-unsure">△ まだ</button>
        <button type="button" class="memoryMarkBtn known ${status === "known" ? "active" : ""}" data-memory-action="mark-known">◯ 覚えた</button>
      </div>
      <div class="memoryStudyControls"><button type="button" class="btn ghost" data-memory-action="previous-card" ${studyIndex === 0 ? "disabled" : ""}>← 前へ</button><button type="button" class="btn ghost" data-memory-action="next-card">${studyIndex === cards.length - 1 ? "終了" : "次へ →"}</button></div>
    </div>`;
  studyFlipIn = false;
  return html;
}

function bundledDecks(): BundledDeck[] {
  if (!activeSubject) return [];
  return (window.MEMORY_DECKS ?? []).filter((deck) => deck.subjectId === activeSubject!.id);
}

async function loadSharedDecks(): Promise<void> {
  sharedDecks = bundledDecks().map((deck) => ({
    id: deck.id, owner_id: OFFICIAL_OWNER, subject_id: deck.subjectId, title: deck.title, folder: deck.folder,
    description: deck.description ?? "", version: 1, card_count: deck.cards.length, published_at: "",
  }));
}

async function loadSharedCards(deckId: string): Promise<void> {
  sharedCards = [];
  const bundled = bundledDecks().find((deck) => deck.id === deckId);
  if (bundled) {
    sharedCards = bundled.cards.map((card, index) => ({
      id: `${deckId}:${card.id}`, shared_deck_id: deckId, origin_card_id: card.id,
      front: card.front, back: card.back, explanation: card.explanation ?? "",
      tags: card.tags ?? [], position: index,
    }));
  }
}

function sharedDeckTile(deck: SharedDeckRow): string {
  return `
    <article class="memoryDeckCard shared">
      <button type="button" class="memoryDeckOpen" data-memory-action="open-shared" data-shared-id="${esc(deck.id)}">
        <span class="memoryDeckIcon">${deck.owner_id === OFFICIAL_OWNER ? "📌" : "🌐"}</span><span><strong>${esc(deck.title)}</strong><small>${esc(deck.description || "説明なし")}</small></span><b>${deck.card_count}枚</b>
      </button>
    </article>`;
}

async function renderPublic(): Promise<string> {
  if (!bundledDecks().length) {
    return shell(`<div class="memoryCardsEmpty"><span>📌</span><h3>公式デッキはまだありません</h3><p>この科目に同梱の公式デッキは準備中です。自分のデッキはいつでも作れます。</p></div>`);
  }
  if (selectedSharedDeckId) {
    const deck = sharedDecks.find((item) => item.id === selectedSharedDeckId);
    if (!deck) selectedSharedDeckId = null;
    else return shell(`
      <div class="memoryDeckDetail">
        <div class="memoryDeckDetailHead"><button type="button" class="btn ghost small" data-memory-action="back-public">← 公式デッキ</button><span>${deck.owner_id === OFFICIAL_OWNER ? "公式デッキ" : `公式デッキ v${deck.version}`}</span></div>
        <div class="memoryDeckTitle"><div><span>SHARED DECK</span><h3>${esc(deck.title)}</h3><p>${esc(deck.description || "説明なし")}</p></div><strong>${deck.card_count}枚</strong></div>
        <div class="memoryDeckActionRow"><button type="button" class="btn primary" data-memory-action="import-shared">自分のデッキに追加</button></div>
        <div class="memoryCardList">${sharedCards.map((card, index) => `<article class="memoryCardRow preview"><span class="memoryCardNumber">${index + 1}</span><span class="memoryCardBody"><strong>${esc(card.front)}</strong><small>${esc(card.back)}</small></span></article>`).join("")}</div>
      </div>`);
  }
  if (!sharedDecks.length) {
    return shell(`<div class="memoryCardsEmpty"><span>🌱</span><h3>${esc(activeSubject!.name)}の公式デッキはまだありません</h3><p>自分のデッキはいつでも作れます。</p></div>`);
  }
  if (openFolder) {
    const inFolder = sharedDecks.filter((deck) => deck.folder === openFolder);
    return shell(`
      <div class="memoryDeckDetailHead"><button type="button" class="btn ghost small" data-memory-action="back-folder">← 公式デッキ</button><span>🗂️ ${esc(openFolder)}・${inFolder.length}デッキ</span></div>
      <div class="memoryDeckGrid">${inFolder.map(sharedDeckTile).join("")}</div>`);
  }
  const folders = [...new Set(sharedDecks.map((deck) => deck.folder).filter(Boolean))] as string[];
  const folderTiles = folders.map((folder) => {
    const inFolder = sharedDecks.filter((deck) => deck.folder === folder);
    const cards = inFolder.reduce((total, deck) => total + deck.card_count, 0);
    return `
    <article class="memoryDeckCard shared">
      <button type="button" class="memoryDeckOpen" data-memory-action="open-folder" data-folder="${esc(folder)}">
        <span class="memoryDeckIcon">🗂️</span><span><strong>${esc(folder)}</strong><small>${inFolder.length}デッキ・${cards}枚</small></span><b>${inFolder.length}冊</b>
      </button>
    </article>`;
  });
  const loose = sharedDecks.filter((deck) => !deck.folder).map(sharedDeckTile);
  return shell(`<div class="memoryDeckGrid">${folderTiles.concat(loose).join("")}</div>`);
}

async function repaint(): Promise<void> {
  if (!rootNode || !activeSubject) return;
  rootNode.innerHTML = activeTab === "mine" ? await renderMine() : await renderPublic();
  rootNode.querySelector("#memoryDeckForm")?.addEventListener("submit", (event) => void saveDeckForm(event));
  rootNode.querySelector("#memoryCardForm")?.addEventListener("submit", (event) => void saveCardForm(event));
}

async function saveDeckForm(event: Event): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name || !activeSubject) return;
  const timestamp = nowIso();
  await saveDeck({
    id: uuid(), ownerId: null, system: "memory", subjectId: activeSubject.id,
    originSharedDeckId: null, originVersion: null, name,
    description: String(data.get("description") || "").trim(), order: await db.decks.count(),
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  });
  editor = null;
  setMessage(`「${name}」を作成しました。`, "success");
  await repaint();
}

function emptyCard(deckId: string): StudyCard {
  const timestamp = nowIso();
  return {
    id: uuid(), ownerId: null, builtIn: false, kind: "basic", deckId,
    front: "", back: "", choices: [], correctChoiceIndex: null, explanation: "",
    field: activeSubject?.name || "", source: "暗記カード", tags: [], image: null, imageAlt: "",
    version: 1, suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

async function saveCardForm(event: Event): Promise<void> {
  event.preventDefault();
  if (!selectedDeckId) return;
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const cardId = form.dataset.cardId;
  const current = cardId ? await db.cards.get(cardId) : emptyCard(selectedDeckId);
  if (!current) return;
  const next: StudyCard = {
    ...current,
    front: String(data.get("front") || "").trim(),
    back: String(data.get("back") || "").trim(),
    explanation: String(data.get("explanation") || "").trim(),
    tags: String(data.get("tags") || "").split(",").map((item) => item.trim()).filter(Boolean),
    version: current.version + (cardId ? 1 : 0), updatedAt: nowIso(),
  };
  if (!next.front || !next.back) return;
  await saveCard(next);
  editor = null;
  setMessage(cardId ? "カードを更新しました。" : "カードを追加しました。", "success");
  await repaint();
}

/** デッキ操作の失敗理由を日本語一文にする。端末内処理だけなので通信系の分岐は持たない。 */
function deckErrorMessage(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message?.trim() || String(error);
  return raw || "原因不明のエラーが発生しました。";
}

async function importSelectedSharedDeck(): Promise<void> {
  if (!selectedSharedDeckId || !activeSubject) return;
  const shared = sharedDecks.find((item) => item.id === selectedSharedDeckId);
  if (!shared) return;
  const duplicate = await db.decks.filter((deck) => deck.originSharedDeckId === shared.id && !deck.deletedAt).first();
  if (duplicate) {
    setMessage("この公開デッキはすでに自分のデッキへ追加されています。", "error");
    return repaint();
  }
  if (sharedCards.length !== shared.card_count) {
    setMessage("公開デッキのカードを完全に取得できませんでした。もう一度開き直してください。", "error");
    return repaint();
  }
  const timestamp = nowIso();
  const localDeckId = uuid();
  await db.transaction("rw", db.decks, db.cards, db.outbox, async () => {
    await saveDeck({
      id: localDeckId, ownerId: null, system: "memory", subjectId: activeSubject!.id,
      originSharedDeckId: shared.id, originVersion: shared.version,
      name: shared.title, description: shared.description, order: await db.decks.count(),
      newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
      desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    });
    for (const row of sharedCards) {
      await saveCard({
        id: uuid(), ownerId: null, builtIn: false, kind: "basic", deckId: localDeckId,
        front: row.front, back: row.back, choices: [], correctChoiceIndex: null,
        explanation: row.explanation, field: activeSubject!.name, source: `公式デッキ: ${shared.title}`,
        tags: row.tags, image: null, imageAlt: "", version: 1, suspendedAt: null,
        originDeckId: shared.id, originVersion: shared.version, originCardId: row.origin_card_id,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      });
    }
  });
  activeTab = "mine";
  selectedSharedDeckId = null;
  selectedDeckId = localDeckId;
  setMessage(`「${shared.title}」を自分のデッキへ追加しました。`, "success");
  await repaint();
}

/** 最後の1枚を終えたら、このセッションの分類結果を伝えて一覧へ戻る。 */
async function advanceStudy(): Promise<void> {
  if (studyIndex < studyCardIds.length - 1) {
    studyIndex += 1;
    studyRevealed = false;
    return;
  }
  const marks = selectedDeckId ? await marksFor(selectedDeckId) : new Map<string, MemoryMarkStatus>();
  const known = studyCardIds.filter((id) => marks.get(id) === "known").length;
  const unsure = studyCardIds.filter((id) => marks.get(id) === "unsure").length;
  if (rootNode) rootNode.dataset.studyMode = "false";
  studyIndex = 0;
  studyRevealed = false;
  setMessage(`めくり終わりました。◯ 覚えた ${known}枚 / △ まだ ${unsure}枚。`, "success");
}

async function handleAction(target: HTMLElement): Promise<void> {
  const action = target.dataset.memoryAction;
  message = "";
  if (action === "tab-mine") { activeTab = "mine"; selectedSharedDeckId = null; editor = null; }
  if (action === "tab-public") {
    activeTab = "public"; selectedDeckId = null; editor = null; openFolder = null;
    try { await loadSharedDecks(); } catch (error) { setMessage(`公式デッキを取得できません: ${deckErrorMessage(error)}`, "error"); }
  }
  if (action === "new-deck") { activeTab = "mine"; selectedDeckId = null; editor = { kind: "deck" }; }
  if (action === "cancel-editor") editor = null;
  if (action === "open-deck") { selectedDeckId = target.dataset.deckId || null; deckFilter = "all"; }
  if (action === "set-filter") deckFilter = (target.dataset.filter as MarkFilter) || "all";
  if (action === "reset-marks" && selectedDeckId && confirm("このデッキの「覚えた／まだ」の分類をすべて消しますか？")) {
    await db.memoryMarks.where("deckId").equals(selectedDeckId).delete();
    deckFilter = "all";
    setMessage("分類をリセットしました。", "success");
  }
  if (action === "back-decks") { selectedDeckId = null; editor = null; }
  if (action === "new-card") editor = { kind: "card", cardId: null };
  if (action === "edit-card") editor = { kind: "card", cardId: target.dataset.cardId || null };
  if (action === "delete-card" && target.dataset.cardId && confirm("このカードを削除しますか？")) {
    const card = await db.cards.get(target.dataset.cardId);
    if (card) await saveCard({ ...card, deletedAt: nowIso(), updatedAt: nowIso(), version: card.version + 1 });
    await db.memoryMarks.delete(target.dataset.cardId);
  }
  if (action === "delete-deck" && selectedDeckId && confirm("このデッキと中のカードを削除しますか？")) {
    const deck = await db.decks.get(selectedDeckId);
    if (deck) {
      for (const card of await cardsFor(deck.id)) await saveCard({ ...card, deletedAt: nowIso(), updatedAt: nowIso(), version: card.version + 1 });
      await saveDeck({ ...deck, deletedAt: nowIso(), updatedAt: nowIso(), version: deck.version + 1 });
      await db.memoryMarks.where("deckId").equals(deck.id).delete();
      selectedDeckId = null;
      setMessage("デッキを削除しました。", "success");
    }
  }
  if (action === "open-shared" && target.dataset.sharedId) {
    const sharedDeckId = target.dataset.sharedId;
    try {
      await loadSharedCards(sharedDeckId);
      selectedSharedDeckId = sharedDeckId;
    } catch (error) {
      selectedSharedDeckId = null;
      setMessage(`カードを取得できません: ${deckErrorMessage(error)}`, "error");
    }
  }
  if (action === "back-public") selectedSharedDeckId = null;
  if (action === "open-folder") openFolder = target.dataset.folder || null;
  if (action === "back-folder") openFolder = null;
  if (action === "import-shared") {
    try { await importSelectedSharedDeck(); } catch (error) { setMessage(`自分のデッキへ追加できませんでした: ${deckErrorMessage(error)}`, "error"); await repaint(); }
    return;
  }
  if (action === "study-deck" && rootNode && selectedDeckId) {
    const cards = await cardsFor(selectedDeckId);
    studyCardIds = filterByMark(cards, await marksFor(selectedDeckId), deckFilter).map((card) => card.id);
    if (studyCardIds.length) { rootNode.dataset.studyMode = "true"; studyIndex = 0; studyRevealed = false; }
  }
  if (action === "stop-study" && rootNode) { rootNode.dataset.studyMode = "false"; studyRevealed = false; }
  if ((action === "mark-known" || action === "mark-unsure") && selectedDeckId) {
    const cardId = studyCardIds[studyIndex];
    if (cardId) {
      await db.memoryMarks.put({
        cardId, deckId: selectedDeckId,
        status: action === "mark-known" ? "known" : "unsure",
        updatedAt: nowIso(),
      });
      await advanceStudy();
    }
  }
  if (action === "reveal-card") {
    studyRevealed = !studyRevealed;
    const card = target.closest<HTMLElement>(".memoryStudyCard");
    if (card && !window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
      card.classList.add("flipOut");
      await new Promise((resolve) => setTimeout(resolve, FLIP_HALF_MS));
      studyFlipIn = true;
    }
  }
  if (action === "previous-card") { studyIndex = Math.max(0, studyIndex - 1); studyRevealed = false; }
  if (action === "next-card") await advanceStudy();
  await repaint();
}

export async function renderMemoryCards(root: HTMLElement, subject: MemoryCardSubject): Promise<void> {
  rootNode = root;
  if (activeSubject?.id !== subject.id) {
    activeSubject = subject;
    activeTab = "mine";
    selectedDeckId = null;
    selectedSharedDeckId = null;
    editor = null;
    message = "";
    deckFilter = "all";
    studyCardIds = [];
    root.dataset.studyMode = "false";
  } else {
    activeSubject = subject;
  }
  if (!root.dataset.memoryBound) {
    root.dataset.memoryBound = "true";
    root.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-memory-action]") : null;
      if (target) void handleAction(target);
    });
  }
  await repaint();
}
