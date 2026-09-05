import type { ReactNode } from "react";

/**
 * Alert / Banner — `docs/design/DESIGN-MODEL.md` §4 "Alert / Banner",
 * `docs/design/PLAN.md` desktop PR 8.
 *
 * The single feedback primitive for the app. Every ad-hoc `<p role="alert"
 * className="samograph-alert samograph-alert--error">` in `components/` now
 * goes through here, which buys three things the hand-written boxes kept
 * getting wrong:
 *
 * 1. **The role follows the tone by default.** `info`/`success` announce as
 *    `status`, `warning`/`danger` as `alert`. A caller can no longer ship a red
 *    box that politely waits for the screen reader to finish a sentence, or a
 *    "saved" confirmation that interrupts one. The default is the *transient*
 *    case; a STANDING condition overrides it with `live` (see below).
 * 2. **The tone lives in the rail, not the copy.** The component only picks the
 *    variant class; `globals.css` draws a 3px inline-start rail in the tone
 *    colour and keeps the copy at `--ink` (DESIGN-MODEL §4 — coloured body text
 *    is the reason `test/alert-contrast.test.ts` exists).
 * 3. **One vocabulary.** Tone names are the design system's
 *    (`info | success | warning | danger`); the CSS variants keep their existing
 *    names (`info | success | warn | error`) because `alert-contrast.test.ts`
 *    and `greenroom-tokens.test.ts` pin those four literally. The map below is
 *    the only place the two vocabularies meet.
 *
 * Icon-less by default: the rail plus the copy carries the tone, and a glyph in
 * a leading column costs a column of width on the 390px viewport for no added
 * meaning. `title` and `action` are opt-in.
 */
export type AlertTone = "info" | "success" | "warning" | "danger";

/**
 * How loudly the alert announces itself, independent of how it looks.
 *
 * A tone says what KIND of news this is; a live region says WHEN to interrupt.
 * They coincide for transient events, and come apart for standing ones: the
 * "Google Calendar needs to be reconnected" notice is a genuine warning and
 * wants the warning rail, but it is re-rendered on every dashboard load and
 * would fire an assertive interruption every single time. Standing conditions
 * take `live="off"` (ordinary page copy) or `"polite"`; transient failures keep
 * the tone's assertive default.
 */
export type AlertLive = "polite" | "assertive" | "off";

/** Tone → the CSS variant name pinned by the contrast + token guards. */
const TONE_VARIANT: Record<AlertTone, string> = {
  info: "info",
  success: "success",
  warning: "warn",
  danger: "error",
};

/**
 * Tone → the DEFAULT live region. Polite for the two good-news tones, assertive
 * for the two bad-news ones — the right default for the transient case, which is
 * most of them: something just happened, and the reader should hear about it.
 */
const TONE_LIVE: Record<AlertTone, AlertLive> = {
  info: "polite",
  success: "polite",
  warning: "assertive",
  danger: "assertive",
};

/** Live region → ARIA role. `off` renders no role at all: ordinary page copy. */
const LIVE_ROLE = { polite: "status", assertive: "alert", off: undefined } as const;

export interface AlertProps {
  /** Defaults to `info` — the tone that neither interrupts nor alarms. */
  tone?: AlertTone;
  /** Optional bold line above the copy. Blank strings render nothing. */
  title?: ReactNode;
  /** Optional trailing control (a retry button, a "Reconnect" link). */
  action?: ReactNode;
  /** Overrides the tone's default live region. */
  live?: AlertLive;
  /**
   * Root element. `p` by default; `span` for the handful of alerts that sit
   * inside an inline row, where a `<p>` would be invalid nesting.
   */
  as?: "p" | "div" | "span";
  /**
   * Extra classes for call-site GEOMETRY (margins, panel placement) only.
   * Class order in the attribute does not affect the cascade — a call-site rule
   * ties with `.samograph-alert` at (0,1,0) and wins on source order — so a
   * class here that sets `color`/`background`/`border*` silently erases the
   * tone rail. `test/alert-rail.test.ts` fails the build if one does.
   */
  className?: string;
  children?: ReactNode;
}

export function Alert({ tone = "info", live, title, action, as = "p", className, children }: AlertProps) {
  const Root = as;
  // A blank title would otherwise render an empty `<strong>`: a styled box with
  // no text, and an extra line of vertical space for nothing.
  const hasTitle = typeof title === "string" ? title.trim() !== "" : title != null;
  // Body-only alerts put their copy directly on the root: the suite (and any
  // screen reader) resolves `getByText(copy)` to the announced element itself
  // rather than to a wrapper that carries neither the role nor the tone.
  return (
    <Root
      role={LIVE_ROLE[live ?? TONE_LIVE[tone]]}
      className={`samograph-alert samograph-alert--${TONE_VARIANT[tone]}${className ? ` ${className}` : ""}`}
    >
      {hasTitle ? <strong className="samograph-alert-title">{title}</strong> : null}
      {children}
      {action == null ? null : <span className="samograph-alert-action">{action}</span>}
    </Root>
  );
}
