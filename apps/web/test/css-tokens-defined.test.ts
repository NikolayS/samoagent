import { describe, expect, it } from "bun:test";
import { readGlobalsCss } from "./helpers/stylesheet";

// A `var(--x)` with no definition and no fallback is invalid at computed-value
// time, which drops the WHOLE declaration — silently. That is how the prod
// serif bug happened (#255), so the stylesheet is guarded against a repeat.
const css = readGlobalsCss().replace(/\/\*[\s\S]*?\*\//g, "");

// Injected at runtime by next/font onto <html>; always referenced WITH a fallback.
const RUNTIME = new Set(["--font-inter", "--font-jetbrains"]);

const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
// `var(--x)` with no `,` fallback before the closing paren.
const usedWithoutFallback = [...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map(([, name]) => name);

describe("globals.css custom properties", () => {
  it("defines every token referenced without a fallback", () => {
    const undefinedTokens = [...new Set(usedWithoutFallback)]
      .filter((name) => !defined.has(name) && !RUNTIME.has(name))
      .sort();
    expect(undefinedTokens).toEqual([]);
  });

  it("only lets the next/font runtime tokens go undefined, and only with a fallback", () => {
    for (const name of RUNTIME) {
      expect(defined.has(name)).toBe(false);
      expect(css).toMatch(new RegExp(`var\\(${name},`));
    }
  });
});
