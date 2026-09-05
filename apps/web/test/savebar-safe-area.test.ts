import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Mobile audit M6 — "savebar + safe area"
 * (`scratchpad/ui-audit/MOBILE-AUDIT.md`, per-page §3 and "Cross-cutting" §7).
 *
 * Two defects, one fix:
 *
 *  1. The settings savebar is `position: sticky; bottom: 0` as the LAST child of
 *     `.samograph-settings`. While its resting place is still below the fold a
 *     sticky bottom box is pulled UP to the viewport edge, so it floats over
 *     whatever sits at the bottom of the screen — at 1024 that is the bottom
 *     border of the "Chat chime" select (`d01-settings-1024.jpg`), a 2px rule
 *     slicing the control the bar exists to save. The bar was column-width with
 *     `--ground` either side and no shadow, so it read as another rule INSIDE
 *     the form rather than as a bar on top of it. Fixed by making the layering
 *     explicit (full-bleed edge, upward shadow, own stacking order, stated
 *     height) and by guaranteeing reserved ground beneath the bar's resting
 *     place so nothing can be trapped under it at the end of the scroll.
 *
 *  2. `grep -c safe-area globals.css` was 0 and `app/layout.tsx` had no
 *     `export const viewport`, so Next shipped the default
 *     `width=device-width, initial-scale=1` with no `viewport-fit=cover`. On a
 *     notched iPhone the sticky savebar and the jump-to-live pill sit under the
 *     home indicator. iOS only reports `env(safe-area-inset-*)` when the
 *     document opts in with `viewport-fit=cover`, so BOTH halves are required —
 *     the CSS alone is inert.
 *
 * Every inset is read through a `--safe-*` token with an explicit `0px`
 * fallback (a bare `env()` with no fallback is invalid at computed-value time
 * on browsers that do not know the keyword, which drops the whole declaration —
 * the #255 failure mode `css-tokens-defined.test.ts` guards).
 */
const cssRaw = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8");
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const layout = readFileSync(join(import.meta.dir, "../app/layout.tsx"), "utf8");

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return normalize(css.match(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "");
}

const token = (name: string) => normalize(root.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1] ?? "");

describe("viewport-fit=cover (M6, audit §7)", () => {
  it("exports a viewport from app/layout.tsx that opts into the safe area", () => {
    expect(layout).toMatch(/export const viewport\s*:\s*Viewport\s*=/);
    const body = normalize(layout.match(/export const viewport[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? "");
    expect(body).toContain('width: "device-width"');
    expect(body).toContain("initialScale: 1");
    expect(body).toContain('viewportFit: "cover"');
  });
});

describe("the --safe-* inset tokens (M6, audit §7)", () => {
  it("defines all four insets in :root with a 0px fallback", () => {
    expect(token("--safe-top")).toBe("env(safe-area-inset-top, 0px)");
    expect(token("--safe-right")).toBe("env(safe-area-inset-right, 0px)");
    expect(token("--safe-bottom")).toBe("env(safe-area-inset-bottom, 0px)");
    expect(token("--safe-left")).toBe("env(safe-area-inset-left, 0px)");
  });

  it("routes EVERY env(safe-area-inset-*) through those four tokens", () => {
    const uses = [...css.matchAll(/env\(\s*safe-area-inset-[\w-]+/g)];
    expect(uses).toHaveLength(4);
    const rootUses = [...root.matchAll(/env\(\s*safe-area-inset-[\w-]+/g)];
    expect(rootUses).toHaveLength(4);
  });

  it("derives the savebar's own height from the control scale, not a literal", () => {
    expect(token("--savebar-h")).toBe("calc(var(--control-h) + var(--space-3) * 2 + var(--border-strong))");
  });
});

describe("the savebar reserves its own footprint (M6, audit §3 / d01)", () => {
  it("reserves at least the bar's height of ground beneath it, page-wide", () => {
    // A sticky bottom bar is only ever pulled UP, never pushed DOWN past its
    // flow position, so the reserve belongs BELOW the bar's containing block —
    // on the page's trailing rail — not inside it. Padding on
    // `.samograph-settings` was measured at 1024x900 and rejected: it left the
    // bar resting 174px above the viewport bottom instead of 80px.
    expect(rule(".samograph-page")).toMatch(
      /padding\s*:\s*var\(--space-8\) var\(--gutter\) max\(var\(--space-16\), calc\(var\(--savebar-h\) \+ var\(--safe-bottom\)\)\)/,
    );
  });

  it("keeps a programmatic scroll from parking a field under the bar", () => {
    expect(rule(".samograph-settings .samograph-field")).toMatch(
      /scroll-margin-bottom\s*:\s*calc\(var\(--savebar-h\) \+ var\(--safe-bottom\) \+ var\(--space-3\)\)/,
    );
  });

  it("pins the bar to a known height so the reserve can match it", () => {
    const bar = rule(".samograph-savebar");
    expect(bar).toMatch(/position\s*:\s*sticky/);
    expect(bar).toMatch(/bottom\s*:\s*0/);
    expect(bar).toMatch(/box-sizing\s*:\s*border-box/);
    expect(bar).toMatch(/min-height\s*:\s*calc\(var\(--savebar-h\) \+ var\(--safe-bottom\)\)/);
  });

  it("reads as a bar ABOVE the page: full bleed, elevated, own stacking order", () => {
    const bar = rule(".samograph-savebar");
    expect(bar).toMatch(/margin-inline\s*:\s*calc\(var\(--gutter\) \* -1\)/);
    expect(bar).toMatch(/padding-inline\s*:\s*var\(--gutter\)/);
    expect(bar).toMatch(/z-index\s*:\s*2/);
    expect(bar).toMatch(/background\s*:\s*var\(--surface\)/);
    expect(bar).toMatch(/box-shadow\s*:\s*var\(--elev-savebar\)/);
    expect(token("--elev-savebar")).toBe("0 -4px 16px color-mix(in srgb, var(--ink) 10%, transparent)");
  });

  it("pads the bar past the home indicator", () => {
    expect(rule(".samograph-savebar")).toMatch(
      /padding-bottom\s*:\s*calc\(var\(--space-3\) \+ var\(--safe-bottom\)\)/,
    );
  });
});

describe("the jump-to-live pill clears the home indicator (M6, audit §7)", () => {
  it("adds the bottom inset to its offset", () => {
    expect(rule(".samograph-jump-live")).toMatch(/bottom\s*:\s*calc\(78px \+ var\(--safe-bottom\)\)/);
  });
});
