// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* 端末間同期の往復試験。
   中継サーバー（worker/src/index.js と同じ約束事）をメモリ上に置き、
   2台の端末を別々のモジュール実体として動かして、
   「取り込む → 統合する → 書き戻す」で記録が両方に行き渡ることを確かめる。 */

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const ENDPOINT = "https://civics-sync.example.workers.dev";
const CODE = "ABCD-EFGH-JKMN";

interface Room { rev: string; blob: string }
const rooms = new Map<string, Room>();
/** PUT の直前に別端末が書き込む状況を作るための細工 */
let beforePut: (() => void) | null = null;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const match = url.match(/^(.*)\/v1\/rooms\/([0-9a-f]{32})$/);
  if (!match || match[1] !== ENDPOINT) return new Response("not found", { status: 404 });
  const roomId = match[2];
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const room = rooms.get(roomId);
    if (!room) return jsonResponse({ error: "empty" }, 404);
    return jsonResponse({ rev: room.rev, blob: room.blob }, 200);
  }
  if (method === "PUT") {
    beforePut?.();
    const expected = new Headers(init?.headers).get("If-Match");
    const room = rooms.get(roomId);
    const currentRev = room?.rev ?? null;
    if (expected === "*" ? currentRev != null : expected !== currentRev) {
      return jsonResponse({ error: "conflict", rev: currentRev }, 412);
    }
    const body = JSON.parse(String(init?.body)) as { blob: string };
    const rev = `rev-${rooms.size}-${Math.random().toString(36).slice(2)}`;
    rooms.set(roomId, { rev, blob: body.blob });
    return jsonResponse({ rev }, 200);
  }
  return new Response("no", { status: 405 });
}) as typeof fetch;

type Progress = Record<string, { seen: number }>;
type SyncModule = typeof import("../src/sync");

/** 端末1台ぶん。localStorage は1つしかないので、切り替えのたびに退避・復元する。 */
class Device {
  store = new Map<string, string>();
  progress: Progress = {};
  module: SyncModule | null = null;

  snapshot(): unknown {
    return {
      app: "common-test-civics", version: 1, exportedAt: new Date().toISOString(),
      data: { progress: structuredClone(this.progress), meta: {}, writtenAttempts: [], study: null, settings: {} },
    };
  }

  /** 本物の統合（index.html の mergeProgress）と同じく「多い方を採る」 */
  merge(snapshot: unknown): void {
    const incoming = ((snapshot as { data?: { progress?: Progress } }).data?.progress) ?? {};
    for (const [id, row] of Object.entries(incoming)) {
      const mine = this.progress[id];
      this.progress[id] = { seen: Math.max(mine?.seen ?? 0, row.seen ?? 0) };
    }
  }
}

async function use<T>(device: Device, run: (sync: SyncModule) => Promise<T>): Promise<T> {
  localStorage.clear();
  for (const [key, value] of device.store) localStorage.setItem(key, value);
  vi.resetModules();
  const sync = (await import("../src/sync")) as SyncModule;
  device.module = sync;
  window.STUDY_SYNC_HOST = {
    build: async () => device.snapshot(),
    apply: async (snapshot: unknown) => device.merge(snapshot),
  };
  try {
    return await run(sync);
  } finally {
    device.store.clear();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) as string;
      device.store.set(key, localStorage.getItem(key) as string);
    }
  }
}

function setUp(device: Device): Promise<void> {
  return use(device, async (sync) => {
    sync.saveConfig({ endpoint: ENDPOINT });
  });
}

beforeEach(() => {
  rooms.clear();
  beforePut = null;
  localStorage.clear();
});

