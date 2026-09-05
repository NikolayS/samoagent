import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cmdG2Listen,
  cmdG2Pair,
  cmdG2Unpair,
  createG2Sink,
  loadG2Config,
} from "../src/commands/g2.ts";

async function captureStderr(run: () => unknown | Promise<unknown>): Promise<string> {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr.write as unknown) = (value: string) => {
    writes.push(value);
    return true;
  };
  try {
    await run();
  } finally {
    (process.stderr.write as unknown) = original;
  }
  return writes.join("");
}

describe("G2 commands", () => {
  it("pairs into a 0600 config and unpairs remotely then locally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g2-")); const file = join(dir, "g2.json");
    const calls: Request[] = [];
    const fetcher = async (request: Request) => {
      calls.push(request);
      return request.method === "POST"
        ? Response.json({ room_id: "r", room_token: "t" })
        : new Response(null, { status: 204 });
    };
    await cmdG2Pair({ command: "g2-pair", g2_code: "483920" }, { file, fetch: fetcher });
    expect(loadG2Config(file)).toEqual({ room_id: "r", room_token: "t" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    await cmdG2Unpair({ command: "g2-unpair" }, { file, fetch: fetcher });
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect(() => readFileSync(file)).toThrow();
  });

  it("g2-listen forwards relay cues through the cue command seam", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g2-")); const file = join(dir, "g2.json");
    writeFileSync(file, JSON.stringify({ room_id: "room", room_token: "token" }));
    const cues: string[] = [];
    const abort = new AbortController();
    class FakeWebSocket {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      onerror?: () => void;

      constructor(public url: string) {
        queueMicrotask(() => {
          this.onopen?.();
          this.onmessage?.({ data: JSON.stringify({ type: "cue", cue: "confirm" }) });
          abort.abort();
          this.onclose?.();
        });
      }

      close() {}
    }
    await cmdG2Listen(
      { command: "g2-listen" },
      {
        file,
        WebSocket: FakeWebSocket as any,
        cue: (value) => void cues.push(value),
        requireSession: () => {},
        signal: abort.signal,
      },
    );
    expect(cues).toEqual(["confirm"]);
  });

  it("reports pairing rejection and unreachable relay failures", async () => {
    const rejected = await captureStderr(async () => {
      await expect(
        cmdG2Pair(
          { command: "g2-pair", g2_code: "483920" },
          { fetch: async () => Response.json({ error: "invalid code" }, { status: 404 }) },
        ),
      ).rejects.toThrow();
    });
    expect(rejected).toBe("Error: pairing code rejected by relay (404 invalid code)\n");

    const unreachable = await captureStderr(async () => {
      await expect(
        cmdG2Pair(
          { command: "g2-pair", g2_code: "483920" },
          {
            relay: "https://relay.test",
            fetch: async () => {
              throw new Error("connection refused");
            },
          },
        ),
      ).rejects.toThrow();
    });
    expect(unreachable).toBe(
      "Error: relay unreachable at https://relay.test: connection refused\n",
    );
  });

  it("reports missing pairing for unpair, sink, and listen", async () => {
    const file = join(tmpdir(), `missing-g2-${crypto.randomUUID()}.json`);
    for (const command of [
      () => cmdG2Unpair({ command: "g2-unpair" }, { file }),
      () => createG2Sink({ file }),
      () =>
        cmdG2Listen(
          { command: "g2-listen" },
          { file, requireSession: () => {} },
        ),
    ]) {
      const error = await captureStderr(async () => {
        await expect(
          Promise.resolve().then(async () => await command()),
        ).rejects.toThrow();
      });
      expect(error).toBe("Error: not paired. Run 'samograph g2-pair <code>' first.\n");
    }
  });

  it("g2-listen checks for an active session before opening a socket", async () => {
    const opened: string[] = [];
    class FakeWebSocket {
      constructor(url: string) {
        opened.push(url);
      }
    }
    const error = await captureStderr(async () => {
      await expect(
        cmdG2Listen(
          { command: "g2-listen" },
          {
            WebSocket: FakeWebSocket as any,
            requireSession: () => {
              process.stderr.write(
                "Error: no active session. Run 'samograph join' first.\n",
              );
              throw new Error("no session");
            },
          },
        ),
      ).rejects.toThrow();
    });
    expect(error).toBe("Error: no active session. Run 'samograph join' first.\n");
    expect(opened).toEqual([]);
  });

  it("g2-listen reconnects with capped exponential backoff", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g2-"));
    const file = join(dir, "g2.json");
    writeFileSync(file, JSON.stringify({ room_id: "room", room_token: "token" }));
    const delays: number[] = [];
    const abort = new AbortController();
    let connections = 0;
    class FakeWebSocket {
      onclose?: () => void;
      onerror?: () => void;
      onmessage?: () => void;

      constructor() {
        connections += 1;
        queueMicrotask(() => this.onclose?.());
      }

      close() {}
    }
    await cmdG2Listen(
      { command: "g2-listen" },
      {
        file,
        WebSocket: FakeWebSocket as any,
        requireSession: () => {},
        signal: abort.signal,
        wait: async (ms) => {
          delays.push(ms);
          if (delays.length === 7) abort.abort();
        },
      },
    );
    expect(connections).toBe(7);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });
});
