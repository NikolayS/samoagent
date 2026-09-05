import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Desktop PR 13 — "converge the landing on the app's design language"
 * (`docs/design/PLAN.md` PR 13; `docs/design/DESIGN-MODEL.md` §4 "Button —
 * `.samograph-btn`", §3 "Type scale", §5 "Type floor", §1 principle 2 "One
 * control geometry").
 *
 * The landing shipped its own parallel design language: a second button
 * (`.samograph-button` / `--compact`, a hand-written 44px ink pill with
 * `!important` colour and an `opacity: .82` hover) and a monospace-first type
 * stack (`font-family: var(--font-mono)` on `.samograph-landing`, on
 * `.samograph-site-footer`, and a `:where(.samograph-landing) h1,h2,h3`
 * override that pulled the hero heading off the app's `--font-display`).
 * Audit finding 7, "two design languages in one product": PR M5 (#290) already
 * converged the landing's tokens, gutter and nav geometry; this guard pins the
 * remaining two — one button system and one type system.
 *
 * Mono is NOT banished from the landing: the dormant transcript-instrument demo
 * (`.samograph-instrument*`) is code/tabular output and keeps it, which is why
 * `.samograph-instrument` must now declare the family itself instead of
 * inheriting it from `.samograph-landing`.
 */
const cssPath = join(import.meta.dir, "../app/globals.css");
const raw = readFileSync(cssPath, "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Every declaration block whose selector list ends with `selector`, joined. */
function body(selector: string): string {
  const found: string[] = [];
  for (const [, prelude, block] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const last = normalize(prelude.split(/[;{}]/).pop() ?? "");
    if (last === selector) found.push(normalize(block));
  }
  expect(found.length, `no rule for ${selector}`).toBeGreaterThan(0);
  return found.join(" ");
}

/** Every .tsx/.ts source file under apps/web, excluding node_modules. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const landingTsx = readFileSync(
  join(import.meta.dir, "../components/Landing.tsx"),
  "utf8",
);

describe("PR13.1 — one button system", () => {
  it("has deleted every .samograph-button rule from the stylesheet", () => {
    const offenders = [...css.matchAll(/([^{}]*)\{[^{}]*\}/g)]
      .map(([, prelude]) => normalize(prelude.split(/[;{}]/).pop() ?? ""))
      .filter((selector) => /\.samograph-button\b/.test(selector));
    expect(offenders).toEqual([]);
  });

  /* Shipping code only. Several guards narrate the retired class in a comment
   * as the history of the defect they cover (`landing-mobile.test.ts` M5.2,
   * `touch-targets.test.ts`'s waiver ledger, the reversed cases in
   * `tokens.test.tsx`) — a prose mention is not a call site, and scanning it
   * would force those comments to lie about what was fixed. What must not
   * survive is the class in rendered markup, so this reads only the sources a
   * page is built from. */
  it("has no .samograph-button left in any component or route", () => {
    const offenders = sources(join(import.meta.dir, ".."))
      .filter((path) => !/\.test\.tsx?$/.test(path) && !path.includes("/test/"))
      .filter((path) => /samograph-button/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(path.indexOf("apps/web")));
    expect(offenders).toEqual([]);
  });

  it("has no .samograph-button left in the landing DOM baseline fixture", () => {
    const fixture = readFileSync(
      join(import.meta.dir, "../components/__fixtures__/landing.baseline.html"),
      "utf8",
    );
    expect(fixture).not.toMatch(/samograph-button/);
    expect(fixture).toMatch(/class="samograph-btn samograph-btn--primary"/);
    expect(fixture).toMatch(
      /class="samograph-btn samograph-btn--primary samograph-btn--sm"/,
    );
  });

  it("dresses the hero CTA as the app's primary button", () => {
    expect(landingTsx).toMatch(
      /className="samograph-btn samograph-btn--primary" href="\/auth"/,
    );
  });

  it("dresses the nav CTA as the app's small primary button", () => {
    expect(landingTsx).toMatch(
      /className="samograph-btn samograph-btn--primary samograph-btn--sm"/,
    );
  });
});

describe("PR13.2 — one type system", () => {
  it("lets the landing inherit the app body font instead of forcing mono", () => {
    expect(body(".samograph-landing")).not.toMatch(/font-family/);
  });

  it("lets the site footer inherit the app body font", () => {
    expect(body(".samograph-site-footer")).not.toMatch(/font-family/);
  });

  it("drops the landing heading override that forced mono over --font-display", () => {
    expect(css).not.toMatch(/:where\(\.samograph-landing\)\s*h1/);
  });

  it("keeps mono on the transcript instrument demo, declared not inherited", () => {
    expect(body(".samograph-instrument")).toMatch(
      /font-family\s*:\s*var\(--font-mono\)/,
    );
  });

  it("sizes the hero subhead from --text-base, above the 14px content floor", () => {
    expect(body(".samograph-landing-hero > p")).toMatch(
      /font-size\s*:\s*var\(--text-base\)/,
    );
  });

  it("sizes the hero secondary link and the wordmark from the token scale", () => {
    expect(body(".samograph-hero-secondary")).toMatch(
      /font-size\s*:\s*var\(--text-xs\)/,
    );
    expect(body(".samograph-brand")).toMatch(/font-size\s*:\s*var\(--text-md\)/);
  });
});
