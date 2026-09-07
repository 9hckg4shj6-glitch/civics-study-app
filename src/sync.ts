/**
 * 端末間データ同期。12文字の「同期コード」で結ばれた中継サーバーの部屋に、
 * 「手動バックアップと同じ形のJSON」を預けるだけで、アプリ内部のデータ構造には触れない。
 * 部屋の作り方と預かるものは worker/ を参照（コードから鍵を作って暗号化するので、
 * サーバー側には暗号文しか届かない）。
 *
 * 同期は必ず「取り込む → 統合する → 書き戻す」の順で行う。統合は index.html 側の
 * 手動バックアップの取り込みと同じ処理（多い方・新しい方を採る）なので、
 * どちらの端末から先に同期しても最終的に同じ内容へ収束し、記録が消えることはない。
 *
 * 起動しただけでは通信しない。接続していない間、この module は何もしない。
 * ログインは持たない（アカウントを作らずに端末を結べることを優先している）。
 */

import {
  CODE_LENGTH,
  deriveRoom,
  formatSyncCode,
  generateSyncCode,
  normalizeSyncCode,
  openSnapshot,
  sealSnapshot,
  type SyncRoom,
} from "./sync-code";
/** 手動バックアップと同じ目印。別アプリのファイルを取り込まないための確認に使う */
const BACKUP_APP = "common-test-civics";
const STATE_KEY = "civicsSync_v1";
const CONFIG_KEY = "civicsSyncConfig_v1";
const MAX_ATTEMPTS = 3;

interface SyncState {
  connected: boolean;
  code: string | null;
  auto: boolean;
  lastSyncedAt: string | null;
}

interface SyncConfig {
  /** 中継サーバー（Cloudflare Worker）のURL */
  endpoint: string;
}

export interface SyncStatusView extends SyncConfig {
  connected: boolean;
  /** 表示用に4文字ずつ区切った同期コード（未接続なら null） */
  code: string | null;
  running: boolean;
  auto: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  endpointConfigured: boolean;
  online: boolean;
}

/** 学習記録の受け渡し口。index.html が起動時に window へ置く */
export interface SyncHost {
  build: () => Promise<unknown>;
  apply: (snapshot: unknown) => Promise<void>;
}

const DEFAULT_STATE: SyncState = {
  connected: false, code: null, auto: true, lastSyncedAt: null,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...(parsed as object) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートモードなどで保存できない端末では、この起動中だけ有効になる
  }
}

let state: SyncState = readJson(STATE_KEY, DEFAULT_STATE);
let running = false;
let lastError: string | null = null;

function saveState(): void {
  writeJson(STATE_KEY, state);
}

/**
 * 設定の読み場所は2つ。sync-config.js（配布物に同梱、公開時に書き換える）を土台にし、
 * 端末で入力された値（localStorage）があればそちらを優先する。
 * 後者があるおかげで、ビルドし直さなくても中継サーバーのURLを差し替えられる。
 */
export function readConfig(): SyncConfig {
  const global = (window as unknown as { SYNC_CONFIG?: Partial<SyncConfig> }).SYNC_CONFIG ?? {};
  const base: SyncConfig = {
    endpoint: typeof global.endpoint === "string" ? global.endpoint : "",
  };
  const override = readJson<SyncConfig>(CONFIG_KEY, { endpoint: "" });
  return { endpoint: (override.endpoint || base.endpoint).trim().replace(/\/+$/, "") };
}

export function saveConfig(patch: Partial<SyncConfig>): SyncConfig {
  const current = readJson<SyncConfig>(CONFIG_KEY, { endpoint: "" });
  const next: SyncConfig = {
    endpoint: (patch.endpoint ?? current.endpoint).trim().replace(/\/+$/, ""),
  };
  writeJson(CONFIG_KEY, next);
  notify();
  return readConfig();
}

