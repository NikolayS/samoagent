import { describe, expect, it } from "bun:test";
import {
  ALLOWED_MEDIA_WIDTHS,
  BREAKPOINTS,
  BREAKPOINT_NAMES,
  below,
  straddles,
  up,
} from "../lib/breakpoints";
import { readGlobalsCss } from "./helpers/stylesheet";

/**
 * ONE set of breakpoints, in ONE unit (PLAN.md M9, DESIGN-MODEL §5).
 *
 * Before M9 the stylesheet stated the same three boundaries seven ways:
 * `40rem` (640px), `48rem` (768px, *inclusive* — it overlapped
 * `min-width: 768px` at exactly 768px), `59.99rem` (959.84px), `63.99rem`
 * (1023.84px), `767.98px` and `768px`. `@media` cannot read a custom property,
 * so the numbers cannot be tokenised in CSS; instead `lib/breakpoints.ts` is
 * the source of truth and this guard fails if the stylesheet uses any width
 * value that is not one of its six canonical strings. (The sheet is read
 * through `test/helpers/stylesheet.ts`, which resolves the `@import`s in
 * `app/globals.css` — PLAN.md PR 14.)
 *
 * Non-width features (`pointer`, `prefers-color-scheme`,
 * `prefers-reduced-motion`) are unconstrained — they are not breakpoints.
 */
const raw = readGlobalsCss();
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `@media` prelude in the stylesheet, comments stripped. */
const preludes = [...css.matchAll(/@media([^{]*)\{/g)].map(([, prelude]) =>
  prelude.replace(/\s+/g, " ").trim(),
);

/** `{ feature, value, prelude }` for every width feature in every prelude. */
const widthFeatures = preludes.flatMap((prelude) =>
  [...prelude.matchAll(/\((min-width|max-width)\s*:\s*([^)]+)\)/g)].map(([, feature, value]) => ({
    feature,
    value: value.trim(),
    prelude,
  })),
);

describe("lib/breakpoints is the source of truth", () => {
  it("names exactly sm/md/lg at 480/768/1024", () => {
    expect(BREAKPOINTS).toEqual({ sm: 480, md: 768, lg: 1024 });
  });

  it("builds the two canonical query forms", () => {
    expect(up("md")).toBe("(min-width: 768px)");
    expect(below("md")).toBe("(max-width: 767.98px)");
    expect(below("sm")).toBe("(max-width: 479.98px)");
    expect(below("lg")).toBe("(max-width: 1023.98px)");
  });

  it("leaves no sub-pixel gap and no overlap between a max block and the min above it", () => {
    for (const name of BREAKPOINT_NAMES) expect(straddles(name)).toBe(false);
  });
});

describe("globals.css uses only the canonical breakpoints", () => {
  it("has width features at all (the extractor is not silently empty)", () => {
    expect(widthFeatures.length).toBeGreaterThan(10);
  });

  it("uses no rem/em width breakpoint — px is the one unit", () => {
    const nonPx = widthFeatures.filter(({ value }) => !value.endsWith("px"));
    expect(nonPx.map(({ prelude }) => prelude)).toEqual([]);
  });

  it("uses only 480/768/1024 and their .98 max-width shims", () => {
    const offScale = widthFeatures.filter(
      ({ value }) => !ALLOWED_MEDIA_WIDTHS.includes(value),
    );
    expect(offScale.map(({ feature, value }) => `${feature}: ${value}`)).toEqual([]);
  });

  it("pairs the unit convention with the direction: min-width is exact, max-width is shimmed", () => {
    const wrongDirection = widthFeatures.filter(({ feature, value }) =>
      feature === "min-width" ? value.includes(".98") : !value.includes(".98"),
    );
    expect(wrongDirection.map(({ feature, value }) => `${feature}: ${value}`)).toEqual([]);
  });
});

describe("the gutter is fluid, not stepped", () => {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("defines --gutter as a clamp between the mobile and desktop values", () => {
    const gutter = root.match(/--gutter\s*:\s*([^;]+);/)?.[1]?.replace(/\s+/g, " ").trim();
    expect(gutter).toBe("clamp(var(--space-4), 5vw, var(--space-8))");
  });

  it("no longer re-declares --gutter inside a @media block", () => {
    const inMedia = [...css.matchAll(/@media[^{]*\{[\s\S]*?\n\}/g)].filter((match) =>
      /:root\s*\{[^}]*--gutter\s*:/.test(match[0]),
    );
    expect(inMedia).toHaveLength(0);
  });

  it("still reads the gutter through max() against the safe-area insets", () => {
    expect(css).toMatch(/padding-inline\s*:\s*max\(var\(--gutter\), var\(--safe-left\)\)/);
  });
});
