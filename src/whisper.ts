import { formatLocalTranscriptTs } from "./transcript.ts";
import {
  CUE_LINE_MARKER,
  WHISPER_LINE_MARKER,
  renderHudFrame,
  sanitizeTranscriptField,
  type CueSemantic,
  type HudFrame,
  type HudGeometry,
  type Whisper,
} from "../packages/shared/whisper/index.ts";

export * from "../packages/shared/whisper/index.ts";

/** The output port for a private wearer-facing message. */
export interface WhisperSink {
  deliver(w: Whisper): void | boolean | Promise<void | boolean>;
}

/** Print whispers to stderr without polluting command output. */
export function createConsoleSink(
  write: (s: string) => void = (s) => void process.stderr.write(s),
): WhisperSink {
  return {
    deliver(w: Whisper): void {
      write(`[whisper:${w.priority}] ${w.text}\n`);
    },
  };
}

/** A {@link WhisperSink} that keeps every simulated HUD frame it rendered. */
export interface FakeHudSink extends WhisperSink {
  deliver(w: Whisper): void;
  frames: HudFrame[];
  lastFrame(): HudFrame | null;
}

export function createFakeHudSink(geometry: HudGeometry = {}): FakeHudSink {
  const frames: HudFrame[] = [];
  return {
    frames,
    deliver(w: Whisper): void {
      frames.push(renderHudFrame(w.text, geometry));
    },
    lastFrame(): HudFrame | null {
      return frames[frames.length - 1] ?? null;
    },
  };
}

/** Format the transcript control line for a delivered whisper. */
export function formatWhisperTranscriptLine(text: string, now: Date): string {
  return `[${formatLocalTranscriptTs(now)}] ${WHISPER_LINE_MARKER} ${sanitizeTranscriptField(text)}`;
}

/** Format the transcript control line for a wearer cue. */
export function formatCueTranscriptLine(cue: CueSemantic, now: Date): string {
  return `[${formatLocalTranscriptTs(now)}] ${CUE_LINE_MARKER} ${cue}`;
}
