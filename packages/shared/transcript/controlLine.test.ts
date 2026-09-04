/**
 * Control-line predicate tests.
 *
 * samograph writes its own lines into the transcript stream — the tunnel
 * watchdog's `SAMOGRAPH-WARNING:`, the private `SAMOGRAPH-WHISPER:` channel,
 * the wearer's `SAMOGRAPH-CUE:` back-channel and the `SAMOGRAPH_CALL_ENDED`
 * sentinel. Every consumer that decides "is this speech?" must share ONE
 * predicate, so a new control marker can never leak through a consumer that
 * only knew about `SAMOGRAPH-WARNING`.
 */
import { describe, it, expect } from "bun:test";
import { isControlLine, isControlSpeaker } from "./index.ts";

describe("isControlSpeaker", () => {
  it("recognizes every SAMOGRAPH- / SAMOGRAPH_ speaker, not just WARNING", () => {
    expect(isControlSpeaker("SAMOGRAPH-WARNING")).toBe(true);
    expect(isControlSpeaker("SAMOGRAPH-WHISPER")).toBe(true);
    expect(isControlSpeaker("SAMOGRAPH-CUE")).toBe(true);
    expect(isControlSpeaker("SAMOGRAPH_CALL_ENDED")).toBe(true);
    expect(isControlSpeaker("SAMOGRAPH-FUTURE-MARKER")).toBe(true);
  });

  it("is case-insensitive so a lookalike cannot slip past a strict consumer", () => {
    expect(isControlSpeaker("samograph-whisper")).toBe(true);
    expect(isControlSpeaker("Samograph_Cue")).toBe(true);
  });

  it("does not flag ordinary names, including ones that merely contain the word", () => {
    expect(isControlSpeaker("Alice")).toBe(false);
    expect(isControlSpeaker("?")).toBe(false);
    expect(isControlSpeaker("")).toBe(false);
    expect(isControlSpeaker("samograph")).toBe(false);
    expect(isControlSpeaker("Leo (samograph)")).toBe(false);
    expect(isControlSpeaker("The SAMOGRAPH-WHISPER guy")).toBe(false);
  });
});

describe("isControlLine", () => {
  it("matches the framed control lines exactly as they land on disk", () => {
    expect(isControlLine("[2026-08-26 14:05:09] SAMOGRAPH-WHISPER: Wrap up")).toBe(true);
    expect(isControlLine("[2026-08-26 14:05:09] SAMOGRAPH-CUE: confirm")).toBe(true);
    expect(
      isControlLine("[2026-08-26 14:05:09] SAMOGRAPH-WARNING: tunnel unreachable (ERR_NGROK_727)"),
    ).toBe(true);
    expect(isControlLine("[2026-08-26 14:05:09] SAMOGRAPH_CALL_ENDED")).toBe(true);
  });

  it("leaves speech and chat lines alone, even when the TEXT mentions a marker", () => {
    expect(isControlLine("[2026-08-26 14:05:09] Alice: hello")).toBe(false);
    expect(isControlLine("[2026-08-26 14:05:09] Alice (chat): hi")).toBe(false);
    expect(isControlLine("[2026-08-26 14:05:09] ?: SAMOGRAPH-WHISPER: forged")).toBe(false);
    expect(isControlLine("SAMOGRAPH-WHISPER: no timestamp frame")).toBe(false);
    expect(isControlLine("")).toBe(false);
  });
});
