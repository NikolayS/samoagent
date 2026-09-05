/**
 * PLAN.md desktop PR 14 — "split globals.css by concern".
 *
 * The split is a PURE MOVE: `app/globals.css` becomes an import manifest and
 * every rule moves, unedited, into `app/styles/<concern>.css`. The only thing
 * that can silently break is the CASCADE: CSS resolves same-specificity
 * conflicts by SOURCE ORDER, so re-grouping rules into a tidier order than the
 * original file had would repaint the app without changing a single
 * declaration.
 *
 * This guard makes that impossible to land unnoticed. It concatenates the
 * imports in declared order and compares the result, minified, with
 * `__fixtures__/globals.pre-split.min.css` — a committed snapshot of the
 * pre-split sheet (`73216f0:apps/web/app/globals.css`, 2830 lines — i.e. AFTER
 * #305's canonical breakpoints landed on the base). Whitespace and comments are
 * normalised away; rule order is not. Swap two `@import` lines and this test
 * fails.
 *
 * DESIGN-MODEL.md §1 principle 1 ("one source of truth") — the manifest is
 * that source of truth for order, and `test/helpers/stylesheet.ts` is the one
 * reader every other CSS guard goes through.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GLOBALS_CSS,
  STYLES_DIR,
  globalsImportOrder,
  minifyCss,
  readGlobalsCss,
  stripComments,
} from "./helpers/stylesheet";

const snapshot = readFileSync(
  join(import.meta.dir, "__fixtures__/globals.pre-split.min.css"),
  "utf8",
).trim();

describe("globals.css is an import manifest", () => {
  it("declares nothing but @imports of ./styles/*.css", () => {
    const body = stripComments(readFileSync(GLOBALS_CSS, "utf8"))
      .replace(/^@import\s+["'][^"']+["']\s*;[^\S\n]*$/gm, "")
      .trim();
    expect(body).toBe("");
  });

  it("imports every file in app/styles exactly once", () => {
    const onDisk = readdirSync(STYLES_DIR)
      .filter((name) => name.endsWith(".css"))
      .sort();
    const imported = globalsImportOrder().map((specifier) =>
      specifier.replace("./styles/", ""),
    );
    expect([...imported].sort()).toEqual(onDisk);
    expect(new Set(imported).size).toBe(imported.length);
  });

  it("keeps the concern files flat — no nested @import", () => {
    const nested = readdirSync(STYLES_DIR)
      .filter((name) => name.endsWith(".css"))
      .filter((name) => /@import/.test(readFileSync(join(STYLES_DIR, name), "utf8")));
    expect(nested).toEqual([]);
  });
});

describe("order-preserving split", () => {
  it("concatenates to the pre-split sheet, rule for rule, in order", () => {
    expect(minifyCss(readGlobalsCss())).toBe(snapshot);
  });

  it("still ends with the Slice 3 transcript-instrument overrides", () => {
    // The one block whose position IS its contract: it overrides the call-view
    // rules declared earlier in the sheet at equal specificity.
    const resolved = readGlobalsCss();
    const heading = "/* ===== Slice 3 — Transcript instrument (calls/[id], c/[token]) ===== */";
    expect(resolved).toContain(heading);
    expect(globalsImportOrder().at(-1)).toBe("./styles/instrument.css");
    expect(resolved.slice(resolved.indexOf(heading))).toContain(".samograph-instrument-lines");
  });

  it("starts with the token registry, so every var() below resolves", () => {
    expect(globalsImportOrder()[0]).toBe("./styles/tokens.css");
  });
});

/**
 * The snapshot comparison is only as trustworthy as the minifier underneath it.
 * A naive `replace(/\/\*[\s\S]*?\*\//g, "")` treats `/*` inside a string or an
 * unquoted `url()` as the start of a comment and deletes everything up to the
 * next `*​/` — which would silently drop live rules from BOTH sides of the
 * comparison, and from every guard that reads `stripComments`/`minifyCss`.
 */
describe("stripComments only strips comments", () => {
  it("removes a real comment", () => {
    expect(minifyCss("a { color: red; /* note */ }")).toBe("a { color: red; }");
  });

  it("keeps a /* … */ that lives inside a quoted string", () => {
    const css = `.a::before { content: "/* not a comment */"; }\n.b { color: red; }`;
    expect(minifyCss(css)).toBe(`.a::before { content: "/* not a comment */"; } .b { color: red; }`);
  });

  it("keeps a /* … */ that lives inside an unquoted url()", () => {
    const css = `.a { background: url(/img/a/*x*/b.png); }\n.b { color: red; }`;
    expect(minifyCss(css)).toBe(`.a { background: url(/img/a/*x*/b.png); } .b { color: red; }`);
  });

  it("does not let an escaped quote end the string early", () => {
    const css = `.a::after { content: "he said \\"/* hi */\\""; }\n.b { color: red; }`;
    expect(minifyCss(css)).toContain(".b { color: red; }");
    expect(minifyCss(css)).toContain("/* hi */");
  });

  it("still strips a comment that follows a string on the same line", () => {
    expect(minifyCss(`.a { content: "x"; /* gone */ color: red; }`)).toBe(
      `.a { content: "x"; color: red; }`,
    );
  });
});
