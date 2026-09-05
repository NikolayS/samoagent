/**
 * One reader for the app stylesheet (PLAN.md desktop PR 14).
 *
 * `app/globals.css` used to be one 2830-line file and ~20 guard tests read it
 * with `readFileSync(".../app/globals.css")`. PR 14 split it by CONCERN into
 * `app/styles/*.css`, with `globals.css` kept as the single build entry that
 * `@import`s them **in the original source order** — the cascade is source
 * order, so the import list IS the sheet.
 *
 * Every guard therefore reads the stylesheet through `readGlobalsCss()` instead
 * of the file, which resolves those `@import`s and returns the concatenated
 * sheet: each guard keeps its assertions unchanged, including the positional
 * ones (`test/transcript-instrument-css.test.ts` slices from the Slice 3
 * heading "to the end of the sheet").
 *
 * `test/stylesheet-split.test.ts` pins the invariant this helper depends on:
 * the resolved sheet, minified, equals a committed snapshot of the pre-split
 * `globals.css`. A reordered import list fails that test.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** `@import "…";` on its own line — the only import form globals.css uses. */
const IMPORT_LINE = /^@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;[^\S\n]*\n?/gm;

export const GLOBALS_CSS = resolve(import.meta.dir, "../../app/globals.css");
export const STYLES_DIR = resolve(import.meta.dir, "../../app/styles");

/**
 * Read `entry` and inline every `@import` it declares, depth-first, in
 * declaration order. The result is byte-equivalent to the sheet the browser
 * builds from the same imports (which is what the cascade sees).
 */
export function resolveCss(entry: string, seen: string[] = []): string {
  const path = resolve(entry);
  if (seen.includes(path)) {
    throw new Error(`circular @import: ${[...seen, path].join(" -> ")}`);
  }
  const source = readFileSync(path, "utf8");
  return source.replace(IMPORT_LINE, (_match, specifier: string) =>
    resolveCss(join(dirname(path), specifier), [...seen, path]),
  );
}

/** The whole app stylesheet, imports resolved, in cascade order. */
export function readGlobalsCss(): string {
  return resolveCss(GLOBALS_CSS);
}

/** The stylesheet with comments stripped — what most guards assert against. */
export function readGlobalsCssNoComments(): string {
  return stripComments(readGlobalsCss());
}

/**
 * Strip `/* … *\/` comments — and ONLY comments.
 *
 * A bare `css.replace(/\/\*[\s\S]*?\*\//g, "")` is wrong: `/*` has no meaning
 * inside a string or an unquoted `url(…)`, so a value like
 * `content: "/* not a comment *\/"` or `url(/img/a*\/b.png)` makes that regex
 * eat everything up to the next real `*\/` — silently deleting live rules from
 * whatever the caller then asserts on. This is a one-pass tokenizer instead: it
 * tracks quoted strings (with backslash escapes) and unquoted `url(` values, and
 * only recognises a comment outside both.
 */
export function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < css.length) {
        out += css[i];
        if (css[i] === "\\") {
          out += css[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (css[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // Unquoted url(…) — the one CSS token where `/` is ordinary text. A quoted
    // url("…") is already covered by the string branch above.
    if (
      ch === "(" &&
      out.slice(-3).toLowerCase() === "url" &&
      !/[\w-]/.test(out.slice(-4, -3)) &&
      css[i + 1] !== '"' &&
      css[i + 1] !== "'"
    ) {
      const end = css.indexOf(")", i + 1);
      const stop = end === -1 ? css.length : end + 1;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Comment-free, whitespace-collapsed — a shape-insensitive diff target. */
export function minifyCss(css: string): string {
  return stripComments(css).replace(/\s+/g, " ").trim();
}

/** The `@import` specifiers declared by `globals.css`, in order. */
export function globalsImportOrder(): string[] {
  const source = readFileSync(GLOBALS_CSS, "utf8");
  return [...source.matchAll(IMPORT_LINE)].map(([, specifier]) => specifier);
}
