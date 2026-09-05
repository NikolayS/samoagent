/**
 * The private agent-to-wearer output channel.
 *
 * Every other samograph output surface is visible to the meeting: `chat` posts
 * into meeting chat and plays a chime into the call audio, `presence` repaints
 * the bot camera everyone can see. A *whisper* is the first surface that is
 * not: it goes to the wearer alone, through a {@link WhisperSink} port.
 *
 * The port is the seam for a real head-up display (Even Realities G2 or any
 * other wearable) — none of that lives here. What lives here is the part that
 * must be right before any hardware exists: the delivery policy (priority,
 * preemption, depth, TTL) and a faithful enough fake screen that overflow is
 * *visible* rather than silent.
 */

export const WHISPER_PRIORITIES = ["low", "normal", "high"] as const;

export type WhisperPriority = typeof WHISPER_PRIORITIES[number];

/** Collapse whitespace and trim so text always occupies one physical line. */
export function sanitizeTranscriptField(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** One private message for the wearer. */
export interface Whisper {
  /** Whitespace-collapsed text — always exactly one physical line. */
  text: string;
  priority: WhisperPriority;
  /** ISO-8601 instant the whisper was created (from the caller's clock). */
  at: string;
  /** Auto-expire after this many ms from {@link Whisper.at}; null never expires. */
  ttlMs: number | null;
}

/**
 * The output port. A sink renders a whisper somewhere only the wearer sees:
 * stderr ({@link createConsoleSink}), a simulated screen
 * ({@link createFakeHudSink}), or — in a later change — a real device.
 */
/** Loose input to {@link makeWhisper}: priority and ttl default. */
export interface WhisperInput {
  text: string;
  priority?: WhisperPriority;
  ttlMs?: number | null;
}

export function normalizeWhisperPriority(value: unknown): WhisperPriority | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (WHISPER_PRIORITIES as readonly string[]).includes(normalized)
    ? (normalized as WhisperPriority)
    : null;
}

/**
 * Build a {@link Whisper}, stamping `at` from the caller's clock (epoch ms) —
 * this module never reads the clock itself, so every behavior below is
 * reproducible in a test. The text is collapsed with the same sanitizer the
 * transcript normalizer uses, so a whisper can never smuggle a line break into
 * the transcript and forge a second control line.
 */
export function makeWhisper(input: WhisperInput, atMs: number): Whisper {
  return {
    text: sanitizeTranscriptField(input.text),
    priority: input.priority ?? "normal",
    at: new Date(atMs).toISOString(),
    ttlMs: input.ttlMs ?? null,
  };
}

/** Default queue depth: a wearer cannot read a backlog deeper than this. */
export const DEFAULT_WHISPER_QUEUE_DEPTH = 8;

export interface WhisperQueueOptions {
  /**
   * Injected clock returning epoch ms. REQUIRED: the queue must never call
   * `Date.now()`, so TTL expiry is deterministic under test.
   */
  now: () => number;
  maxDepth?: number;
}

/**
 * How a push landed. `replace` means the whisper preempted the one currently
 * displayed (the head); `enqueue` means it went to the back of the queue — or
 * to the front of an empty queue, where there was nothing to preempt.
 */
export type WhisperPushMode = "enqueue" | "replace";

export interface WhisperPushResult {
  mode: WhisperPushMode;
  accepted: Whisper;
  /** Whispers removed because their TTL had elapsed, in queue order. */
  expired: Whisper[];
  /** Whispers removed by the max-depth policy, oldest first. */
  dropped: Whisper[];
}

function expiresAt(w: Whisper): number | null {
  if (w.ttlMs === null) return null;
  return Date.parse(w.at) + w.ttlMs;
}

