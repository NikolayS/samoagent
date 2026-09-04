import { ExitError } from "../config.ts";
import { transcriptFileFromState } from "../state.ts";
import { appendTranscriptLine } from "../transcript.ts";
import type { ParsedArgs } from "../args.ts";
import {
  G2_HEIGHT_PX,
  G2_WIDTH_PX,
  WhisperQueue,
  createConsoleSink,
  createFakeHudSink,
  formatWhisperTranscriptLine,
  makeWhisper,
  normalizeWhisperPriority,
  type HudGeometry,
  type Whisper,
  type WhisperSink,
} from "../whisper.ts";

/** The sinks reachable from the CLI today. A device sink lands behind the same port. */
export const WHISPER_SINK_NAMES = ["console", "fake-hud"] as const;

export interface WhisperDeps {
  /** Override the sink entirely (tests, embedders). Bypasses --sink. */
  sink?: WhisperSink;
  now?: () => Date;
  /** Geometry for the fake-hud sink; defaults to the real G2 screen. */
  hudGeometry?: HudGeometry;
  appendLine?: (path: string, line: string) => void;
}

/**
 * Send a private message to the wearer.
 *
 * The meeting never sees it — that is the whole point of the surface — but the
 * agent must, so every delivered whisper also lands in the active transcript as
 * a `SAMOGRAPH-WHISPER:` control line, exactly like the tunnel watchdog's
 * `SAMOGRAPH-WARNING:` lines. That reuse is what makes the channel useful with
 * no hardware attached: `samograph watch` already relays it.
 */
export async function cmdWhisper(
  args: ParsedArgs,
  deps: WhisperDeps = {},
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const appendLine = deps.appendLine ?? appendTranscriptLine;

  const text = (args.message ?? "").trim();
  if (!text) {
    process.stderr.write("Error: whisper text must not be empty\n");
    throw new ExitError(1);
  }

  // Re-validated here rather than trusted from parseArgs, so an embedder
  // calling cmdWhisper directly gets the same guarantees as the CLI.
  const priority = normalizeWhisperPriority(args.whisper_priority ?? "normal");
  if (priority === null) {
    process.stderr.write(
      "Error: whisper priority must be one of: low, normal, high\n",
    );
    throw new ExitError(1);
  }

  const sinkName = args.whisper_sink ?? "console";
  if (!(WHISPER_SINK_NAMES as readonly string[]).includes(sinkName)) {
    process.stderr.write(
      `Error: whisper sink must be one of: ${WHISPER_SINK_NAMES.join(", ")}\n`,
    );
    throw new ExitError(1);
  }

  // Only after the arguments are known good: a bad flag must not depend on
  // whether a call happens to be running.
  const transcriptPath = transcriptFileFromState();

  const hud = sinkName === "fake-hud" ? createFakeHudSink(deps.hudGeometry ?? {}) : null;
  const sink = deps.sink ?? hud ?? createConsoleSink();

  // A one-shot CLI invocation builds a FRESH queue, so preemption, depth
  // shedding and TTL expiry can never take effect here: with one whisper in
  // an empty queue, push-then-drain always delivers it. Priority and ttl are
  // still recorded on the whisper and handed to the sink. The queue policy
  // only matters inside a long-lived sink process (an embedded agent loop or
  // a device driver), which does not exist yet — README and --help say so.
  const queue = new WhisperQueue({ now: () => now().getTime() });
  queue.push(makeWhisper({ text, priority, ttlMs: args.whisper_ttl_ms ?? null }, now().getTime()));

  let delivered: Whisper | null;
  while ((delivered = queue.take()) !== null) {
    await sink.deliver(delivered);
    appendLine(transcriptPath, formatWhisperTranscriptLine(delivered.text, now()));
  }

  if (hud !== null) {
    const frame = hud.lastFrame();
    if (frame !== null) {
      process.stdout.write(`${frame.frame}\n`);
      if (frame.overflow) {
        const geometry = deps.hudGeometry ?? {};
        process.stdout.write(
          `${frame.hiddenLines} more lines did not fit the ` +
            `${geometry.widthPx ?? G2_WIDTH_PX}x${geometry.heightPx ?? G2_HEIGHT_PX} display.\n`,
        );
      }
    }
  }
  process.stdout.write(`Whispered: ${text}\n`);
}
