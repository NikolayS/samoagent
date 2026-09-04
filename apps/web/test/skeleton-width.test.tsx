import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { PageSkeleton } from "../components/PageSkeleton.tsx";
import { installDom } from "./setup.tsx";
import { readGlobalsCss } from "./helpers/stylesheet";

installDom();

/**
 * Design PR 10, review finding (BLOCKING, PR #303).
 *
 * The legacy width rules
 * `.samograph-skeleton > span[aria-hidden="true"]:nth-of-type(3|4)` are
 * **(0,3,1)** — two classes plus the attribute selector plus `:nth-of-type`,
 * AND the `span` type selector — not the (0,3,0) the first review of this code
 * assumed. They therefore beat the shaped variants' three-class modifiers
 * (0,3,0), and in the `row` skeleton they landed on the wrong elements: span #3
 * is the upcoming-meetings block and span #4 the first section heading, so a
 * full-width 245px slab rendered at 70% and a 30% heading bar at 85%.
 *
 * `bar.className` says nothing about that — a `toContain("--block")` assertion
 * passes on the broken markup — and jsdom/happy-dom's `getComputedStyle` does
 * not run the author cascade, so neither catches it. Two layers here:
 *
 *  1. `MEASURED` — widths rendered by real Chrome against the real stylesheet,
 *     in the harness that produced the PR's screenshots. These are the numbers
 *     the reviewer saw in `skeleton-390-light.png`.
 *  2. a resolver that replays the cascade over every `width` declaration that
 *     can match a skeleton bar — specificity, then source order — and checks
 *     the winner for each bar of the rendered component. It runs in CI, where
 *     Chrome does not, and it fails for the same reason the pixels did.
 */
const css = readGlobalsCss().replace(/\/\*[\s\S]*?\*\//g, "");

/** The /dashboard content column at a 1024px viewport (`--width-app` minus the gutters). */
const COLUMN = 960;

/**
 * Rendered widths of the `row` skeleton's bars, measured in headless Chrome at
 * 1024 (scratchpad/ui-audit/pr9-10 — `run.sh`, `DIAG=skel`). `before` is the
 * state the reviewer found; `after` is what this test's resolver now enforces.
 */
const MEASURED = {
  before: { hero: 960, block: 672, head: 816, row: 960 },
  after: { hero: 960, block: 960, head: 288, row: 960 },
} as const;

/** A top-level rule: no `@media`/`@keyframes` bodies, which declare no widths here. */
type Rule = { selector: string; body: string; order: number };

function topLevelRules(): Rule[] {
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  let order = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const selector = css.slice(rules.length ? Math.max(css.lastIndexOf("}", start - 1) + 1, 0) : 0, start).trim();
        const head = selector.slice(selector.lastIndexOf("}") + 1).trim();
        if (head && !head.startsWith("@")) {
          rules.push({ selector: head, body: css.slice(start + 1, i), order: (order += 1) });
        }
      }
    }
  }
  return rules;
}

/** CSS specificity as (id, class/attr/pseudo-class, type/pseudo-element). */
function specificity(selector: string): [number, number, number] {
  const cleaned = selector.replace(/\([^)]*\)/g, "()");
  const ids = (cleaned.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (cleaned.match(/\.[\w-]+/g) ?? []).length +
    (cleaned.match(/\[[^\]]*\]/g) ?? []).length +
    (cleaned.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const types = (cleaned.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length + (cleaned.match(/::[\w-]+/g) ?? []).length;
  return [ids, classes, types];
}

const beats = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** Declarations that set `width`, paired with the single selector that carries them. */
const widthRules = topLevelRules()
  .filter((r) => /(?:^|;)\s*width\s*:/.test(r.body))
  .flatMap((r) =>
    r.selector
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("samograph-skeleton"))
      .map((s) => ({
        selector: s,
        width: (r.body.match(/(?:^|;)\s*width\s*:\s*([^;]+)/) ?? [])[1]?.trim() ?? "",
        order: r.order,
        spec: specificity(s),
      })),
  );

/** Replay the cascade for one element: highest specificity wins, then source order. */
function winningWidth(el: Element): string {
  let winner: (typeof widthRules)[number] | undefined;
  for (const rule of widthRules) {
    if (!el.matches(rule.selector)) continue;
    if (!winner || beats(rule.spec, winner.spec) || (!beats(winner.spec, rule.spec) && rule.order > winner.order)) {
      winner = rule;
    }
  }
  return winner?.width ?? "auto";
}

const px = (width: string) =>
  width.endsWith("%") ? Math.round((parseFloat(width) / 100) * COLUMN) : width === "auto" ? COLUMN : parseFloat(width);

describe("the cascade actually reaches the shaped skeletons", () => {
  it("does not let the legacy :nth-of-type widths touch the row variant", () => {
    // `.samograph-skeleton > span[aria-hidden="true"]:nth-of-type(3)` is
    // (0,3,1) — the `span` is the third component. If it is still written
    // against the base class it out-specifies every modifier below it.
    const legacy = widthRules.filter((r) => r.selector.includes(":nth-of-type"));
    expect(legacy.length).toBeGreaterThan(0);
    for (const rule of legacy) {
      expect(rule.spec).toEqual([0, 3, 1]);
      expect(rule.selector).toMatch(/samograph-skeleton--(form|page)/);
    }
  });

  it("renders the dashboard skeleton's slabs and headings at their own widths", () => {
    const { getByRole } = render(<PageSkeleton variant="row" count={3} />);
    const skeleton = getByRole("status", { name: /^Loading/ });
    const width = (modifier: string, nth = 0) =>
      px(winningWidth([...skeleton.querySelectorAll(`.samograph-skeleton-bar--${modifier}`)][nth]!));

    expect(width("hero")).toBe(MEASURED.after.hero);
    // The two the review caught: 672px (70%) and 816px (85%).
    expect(width("block")).toBe(MEASURED.after.block);
    expect(width("head")).toBe(MEASURED.after.head);
    expect(width("row")).toBe(MEASURED.after.row);
    // Every heading, not just the first — span #4 was only the first one.
    for (const head of skeleton.querySelectorAll(".samograph-skeleton-bar--head")) {
      expect(px(winningWidth(head))).toBe(MEASURED.after.head);
    }
  });

  it("keeps the ragged widths on the two variants they were written for", () => {
    // `form`/`page` are three anonymous lines; the 70%/85% taper is what stops
    // them reading as a table, and it must survive the scoping fix.
    for (const variant of ["form", "page"] as const) {
      const { getByRole, unmount } = render(<PageSkeleton variant={variant} />);
      const bars = [...getByRole("status", { name: /^Loading/ }).querySelectorAll('span[aria-hidden="true"]')];
      expect(bars.length).toBe(3);
      expect(px(winningWidth(bars[0]!))).toBe(COLUMN);
      expect(px(winningWidth(bars[1]!))).toBe(Math.round(0.7 * COLUMN));
      expect(px(winningWidth(bars[2]!))).toBe(Math.round(0.85 * COLUMN));
      unmount();
    }
  });
});
