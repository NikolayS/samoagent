import type { ReactNode } from "react";

export type PageSkeletonVariant = "form" | "page" | "row" | "panel";

/** One bar. `kind` picks the height class; the CSS owns every number. */
type Bar =
  | "title"
  | "head"
  | "label"
  | "control"
  | "area"
  | "row"
  | "hero"
  | "block"
  | "para"
  | "savebar"
  | "text";

export interface PageSkeletonProps {
  variant?: PageSkeletonVariant;
  /**
   * How many call rows the `row` variant draws. Three fills a first screen
   * without pretending to know how many calls the user has. Ignored by the
   * other variants, whose shape is fixed by the page they stand in for.
   */
  count?: number;
}

function bar(kind: Bar, key?: string | number) {
  return (
    <span
      key={key}
      aria-hidden="true"
      className={kind === "text" ? "samograph-skeleton-bar" : `samograph-skeleton-bar samograph-skeleton-bar--${kind}`}
    />
  );
}

function field(kinds: readonly Bar[], key: number) {
  return (
    <div key={key} className="samograph-skeleton-field">
      {kinds.map((k, i) => bar(k, i))}
    </div>
  );
}

function group(children: ReactNode, key: number) {
  return (
    <div key={key} className="samograph-skeleton-group">
      {children}
    </div>
  );
}

/**
 * The loading state for a whole route (DESIGN-MODEL §4 "Skeleton", §1.4
 * "Loading is a skeleton of the thing that is coming").
 *
 * `form` and `page` are three anonymous lines — right for a card or a
 * paragraph. `panel` and `row` are deliberately PAGE-SHAPED: a placeholder can
 * only avoid a layout jump if it has the shape and the height of what is
 * arriving, and /settings (sections of fields, a savebar) and /dashboard (a
 * hero form, an upcoming block, call rows, a danger zone) do not have the same
 * shape as each other. Every number is a `--skeleton-*` token or the page's own
 * spacing token, so the two sides move together.
 *
 * Accessibility: the wrapper is the single `role="status"` + `aria-busy` region
 * with a visually-hidden "Loading…"; every bar is `aria-hidden`, so a screen
 * reader hears one announcement instead of counting grey boxes.
 */
export function PageSkeleton({ variant = "page", count = 3 }: PageSkeletonProps) {
  const rows = Math.max(1, count);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={`samograph-skeleton samograph-skeleton--${variant}`}
    >
      <span className="samograph-visually-hidden">Loading…</span>
      {variant === "panel" ? (
        <>
          {bar("title")}
          {/* Transcription: preset + hint, keyterms textarea, language. */}
          {group(
            <>
              {bar("head")}
              {field(["label", "control", "text"], 0)}
              {field(["label", "area"], 1)}
              {field(["label", "control"], 2)}
            </>,
            0,
          )}
          {/* In-call: the chat chime. */}
          {group(
            <>
              {bar("head")}
              {field(["label", "control"], 0)}
            </>,
            1,
          )}
          {/* Account: the read-only sign-in block. */}
          {group(
            <>
              {bar("head")}
              {bar("text", "a")}
              {bar("text", "b")}
              {bar("text", "c")}
              {bar("text", "d")}
            </>,
            2,
          )}
          {bar("savebar")}
        </>
      ) : variant === "row" ? (
        <>
          {bar("title")}
          {/* The add-to-call hero, then the upcoming-meetings block (which
              brings its own heading). */}
          {bar("hero")}
          {bar("block")}
          {/* Active calls, then Past calls — the two labelled lists the
              dashboard splits its calls into. */}
          {bar("head")}
          {bar("row", "active")}
          {bar("head")}
          {Array.from({ length: Math.max(1, rows - 1) }, (_, i) => bar("row", i))}
          {/* The danger zone: heading, explanation, a confirm field and the
              lone destructive action. */}
          {bar("head")}
          {bar("para")}
          {field(["label", "control"], 9)}
          {bar("control")}
        </>
      ) : (
        <>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </>
      )}
    </div>
  );
}