/**
 * The whisper delivery policy, as a pure in-memory queue.
 *
 * - **Preemption.** A `high` whisper goes to the *front*: something urgent must
 *   not wait behind a backlog. Everything else appends.
 * - **Depth.** Over `maxDepth` the queue sheds the oldest `low` first, then the
 *   oldest `normal`. A `high` whisper is NEVER dropped — a queue saturated with
 *   `high` deliberately exceeds `maxDepth` rather than lose one.
 * - **TTL.** A whisper with a ttl is gone once `now >= at + ttlMs` (the ttl is
 *   the window it stays useful, so the boundary instant is already too late).
 *   Expiry is applied lazily on every read/write, never on a timer.
 */
export class WhisperQueue {
  private readonly nowMs: () => number;
  private readonly maxDepth: number;
  private items: Whisper[] = [];

  constructor(options: WhisperQueueOptions) {
    this.nowMs = options.now;
    this.maxDepth = options.maxDepth ?? DEFAULT_WHISPER_QUEUE_DEPTH;
  }

  /** Drop every whisper whose TTL has elapsed; returns them in queue order. */
  expire(): Whisper[] {
    const now = this.nowMs();
    const expired: Whisper[] = [];
    const kept: Whisper[] = [];
    for (const item of this.items) {
      const deadline = expiresAt(item);
      if (deadline !== null && now >= deadline) {
        expired.push(item);
      } else {
        kept.push(item);
      }
    }
    this.items = kept;
    return expired;
  }

  push(w: Whisper): WhisperPushResult {
    const expired = this.expire();
    const preempts = w.priority === "high" && this.items.length > 0;
    if (w.priority === "high") {
      this.items.unshift(w);
    } else {
      this.items.push(w);
    }
    return {
      mode: preempts ? "replace" : "enqueue",
      accepted: w,
      expired,
      dropped: this.enforceDepth(),
    };
  }

  /** Live queue contents, head first, with elapsed whispers already removed. */
  list(): Whisper[] {
    this.expire();
    return [...this.items];
  }

  /** The whisper that would be on screen right now, or null. */
  current(): Whisper | null {
    this.expire();
    return this.items[0] ?? null;
  }

  /** Remove and return the head — what a display loop calls each tick. */
  take(): Whisper | null {
    this.expire();
    return this.items.shift() ?? null;
  }

  size(): number {
    this.expire();
    return this.items.length;
  }

  /**
   * Shed whispers until the queue fits `maxDepth`, oldest `low` first, then
   * oldest `normal`. Stops early when only `high` whispers remain: they are
   * never dropped, so the queue is allowed to run over depth instead.
   */
  private enforceDepth(): Whisper[] {
    const dropped: Whisper[] = [];
    while (this.items.length > this.maxDepth) {
      const index =
        this.oldestIndexOf("low") ?? this.oldestIndexOf("normal") ?? null;
      if (index === null) break;
      dropped.push(...this.items.splice(index, 1));
    }
    return dropped;
  }

