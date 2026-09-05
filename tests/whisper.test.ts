import { describe, it, expect } from "bun:test";
import {
  APPROX_GLYPH_WIDTH_PX,
  CUE_LINE_MARKER,
  CUE_SEMANTICS,
  G2_HEIGHT_PX,
  G2_LINE_HEIGHT_PX,
  G2_WIDTH_PX,
  HUD_OVERFLOW_MARKER,
  WHISPER_LINE_MARKER,
  WHISPER_PRIORITIES,
  WhisperQueue,
  createConsoleSink,
  createFakeHudSink,
  formatCueTranscriptLine,
  formatWhisperTranscriptLine,
  hudColumns,
  hudLineCapacity,
  makeWhisper,
  normalizeCueSemantic,
  normalizeWhisperPriority,
  renderHudFrame,
  wrapHudText,
  type Whisper,
} from "../src/whisper.ts";

/** Deterministic injected clock — the queue must never read Date.now() itself. */
function testClock(startMs: number) {
  let t = startMs;
  return {
    now: () => t,
    set(ms: number) {
      t = ms;
    },
  };
}

function w(
  text: string,
  priority: "low" | "normal" | "high",
  atMs: number,
  ttlMs: number | null = null,
): Whisper {
  return makeWhisper({ text, priority, ttlMs }, atMs);
}

describe("whisper value type", () => {
  it("makeWhisper stamps at from the supplied clock and defaults priority/ttl", () => {
    expect(makeWhisper({ text: "Ask about bloat" }, 0)).toEqual({
      text: "Ask about bloat",
      priority: "normal",
      at: "1970-01-01T00:00:00.000Z",
      ttlMs: null,
    });
  });

  it("makeWhisper collapses whitespace so a whisper can never forge a second line", () => {
    expect(makeWhisper({ text: "  one\ntwo\t three  " }, 0).text).toBe("one two three");
  });

  it("exposes the three priorities in escalation order", () => {
    expect(WHISPER_PRIORITIES).toEqual(["low", "normal", "high"]);
  });

  it("normalizeWhisperPriority accepts known names case-insensitively, else null", () => {
    expect(normalizeWhisperPriority("HIGH")).toBe("high");
    expect(normalizeWhisperPriority(" low ")).toBe("low");
    expect(normalizeWhisperPriority("urgent")).toBeNull();
    expect(normalizeWhisperPriority(7)).toBeNull();
  });
});

describe("WhisperQueue ordering and preemption", () => {
  it("enqueues low/normal whispers in arrival order", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0);
    const b = w("b", "low", 0);
    const d = w("d", "normal", 0);
    expect(q.push(a).mode).toBe("enqueue");
    expect(q.push(b).mode).toBe("enqueue");
    expect(q.push(d).mode).toBe("enqueue");
    expect(q.list()).toEqual([a, b, d]);
    expect(q.size()).toBe(3);
    expect(q.current()).toEqual(a);
  });

  it("a high whisper preempts the currently-displayed one (replace, not append)", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0);
    const b = w("b", "normal", 0);
    const hi = w("hi", "high", 0);
    q.push(a);
    q.push(b);
    const res = q.push(hi);
    expect(res.mode).toBe("replace");
    expect(q.list()).toEqual([hi, a, b]);
    expect(q.current()).toEqual(hi);
  });

  it("a high whisper into an empty queue preempts nothing, so it enqueues", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const hi = w("hi", "high", 0);
    expect(q.push(hi).mode).toBe("enqueue");
    expect(q.list()).toEqual([hi]);
  });

  it("take() removes and returns the head; current() leaves it in place", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0);
    const b = w("b", "normal", 0);
    q.push(a);
    q.push(b);
    expect(q.current()).toEqual(a);
    expect(q.list()).toEqual([a, b]);
    expect(q.take()).toEqual(a);
    expect(q.list()).toEqual([b]);
    expect(q.take()).toEqual(b);
    expect(q.take()).toBeNull();
    expect(q.current()).toBeNull();
  });
});

