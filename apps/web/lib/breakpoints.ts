/**
 * The canonical responsive breakpoints (DESIGN-MODEL.md §5 "Layout + responsive
 * model", PLAN.md M9).
 *
 * CSS custom properties cannot be used inside a `@media` prelude — `@media
 * (max-width: var(--bp-md))` is invalid and the whole block is dropped. So the
 * numbers below are the source of truth for JS/tests, and `globals.css` repeats
 * them literally under the guard in `test/breakpoints.test.ts`, which fails if
 * any `@media` width feature in the stylesheet uses a value that is not one of
 * `min()`/`max()` below.
 *
 * ONE unit convention: **pixels**, mobile-first `min-width` where a rule adds
 * capability, `max-width` with the `.02px` shim where a rule takes it away.
 * `rem` breakpoints were dropped in M9: a user zooming text moves a `rem`
 * breakpoint but not the device width the layout was measured against, and the
 * stylesheet already stated the same boundary three ways (`48rem`, `767.98px`,
 * `40rem`).
 *
 * The `.02px` shim (not `.5px`, not `1px`) is the industry convention for the
 * smallest gap that no viewport can land in while still leaving `max` strictly
 * below `min`: a fractional viewport width of 767.99px matches neither
 * `max-width: 767.98px` nor `min-width: 768px` only in browsers that report
 * sub-pixel widths finer than 0.02px, which none do. `straddles()` proves the
 * pair never overlaps.
 */
export const BREAKPOINTS = {
  /** 480px — two-up action rows, meta inline, 16px form fields (iOS zoom fix). */
  sm: 480,
  /** 768px — list rows go 3-column, forms side-by-side, nav un-collapses. */
  md: 768,
  /** 1024px — nav spreads, transcript takes its 4-column form. */
  lg: 1024,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

/** The sub-pixel shim between a `max-width` block and the `min-width` above it. */
export const BREAKPOINT_EPSILON = 0.02;

export const BREAKPOINT_NAMES = Object.keys(BREAKPOINTS) as BreakpointName[];

/** `(min-width: 768px)` — the mobile-first form: at and above the breakpoint. */
export function up(name: BreakpointName): string {
  return `(min-width: ${BREAKPOINTS[name]}px)`;
}

/** `(max-width: 767.98px)` — strictly below the breakpoint. */
export function below(name: BreakpointName): string {
  return `(max-width: ${BREAKPOINTS[name] - BREAKPOINT_EPSILON}px)`;
}

/** Every width value a `@media` prelude in `globals.css` may contain. */
export const ALLOWED_MEDIA_WIDTHS: readonly string[] = BREAKPOINT_NAMES.flatMap(
  (name) => [`${BREAKPOINTS[name]}px`, `${BREAKPOINTS[name] - BREAKPOINT_EPSILON}px`],
);

/** True when a `max` block and the `min` block above it can both match, or leave a hole. */
export function straddles(name: BreakpointName): boolean {
  const maxValue = BREAKPOINTS[name] - BREAKPOINT_EPSILON;
  return maxValue >= BREAKPOINTS[name] || maxValue < BREAKPOINTS[name] - 0.5;
}
