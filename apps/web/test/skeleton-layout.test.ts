import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGlobalsCss } from "./helpers/stylesheet";

/**
 * Design PR 10 (docs/design/PLAN.md, desktop track #10 — "skeletons everywhere a
 * sentence used to be"; spec: DESIGN-MODEL.md §4 "Skeleton — .samograph-skeleton",
 * principle §1.4 "Loading is a skeleton of the thing that is coming").
 *
 * Audit finding #8: "a proper skeleton component existed but was wired to only
 * one Suspense fallback; two other surfaces rendered bare
 * `<p role="status">Loading …</p>` sentences instead." A sentence is not just
 * ugly — it is ~20px tall where ~700px of settings form is about to arrive, so
 * the page jumps the moment the fetch resolves.
 *
 * Two contracts here:
 *   1. every shimmer number is a `--skeleton-*` token, so the four variants
 *      cannot drift into four different greys and four different rhythms;
 *   2. `row` and `panel` exist and are shaped like the dashboard list and the
 *      settings sections they stand in for (the measured ≤8px claim in the PR
 *      body rests on these heights).
 */
const css = readGlobalsCss().replace(/\/\*[\s\S]*?\*\//g, "");
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return normalize(css.match(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "");
}

function token(name: string): string {
  return normalize(root.match(new RegExp(`${name.replace(/-/g, "\\-")}\\s*:\\s*([^;]+);`))?.[1] ?? "");
}

describe("skeleton tokens", () => {
  const expected: Record<string, string> = {
    "--skeleton-bg": "color-mix(in srgb, var(--muted) 15%, transparent)",
    "--skeleton-radius": "var(--radius-md)",
    "--skeleton-gap": "var(--space-3)",
    "--skeleton-dur": "1.4s",
    // Every height below is the MEASURED height of the thing the bar stands in
    // for, at 1024 (the mobile values are in the `--bp-md` block, asserted
    // further down). Rounded to the pixel; the deltas are in the PR body.
    "--skeleton-bar-h": "16px",          // one line of body text
    "--skeleton-title-h": "34px",        // `<h1>` — 33.59
    "--skeleton-head-h": "25px",         // `<h2>` — 24.8
    "--skeleton-para-h": "43px",         // two lines of prose — 43.38
    "--skeleton-control-h": "var(--control-h)",
    "--skeleton-area-h": "157px",        // the keyterms textarea, rows=6
    "--skeleton-row-h": "71px",          // one `.samograph-call-item` — 71.08
    "--skeleton-hero-h": "134px",        // the add-to-call hero — 142.28 less its 8px rail
    "--skeleton-block-h": "245px",       // upcoming meetings — 245.28
  };
  for (const [name, value] of Object.entries(expected)) {
    it(`defines ${name} exactly`, () => expect(token(name)).toBe(value));
  }
});

describe(".samograph-skeleton", () => {
  it("lays every variant out on the one shared rhythm", () => {
    const base = rule(".samograph-skeleton");
    expect(base).toMatch(/display\s*:\s*grid/);
    expect(base).toMatch(/gap\s*:\s*var\(--skeleton-gap\)/);
  });

  it("draws every bar from the tokens, not from a hand-picked grey", () => {
    const bar = rule('.samograph-skeleton span[aria-hidden="true"]');
    expect(bar).toMatch(/height\s*:\s*var\(--skeleton-bar-h\)/);
    expect(bar).toMatch(/border-radius\s*:\s*var\(--skeleton-radius\)/);
    expect(bar).toMatch(/background\s*:\s*var\(--skeleton-bg\)/);
    expect(bar).toMatch(/animation\s*:\s*samograph-skeleton-shimmer var\(--skeleton-dur\)/);
  });

  it("keeps the three original bars varying in width, scoped to their variants", () => {
    expect(css).toContain('.samograph-skeleton--form > span[aria-hidden="true"]:nth-of-type(3), .samograph-skeleton--page > span[aria-hidden="true"]:nth-of-type(3) { width: 70%; }');
    expect(css).toContain('.samograph-skeleton--form > span[aria-hidden="true"]:nth-of-type(4), .samograph-skeleton--page > span[aria-hidden="true"]:nth-of-type(4) { width: 85%; }');
  });

  /**
   * Three classes deep, not one. Both the base bar rule
   * (`.samograph-skeleton span[aria-hidden="true"]`, (0,2,0)) and the
   * `:nth-of-type` widths ((0,3,0)) out-specify a lone modifier class, so a
   * single-class `.samograph-skeleton-bar--title { height: … }` LOSES and every
   * bar renders 16px tall — measured, that is exactly what the first cut of
   * this PR did (settings skeleton 320px against a 1090px page). This test
   * pins the selector shape, not just the declaration.
   */
  const named: Record<string, string> = {
    title: "--skeleton-title-h",
    head: "--skeleton-head-h",
    para: "--skeleton-para-h",
    control: "--skeleton-control-h",
    area: "--skeleton-area-h",
    row: "--skeleton-row-h",
    hero: "--skeleton-hero-h",
    block: "--skeleton-block-h",
  };
  for (const [name, height] of Object.entries(named)) {
    it(`sizes --${name} from ${height}, at a specificity that actually wins`, () => {
      const selector = `.samograph-skeleton .samograph-skeleton-bar.samograph-skeleton-bar--${name}`;
      expect(rule(selector)).toMatch(new RegExp(`height\\s*:\\s*var\\(${height}\\)`));
    });
  }

  it("gives the header the geometry of .samograph-page-header", () => {
    const head = rule(".samograph-skeleton-header");
    expect(head).toMatch(/display\s*:\s*grid/);
    expect(head).toMatch(/gap\s*:\s*var\(--space-3\)/);
    // The header's own rail before the first section — `--space-8`, the same
    // one `.samograph-page-header` uses.
    expect(head).toMatch(/margin-block\s*:\s*var\(--space-5\) var\(--space-8\)/);
  });

  it("gives a section the geometry of .samograph-settings-section", () => {
    const group = rule(".samograph-skeleton-group");
    expect(group).toMatch(/display\s*:\s*grid/);
    expect(group).toMatch(/gap\s*:\s*var\(--space-5\)/);
    expect(group).toMatch(/padding-block\s*:\s*var\(--space-5\)/);
    expect(group).toMatch(/border-top\s*:\s*var\(--border-strong\) solid var\(--line\)/);
  });

  it("gives a field the label -> control -> hint rhythm of .samograph-field", () => {
    const field = rule(".samograph-skeleton-field");
    expect(field).toMatch(/display\s*:\s*grid/);
    expect(field).toMatch(/gap\s*:\s*var\(--space-3\)/);
  });

  it("grows the shaped variants below --bp-md, where the loaded pages grow", () => {
    // The narrow column wraps prose and stacks the hero form; a skeleton that
    // stayed at its desktop height would re-introduce the jump.
    const mobile = css.match(/@media\s*\(max-width:\s*767\.98px\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(normalize(mobile)).toContain("--skeleton-area-h: 176px;");
    expect(normalize(mobile)).toContain("--skeleton-hero-h: 190px;");   // 198.28 less the rail
    expect(normalize(mobile)).toContain("--skeleton-row-h: 119px;");    // 119.08
    expect(normalize(mobile)).toContain("--skeleton-para-h: 87px;");
  });

  it("gives the settings and dashboard variants the width of the page they load into", () => {
    // `--panel` and `--row` sit in `--width-prose`/full-width pages, so unlike
    // `--form` they must NOT be capped at `--width-form` or the loaded content
    // jumps sideways when it arrives (the bug `test/page-alignment.test.ts`
    // fixed for `--form`).
    expect(rule(".samograph-skeleton--panel")).toMatch(/max-width\s*:\s*var\(--width-prose\)/);
    expect(rule(".samograph-skeleton--row")).toMatch(/max-width\s*:\s*none/);
    // Their spacing comes from the group padding and the bar margins, so the
    // outer grid gap would double it.
    expect(rule(".samograph-skeleton--panel")).toMatch(/gap\s*:\s*0/);
    expect(rule(".samograph-skeleton--row")).toMatch(/gap\s*:\s*0/);
  });

  it("stops the shimmer under prefers-reduced-motion", () => {
    const reduced = (css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g) ?? []).join("\n");
    expect(reduced).toMatch(/\.samograph-skeleton span\[aria-hidden="true"\]\s*\{[^}]*animation\s*:\s*none/);
  });
});

describe("no page states a bare loading sentence any more", () => {
  const components = join(import.meta.dir, "../components");
  // Each surface names ITSELF in the announcement (PR #303 review): the status
  // region fires before anything is on screen, so "Loading" alone leaves a
  // screen-reader user without the page they just landed on.
  const expectedLabel: Record<string, string> = {
    "SettingsPage.tsx": 'label="Loading settings"',
    "Dashboard.tsx": 'label="Loading calls"',
    "CalendarConnectionCard.tsx": 'label="Loading calendar"',
  };
  for (const [file, label] of Object.entries(expectedLabel)) {
    it(`${file} renders a skeleton that says what is loading`, () => {
      const source = readFileSync(join(components, file), "utf8");
      expect(source).not.toMatch(/Loading (your |Google |upcoming )/);
      expect(source).toContain("PageSkeleton");
      expect(source).toContain(label);
    });
  }
});
