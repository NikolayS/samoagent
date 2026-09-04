import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitError } from "../src/config.ts";
import { cmdWhisper } from "../src/commands/whisper.ts";
import { cmdCue } from "../src/commands/cue.ts";
import type { Whisper } from "../src/whisper.ts";
import { makeTmpDir, cleanupTmpDir, saveEnv, restoreEnv } from "./helpers.ts";

const AT = new Date(2026, 7, 26, 14, 5, 9);

function collect(stream: "stdout" | "stderr", fn: () => Promise<void>): {
  run: Promise<void>;
  out: string[];
} {
  const out: string[] = [];
  const orig = process[stream].write.bind(process[stream]);
  (process[stream].write as unknown) = (s: string) => {
    out.push(s);
    return true;
  };
  const run = fn().finally(() => {
    (process[stream].write as unknown) = orig;
  });
  return { run, out };
}

describe("cmdWhisper", () => {
  let tmp: string;
  let transcript: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    tmp = makeTmpDir();
    transcript = join(tmp, "transcript.txt");
    process.env.SAMOGRAPH_STATE_FILE = join(tmp, "state.json");
    writeFileSync(
      join(tmp, "state.json"),
      JSON.stringify({ bot_id: "bot-123", transcript_file: transcript }),
    );
    writeFileSync(transcript, "");
  });

  afterEach(() => {
    restoreEnv(env);
    cleanupTmpDir(tmp);
  });

  it("delivers to the sink and appends exactly one SAMOGRAPH-WHISPER line", async () => {
    const delivered: Whisper[] = [];
    const { run, out } = collect("stdout", () =>
      cmdWhisper(
        { command: "g2-whisper", message: "Ask about the index bloat" },
        { sink: { deliver: (x) => void delivered.push(x) }, now: () => AT },
      ),
    );
    await run;

    expect(delivered).toEqual([
      {
        text: "Ask about the index bloat",
        priority: "normal",
        at: AT.toISOString(),
        ttlMs: null,
      },
    ]);
    expect(readFileSync(transcript, "utf-8")).toBe(
      "[2026-08-26 14:05:09] SAMOGRAPH-WHISPER: Ask about the index bloat\n",
    );
    expect(out.join("")).toBe("Whispered: Ask about the index bloat\n");
  });

  it("carries --priority and --ttl through to the delivered whisper", async () => {
    const delivered: Whisper[] = [];
    const { run } = collect("stdout", () =>
      cmdWhisper(
        {
          command: "g2-whisper",
          message: "Wrap up",
          whisper_priority: "high",
          whisper_ttl_ms: 30_000,
        },
        { sink: { deliver: (x) => void delivered.push(x) }, now: () => AT },
      ),
    );
    await run;
    expect(delivered[0]).toEqual({
      text: "Wrap up",
      priority: "high",
      at: AT.toISOString(),
      ttlMs: 30_000,
    });
  });

  it("prints the fake-HUD frame so overflow is visible with no hardware", async () => {
    const { run, out } = collect("stdout", () =>
      cmdWhisper(
        {
          command: "g2-whisper",
          message: "alpha bravo charlie delta echo",
          whisper_sink: "fake-hud",
        },
        { now: () => AT, hudGeometry: { widthPx: 60, heightPx: 60, lineHeightPx: 20 } },
      ),
    );
    await run;
    expect(out.join("")).toBe(
      [
        "┌─────┐",
        "│alpha│",
        "│bravo│",
        "│char…│",
        "└─────┘",
        "3 more lines did not fit the 60x60 display.",
        "Whispered: alpha bravo charlie delta echo",
        "",
      ].join("\n"),
    );
  });

  it("rejects an invalid priority before writing anything", async () => {
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdWhisper(
          { command: "g2-whisper", message: "hi", whisper_priority: "urgent" },
          { now: () => AT },
        ),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe(
      "Error: whisper priority must be one of: low, normal, high\n",
    );
    expect(readFileSync(transcript, "utf-8")).toBe("");
  });

  it("rejects an unknown sink before writing anything", async () => {
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdWhisper(
          { command: "g2-whisper", message: "hi", whisper_sink: "hologram" },
          { now: () => AT },
        ),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe("Error: whisper sink must be one of: console, fake-hud\n");
    expect(readFileSync(transcript, "utf-8")).toBe("");
  });

  it("rejects empty whisper text", async () => {
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdWhisper({ command: "g2-whisper", message: "   " }, { now: () => AT }),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe("Error: whisper text must not be empty\n");
  });

  it("degrades cleanly with no active session", async () => {
    writeFileSync(join(tmp, "state.json"), JSON.stringify({ bot_id: "bot-123" }));
    const delivered: Whisper[] = [];
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdWhisper(
          { command: "g2-whisper", message: "hi" },
          { sink: { deliver: (x) => void delivered.push(x) }, now: () => AT },
        ),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe(
      "Error: no active session. Run 'samograph join' first.\n",
    );
    expect(delivered).toEqual([]);
  });
});

describe("cmdCue", () => {
  let tmp: string;
  let transcript: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = saveEnv();
    tmp = makeTmpDir();
    transcript = join(tmp, "transcript.txt");
    process.env.SAMOGRAPH_STATE_FILE = join(tmp, "state.json");
    writeFileSync(
      join(tmp, "state.json"),
      JSON.stringify({ bot_id: "bot-123", transcript_file: transcript }),
    );
    writeFileSync(transcript, "");
  });

  afterEach(() => {
    restoreEnv(env);
    cleanupTmpDir(tmp);
  });

  it("appends the SAMOGRAPH-CUE control line on the existing transcript stream", async () => {
    const { run, out } = collect("stdout", () =>
      cmdCue({ command: "g2-cue", cue: "confirm" }, { now: () => AT }),
    );
    await run;
    expect(readFileSync(transcript, "utf-8")).toBe(
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: confirm\n",
    );
    expect(out.join("")).toBe("Cue: confirm\n");
  });

  it("accepts every semantic cue and nothing physical", async () => {
    for (const semantic of ["confirm", "dismiss", "next", "more"]) {
      const { run } = collect("stdout", () =>
        cmdCue({ command: "g2-cue", cue: semantic }, { now: () => AT }),
      );
      await run;
    }
    expect(readFileSync(transcript, "utf-8").split("\n").filter(Boolean)).toEqual([
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: confirm",
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: dismiss",
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: next",
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: more",
    ]);
  });

  it("rejects a physical (non-semantic) cue without writing", async () => {
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdCue({ command: "g2-cue", cue: "double-tap" }, { now: () => AT }),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe(
      "Error: cue must be one of: confirm, dismiss, next, more\n",
    );
    expect(readFileSync(transcript, "utf-8")).toBe("");
  });

  it("degrades cleanly with no active session", async () => {
    writeFileSync(join(tmp, "state.json"), JSON.stringify({ bot_id: "bot-123" }));
    const { run, out } = collect("stderr", async () => {
      await expect(
        cmdCue({ command: "g2-cue", cue: "next" }, { now: () => AT }),
      ).rejects.toBeInstanceOf(ExitError);
    });
    await run;
    expect(out.join("")).toBe(
      "Error: no active session. Run 'samograph join' first.\n",
    );
    expect(existsSync(transcript)).toBe(true);
    expect(readFileSync(transcript, "utf-8")).toBe("");
  });
});
