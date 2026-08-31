import { db, nowIso, saveCard, saveDeck, uuid } from "./db";
import { importBundleSchema } from "./schema";
import { mirrorCustomCardsToLegacy } from "./migration";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type CardKind,
  type StudyCard,
} from "./types";

let modal: HTMLElement | null = null;
let editingId: string | null = null;
let lastFocused: HTMLElement | null = null;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`要素が見つかりません: ${selector}`);
  return element;
};

function template(): string {
  return `
    <div class="study-modal hidden" id="studyManager" role="dialog" aria-modal="true" aria-labelledby="studyManagerTitle">
      <div class="study-manager-card">
        <header class="study-manager-head">
          <div><span class="study-kicker">LOCAL-FIRST STUDY</span><h2 id="studyManagerTitle">カード管理</h2></div>
          <button type="button" class="study-icon-btn" data-action="close" aria-label="閉じる">✕</button>
        </header>
        <nav class="study-tabs" aria-label="カード管理メニュー">
          <button type="button" class="active" data-tab="cards">カード</button>
          <button type="button" data-tab="stats">学習統計</button>
          <button type="button" data-tab="sync">データ</button>
        </nav>
        <section class="study-tab" data-panel="cards">
          <div class="study-toolbar">
            <button type="button" class="study-primary" data-action="new">＋ 新しいカード</button>
            <button type="button" class="study-secondary" data-action="new-deck">デッキ追加</button>
          </div>
          <div class="study-layout">
            <div><div id="studyCardList" class="study-card-list"></div></div>
            <form id="studyCardForm" class="study-editor hidden">
              <input type="hidden" id="studyCardId">
              <label>種類<select id="studyKind"><option value="basic">基本カード</option><option value="term">用語カード</option><option value="multiple-choice">選択問題</option></select></label>
              <label>デッキ<select id="studyDeck"></select></label>
              <label>表・問題文<textarea id="studyFront" required rows="3"></textarea></label>
              <label>裏・答え<textarea id="studyBack" rows="3"></textarea></label>
              <div id="studyChoiceFields" class="hidden">
                <label>選択肢（1行に1個）<textarea id="studyChoices" rows="5"></textarea></label>
                <label>正解番号<input id="studyCorrect" type="number" min="1" value="1"></label>
              </div>
              <label>解説<textarea id="studyExplanation" rows="3"></textarea></label>
              <div class="study-two-col"><label>分野<input id="studyField"></label><label>出典<input id="studySource"></label></div>
              <label>タグ（カンマ区切り）<input id="studyTags"></label>
              <label>画像<input id="studyImage" type="file" accept="image/png,image/jpeg,image/webp"><small>長辺1600px以下のWebPへ端末内で変換します</small></label>
              <label>画像の説明<input id="studyImageAlt"></label>
              <div id="studyImagePreview" class="study-image-preview hidden"></div>
              <div id="studyFormError" class="study-error" role="alert"></div>
              <div class="study-form-actions"><button class="study-primary" type="button" data-action="save-card">保存</button><button class="study-secondary" type="button" data-action="cancel-edit">キャンセル</button></div>
            </form>
          </div>
        </section>
        <section class="study-tab hidden" data-panel="stats"><div id="studyStats"></div></section>
        <section class="study-tab hidden" data-panel="sync">
          <div class="study-sync-card"><h3>保存先</h3><div id="studySyncStatus"></div>
            <p>カード・デッキ・復習記録はこの端末の中だけに保存されます。端末を替えるときは下のバックアップを使ってください。</p>
          </div>
          <div class="study-sync-card"><h3>バックアップ</h3><p>カード、デッキ、復習イベントをバージョン付きJSONで保存できます。</p><div class="study-form-actions"><button type="button" class="study-secondary" data-action="export">書き出す</button><button type="button" class="study-secondary" data-action="import">読み込む</button><input id="studyImport" class="hidden" type="file" accept="application/json,.json"></div></div>
        </section>
      </div>
    </div>`;
}