export function getStatus(): SyncStatusView {
  const config = readConfig();
  return {
    ...config,
    connected: state.connected,
    code: state.code ? formatSyncCode(state.code) : null,
    running,
    auto: state.auto,
    lastSyncedAt: state.lastSyncedAt,
    lastError,
    endpointConfigured: config.endpoint !== "",
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  };
}

function notify(): void {
  window.dispatchEvent(new CustomEvent("study:sync-status", { detail: getStatus() }));
}

function host(): SyncHost {
  const found = (window as unknown as { STUDY_SYNC_HOST?: SyncHost }).STUDY_SYNC_HOST;
  if (!found) throw new Error("アプリの準備が終わっていません。少し待ってからお試しください");
  return found;
}

/* ---------- 送受信の中身 ---------- */

interface Remote {
  text: string | null;
  rev: string | null;
}

/** 部屋IDと鍵はコードから毎回同じものが出るので、一度作ったら使い回す */
let roomCache: { code: string; room: SyncRoom } | null = null;

async function room(code: string): Promise<SyncRoom> {
  if (roomCache && roomCache.code === code) return roomCache.room;
  const derived = await deriveRoom(code);
  roomCache = { code, room: derived };
  return derived;
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("同期サーバーに接続できませんでした（通信状態と設定のURLをご確認ください）");
  }
}

async function pullByCode(endpoint: string, code: string): Promise<Remote> {
  const { roomId, key } = await room(code);
  const response = await request(`${endpoint}/v1/rooms/${roomId}`);
  if (response.status === 404) return { text: null, rev: null };
  if (!response.ok) throw new Error(`同期サーバーから読み出せませんでした（${response.status}）`);
  const body = (await response.json()) as { rev?: string; blob?: string };
  if (!body.blob) return { text: null, rev: body.rev ?? null };
  return { text: await openSnapshot(key, body.blob), rev: body.rev ?? null };
}