  /**
   * Index of the oldest whisper of `priority` by `at` (ties break toward the
   * earlier queue position). Age is read from `at`, not from queue position,
   * because a preempting `high` whisper moves to the front out of age order.
   */
  private oldestIndexOf(priority: WhisperPriority): number | null {
    let bestIndex: number | null = null;
    let bestAt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i]!;
      if (item.priority !== priority) continue;
      const at = Date.parse(item.at);
      if (at < bestAt) {
        bestAt = at;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}

/** Even Realities G2 display width, in pixels. */
export const G2_WIDTH_PX = 576;
/** Even Realities G2 display height, in pixels. */
export const G2_HEIGHT_PX = 288;
/** LVGL line height of the G2 text container, in pixels (288 / 27 => 10 lines). */
export const G2_LINE_HEIGHT_PX = 27;

/**
 * APPROXIMATE advance width of one glyph, in pixels.
 *
 * The G2 font is proportional, so no single number is correct: this is a
 * deliberate stand-in chosen to divide the 576 px screen into a round 48
 * columns at the 27 px line height. It exists so wrapping and overflow are
 * exercised end-to-end today, and it is the ONLY place the approximation
 * lives — pass {@link HudGeometry.measure} to replace it with real per-string
 * measurement (the on-device app will measure through `@evenrealities/pretext`).
 */
export const APPROX_GLYPH_WIDTH_PX = 12;

/** Measures the rendered width of a string, in pixels. */
export type MeasureFn = (text: string) => number;

/** Glyph count of a string: code points, never UTF-16 units (an emoji is one). */
function glyphCount(text: string): number {
  return Array.from(text).length;
}

/** The monospace stand-in for real font measurement: one glyph per code point. */
export const approxMeasure: MeasureFn = (text) => glyphCount(text) * APPROX_GLYPH_WIDTH_PX;

/** Upper bound on probed columns, so a pathological `measure` cannot spin. */
const HUD_MAX_COLUMNS = 512;

/** Appended to the last visible line when text did not fit — never silent. */
export const HUD_OVERFLOW_MARKER = "…";

export interface HudGeometry {
  widthPx?: number;
  heightPx?: number;
  lineHeightPx?: number;
  /** The measurement seam; defaults to {@link approxMeasure}. */
  measure?: MeasureFn;
}

interface ResolvedGeometry {
  widthPx: number;
  heightPx: number;
  lineHeightPx: number;
  measure: MeasureFn;
}

function resolveGeometry(geometry: HudGeometry): ResolvedGeometry {
  return {
    widthPx: geometry.widthPx ?? G2_WIDTH_PX,
    heightPx: geometry.heightPx ?? G2_HEIGHT_PX,
    lineHeightPx: geometry.lineHeightPx ?? G2_LINE_HEIGHT_PX,
    measure: geometry.measure ?? approxMeasure,
  };
}

/** How many whole lines the container fits: floor(heightPx / lineHeightPx). */
export function hudLineCapacity(geometry: HudGeometry = {}): number {
  const g = resolveGeometry(geometry);
  if (g.lineHeightPx <= 0) return 0;
  return Math.max(0, Math.floor(g.heightPx / g.lineHeightPx));
}

/**
 * How many plain glyphs fit on one line, probed through `measure`. Exact for
 * the monospace stand-in; for a proportional `measure` it is only the width of
 * the debug box drawn by {@link renderHudFrame} — wrapping itself always
 * measures the real candidate string, never a column count.
 */
export function hudColumns(geometry: HudGeometry = {}): number {
  const g = resolveGeometry(geometry);
  let cols = 0;
  while (cols < HUD_MAX_COLUMNS && g.measure("0".repeat(cols + 1)) <= g.widthPx) {
    cols += 1;
  }
  return cols;
}

/** Split a word too wide for one line into chunks that each fit. */
function hardBreak(word: string, g: ResolvedGeometry): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const ch of word) {
    if (chunk !== "" && g.measure(chunk + ch) > g.widthPx) {
      chunks.push(chunk);
      chunk = ch;
    } else {
      chunk += ch;
    }
  }
  if (chunk !== "") chunks.push(chunk);
  return chunks;
}

/**
 * Greedy word wrap against the display width, with no truncation — the caller
 * decides what does not fit. A word wider than the whole line is hard-broken
 * rather than allowed to overhang.
 */
export function wrapHudText(text: string, geometry: HudGeometry = {}): string[] {
  const g = resolveGeometry(geometry);
  const words = sanitizeTranscriptField(text).split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (g.measure(candidate) <= g.widthPx) {
      current = candidate;
      continue;
    }
    if (current !== "") {
      lines.push(current);
      current = "";
    }
    if (g.measure(word) <= g.widthPx) {
      current = word;
      continue;
    }
    const chunks = hardBreak(word, g);
    lines.push(...chunks.slice(0, -1));
    current = chunks[chunks.length - 1] ?? "";
  }
  if (current !== "") lines.push(current);
  return lines;
}

