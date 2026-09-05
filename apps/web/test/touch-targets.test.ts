import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Mobile audit M3 (`scratchpad/ui-audit/MOBILE-AUDIT.md`).
 *
 * Two defects, one guard:
 *
 * 1. **Type floor.** `--text-xs: 0.75rem` (12px) is the smallest size the token
 *    scale admits, but the stylesheet carried eleven raw `.66–.74rem` literals
 *    that resolve to 9.73–11.84px — below the size iOS/Android consider legible
 *    body text. Raw literals are how the floor gets breached, so the floor is
 *    enforced against literals, not against the tokens.
 * 2. **Touch targets.** 24 interactive elements measured under 44 × 44 CSS px
 *    at 390px (`← Dashboard` at 85 × 20, `Reconnect in Settings` at 144 × 17,
 *    every `.samograph-btn` at 36px, `.samograph-btn--sm` at 28px). 44px is the
 *    WCAG 2.2 / iOS HIG minimum.
 *
 * The fix is one media block, so this guard pins the block and its members.
 */
const raw = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const FLOOR_PX = 12;
const toPx = (value: number, unit: string) => (unit === "px" ? value : value * 16);

/**
 * Rules whose below-floor literal lives in a globals.css region owned by
 * another in-flight mobile-audit PR. Editing them here would collide, so M3
 * reports them in its PR body instead. Each entry MUST name the owning PR.
 */
const OWNED_ELSEWHERE = new Map<string, string>([
  [".samograph-button", "M5 — landing (globals.css 137–171)"],
  [".samograph-instrument", "M5 — landing (globals.css 137–171)"],
  [".samograph-instrument-foot", "M5 — landing (globals.css 137–171)"],
  [".samograph-site-footer", "M5 — landing (globals.css 137–171)"],
  [".samograph-instrument-lines > li.samograph-transcript-row", "M1 — transcript (globals.css 1559–1585)"],
]);

type Literal = { selector: string; value: string; px: number };

function belowFloorLiterals(): Literal[] {
  const found: Literal[] = [];
  for (const [, prelude, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    // The prelude of a nested rule is everything since the previous brace,
    // including any `@media` header; the last line of it is the selector.
    const selector = normalize(prelude.split(/[;{}]/).pop() ?? "").replace(/^@media[^{]*/, "");
    for (const [, value, unit] of body.matchAll(/font-size\s*:\s*([0-9.]+)(rem|px|em)/g)) {
      const px = toPx(Number(value), unit);
      if (px < FLOOR_PX) found.push({ selector, value: `${value}${unit}`, px });
    }
  }
  return found;
}

describe("type floor — nothing renders below 12px", () => {
  it("has no raw font-size literal under 0.75rem outside another PR's region", () => {
    const offenders = belowFloorLiterals()
      .filter((literal) => !OWNED_ELSEWHERE.has(literal.selector))
      .map((literal) => `${literal.selector} { font-size: ${literal.value} } /* ${literal.px}px */`)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("keeps --text-xs as the 12px floor of the token scale", () => {
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(normalize(root.match(/--text-xs\s*:\s*([^;]+);/)?.[1] ?? "")).toBe("0.75rem");
  });

  it("sizes the theme switcher from the token scale, not a 10.88px literal", () => {
    const option = normalize(
      css.match(/\.samograph-theme-switcher__option\s*\{([^}]*)\}/)?.[1] ?? "",
    );
    expect(option).toMatch(/font-size\s*:\s*var\(--text-xs\)/);
  });
});

/** The coarse-pointer block, extracted brace-balanced so members can be read. */
function tapBlock(): string {
  const start = css.indexOf("@media (pointer: coarse), (max-width: 767.98px)");
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && (depth -= 1) === 0) return css.slice(start, i + 1);
  }
  return "";
}

describe("touch targets — 44px on a coarse pointer", () => {
  const block = tapBlock();

  it("defines the tap-target minimum as a token, once", () => {
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(normalize(root.match(/--tap-min\s*:\s*([^;]+);/)?.[1] ?? "")).toBe("44px");
  });

  it("ships a coarse-pointer block that also covers narrow mouse viewports", () => {
    expect(block).not.toBe("");
  });

  it("lifts every button variant to the tap minimum", () => {
    // `.samograph-btn` sets `height: 36px` and `--sm` 28px; a bare `min-height`
    // would lose to the fixed height, so `height: auto` must come with it.
    const btn = normalize(block.match(/\.samograph-btn[^{}]*\{([^}]*)\}/)?.[1] ?? "");
    expect(btn).toMatch(/min-height\s*:\s*var\(--tap-min\)/);
    expect(btn).toMatch(/height\s*:\s*auto/);
    expect(block).toMatch(/\.samograph-btn--sm/);
  });

  it("gives the call-view back link and the share-page download a real box", () => {
    for (const selector of [".samograph-call-back", ".samograph-download-transcript"]) {
      expect(block).toContain(selector);
    }
    const back = normalize(
      block.match(/\.samograph-call-back[^{}]*\{([^}]*)\}/)?.[1] ?? "",
    );
    expect(back).toMatch(/min-height\s*:\s*var\(--tap-min\)/);
  });

  it("grows inline prose links with a ::before hit area, not a min-height", () => {
    // An inline `<a>` in a paragraph cannot take `min-height` — it would be
    // ignored on an inline box, and `display: block` would break the sentence.
    // An absolutely-positioned pseudo-element enlarges the hit area in place.
    const hit = normalize(block.match(/a:not\(\[class\]\)::before\s*\{([^}]*)\}/)?.[1] ?? "");
    expect(hit).toMatch(/content\s*:\s*""/);
    expect(hit).toMatch(/position\s*:\s*absolute/);
    expect(hit).toMatch(/height\s*:\s*var\(--tap-min\)/);
    const anchor = normalize(block.match(/a:not\(\[class\]\)\s*\{([^}]*)\}/)?.[1] ?? "");
    expect(anchor).toMatch(/position\s*:\s*relative/);
  });
});