async function pushByCode(endpoint: string, code: string, rev: string | null, text: string):
  Promise<{ ok: true; rev: string | null } | { ok: false }> {
  const { roomId, key } = await room(code);
  const blob = await sealSnapshot(key, text);
  const response = await request(`${endpoint}/v1/rooms/${roomId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": rev ?? "*" },
    body: JSON.stringify({ blob }),
  });
  if (response.status === 412) return { ok: false };
  if (response.status === 413) throw new Error("学習記録が大きすぎて同期サーバーに保存できません");
  if (!response.ok) throw new Error(`同期サーバーへ保存できませんでした（${response.status}）`);
  const body = (await response.json()) as { rev?: string };
  return { ok: true, rev: body.rev ?? null };
}

/* ---------- 統合と収束の判定 ---------- */

/**
 * 端末ごとにキーの並び順が違っても同じ文字列になるように整えてから比べる。
 * 中身が同じなら書き戻さずに済み、無駄な通信と版の増加を避けられる。
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** exportedAt（書き出した時刻）は毎回変わるので、比較からは外す */
function fingerprint(snapshot: unknown): string {
  const data = (snapshot as { data?: unknown } | null)?.data;
  return canonical(data ?? snapshot);
}

function parseSnapshot(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("同期サーバーの記録が壊れています");
  }
  const app = (parsed as { app?: unknown } | null)?.app;
  if (app !== BACKUP_APP) throw new Error("このアプリの学習記録ではありません");
  return parsed;
}

export interface SyncResult {
  pulled: boolean;
  pushed: boolean;
}

async function runSync(): Promise<SyncResult> {
  const config = readConfig();
  if (!state.connected || !state.code) throw new Error("同期がまだ設定されていません");
  if (!config.endpoint) throw new Error("同期サーバーのURLが設定されていません");
  const code = state.code;
  const pull = () => pullByCode(config.endpoint, code);
  const push = (rev: string | null, text: string) => pushByCode(config.endpoint, code, rev, text);
  const local = host();
  let pulled = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const remote = await pull();
    if (remote.text) {
      const snapshot = parseSnapshot(remote.text);
      await local.apply(snapshot);   // 統合（この端末の記録は消さない）
      pulled = true;
      const merged = await local.build();
      if (fingerprint(merged) === fingerprint(snapshot)) {
        // 統合しても中身が変わらない＝相手が最新。書き戻す必要はない
        return { pulled, pushed: false };
      }
      const result = await push(remote.rev, JSON.stringify(merged));
      if (result.ok) return { pulled, pushed: true };
      continue;   // 競合。もう一度読み直して統合し直す
    }
    const snapshot = await local.build();
    const result = await push(remote.rev, JSON.stringify(snapshot));
    if (result.ok) return { pulled, pushed: true };
  }
  throw new Error("ほかの端末の更新と重なりました。もう一度お試しください");
}

/** 同期は同時に走らせない。実行中に呼ばれたら、その1回に相乗りする。 */
let inFlight: Promise<SyncResult> | null = null;

export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  running = true;
  lastError = null;
  notify();
  inFlight = runSync()
    .then((result) => {
      state.lastSyncedAt = new Date().toISOString();
      saveState();
      return result;
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : "同期に失敗しました";
      saveState();
      throw error;
    })
    .finally(() => {
      running = false;
      inFlight = null;
      notify();
    });
  return inFlight;
}

/* ---------- 接続・解除 ---------- */

export async function connectWithCode(input: string): Promise<string> {
  const config = readConfig();
  if (!config.endpoint) throw new Error("先に同期サーバーのURLを設定してください");
  const code = normalizeSyncCode(input);
  if (!code) throw new Error(`同期コードは${CODE_LENGTH}文字です。入力をご確認ください`);
  state = { ...state, connected: true, code };
  saveState();
  notify();
  try {
    await syncNow();
  } catch (error) {
    // つながらないコードで接続したままにしない
    state = { ...state, connected: false, code: null };
    saveState();
    notify();
    throw error;
  }
  return formatSyncCode(code);
}

/** 新しいコードを発行して、この端末の記録をその部屋へ置く */
export async function createSyncCode(): Promise<string> {
  return connectWithCode(generateSyncCode());
}

/** この端末だけ同期をやめる。部屋の記録も、ほかの端末の記録もそのまま残る。 */
export function disconnect(): void {
  state = { ...DEFAULT_STATE, auto: state.auto };
  roomCache = null;
  lastError = null;
  saveState();
  notify();
}

export function setAuto(auto: boolean): void {
  state.auto = auto;
  saveState();
  notify();
  if (auto) void maybeSync();
}

/* ---------- 自動同期のきっかけ ---------- */

const MIN_GAP_MS = 60 * 1000;
const AFTER_STUDY_MS = 20 * 1000;
const INTERVAL_MS = 30 * 60 * 1000;
let lastAttemptAt = 0;
let studyTimer = 0;

async function maybeSync(): Promise<void> {
  if (!state.connected || !state.auto || running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const now = Date.now();
  if (now - lastAttemptAt < MIN_GAP_MS) return;
  lastAttemptAt = now;
  try {
    await syncNow();
  } catch {
    // 失敗はステータス欄に出る。次のきっかけでまた試す
  }
}

export function installAutoSync(): void {
  window.addEventListener("online", () => void maybeSync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void maybeSync();
  });
  // 学習のたびに送らず、手が止まってからまとめて送る
  window.addEventListener("study:review-saved", () => {
    if (!state.connected || !state.auto) return;
    window.clearTimeout(studyTimer);
    studyTimer = window.setTimeout(() => void maybeSync(), AFTER_STUDY_MS);
  });
  window.setInterval(() => void maybeSync(), INTERVAL_MS);
  if (state.connected && state.auto) window.setTimeout(() => void maybeSync(), 2000);
}

export { formatSyncCode, normalizeSyncCode };