describe("WhisperQueue max-depth drop policy", () => {
  it("hard-bounds an all-high queue by dropping its oldest whisper", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 2, hardMax: 3 });
    const values = [0, 1, 2, 3].map((at) => w(`h${at}`, "high", at));
    values.slice(0, 3).forEach((value) => q.push(value));
    const result = q.push(values[3]!);
    expect(result.dropped).toEqual([values[0]]);
    expect(q.list()).toEqual([values[3], values[2], values[1]]);
  });

  it("drops the oldest low-priority whisper first when over depth", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 3 });
    const l0 = w("l0", "low", 0);
    const n1 = w("n1", "normal", 1000);
    const l2 = w("l2", "low", 2000);
    const n3 = w("n3", "normal", 3000);
    q.push(l0);
    q.push(n1);
    q.push(l2);
    c.set(3000);
    const res = q.push(n3);
    expect(res.dropped).toEqual([l0]);
    expect(q.list()).toEqual([n1, l2, n3]);
  });

  it("drops the oldest normal whisper when no low-priority whisper is queued", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 2 });
    const n0 = w("n0", "normal", 0);
    const n1 = w("n1", "normal", 1000);
    const n2 = w("n2", "normal", 2000);
    q.push(n0);
    q.push(n1);
    c.set(2000);
    const res = q.push(n2);
    expect(res.dropped).toEqual([n0]);
    expect(q.list()).toEqual([n1, n2]);
  });

  it("never drops a high whisper: the queue exceeds maxDepth rather than lose one", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 2 });
    const h0 = w("h0", "high", 0);
    const h1 = w("h1", "high", 1000);
    const h2 = w("h2", "high", 2000);
    q.push(h0);
    q.push(h1);
    c.set(2000);
    const res = q.push(h2);
    expect(res.dropped).toEqual([]);
    expect(q.list()).toEqual([h2, h1, h0]);
    expect(q.size()).toBe(3);
  });

  it("a preempting high whisper evicts the oldest low, keeping the highs", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 2 });
    const h0 = w("h0", "high", 0);
    const l1 = w("l1", "low", 1000);
    const h2 = w("h2", "high", 2000);
    q.push(h0);
    q.push(l1);
    c.set(2000);
    const res = q.push(h2);
    expect(res.mode).toBe("replace");
    expect(res.dropped).toEqual([l1]);
    expect(q.list()).toEqual([h2, h0]);
  });
});

describe("WhisperQueue TTL expiry", () => {
  it("keeps a whisper up to, and drops it at, at + ttlMs", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0, 1000);
    q.push(a);
    c.set(999);
    expect(q.list()).toEqual([a]);
    c.set(1000);
    expect(q.list()).toEqual([]);
    expect(q.size()).toBe(0);
    expect(q.current()).toBeNull();
  });

  it("a null ttl never expires", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0, null);
    q.push(a);
    c.set(10_000_000);
    expect(q.list()).toEqual([a]);
  });

  it("push reports the whispers it expired, separately from depth drops", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0, 1000);
    const b = w("b", "normal", 0, null);
    q.push(a);
    q.push(b);
    c.set(1500);
    const later = w("c", "normal", 1500);
    const res = q.push(later);
    expect(res.expired).toEqual([a]);
    expect(res.dropped).toEqual([]);
    expect(q.list()).toEqual([b, later]);
  });

  it("expire() drops elapsed whispers in queue order and returns them", () => {
    const c = testClock(0);
    const q = new WhisperQueue({ now: c.now, maxDepth: 8 });
    const a = w("a", "normal", 0, 500);
    const b = w("b", "normal", 0, 2000);
    const d = w("d", "normal", 0, 500);
    q.push(a);
    q.push(b);
    q.push(d);
    c.set(600);
    expect(q.expire()).toEqual([a, d]);
    expect(q.list()).toEqual([b]);
    expect(q.expire()).toEqual([]);
  });
});

