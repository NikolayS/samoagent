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
 * 1. **The role follows the tone.** `info`/`success` announce as `status`,
 *    `warning`/`danger` as `alert`. A caller can no longer ship a red box that
 *    politely waits for the screen reader to finish a sentence, or a "saved"
 *    confirmation that interrupts one.
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

/** Tone → the CSS variant name pinned by the contrast + token guards. */
const TONE_VARIANT: Record<AlertTone, string> = {
  info: "info",
  success: "success",
  warning: "warn",
  danger: "error",
};

/** Tone → ARIA role. Polite for the two good-news tones, assertive for the two bad-news ones. */
const TONE_ROLE: Record<AlertTone, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

export interface AlertProps {
  /** Defaults to `info` — the tone that neither interrupts nor alarms. */
  tone?: AlertTone;
  /** Optional bold line above the copy. */
  title?: ReactNode;
  /** Optional trailing control (a retry button, a "Reconnect" link). */
  action?: ReactNode;
  /**
   * Root element. `p` by default; `span` for the handful of alerts that sit
   * inside an inline row, where a `<p>` would be invalid nesting.
   */
  as?: "p" | "div" | "span";
  /** Appended AFTER the base classes — call sites layer page-specific rules on top. */
  className?: string;
  children?: ReactNode;
}

export function Alert({ tone = "info", title, action, as = "p", className, children }: AlertProps) {
  const Root = as;
  // Body-only alerts put their copy directly on the root: the suite (and any
  // screen reader) resolves `getByText(copy)` to the announced element itself
  // rather than to a wrapper that carries neither the role nor the tone.
  return (
    <Root
      role={TONE_ROLE[tone]}
      className={`samograph-alert samograph-alert--${TONE_VARIANT[tone]}${className ? ` ${className}` : ""}`}
    >
      {title == null ? null : <strong className="samograph-alert-title">{title}</strong>}
      {children}
      {action == null ? null : <span className="samograph-alert-action">{action}</span>}
    </Root>
  );
}
