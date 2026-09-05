import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Button borders + a legible disabled state (design PR 7, plus PR 12's
 * dark-hairline item). Cites `docs/design/DESIGN-MODEL.md` §4 "Button —
 * `.samograph-btn`" and `docs/design/PLAN.md` rows 7 and 12.
 *
 * Three defects this guard pins:
 *
 *  1. `.samograph-btn[disabled]` was `opacity: .5` ALONE. Half-opacity ink over
 *     the page ground lands grey-on-grey in BOTH themes — the disabled "Save
 *     settings" button on /settings was the reported symptom. DESIGN-MODEL §4
 *     states the disabled recipe is a real background + a real border + a real
 *     foreground, "never opacity alone". We go one step further than the model
 *     and drop opacity entirely: an opacity multiplier on top of an explicit
 *     colour trio re-introduces exactly the contrast collapse it is supposed to
 *     fix, so the label ink is a token whose contrast can be MEASURED (below).
 *
 *  2. Border geometry was inconsistent across variants: the base declared no
 *     `border` at all (inheriting the bare `button` rule), `--primary` set only
 *     `border-color`, `--secondary`/`--danger` re-declared the shorthand, and
 *     `--ghost` set `border: 0` — which makes a ghost button 2px shorter and
 *     2px narrower than every sibling on the same row. DESIGN-MODEL §4:
 *     "border: 1px solid transparent; ← declare it, don't inherit from
 *     `button`", with each variant supplying only the colour. We keep the
 *     model's rule (base declares the border, variants set border-color only)
 *     but give the base `var(--control-border)` rather than `transparent`, so
 *     that a bare `.samograph-btn` with no variant — real in this codebase —
 *     keeps the box `button` used to give it. See the CSS comment for the
 *     recorded deviation.
 *
 *  3. Dark `--line` (#2a2926) on dark `--ground` (#111110) is 1.30:1 — below
 *     the 1.5:1 floor a 1px hairline needs to be seen at all, so list
 *     separators simply vanished in dark mode (PLAN PR 12: "Lifts `--line` in
 *     dark").
 */
const css = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Body of the LAST rule whose selector matches exactly (source order wins in CSS). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const matches = [...css.matchAll(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  return normalize(matches.at(-1)?.[1] ?? "");
}

const decl = (body: string, prop: string) =>
  normalize(body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1] ?? "");

// ---------------------------------------------------------------- token model
function block(selector: string): Record<string, string> {
  const body = css.match(new RegExp(`${selector.replace(/[[\]"^$.*+?()\\|{}]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const base = block(":root");
const themes = {
  light: { ...base, ...block(':root[data-theme="light"]') },
  dark: { ...base, ...block(':root[data-theme="dark"]') },
};

type Rgb = [number, number, number];

function resolve(value: string, tokens: Record<string, string>, depth = 0): string {
  if (depth > 8) throw new Error(`cyclic var() chain: ${value}`);
  const varRef = value.trim().match(/^var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)$/);
  if (!varRef) return value.trim();
  const target = tokens[varRef[1]] ?? varRef[2];
  if (target === undefined) throw new Error(`undefined token ${varRef[1]}`);
  return resolve(target, tokens, depth + 1);
}

function hex(value: string): Rgb {
  const m = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (/^white$/i.test(value)) return [255, 255, 255];
  if (/^black$/i.test(value)) return [0, 0, 0];
  throw new Error(`unsupported color: ${value}`);
}

function color(value: string, tokens: Record<string, string>): Rgb {
  const resolved = resolve(value, tokens);
  const mix = resolved.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/);
  if (!mix) return hex(resolved);
  const a = color(mix[1], tokens);
  const b = color(mix[3], tokens);
  const p = Number(mix[2]) / 100;
  return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

const ratio = (fg: string, bg: string, theme: "light" | "dark") =>
  contrast(color(fg, themes[theme]), color(bg, themes[theme]));

// ------------------------------------------------------------------ the guard
const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;

describe("button border geometry (DESIGN-MODEL §4 Button)", () => {
  it("declares the border on the base instead of inheriting it from `button`", () => {
    expect(decl(rule(".samograph-btn"), "border")).toBe("1px solid var(--control-border)");
  });

  for (const variant of VARIANTS) {
    it(`.samograph-btn--${variant} sets only border-color, never a shorthand or 0`, () => {
      const body = rule(`.samograph-btn--${variant}`);
      expect(body.length).toBeGreaterThan(0);
      // A shorthand `border:` in a variant re-states the width and can zero it
      // out (the `--ghost { border: 0 }` bug), desyncing the box model.
      expect(decl(body, "border")).toBe("");
      expect(decl(body, "border-color").length).toBeGreaterThan(0);
    });
  }

  it("keeps --ghost the same box as its siblings (transparent border, not none)", () => {
    expect(decl(rule(".samograph-btn--ghost"), "border-color")).toBe("transparent");
  });

  it("gives .samograph-btn--sm the same 1px border via the base (height only)", () => {
    const body = rule(".samograph-btn--sm");
    expect(decl(body, "border")).toBe("");
    expect(decl(body, "height")).toBe("var(--control-h-sm)");
  });
});

describe("button states (DESIGN-MODEL §4 Button — states)", () => {
  it("carries its own focus-visible outline", () => {
    const body = rule(".samograph-btn:focus-visible");
    expect(decl(body, "outline")).toBe("2px solid var(--focus-ring)");
    expect(decl(body, "outline-offset")).toBe("2px");
  });

  it("hovers only when enabled — no :hover rule may apply to a disabled button", () => {
    const hovers = [...css.matchAll(/(\.samograph-btn[^{,]*:hover)\s*\{/g)].map((m) => m[1].trim());
    expect(hovers.length).toBeGreaterThan(0);
    expect(hovers.filter((s) => !s.includes(":not([disabled])"))).toEqual([]);
  });

  it("defines an :active press state for the base", () => {
    expect(rule(".samograph-btn:not([disabled]):active").length).toBeGreaterThan(0);
  });
});

describe("disabled buttons are legible (PLAN PR 7)", () => {
  const disabled = rule(".samograph-btn[disabled]");

  it("uses the explicit token trio, not a bare opacity multiplier", () => {
    expect(decl(disabled, "opacity")).toBe("");
    expect(decl(disabled, "background")).toBe("var(--btn-disabled-bg)");
    expect(decl(disabled, "color")).toBe("var(--btn-disabled-fg)");
    expect(decl(disabled, "border-color")).toBe("var(--btn-disabled-border)");
    expect(decl(disabled, "cursor")).toBe("not-allowed");
  });

  it("defines the three tokens in :root so both themes re-resolve them", () => {
    for (const t of ["--btn-disabled-bg", "--btn-disabled-fg", "--btn-disabled-border"]) {
      expect(base[t]).toBeDefined();
    }
  });

  for (const theme of ["light", "dark"] as const) {
    it(`label clears 3:1 against its own fill in ${theme} mode`, () => {
      expect(ratio("var(--btn-disabled-fg)", "var(--btn-disabled-bg)", theme)).toBeGreaterThanOrEqual(3);
    });

    it(`label clears 3:1 against the surrounding page ground in ${theme} mode`, () => {
      expect(ratio("var(--btn-disabled-fg)", "var(--ground)", theme)).toBeGreaterThanOrEqual(3);
    });

    it(`border stays visible against the page ground in ${theme} mode`, () => {
      expect(ratio("var(--btn-disabled-border)", "var(--ground)", theme)).toBeGreaterThanOrEqual(1.5);
    });
  }
});

describe("dark hairlines (PLAN PR 12)", () => {
  for (const against of ["--ground", "--surface"] as const) {
    it(`--line reaches 1.5:1 against ${against} in dark mode`, () => {
      expect(ratio("var(--line)", `var(${against})`, "dark")).toBeGreaterThanOrEqual(1.5);
    });
  }

  it("keeps --line-strong above --line so the two-step hairline scale survives", () => {
    expect(ratio("var(--line-strong)", "var(--ground)", "dark")).toBeGreaterThan(
      ratio("var(--line)", "var(--ground)", "dark"),
    );
  });

  it("leaves the light hairline alone", () => {
    expect(themes.light["--line"]).toBe("#dfdbd1");
  });
});