function makeEmptyCard(): StudyCard {
  const timestamp = nowIso();
  return {
    id: uuid(), ownerId: null, builtIn: false, kind: "basic", deckId: "deck-personal",
    front: "", back: "", choices: [], correctChoiceIndex: null, explanation: "", field: "",
    source: "自作カード", tags: [], image: null, imageAlt: "", version: 1,
    suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

async function ensureModal(): Promise<void> {
  if (modal) return;
  document.body.insertAdjacentHTML("beforeend", template());
  modal = $("#studyManager");
  modal.addEventListener("click", onClick);
  $("#studyCardForm").addEventListener("submit", onSave);
  $("#studyKind").addEventListener("change", toggleChoiceFields);
  $("#studyImport").addEventListener("change", onImport);
  modal.addEventListener("keydown", onModalKeydown);
  await ensureDefaultDeck();
}

async function ensureDefaultDeck(): Promise<void> {
  if (await db.decks.get("deck-personal")) return;
  const timestamp = nowIso();
  await saveDeck({
    id: "deck-personal", ownerId: null, name: "自作カード", description: "自分で作成したカード", order: 0,
    system: "legacy", subjectId: "civics", originSharedDeckId: null, originVersion: null,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  }, false);
}

export async function installCardManager(): Promise<void> {
  await ensureModal();
  const footer = document.querySelector("#dataSection");
  if (footer && !document.querySelector("#cardManagerBtn")) {
    const separator = document.createTextNode(" · ");
    const button = document.createElement("button");
    button.type = "button";
    button.id = "cardManagerBtn";
    button.className = "study-footer-link";
    button.textContent = "カード管理";
    button.addEventListener("click", () => void openCardManager());
    footer.insertBefore(separator, footer.querySelector("input"));
    footer.insertBefore(button, footer.querySelector("input"));
  }
}

export async function openCardManager(): Promise<void> {
  await ensureModal();
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal?.classList.remove("hidden");
  document.body.classList.add("study-modal-open");
  await renderCards();
  await renderStats();
  await renderSync();
  modal?.querySelector<HTMLElement>("[data-action=close]")?.focus();
}

function closeModal(): void {
  modal?.classList.add("hidden");
  document.body.classList.remove("study-modal-open");
  lastFocused?.focus();
}

async function renderCards(): Promise<void> {
  const list = $("#studyCardList");
  list.replaceChildren();
  const legacyDeckIds = new Set((await db.decks.filter((deck) => deck.system !== "memory").toArray()).map((deck) => deck.id));
  const cards = await db.cards.filter((card) => !card.builtIn && !card.deletedAt && legacyDeckIds.has(card.deckId)).sortBy("updatedAt");
  cards.reverse();
  if (!cards.length) {
    const empty = document.createElement("div"); empty.className = "study-empty"; empty.textContent = "自作カードはまだありません。最初の1枚を作成しましょう。"; list.append(empty); return;
  }
  for (const card of cards) {
    const item = document.createElement("article"); item.className = "study-card-row"; item.dataset.id = card.id;
    const body = document.createElement("button"); body.type = "button"; body.className = "study-card-main"; body.dataset.action = "edit";
    const title = document.createElement("strong"); title.textContent = card.front;
    const meta = document.createElement("span"); meta.textContent = `${card.kind === "multiple-choice" ? "選択問題" : card.kind === "term" ? "用語" : "基本"} · ${card.field || "分野なし"}`;
    body.append(title, meta);
    const actions = document.createElement("div"); actions.className = "study-row-actions";
    for (const [action, label] of [["duplicate", "複製"], ["delete", "削除"]]) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.action = action; button.textContent = label; actions.append(button);
    }
    item.append(body, actions); list.append(item);
  }
}

async function fillDecks(selected?: string): Promise<void> {
  const select = $("#studyDeck") as HTMLSelectElement;
  select.replaceChildren();
  const decks = await db.decks.filter((deck) => !deck.deletedAt && deck.system !== "memory").sortBy("order");
  for (const deck of decks) {
    const option = document.createElement("option"); option.value = deck.id; option.textContent = deck.name; select.append(option);
  }
  select.value = selected ?? "deck-personal";
}

async function editCard(card: StudyCard, isNew = false): Promise<void> {
  editingId = isNew ? null : card.id;
  await fillDecks(card.deckId);
  ($("#studyKind") as HTMLSelectElement).value = card.kind;
  ($("#studyFront") as HTMLTextAreaElement).value = card.front;
  ($("#studyBack") as HTMLTextAreaElement).value = card.back;
  ($("#studyChoices") as HTMLTextAreaElement).value = card.choices.join("\n");
  ($("#studyCorrect") as HTMLInputElement).value = String((card.correctChoiceIndex ?? 0) + 1);
  ($("#studyExplanation") as HTMLTextAreaElement).value = card.explanation;
  ($("#studyField") as HTMLInputElement).value = card.field;
  ($("#studySource") as HTMLInputElement).value = card.source;
  ($("#studyTags") as HTMLInputElement).value = card.tags.join(", ");
  ($("#studyImageAlt") as HTMLInputElement).value = card.imageAlt;
  $("#studyCardForm").classList.remove("hidden");
  $("#studyCardForm").dataset.image = card.image ?? "";
  renderImagePreview(card.image);
  toggleChoiceFields();
  ($("#studyFront") as HTMLTextAreaElement).focus();
}

function toggleChoiceFields(): void {
  const isChoice = ($("#studyKind") as HTMLSelectElement).value === "multiple-choice";
  $("#studyChoiceFields").classList.toggle("hidden", !isChoice);
}

async function onSave(event: Event): Promise<void> {
  event.preventDefault();
  try {
  const current = editingId ? await db.cards.get(editingId) : makeEmptyCard();
  if (!current) return;
  const kind = ($("#studyKind") as HTMLSelectElement).value as CardKind;
  const choices = ($("#studyChoices") as HTMLTextAreaElement).value.split("\n").map((value) => value.trim()).filter(Boolean);
  const correct = Number(($("#studyCorrect") as HTMLInputElement).value) - 1;
  const imageFile = ($("#studyImage") as HTMLInputElement).files?.[0];
  const image = imageFile ? await compressImage(imageFile) : ($("#studyCardForm").dataset.image || null);
  const next: StudyCard = {
    ...current,
    kind,
    deckId: ($("#studyDeck") as HTMLSelectElement).value,
    front: ($("#studyFront") as HTMLTextAreaElement).value.trim(),
    back: ($("#studyBack") as HTMLTextAreaElement).value.trim(),
    choices: kind === "multiple-choice" ? choices : [],
    correctChoiceIndex: kind === "multiple-choice" ? correct : null,
    explanation: ($("#studyExplanation") as HTMLTextAreaElement).value.trim(),
    field: ($("#studyField") as HTMLInputElement).value.trim(),
    source: ($("#studySource") as HTMLInputElement).value.trim(),
    tags: ($("#studyTags") as HTMLInputElement).value.split(",").map((value) => value.trim()).filter(Boolean),
    image,
    imageAlt: ($("#studyImageAlt") as HTMLInputElement).value.trim(),
    version: current.version + (editingId ? 1 : 0),
    updatedAt: nowIso(),
  };
  const error = validateCard(next);
  $("#studyFormError").textContent = error;
  if (error) return;
  await saveCard(next);
  await mirrorCustomCardsToLegacy();
  editingId = null;
  $("#studyCardForm").classList.add("hidden");
  ($("#studyCardForm") as HTMLFormElement).reset();
  await renderCards(); await renderStats();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    $("#studyFormError").textContent = `保存に失敗しました: ${message}`;
    console.error("カード保存エラー", error);
  }
}

function validateCard(card: StudyCard): string {
  if (!card.front) return "表・問題文を入力してください。";
  if (card.kind === "multiple-choice" && card.choices.length < 2) return "選択肢を2個以上入力してください。";
  if (card.kind === "multiple-choice" && (card.correctChoiceIndex == null || card.correctChoiceIndex < 0 || card.correctChoiceIndex >= card.choices.length)) return "正解番号を選択肢の範囲内で指定してください。";
  return "";
}

async function compressImage(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("画像は10MB以下にしてください");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("画像を処理できません");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return canvas.toDataURL("image/webp", 0.82);
}

function renderImagePreview(src: string | null): void {
  const preview = $("#studyImagePreview"); preview.replaceChildren(); preview.classList.toggle("hidden", !src);
  if (src) { const image = document.createElement("img"); image.src = src; image.alt = "カード画像プレビュー"; preview.append(image); }
}

async function renderStats(): Promise<void> {
  const cards = await db.cards.filter((card) => !card.deletedAt).count();
  const events = await db.reviewEvents.toArray();
  const schedules = await db.schedules.toArray();
  const now = Date.now(); const week = now + 7 * 86_400_000;
  const due = schedules.filter((item) => new Date(item.due).getTime() <= now).length;
  const forecast = schedules.filter((item) => { const time = new Date(item.due).getTime(); return time > now && time <= week; }).length;
  const ratings = [1, 2, 3, 4].map((rating) => events.filter((item) => item.rating === rating).length);
  $("#studyStats").innerHTML = `<div class="study-stat-grid"><article><b>${cards}</b><span>自作カード</span></article><article><b>${events.length}</b><span>復習記録</span></article><article><b>${due}</b><span>今日まで</span></article><article><b>${forecast}</b><span>今後7日</span></article></div><div class="study-sync-card"><h3>評価の内訳</h3><div class="study-rating-bars"><span>もう一度 ${ratings[0]}</span><span>難しい ${ratings[1]}</span><span>できた ${ratings[2]}</span><span>簡単 ${ratings[3]}</span></div></div>`;
}

async function renderSync(message = ""): Promise<void> {
  const node = $("#studySyncStatus");
  node.className = "study-sync-status";
  node.textContent = message || "この端末に保存中（サーバーへは送信しません）";
}

async function onClick(event: Event): Promise<void> {
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-action],[data-tab]") : null;
  if (!target) { if (event.target === modal) closeModal(); return; }
  if (target.dataset.tab) {
    modal?.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", (item as HTMLElement).dataset.tab === target.dataset.tab));
    modal?.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("hidden", (item as HTMLElement).dataset.panel !== target.dataset.tab));
    return;
  }
  const action = target.dataset.action;
  const rowId = target.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (action === "close") closeModal();
  if (action === "new") await editCard(makeEmptyCard(), true);
  if (action === "save-card") await onSave(event);
  if (action === "cancel-edit") { editingId = null; $("#studyCardForm").classList.add("hidden"); }
  if (action === "edit" && rowId) { const card = await db.cards.get(rowId); if (card) await editCard(card); }
  if (action === "duplicate" && rowId) { const card = await db.cards.get(rowId); if (card) await saveCard({ ...card, id: uuid(), front: `${card.front}（コピー）`, suspendedAt: null, originDeckId: null, originVersion: null, originCardId: null, version: 1, createdAt: nowIso(), updatedAt: nowIso() }); await mirrorCustomCardsToLegacy(); await renderCards(); }
  if (action === "delete" && rowId && confirm("このカードを削除しますか？")) { const card = await db.cards.get(rowId); if (card) await saveCard({ ...card, deletedAt: nowIso(), updatedAt: nowIso(), version: card.version + 1 }); await mirrorCustomCardsToLegacy(); await renderCards(); }
  if (action === "new-deck") await createDeck();
  if (action === "account-settings") { closeModal(); window.dispatchEvent(new Event("study:open-account-settings")); }
  if (action === "export") await exportData();
  if (action === "import") ($("#studyImport") as HTMLInputElement).click();
}