export interface HudFrame {
  /** The bounded box as text, rows joined by "\n" (no trailing newline). */
  frame: string;
  /** The visible text rows after wrapping and truncation, marker included. */
  lines: string[];
  /** Rows the container fits — {@link hudLineCapacity}. */
  maxLines: number;
  /** Columns the container fits — {@link hudColumns}. */
  maxCols: number;
  /** True when the text did not fit; also visible as the in-box marker. */
  overflow: boolean;
  /** Wrapped rows that did not fit. */
  hiddenLines: number;
}

/**
 * Trim `line` until it plus the overflow marker fits the display width. Trims
 * whole code points, matching {@link hardBreak}: slicing a UTF-16 unit off a
 * line that ends in an astral glyph (an emoji) would leave a lone surrogate.
 */
function withOverflowMarker(line: string, g: ResolvedGeometry): string {
  const head = Array.from(line);
  while (head.length > 0 && g.measure(head.join("") + HUD_OVERFLOW_MARKER) > g.widthPx) {
    head.pop();
  }
  return head.join("") + HUD_OVERFLOW_MARKER;
}

/** Right-pad `row` with spaces to `width` glyphs (code points, not UTF-16 units). */
function padRow(row: string, width: number): string {
  return row + " ".repeat(Math.max(0, width - glyphCount(row)));
}

/**
 * Render `text` onto a simulated fixed-size screen and return the frame.
 *
 * The box is padded to the container's full line capacity so the drawn frame is
 * the *screen*, not just the text — a human running the fake sink sees exactly
 * how much room is left. When the text does not fit, the last visible row ends
 * in {@link HUD_OVERFLOW_MARKER} and `overflow`/`hiddenLines` say so: this
 * surface must never drop words quietly.
 */
export function renderHudFrame(text: string, geometry: HudGeometry = {}): HudFrame {
  const g = resolveGeometry(geometry);
  const maxLines = hudLineCapacity(geometry);
  const maxCols = hudColumns(geometry);
  const wrapped = wrapHudText(text, geometry);

  const overflow = wrapped.length > maxLines;
  const lines = wrapped.slice(0, maxLines);
  if (overflow && lines.length > 0) {
    lines[lines.length - 1] = withOverflowMarker(lines[lines.length - 1]!, g);
  }

  const inner = Math.max(maxCols, ...lines.map(glyphCount), 0);
  const rows = [...lines];
  while (rows.length < maxLines) rows.push("");
  const border = "─".repeat(inner);
  const frame = [
    `┌${border}┐`,
    ...rows.map((row) => `│${padRow(row, inner)}│`),
    `└${border}┘`,
  ].join("\n");

  return {
    frame,
    lines,
    maxLines,
    maxCols,
    overflow,
    hiddenLines: wrapped.length - lines.length,
  };
}

/** The control-line marker a delivered whisper leaves in the transcript. */
export const WHISPER_LINE_MARKER = "SAMOGRAPH-WHISPER:";

/** The control-line marker a wearer's back-channel cue leaves in the transcript. */
export const CUE_LINE_MARKER = "SAMOGRAPH-CUE:";

/**
 * The wearer's back-channel vocabulary. These are SEMANTIC, never physical: no
 * `tap` or `double-tap` appears anywhere above the driver, so replacing the
 * input device (glasses touchpad, a ring, a keyboard) changes a driver and
 * nothing else.
 */
export const CUE_SEMANTICS = ["confirm", "dismiss", "next", "more"] as const;

export type CueSemantic = typeof CUE_SEMANTICS[number];

export function normalizeCueSemantic(value: unknown): CueSemantic | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (CUE_SEMANTICS as readonly string[]).includes(normalized)
    ? (normalized as CueSemantic)
    : null;
}

/**
 * The exact transcript control line for a delivered whisper. It rides the
 * existing transcript stream on purpose: an agent already running
 * `samograph watch` sees whispers with no new contract to implement. The
 * timestamp is the shared local-time formatter, so every control line
 * (watchdog warning, whisper, cue, sentinel) has one shape.
 */
