import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Mobile audit M5 — the landing page (`docs/design/AUDIT-2026-09-04.md` "/ landing"
 * and finding 7 "two design languages"; `docs/design/PLAN.md` M5).
 *
 * Four defects, one guard, all inside the landing block of globals.css:
 *
 * 1. **Footer separators render on the line above their links.** The footer nav
 *    is `display: flex` over `<span><i>·</i><a>…</a></span>` pairs. The span
 *    inherited `align-items: normal` (= stretch), so the `<i>` box was stretched
 *    to the link's 44px touch target while its single glyph painted at the TOP
 *    of that box — measured at 390px the `·` sat at y=536.7 with a 7×44 box
 *    against a link whose text is vertically centred in the same 44px. It read
 *    as stray punctuation floating a line up, at every viewport width.
 * 2. **The mobile breakpoint hid the wordmark AND the nav CTA.** `.samograph-brand
 *    > span` and `.samograph-button--compact` were both `display: none` below
 *    the mobile breakpoint, so the product's name did not appear on its own page and the
 *    nav had no action — leaving a 44px unlabelled avatar and a 154px theme
 *    switcher.
 * 3. **Type floor.** The landing block carried four raw below-12px literals
 *    (`.74rem` / `.7rem` / `.66rem` / `.73rem`) plus a `<small>` that resolved to
 *    9.73px — the smallest text in the product. `--text-xs` (12px) is the floor
 *    the token scale admits.
 * 4. **Two design languages.** The landing nav was 68px tall with a hard-coded
 *    56px gutter; the app shell (`.samograph-app-nav-inner`) is 56px below
 *    `--bp-md`, 64px at/above it, with `padding: 0 var(--gutter)`. The landing
 *    now uses the same three numbers so the two headers are one geometry.
 */
const raw = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Every declaration block whose selector list matches, concatenated in order. */
function bodies(selector: string): string[] {
  const found: string[] = [];
  for (const [, prelude, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const last = normalize(prelude.split(/[;{}]/).pop() ?? "");
    if (last === selector) found.push(normalize(body));
  }
  return found;
}

/**
 * Every top-level `@media` block for the feature, brace-balanced and joined —
 * the stylesheet repeats a breakpoint per slice rather than centralising it.
 */
function mediaBlock(feature: string): string {
  const header = `@media ${feature}`;
  const blocks: string[] = [];
  for (let start = css.indexOf(header); start >= 0; start = css.indexOf(header, start + 1)) {
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i));
          break;
        }
      }
    }
  }
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.join("\n");
}

describe("M5.1 — the footer separator sits on its link's line", () => {
  it("centres the separator against the 44px link inside each span", () => {
    const span = bodies(".samograph-site-footer nav span");
    expect(span.length).toBeGreaterThan(0);
    expect(span.join(" ")).toMatch(/align-items\s*:\s*center/);
  });

  it("centres the wrapped rows of the footer nav itself", () => {
    const nav = bodies(".samograph-site-footer nav");
    expect(nav.length).toBeGreaterThan(0);
    expect(nav.join(" ")).toMatch(/align-items\s*:\s*center/);
  });

  it("drops the separators below --bp-md, where the links wrap", () => {
    const mobile = mediaBlock("(max-width: 767.98px)");
    expect(mobile).toMatch(/\.samograph-site-footer nav i\s*\{[^}]*display\s*:\s*none/);
    expect(mobile).toMatch(
      /\.samograph-site-footer nav\s*\{[^}]*column-gap\s*:\s*var\(--space-4\)/,
    );
  });
});

describe("M5.2 — the wordmark and the nav CTA survive the mobile breakpoint", () => {
  const mobile = () => mediaBlock("(max-width: 767.98px)");

  it("no longer hides .samograph-brand > span below --bp-md", () => {
    expect(css).not.toMatch(/\.samograph-brand\s*>\s*span\s*,?[^{}]*\{[^}]*display\s*:\s*none/);
  });

  it("no longer hides the nav CTA below --bp-md", () => {
    // PLAN PR 13 replaced `.samograph-button--compact` with the shared
    // `.samograph-btn--sm`; the defect guarded here is unchanged — nothing in
    // the mobile block may hide the landing nav's one action.
    expect(mobile()).not.toMatch(/\.samograph-btn--sm[^{}]*\{[^}]*display\s*:\s*none/);
    expect(mobile()).not.toMatch(/\.samograph-nav-actions\s+a[^{}]*\{[^}]*display\s*:\s*none/);
  });

  it("shrinks the brand instead of hiding it", () => {
    expect(mobile()).toMatch(/\.samograph-brand\s*\{[^}]*font-size\s*:\s*0?\.82rem/);
  });

  it("drops the theme switcher from the landing nav to make room", () => {
    expect(mobile()).toMatch(
      /\.samograph-nav-actions\s+\.samograph-theme-switcher\s*\{[^}]*display\s*:\s*none/,
    );
  });
});

