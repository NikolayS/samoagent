import { timingSafeEqual } from "node:crypto";
import {
  makeWhisper,
  normalizeCueSemantic,
  normalizeWhisperPriority,
  WhisperQueue,
} from "../../packages/shared/whisper/index.ts";

/** Minimal socket contract shared by the phone app and listening CLI. */
export interface G2Socket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

interface Pending {
  socket: G2Socket;
  expiresAt: number;
}

interface Room {
  id: string;
  token: string;
  deviceToken: string;
  app?: G2Socket;
  agent?: G2Socket;
  queue: WhisperQueue;
  touchedAt: number;
}

/** Injectable seams for deterministic relay tests. */
export interface G2RelayOptions {
  now?: () => number;
  randomCode?: () => string;
  randomToken?: () => string;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

const MAX_FRAME = 8 * 1024;
const CODE_TTL = 600_000;
const ROOM_TTL = 86_400_000;
const CLAIM_WINDOW = 60_000;
const MAX_FAILED_CLAIMS = 10;
const MAX_CLAIMS = 30;
const MAX_CLAIM_IPS = 10_000;
const AGENT_AUTH_TIMEOUT = 5_000;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const token = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether a request path belongs to the G2 relay surface. */
export const isG2Path = (path: string) => path === "/g2" || path.startsWith("/g2/");

/**
 * In-memory G2 pairing and message relay.
 *
 * Phone sockets receive a short pairing code, agents claim it over HTTPS, and
 * the room carries whispers toward the phone and semantic cues back to an agent.
 * Failed pairing guesses are isolated and limited by client IP.
 */
export class G2Relay {
  private pending = new Map<string, Pending>();
  private bySocket = new Map<G2Socket, string>();
  private rooms = new Map<string, Room>();
  private claims = new Map<string, { start: number; count: number; failures: number }>();
  private pendingAgents = new Map<G2Socket, { id: string; timer: ReturnType<typeof setTimeout> }>();
  private now: () => number;
  private code: () => string;
  private randomToken: () => string;
  private setTimer: NonNullable<G2RelayOptions["setTimeout"]>;
  private clearTimer: NonNullable<G2RelayOptions["clearTimeout"]>;

  constructor(options: G2RelayOptions = {}) {
    this.now = options.now ?? Date.now;
    this.code =
      options.randomCode ??
      (() =>
        String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(
          6,
          "0",
        ));
    this.randomToken = options.randomToken ?? token;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
  }

  /** Register a phone socket and send it a fresh short-lived pairing code. */
  openApp(socket: G2Socket): void {
    this.sweep();
    let code = this.code();
    while (this.pending.has(code)) code = this.code();
    this.pending.set(code, { socket, expiresAt: this.now() + CODE_TTL });
    this.bySocket.set(socket, code);
    socket.send(
      JSON.stringify({
        type: "code",
        code,
        expires_at: new Date(this.now() + CODE_TTL).toISOString(),
      }),
    );
  }

  /** Remove a disconnected phone from pending codes or its active room. */
  closeApp(socket: G2Socket): void {
    const key = this.bySocket.get(socket);
    if (key) this.pending.delete(key);
    this.bySocket.delete(socket);
    for (const room of this.rooms.values()) {
      if (room.app === socket) room.app = undefined;
    }
  }

  /** Await an agent's first-frame auth before binding it to any room. */
  openAgent(socket: G2Socket, id: string): void {
    const timer = this.setTimer(() => {
      if (!this.pendingAgents.delete(socket)) return;
      socket.close(4401, "unauthorized");
    }, AGENT_AUTH_TIMEOUT);
    this.pendingAgents.set(socket, { id, timer });
  }

  /** Authenticate an agent's first frame and only then attach it to the room. */
  messageAgent(socket: G2Socket, raw: string | ArrayBufferView): void {
    const pending = this.pendingAgents.get(socket);
    if (!pending) return;
    this.pendingAgents.delete(socket);
    this.clearTimer(pending.timer);
    const text = this.decodeFrame(raw);
    if (text === null) {
      socket.close(4400, "frame too large");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      message = null;
    }
    const supplied =
      typeof message === "object" &&
      message !== null &&
      (message as any).type === "auth" &&
      typeof (message as any).token === "string"
        ? (message as any).token
        : "";
    const room = this.room(pending.id);
    if (!room || !equal(room.token, supplied)) {
      socket.close(4401, "unauthorized");
      return;
    }
    room.agent?.close(4409, "replaced");
    room.agent = socket;
    room.touchedAt = this.now();
  }

  /** Detach a disconnected cue-listening agent socket. */
  closeAgent(socket: G2Socket): void {
    const pending = this.pendingAgents.get(socket);
    if (pending) this.clearTimer(pending.timer);
    this.pendingAgents.delete(socket);
    for (const room of this.rooms.values()) {
      if (room.agent === socket) room.agent = undefined;
    }
  }

  /** Handle resume and cue protocol messages sent by the phone app. */
  messageApp(socket: G2Socket, raw: string | ArrayBufferView): void {
    const text = this.decodeFrame(raw);
    if (text === null) {
      socket.close(4400, "frame too large");
      return;
    }
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      socket.close(4400, "invalid json");
      return;
    }

