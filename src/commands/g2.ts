import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ParsedArgs } from "../args.ts";
import { ExitError } from "../config.ts";
import { transcriptFileFromState } from "../state.ts";
import { cmdCue } from "./cue.ts";

/** Persistent room credentials returned by the relay pairing endpoint. */
export interface G2Config {
  room_id: string;
  room_token: string;
}

type Fetch = (request: Request) => Promise<Response>;

/** Injectable I/O seams used by G2 command tests. */
export interface G2Deps {
  file?: string;
  fetch?: Fetch;
  relay?: string;
  WebSocket?: typeof WebSocket;
  cue?: (value: string) => void | Promise<void>;
  requireSession?: () => void;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}

/** Location of the mode-0600 local G2 room credential file. */
export const g2File = () =>
  process.env.SAMOGRAPH_G2_FILE ?? join(homedir(), ".samograph", "g2.json");

/** Base URL of the shared G2 relay. */
export const g2Relay = () =>
  (process.env.SAMOGRAPH_G2_RELAY ?? "https://samograph.samo.team").replace(/\/$/, "");

/** Load and validate a saved G2 pairing, returning null when unavailable. */
export function loadG2Config(file = g2File()): G2Config | null {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return typeof value.room_id === "string" && typeof value.room_token === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Claim a phone pairing code and persist the resulting room credentials. */
export async function cmdG2Pair(args: ParsedArgs, deps: G2Deps = {}): Promise<void> {
  const code = args.g2_code ?? "";
  if (!/^\d{6}$/.test(code)) fail("pairing code must be 6 digits");
  const relay = deps.relay ?? g2Relay();
  let response: Response;
  try {
    response = await request(
      `${relay}/g2/pair`,
      {
        method: "POST",
        body: JSON.stringify({ code }),
        headers: { "content-type": "application/json" },
      },
      deps.fetch ?? fetch,
    );
  } catch (error) {
    fail(`relay unreachable at ${relay}: ${cause(error)}`);
  }
  if (!response.ok) {
    fail(`pairing code rejected by relay (${response.status} ${await responseError(response)})`);
  }

  const config = (await response.json()) as G2Config;
  const file = deps.file ?? g2File();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  process.stdout.write("G2 paired.\n");
}

/** Delete the paired relay room and its local credentials. */
export async function cmdG2Unpair(
  _args: ParsedArgs,
  deps: G2Deps = {},
): Promise<void> {
  const file = deps.file ?? g2File();
  const config = requirePairing(file);
  const relay = deps.relay ?? g2Relay();
  let response: Response;
  try {
    response = await request(
      `${relay}/g2/rooms/${encodeURIComponent(config.room_id)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${config.room_token}` },
      },
      deps.fetch ?? fetch,
    );
  } catch (error) {
    fail(`relay unreachable at ${relay}: ${cause(error)}`);
  }
  if (!response.ok && response.status !== 404) {
    fail(`relay rejected unpair (${response.status} ${await responseError(response)})`);
  }
  rmSync(file, { force: true });
  process.stdout.write("G2 unpaired.\n");
}

/** Create the authenticated G2 whisper delivery sink. */
export function createG2Sink(deps: G2Deps = {}) {
  const config = requirePairing(deps.file);
  const relay = deps.relay ?? g2Relay();
  return {
    async deliver(whisper: { text: string; priority: string; ttlMs: number | null }) {
      let response: Response;
      try {
        response = await request(
          `${relay}/g2/rooms/${encodeURIComponent(config.room_id)}/whisper`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.room_token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              text: whisper.text,
              priority: whisper.priority,
              ttl_ms: whisper.ttlMs,
            }),
          },
          deps.fetch ?? fetch,
        );
      } catch (error) {
        fail(`relay unreachable at ${relay}: ${cause(error)}`);
      }
      if (!response.ok) {
        fail(`relay rejected whisper (${response.status} ${await responseError(response)})`);
      }
      return response.status === 202;
    },
  };
}

/**
 * Listen for G2 cues for the active meeting, reconnecting until Ctrl-C.
 *
 * The relay socket carries semantic cue messages which are appended through the
 * same command used by local cue input. Disconnects retry with 1–30 second
 * exponential backoff; an abort signal provides the Ctrl-C shutdown boundary.
 */
export async function cmdG2Listen(
  _args: ParsedArgs,
  deps: G2Deps = {},
): Promise<void> {
  (deps.requireSession ?? (() => void transcriptFileFromState()))();
  const config = requirePairing(deps.file);
  const relay = deps.relay ?? g2Relay();
  const url =
    relay.replace(/^http/, "ws") +
    `/g2/rooms/${encodeURIComponent(config.room_id)}/agent` +
    `?token=${encodeURIComponent(config.room_token)}`;
  const controller = deps.signal ? null : new AbortController();
  const signal = deps.signal ?? controller!.signal;
  const stop = () => controller?.abort();
  if (controller) process.once("SIGINT", stop);
  process.stdout.write(
    `Listening for G2 cues (room ${config.room_id}). Ctrl-C to stop.\n`,
  );

  let delay = 1_000;
  try {
    while (!signal.aborted) {
      await listenOnce(url, signal, deps);
      if (signal.aborted) break;
      await (deps.wait ?? wait)(delay);
      delay = Math.min(30_000, delay * 2);
    }
  } finally {
    if (controller) process.off("SIGINT", stop);
  }
}

async function listenOnce(url: string, signal: AbortSignal, deps: G2Deps): Promise<void> {
  const Socket = deps.WebSocket ?? WebSocket;
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new Socket(url);
    } catch (error) {
      process.stderr.write(`Error: relay unreachable at ${url}: ${cause(error)}\n`);
      resolve();
      return;
    }
    const abort = () => socket.close();
    signal.addEventListener("abort", abort, { once: true });
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "cue") {
          void (deps.cue
            ? deps.cue(message.cue)
            : cmdCue({ command: "g2-cue", cue: message.cue }));
        }
      } catch {}
    };
    socket.onerror = () => {
      process.stderr.write(`Error: relay unreachable at ${url}: WebSocket error\n`);
    };
    socket.onclose = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
  });
}

function requirePairing(file = g2File()): G2Config {
  const config = loadG2Config(file);
  if (!config) fail("not paired. Run 'samograph g2-pair <code>' first.");
  return config;
}

function request(url: string, init: RequestInit, fetcher: Fetch): Promise<Response> {
  return fetcher(new Request(url, init));
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  throw new ExitError(1);
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {}
  return response.statusText || "request failed";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