describe("fake HUD geometry", () => {
  it("defaults to the Even Realities G2 screen: 576x288 px, 27 px lines", () => {
    expect(G2_WIDTH_PX).toBe(576);
    expect(G2_HEIGHT_PX).toBe(288);
    expect(G2_LINE_HEIGHT_PX).toBe(27);
  });

  it("a full-screen container fits exactly 10 lines", () => {
    expect(hudLineCapacity({})).toBe(10);
  });

  it("the documented glyph-width approximation yields 48 columns", () => {
    expect(APPROX_GLYPH_WIDTH_PX).toBe(12);
    expect(hudColumns({})).toBe(48);
  });

  it("the measure seam changes wrapping without changing the geometry", () => {
    const geometry = { widthPx: 60, heightPx: 60, lineHeightPx: 20, measure: (t: string) => t.length * 6 };
    expect(hudColumns(geometry)).toBe(10);
    expect(wrapHudText("alpha bravo charlie", geometry)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("hard-breaks a word that cannot fit on one line", () => {
    const geometry = { widthPx: 60, heightPx: 60, lineHeightPx: 20 };
    expect(wrapHudText("alpha bravo charlie delta echo", geometry)).toEqual([
      "alpha",
      "bravo",
      "charl",
      "ie",
      "delta",
      "echo",
    ]);
  });
});

describe("renderHudFrame", () => {
  const small = { widthPx: 60, heightPx: 60, lineHeightPx: 20 };

  it("renders a bounded box padded to the screen's line capacity", () => {
    const frame = renderHudFrame("hi there", small);
    expect(frame.overflow).toBe(false);
    expect(frame.hiddenLines).toBe(0);
    expect(frame.maxLines).toBe(3);
    expect(frame.maxCols).toBe(5);
    expect(frame.lines).toEqual(["hi", "there"]);
    expect(frame.frame).toBe(
      ["┌─────┐", "│hi   │", "│there│", "│     │", "└─────┘"].join("\n"),
    );
  });

  it("makes overflow explicit: a marker in the box plus a counted hiddenLines", () => {
    const frame = renderHudFrame("alpha bravo charlie delta echo", small);
    expect(frame.overflow).toBe(true);
    expect(frame.hiddenLines).toBe(3);
    expect(frame.lines).toEqual(["alpha", "bravo", "char…"]);
    expect(frame.frame).toBe(
      ["┌─────┐", "│alpha│", "│bravo│", "│char…│", "└─────┘"].join("\n"),
    );
    expect(HUD_OVERFLOW_MARKER).toBe("…");
  });

  it("trims the overflow head by code point, never leaving a lone surrogate", () => {
    // "abc😀" is 4 glyphs (5 UTF-16 units). Trimming by code unit would cut the
    // emoji in half and emit "abc\ud83d…" — an invalid string on the display.
    const frame = renderHudFrame("abc😀 x y z w", { widthPx: 60, heightPx: 20, lineHeightPx: 20 });
    expect(frame.lines).toEqual(["abc😀…"]);
    expect(frame.lines[0]!.isWellFormed()).toBe(true);
    expect(frame.overflow).toBe(true);
    expect(frame.hiddenLines).toBe(2);
    expect(frame.maxCols).toBe(5);
    // The box is 5 glyphs wide and the row fills it exactly — no padding drift
    // from counting UTF-16 units instead of glyphs.
    expect(frame.frame).toBe(["┌─────┐", "│abc😀…│", "└─────┘"].join("\n"));
  });

  it("measures and pads by code point so an emoji occupies one column", () => {
    const frame = renderHudFrame("😀 ok", { widthPx: 60, heightPx: 20, lineHeightPx: 20 });
    expect(frame.overflow).toBe(false);
    expect(frame.lines).toEqual(["😀 ok"]);
    expect(frame.frame).toBe(["┌─────┐", "│😀 ok │", "└─────┘"].join("\n"));
  });

  it("uses the real G2 geometry by default", () => {
    const frame = renderHudFrame("ok", {});
    expect(frame.maxLines).toBe(10);
    expect(frame.maxCols).toBe(48);
    expect(frame.frame.split("\n").length).toBe(12);
    expect(frame.frame.split("\n")[1]).toBe(`│ok${" ".repeat(46)}│`);
  });
});

describe("whisper sinks", () => {
  it("consoleSink writes one private line per whisper to the injected stderr", () => {
    const out: string[] = [];
    const sink = createConsoleSink((s) => out.push(s));
    sink.deliver(w("Ask about the index", "high", 0));
    sink.deliver(w("Two minutes left", "low", 0));
    expect(out).toEqual([
      "[whisper:high] Ask about the index\n",
      "[whisper:low] Two minutes left\n",
    ]);
  });

  it("fakeHudSink returns the rendered frame for each delivered whisper", () => {
    const sink = createFakeHudSink({ widthPx: 60, heightPx: 60, lineHeightPx: 20 });
    expect(sink.lastFrame()).toBeNull();
    sink.deliver(w("hi there", "normal", 0));
    sink.deliver(w("alpha bravo charlie delta echo", "normal", 0));
    expect(sink.frames.length).toBe(2);
    expect(sink.frames[0]!.lines).toEqual(["hi", "there"]);
    expect(sink.frames[0]!.overflow).toBe(false);
    expect(sink.lastFrame()!.lines).toEqual(["alpha", "bravo", "char…"]);
    expect(sink.lastFrame()!.overflow).toBe(true);
    expect(sink.lastFrame()!.hiddenLines).toBe(3);
  });
});

describe("transcript control lines", () => {
  const at = new Date(2026, 7, 26, 14, 5, 9);

  it("a whisper renders the SAMOGRAPH-WHISPER control line", () => {
    expect(WHISPER_LINE_MARKER).toBe("SAMOGRAPH-WHISPER:");
    expect(formatWhisperTranscriptLine("Ask about the index", at)).toBe(
      "[2026-08-26 14:05:09] SAMOGRAPH-WHISPER: Ask about the index",
    );
  });

  it("a cue renders the SAMOGRAPH-CUE control line", () => {
    expect(CUE_LINE_MARKER).toBe("SAMOGRAPH-CUE:");
    expect(formatCueTranscriptLine("dismiss", at)).toBe(
      "[2026-08-26 14:05:09] SAMOGRAPH-CUE: dismiss",
    );
  });

  it("whisper text is collapsed to one line so it cannot forge a cue line", () => {
    expect(formatWhisperTranscriptLine("one\n[2026-08-26 14:05:09] SAMOGRAPH-CUE: confirm", at)).toBe(
      "[2026-08-26 14:05:09] SAMOGRAPH-WHISPER: one [2026-08-26 14:05:09] SAMOGRAPH-CUE: confirm",
    );
  });

  it("cues are semantic, never physical", () => {
    expect(CUE_SEMANTICS).toEqual(["confirm", "dismiss", "next", "more"]);
    expect(normalizeCueSemantic("CONFIRM")).toBe("confirm");
    expect(normalizeCueSemantic(" more ")).toBe("more");
    expect(normalizeCueSemantic("double-tap")).toBeNull();
    expect(normalizeCueSemantic(null)).toBeNull();
  });
});