    if (message.type === "resume" && typeof message.device_token === "string") {
      const pendingCode = this.bySocket.get(socket);
      if (pendingCode) {
        this.pending.delete(pendingCode);
        this.bySocket.delete(socket);
      }
      const room = [...this.rooms.values()].find((item) =>
        equal(item.deviceToken, message.device_token),
      );
      if (!room) {
        this.openApp(socket);
        return;
      }
      room.app?.close(4409, "replaced");
      room.app = socket;
      room.touchedAt = this.now();
      socket.send(JSON.stringify({ type: "paired", device_token: room.deviceToken }));
      for (const whisper of room.queue.list()) {
        socket.send(JSON.stringify({ type: "whisper", ...whisper }));
      }
      while (room.queue.take()) {}
      return;
    }

    const room = [...this.rooms.values()].find((item) => item.app === socket);
    if (message.type === "cue" && room) {
      const cue = normalizeCueSemantic(message.cue);
      if (cue) room.agent?.send(JSON.stringify({ type: "cue", cue }));
    }
  }

  private decodeFrame(raw: string | ArrayBufferView): string | null {
    const byteLength =
      typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
    if (byteLength > MAX_FRAME) return null;
    return typeof raw === "string"
      ? raw
      : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  }

  /** Serve pairing, whisper, health, and room deletion HTTP requests. */
  async fetch(request: Request, ip = "unknown"): Promise<Response> {
    this.sweep();
    const url = new URL(request.url);
    if (url.pathname === "/g2/health" && request.method === "GET") {
      return new Response("ok");
    }
    if (url.pathname === "/g2/pair" && request.method === "POST") {
      return this.pair(request, ip);
    }

    const match = /^\/g2\/rooms\/([^/]+)\/(whisper|agent)$/.exec(url.pathname);
    const id = match?.[1];
    const room = id ? this.room(id) : undefined;
    if (match?.[2] === "whisper" && request.method === "POST") {
      if (!room || !this.auth(request, room)) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await safeBody(request);
      const priority = normalizeWhisperPriority(body?.priority ?? "normal");
      const whisper = makeWhisper(
        {
          text: typeof body?.text === "string" ? body.text : "",
          priority: priority ?? "normal",
          ttlMs: body?.ttl_ms ?? null,
        },
        this.now(),
      );
      if (
        !whisper.text ||
        whisper.text.length > 2000 ||
        !priority ||
        (body?.ttl_ms != null &&
          (!Number.isInteger(body.ttl_ms) || body.ttl_ms < 1))
      ) {
        return json({ error: "invalid whisper" }, 400);
      }
      room.touchedAt = this.now();
      if (room.app) {
        room.app.send(JSON.stringify({ type: "whisper", ...whisper }));
        return json({ queued: false });
      }
      if (room.queue.size() >= room.queue.hardMax) return json({ error: "queue full" }, 429);
      room.queue.push(whisper);
      return json({ queued: true }, 202);
    }

    if (id && request.method === "DELETE") {
      if (!room || !this.auth(request, room)) {
        return json({ error: "unauthorized" }, 401);
      }
      room.app?.close(4401, "unpaired");
      room.agent?.close(4401, "unpaired");
      this.rooms.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }

  private async pair(request: Request, ip: string): Promise<Response> {
    const claim = this.claim(ip);
    if (!claim.allowed) return json({ error: "rate limited" }, 429);
    const body = await safeBody(request);
    const code = body?.code;
    const pending = typeof code === "string" ? this.pending.get(code) : undefined;
    if (!pending) {
      claim.recordFailure();
      return json({ error: "invalid code" }, 404);
    }
    if (this.now() >= pending.expiresAt) {
      this.pending.delete(code);
      return json({ error: "expired code" }, 410);
    }
    this.pending.delete(code);
    this.bySocket.delete(pending.socket);
    const room: Room = {
      id: this.randomToken(),
      token: this.randomToken(),
      deviceToken: this.randomToken(),
      app: pending.socket,
      queue: new WhisperQueue({ now: this.now }),
      touchedAt: this.now(),
    };
    this.rooms.set(room.id, room);
    pending.socket.send(
      JSON.stringify({ type: "paired", device_token: room.deviceToken }),
    );
    return json({ room_id: room.id, room_token: room.token });
  }

  private auth(request: Request, room: Room): boolean {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    return !!match && equal(match[1]!, room.token);
  }

  private room(id: string): Room | undefined {
    const room = this.rooms.get(id);
    if (room && this.now() - room.touchedAt >= ROOM_TTL) {
      this.rooms.delete(id);
      return undefined;
    }
    return room;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      if (now - room.touchedAt >= ROOM_TTL) this.rooms.delete(id);
    }
    for (const [ip, entry] of this.claims) {
      if (now - entry.start >= CLAIM_WINDOW) this.claims.delete(ip);
    }
  }

  private claim(ip: string): { allowed: boolean; recordFailure(): void } {
    const now = this.now();
    let entry = this.claims.get(ip);
    if (!entry || now - entry.start >= CLAIM_WINDOW) {
      if (!entry && this.claims.size >= MAX_CLAIM_IPS) {
        let oldestIp: string | undefined;
        let oldestStart = Infinity;
        for (const [candidate, value] of this.claims) {
          if (value.start < oldestStart) { oldestStart = value.start; oldestIp = candidate; }
        }
        if (oldestIp !== undefined) this.claims.delete(oldestIp);
      }
      entry = { start: now, count: 0, failures: 0 };
      this.claims.set(ip, entry);
    }
    const allowed = entry.count < MAX_CLAIMS && entry.failures < MAX_FAILED_CLAIMS;
    entry.count += 1;
    return { allowed, recordFailure: () => void (entry!.failures += 1) };
  }

  /** Number of live claim windows; exposed for deterministic bound tests. */
  claimWindowCount(): number { return this.claims.size; }
}

async function safeBody(request: Request): Promise<any> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_FRAME) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
