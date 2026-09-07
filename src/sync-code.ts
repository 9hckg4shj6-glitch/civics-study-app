/**
 * 同期コード方式の下ごしらえ（コード生成・部屋IDの導出・暗号化）。
 *
 * 中継サーバー（Cloudflare Worker）には「部屋ID」と「暗号文」しか渡らない。
 * 部屋IDはコードのハッシュ、鍵はコードから導出するので、コードを知らない
 * サーバー管理者や第三者は中身を読めない（End-to-End 暗号化）。
 * 学習記録には答案の本文やメモが入るため、ここは平文で預けない。
 */

/** Crockford Base32 から紛らわしい I・L・O・U を除いた32文字 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 12文字＝60ビット。総当たりでは当てられず、手で書き写せる長さ */
export const CODE_LENGTH = 12;
const PBKDF2_ITERATIONS = 150000;

/** 見間違えやすい文字を、書き写しても同じコードになるように寄せる */
const CONFUSABLE: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

export function generateSyncCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 は 32 で割り切れるので、剰余を取っても文字の出方は偏らない
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** 入力されたコードを正規化する。桁数や文字が不正なら null。 */
export function normalizeSyncCode(input: string): string | null {
  const cleaned = (input || "")
    .toUpperCase()
    .replace(/[\s\-_・ー]/g, "")
    .split("")
    .map((ch) => CONFUSABLE[ch] ?? ch)
    .join("");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** 画面表示用に 4文字ずつ区切る */
export function formatSyncCode(code: string): string {
  return (code.match(/.{1,4}/g) || []).join("-");
}

/** TextEncoder の戻り値は SharedArrayBuffer 込みの型になるため、WebCrypto へ渡せる形に固定する */
type Bytes = Uint8Array<ArrayBuffer>;

function toBytes(text: string): Bytes {
  return new TextEncoder().encode(text) as Bytes;
}

function toBase64(bytes: Bytes): string {
  let binary = "";
  // 一度に渡すと引数が多すぎて落ちる端末があるので小分けにする
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SyncRoom {
  /** 中継サーバーに渡す部屋ID（コードのSHA-256の前半32桁） */
  roomId: string;
  /** 暗号化・復号に使う鍵。コードからしか作れない */
  key: CryptoKey;
}

export async function deriveRoom(code: string): Promise<SyncRoom> {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(`civics-sync-room-v1:${code}`));
  const roomId = toHex(digest).slice(0, 32);
  const material = await crypto.subtle.importKey("raw", toBytes(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toBytes(`civics-sync-key-v1:${roomId}`), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { roomId, key };
}

/** 学習記録は繰り返しの多いJSONなので、送る前に縮める（対応していない端末では素通し） */
async function deflate(bytes: Bytes): Promise<{ body: Bytes; encoding: "gzip" | "none" }> {
  if (typeof CompressionStream === "undefined") return { body: bytes, encoding: "none" };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { body: packed, encoding: "gzip" };
  } catch {
    return { body: bytes, encoding: "none" };
  }
}

async function inflate(bytes: Bytes, encoding: string): Promise<Bytes> {
  if (encoding !== "gzip") return bytes;
  if (typeof DecompressionStream === "undefined") throw new Error("この端末では圧縮された同期データを読めません");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface SealedSnapshot {
  v: 1;
  alg: "A256GCM";
  enc: "gzip" | "none";
  iv: string;
  ct: string;
}

export async function sealSnapshot(key: CryptoKey, text: string): Promise<string> {
  const { body, encoding } = await deflate(toBytes(text));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body);
  const sealed: SealedSnapshot = {
    v: 1, alg: "A256GCM", enc: encoding,
    iv: toBase64(iv), ct: toBase64(new Uint8Array(cipher)),
  };
  return JSON.stringify(sealed);
}

/** 復号できない（＝コードが違う・データが壊れている）ときは例外を投げる */
export async function openSnapshot(key: CryptoKey, blob: string): Promise<string> {
  let sealed: SealedSnapshot;
  try {
    sealed = JSON.parse(blob) as SealedSnapshot;
  } catch {
    throw new Error("同期データの形式が正しくありません");
  }
  if (!sealed || sealed.v !== 1 || sealed.alg !== "A256GCM" || !sealed.iv || !sealed.ct) {
    throw new Error("同期データの形式が正しくありません");
  }
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ct));
  } catch {
    throw new Error("同期コードが違うため、保存されている記録を読めません");
  }
  const bytes = await inflate(new Uint8Array(plain), sealed.enc);
  return new TextDecoder().decode(bytes);
}