describe("同期コード", () => {
  it("書き写しの揺れを吸収し、桁数が違うものは受け付けない", async () => {
    const { normalizeSyncCode, formatSyncCode, generateSyncCode } = await import("../src/sync-code");
    expect(normalizeSyncCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeSyncCode("abcd efgh jkmn")).toBe("ABCDEFGHJKMN");
    // 紛らわしい O・I・L は 0・1 とみなす
    expect(normalizeSyncCode("OI23-4567-89AB")).toBe("0123456789AB");
    expect(normalizeSyncCode("ABC")).toBeNull();
    expect(normalizeSyncCode("ABCD-EFGH-JKM!")).toBeNull();
    expect(formatSyncCode(generateSyncCode())).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("同じコードからは同じ部屋が、違うコードからは違う部屋ができる", async () => {
    const { deriveRoom } = await import("../src/sync-code");
    const a = await deriveRoom("ABCDEFGHJKMN");
    const b = await deriveRoom("ABCDEFGHJKMN");
    const c = await deriveRoom("ABCDEFGHJKMP");
    expect(a.roomId).toBe(b.roomId);
    expect(a.roomId).not.toBe(c.roomId);
    expect(a.roomId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("コードを知らないと復号できない", async () => {
    const { deriveRoom, sealSnapshot, openSnapshot } = await import("../src/sync-code");
    const mine = await deriveRoom("ABCDEFGHJKMN");
    const other = await deriveRoom("ABCDEFGHJKMP");
    const sealed = await sealSnapshot(mine.key, '{"civics-2010-1":"覚え書き"}');
    expect(sealed).not.toContain("覚え書き");
    expect(await openSnapshot(mine.key, sealed)).toBe('{"civics-2010-1":"覚え書き"}');
    await expect(openSnapshot(other.key, sealed)).rejects.toThrow(/同期コードが違う/);
  });
});

describe("端末間同期（同期コード方式）", () => {
  it("2台目がコードで参加すると、両方の記録が行き渡る", async () => {
    const phone = new Device();
    const pc = new Device();
    phone.progress = { "civics-a": { seen: 3 } };
    pc.progress = { "civics-b": { seen: 1 } };
    await setUp(phone);
    await setUp(pc);

    await use(phone, (sync) => sync.connectWithCode(CODE));
    expect(rooms.size).toBe(1);

    await use(pc, (sync) => sync.connectWithCode(CODE));
    expect(pc.progress).toEqual({ "civics-a": { seen: 3 }, "civics-b": { seen: 1 } });

    // 1台目は次の同期で2台目の記録を受け取る
    await use(phone, (sync) => sync.syncNow());
    expect(phone.progress).toEqual({ "civics-a": { seen: 3 }, "civics-b": { seen: 1 } });
  });

  it("中継サーバーには平文を置かない", async () => {
    const phone = new Device();
    phone.progress = { "civics-秘密のメモ": { seen: 1 } };
    await setUp(phone);
    await use(phone, (sync) => sync.connectWithCode(CODE));
    const stored = [...rooms.values()][0].blob;
    expect(stored).not.toContain("秘密のメモ");
    expect(stored).not.toContain("civics");
    expect(JSON.parse(stored).alg).toBe("A256GCM");
  });

  it("中身が変わらないときは書き戻さない", async () => {
    const phone = new Device();
    phone.progress = { "civics-a": { seen: 2 } };
    await setUp(phone);
    await use(phone, (sync) => sync.connectWithCode(CODE));
    const first = [...rooms.values()][0].rev;
    const result = await use(phone, (sync) => sync.syncNow());
    expect(result.pushed).toBe(false);
    expect([...rooms.values()][0].rev).toBe(first);
  });

  it("書き戻す直前に別端末が書いていたら、読み直して統合し直す", async () => {
    const phone = new Device();
    const pc = new Device();
    phone.progress = { "civics-a": { seen: 1 } };
    await setUp(phone);
    await setUp(pc);
    await use(phone, (sync) => sync.connectWithCode(CODE));
    await use(pc, (sync) => sync.connectWithCode(CODE));

    // 1台目が書き戻す直前に、2台目が先に書き込んだ状況を作る
    phone.progress["civics-a"] = { seen: 5 };
    let interfered = false;
    beforePut = () => {
      if (interfered) return;
      interfered = true;
      const [roomId, room] = [...rooms.entries()][0];
      rooms.set(roomId, { rev: "rev-from-other-device", blob: room.blob });
    };
    const result = await use(phone, (sync) => sync.syncNow());
    expect(interfered).toBe(true);
    expect(result.pushed).toBe(true);

    // 割り込まれても記録は残り、2台目にも届く
    await use(pc, (sync) => sync.syncNow());
    expect(pc.progress["civics-a"]).toEqual({ seen: 5 });
  });

  it("つながらないコードでは接続したままにしない", async () => {
    const phone = new Device();
    await setUp(phone);
    await use(phone, async (sync) => {
      await expect(sync.connectWithCode("ABC")).rejects.toThrow(/12文字/);
      expect(sync.getStatus().connected).toBe(false);
    });
  });

  it("サーバーのURLが未設定なら接続を止める", async () => {
    const phone = new Device();
    await use(phone, async (sync) => {
      await expect(sync.connectWithCode(CODE)).rejects.toThrow(/同期サーバーのURL/);
      expect(sync.getStatus().endpointConfigured).toBe(false);
    });
  });

  it("解除しても、この端末の記録と部屋の記録は残る", async () => {
    const phone = new Device();
    phone.progress = { "civics-a": { seen: 4 } };
    await setUp(phone);
    await use(phone, (sync) => sync.connectWithCode(CODE));
    await use(phone, async (sync) => {
      await sync.disconnect();
      const status = sync.getStatus();
      expect(status.connected).toBe(false);
      expect(status.code).toBeNull();
      await expect(sync.syncNow()).rejects.toThrow(/設定されていません/);
    });
    expect(phone.progress).toEqual({ "civics-a": { seen: 4 } });
    expect(rooms.size).toBe(1);
  });
});
