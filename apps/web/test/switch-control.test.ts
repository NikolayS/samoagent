import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGlobalsCss } from "./helpers/stylesheet";

/**
 * Design PR 9 (docs/design/PLAN.md, desktop track #9 — "real switch for
 * auto-record"; spec: DESIGN-MODEL.md §4 "Checkbox / Toggle — .samograph-toggle").
 *
 * The audit's honourable mention: `role="switch"` on auto-record *announced* a
 * switch and *drew* a 13px UA checkbox. DESIGN-MODEL §4 is explicit — "the
 * pixels must match the announced semantics": a real track (40×24,
 * `--radius-pill`, `--line-strong`) with an 18px knob that translates 16px on
 * `:checked` over `--dur-base`, track → `--ink`.
 *
 * This guard pins the load-bearing declarations. The two forms of
 * `.samograph-toggle` are separated by attribute, not by an extra class, so the
 * markup keeps its implicit `<label>` association (the whole label stays the
 * hit target) and nothing has to remember to add a class next to `role`.
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

describe("switch geometry and motion tokens", () => {
  // Every number in the switch comes from a token so the control can be
  // re-scaled in one place, and so `test/css-tokens-defined.test.ts` (no bare
  // `var()` without a definition) stays green.
  const expected: Record<string, string> = {
    "--switch-w": "40px",
    "--switch-h": "24px",
    "--switch-knob": "18px",
    // 40 - 18 - 3*2 padding = 16. Declared, not computed inline, so the three
    // numbers above cannot drift apart silently.
    "--switch-travel": "16px",
    "--switch-pad": "3px",
    // DESIGN-MODEL §3 Motion. The knob is the first thing in the app that
    // animates on state, so it introduces the shared duration/easing pair.
    "--dur-base": "180ms",
    "--ease": "cubic-bezier(.2, 0, 0, 1)",
  };
  for (const [name, value] of Object.entries(expected)) {
    it(`defines ${name} exactly`, () => expect(token(name)).toBe(value));
  }
});

describe(".samograph-toggle checkbox", () => {
  it("keeps the plain checkbox a checkbox, sized and inked", () => {
    const box = rule('.samograph-toggle input[type="checkbox"]:not([role="switch"])');
    expect(box).toMatch(/accent-color\s*:\s*var\(--ink\)/);
    expect(box).toMatch(/width\s*:\s*18px/);
    expect(box).toMatch(/height\s*:\s*18px/);
  });
});

describe('.samograph-toggle input[role="switch"]', () => {
  const track = rule('.samograph-toggle input[role="switch"]');

  it("drops the UA checkbox rendering", () => {
    expect(track).toMatch(/(^|[;\s])appearance\s*:\s*none/);
    expect(track).toMatch(/-webkit-appearance\s*:\s*none/);
  });

  it("draws a token-sized pill track", () => {
    expect(track).toMatch(/width\s*:\s*var\(--switch-w\)/);
    expect(track).toMatch(/height\s*:\s*var\(--switch-h\)/);
    expect(track).toMatch(/border-radius\s*:\s*var\(--radius-pill\)/);
    // DEVIATION from DESIGN-MODEL §4 (which names `--line-strong`): the OFF
    // track and the knob are a state indicator, so WCAG 2.2 SC 1.4.11 wants
    // 3:1 between them. `--ground` knob on `--line-strong` is 1.2:1 in dark
    // (#111110 on #45433d) — invisible. `--muted` is the same hairline family
    // one step darker/lighter per theme and clears 5:1 in BOTH (#f4f2ed on
    // #6b675c light, #111110 on #918c80 dark) with one declaration.
    expect(track).toMatch(/background\s*:\s*var\(--muted\)/);
    // A switch in a flex label must not be squeezed by a long hint beside it.
    expect(track).toMatch(/flex\s*:\s*none/);
    // The knob is an absolutely-positioned child, so the track is its
    // containing block.
    expect(track).toMatch(/position\s*:\s*relative/);
  });

  it("transitions the track colour on the shared duration and easing", () => {
    expect(track).toMatch(/transition\s*:[^;]*var\(--dur-base\)[^;]*var\(--ease\)/);
  });

  it("moves an 18px knob 16px across on :checked", () => {
    const knob = rule('.samograph-toggle input[role="switch"]::before');
    expect(knob).toMatch(/content\s*:\s*""/);
    expect(knob).toMatch(/position\s*:\s*absolute/);
    expect(knob).toMatch(/width\s*:\s*var\(--switch-knob\)/);
    expect(knob).toMatch(/height\s*:\s*var\(--switch-knob\)/);
    expect(knob).toMatch(/border-radius\s*:\s*var\(--radius-pill\)/);
    expect(knob).toMatch(/background\s*:\s*var\(--ground\)/);
    expect(knob).toMatch(/transition\s*:[^;]*var\(--dur-base\)[^;]*var\(--ease\)/);

    expect(rule('.samograph-toggle input[role="switch"]:checked')).toMatch(/background\s*:\s*var\(--ink\)/);
    expect(rule('.samograph-toggle input[role="switch"]:checked::before')).toMatch(
      /transform\s*:\s*translateX\(var\(--switch-travel\)\)/,
    );
  });

  it("takes the one focus signal, on the control itself", () => {
    const focus = rule('.samograph-toggle input[role="switch"]:focus-visible');
    expect(focus).toMatch(/outline\s*:\s*2px solid var\(--focus-ring\)/);
    expect(focus).toMatch(/outline-offset\s*:\s*2px/);
  });

  /**
   * Review finding (NON-BLOCKING, PR #303). The system's disabled recipe is
   * `opacity: .45` + a disabled fill + a hairline (DESIGN-MODEL §6), but the
   * opacity half cannot apply to a switch: it composites the track back toward
   * the page ground while the knob (which IS the page ground) does not move, so
   * light-theme track-vs-knob falls from 5.0:1 to 1.9:1 (#b6b4ac on #f4f2ed)
   * and a disabled switch no longer says whether it is on. The other three
   * signals carry the state instead.
   */
  it("draws a disabled switch as disabled without dimming away its state", () => {
    const off = rule('.samograph-toggle:has(input[role="switch"]:disabled)');
    expect(off).toMatch(/cursor\s*:\s*not-allowed/);
    expect(off).toMatch(/color\s*:\s*var\(--muted\)/);
    const control = rule('.samograph-toggle input[role="switch"]:disabled');
    expect(control).toMatch(/cursor\s*:\s*not-allowed/);
    expect(control).toMatch(/box-shadow\s*:\s*inset 0 0 0 var\(--border\) var\(--btn-disabled-border\)/);
    // The load-bearing negative: no opacity anywhere on the control.
    expect(control).not.toMatch(/opacity/);
  });

  /**
   * Review finding (NON-BLOCKING, PR #303). Forced-colours modes replace author
   * colours, so a track whose ON/OFF difference lives in `background` collapses
   * to one flat box. The border and the system-colour knob survive.
   */
  it("keeps the two states apart in forced-colours mode", () => {
    const forced = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(forced).toMatch(/border\s*:\s*var\(--border\) solid ButtonText/);
    expect(forced).toMatch(/::before\s*\{[^}]*background\s*:\s*ButtonText/);
    expect(forced).toMatch(/:checked\s*\{[^}]*background\s*:\s*Highlight/);
    expect(forced).toMatch(/:disabled\s*\{[^}]*border-color\s*:\s*GrayText/);
    // A border on a 40x24 track must not eat the track: there is no blanket
    // `* { box-sizing: border-box }` in this stylesheet.
    expect(rule('.samograph-toggle input[role="switch"]')).toMatch(/box-sizing\s*:\s*border-box/);
  });

  it("stops the knob animating under prefers-reduced-motion", () => {
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g) ?? [];
    const joined = block.join("\n");
    expect(joined).toMatch(/\.samograph-toggle input\[role="switch"\][^{]*\{[^}]*transition\s*:\s*none/);
  });
});

describe("the auto-record control keeps its label association", () => {
  it("wraps the switch in its own <label>, with the hint inside", () => {
    const card = readFileSync(join(import.meta.dir, "../components/CalendarConnectionCard.tsx"), "utf8");
    // An implicit label: the <input> is a descendant of the <label>, so the
    // accessible name comes from the element itself and the whole row (44px on
    // a coarse pointer, `test/touch-targets.test.ts`) toggles it.
    expect(card).toMatch(/<label className="samograph-toggle">\s*<input type="checkbox" role="switch"/);
  });
});