async function createDeck(): Promise<void> {
  const name = prompt("新しいデッキ名"); if (!name?.trim()) return;
  const timestamp = nowIso();
  await saveDeck({
    id: uuid(), ownerId: null, name: name.trim(), description: "", order: await db.decks.count(),
    system: "legacy", subjectId: "civics", originSharedDeckId: null, originVersion: null,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY,
    desiredRetention: DEFAULT_DESIRED_RETENTION, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  });
  await fillDecks();
}

async function exportData(): Promise<void> {
  const data = { app: "civics-study", schemaVersion: 4, exportedAt: nowIso(), cards: await db.cards.filter((card) => !card.builtIn).toArray(), decks: await db.decks.toArray(), reviewEvents: (await db.reviewEvents.toArray()).map(({ syncedAt: _syncedAt, ownerId: _ownerId, ...event }) => event) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `公共政治経済演習_カード_${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
}

async function onImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    const parsed = importBundleSchema.parse(JSON.parse(await file.text()));
    await db.transaction("rw", db.cards, db.decks, db.reviewEvents, async () => {
      await db.cards.bulkPut(parsed.cards);
      await db.decks.bulkPut(parsed.decks.map((deck) => ({ ...deck, ownerId: null, version: 1, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null })));
      await db.reviewEvents.bulkPut(parsed.reviewEvents.map((item) => ({ ...item, rating: item.rating as 1 | 2 | 3 | 4, ownerId: null, syncedAt: null })));
    });
    await mirrorCustomCardsToLegacy(); await renderCards(); await renderStats(); await renderSync("バックアップを読み込みました");
  } catch (error) { await renderSync(`読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`); }
  input.value = "";
}

function onModalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.preventDefault(); closeModal(); return; }
  if (event.key !== "Tab" || !modal) return;
  const focusable = Array.from(modal.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")).filter((item) => !item.closest(".hidden"));
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