describe("M5.3 — a 12px type floor across the landing block", () => {
  // The slice used to stop at `@keyframes samograph-refined-pulse`, which sits
  // BEFORE the landing's own `@media` blocks (--bp-lg / --bp-md / reduced
  // motion) — so the breakpoint where the type actually shrinks was never
  // scanned (#290 review). It now runs to the theme blocks that follow the
  // whole landing section.
  const landing = css.slice(
    css.indexOf(".samograph-landing {"),
    css.indexOf("@media (prefers-color-scheme: dark)"),
  );

  it("scans PAST @keyframes, so the landing's own media blocks are covered", () => {
    expect(landing).toContain("@keyframes samograph-refined-pulse");
    expect(landing).toContain(".samograph-landing-hero h1 { font-size: 1.95rem; }");
    expect(landing.indexOf(".samograph-landing {")).toBe(0);
  });

  it("has no font-size literal below 0.75rem in the landing block", () => {
    const offenders: string[] = [];
    for (const [, prelude, body] of landing.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = normalize(prelude.split(/[;{}]/).pop() ?? "");
      for (const [, value, unit] of body.matchAll(/font-size\s*:\s*([0-9.]+)(rem|px|em)/g)) {
        const px = unit === "px" ? Number(value) : Number(value) * 16;
        if (px < 12) offenders.push(`${selector} { font-size: ${value}${unit} } /* ${px}px */`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  for (const selector of [
    // `.samograph-button` was in this list until PLAN PR 13 retired it for the
    // shared `.samograph-btn`, whose `--text-sm` (13px) clears the floor and is
    // pinned by `test/control-height.test.ts` / `test/button-states.test.ts`.
    // The block-wide sweep above still catches any sub-12px literal that lands
    // on the landing's replacement CTA rules.
    ".samograph-instrument",
    ".samograph-instrument-foot",
    ".samograph-site-footer",
  ]) {
    it(`sizes ${selector} from --text-xs`, () => {
      expect(bodies(selector).join(" ")).toMatch(/font-size\s*:\s*var\(--text-xs\)/);
    });
  }

  it("stops <small> shrinking the strapline to 9.73px", () => {
    expect(bodies(".samograph-site-footer small").join(" ")).toMatch(
      /font-size\s*:\s*var\(--text-xs\)/,
    );
  });
});

describe("M5.4 — the landing header shares the app shell's geometry", () => {
  it("rests at the app shell's 56px below --bp-md", () => {
    expect(bodies(".samograph-site-nav").join(" ")).toMatch(/min-height\s*:\s*56px/);
  });

  it("grows to the app shell's 64px at >= 768px", () => {
    expect(mediaBlock("(min-width: 768px)")).toMatch(
      /\.samograph-site-nav\s*\{[^}]*min-height\s*:\s*64px/,
    );
  });

  it("uses the shared --gutter rather than a hard-coded 56px", () => {
    for (const selector of [
      ".samograph-site-nav",
      ".samograph-landing-hero",
      ".samograph-site-footer",
    ]) {
      expect(bodies(selector).join(" ")).toMatch(/var\(--gutter\)/);
    }
    // The private 56px/32px/20px gutter ladder is gone from every landing rule.
    for (const body of [
      ...bodies(".samograph-site-nav"),
      ...bodies(".samograph-landing-hero"),
      ...bodies(".samograph-site-footer"),
    ]) {
      expect(body).not.toMatch(/padding[^;]*\b(?:56|32|20)px/);
    }
  });
});

describe("M5.5 — the dormant instrument rule declares no width at all", () => {
  // `min-width: min(780px, 100%)` was a no-op, not a cap (#290 review): every
  // `.samograph-instrument` in the app is also `.samograph-percall`, and
  // `.samograph-percall.samograph-instrument` (0,2,0) declares `min-width: 0`.
  // A dead declaration that LOOKS like the phone-overflow guard is worse than
  // none — it invites the next reader to trust it. The live rule is asserted
  // here instead.
  it("declares no min-width on the bare .samograph-instrument", () => {
    expect(bodies(".samograph-instrument").join(" ")).not.toMatch(/min-width/);
  });

  it("keeps the real cap on the compound rule that actually matches the markup", () => {
    expect(bodies(".samograph-percall.samograph-instrument").join(" ")).toMatch(
      /min-width\s*:\s*0/,
    );
  });
});

describe("M5.6 — the landing nav fits a 320px phone (#290 review)", () => {
  // At 320px the nav box is 320 - 2 x --gutter = 288px since M9 made the gutter
  // fluid (clamp(16px, 5vw, 32px) resolves to 16px here, was a stepped 20px), and
  // its content is the wordmark (~153px) + the CTA (~112px) + the flex gap. With
  // the desktop 32px gap that is ~297px in a 288px box — the CTA overhangs the
  // right edge. --space-3 (12px) brings it to ~277px, inside the box, and the
  // theme switcher is already dropped at this width.
  it("keeps the 32px gap above the breakpoint", () => {
    expect(bodies(".samograph-site-nav").join(" ")).toMatch(/gap\s*:\s*32px/);
  });

  it("tightens the nav gap to --space-3 below --bp-md", () => {
    expect(mediaBlock("(max-width: 767.98px)")).toMatch(
      /\.samograph-site-nav\s*\{[^}]*gap\s*:\s*var\(--space-3\)/,
    );
  });
});
