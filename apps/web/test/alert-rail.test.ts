import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Design PR 8 — `docs/design/DESIGN-MODEL.md` §4 "Alert / Banner":
 *
 *   tone   border-left: 3px solid <tone>; border: 1px solid --line;
 *          background: 6% tint of <tone>
 *          text: var(--ink) — NOT the tone colour. The tone lives in the rail.
 *
 * `test/alert-contrast.test.ts` pins the four variant NAMES and the copy/tint
 * contrast; this guard pins the geometry and the exact rail token per tone, so
 * the tone can never quietly fall back into the copy colour again.
 */
const web = join(import.meta.dir, "..");
const css = readFileSync(join(web, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1];
}

function decl(selector: string, property: string): string | undefined {
  return body(selector)
    .match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`))?.[1]
    ?.trim();
}

describe("alert tone rail (DESIGN-MODEL §4 Alert / Banner)", () => {
  it("declares a 3px rail token in :root", () => {
    expect(css.match(/--alert-rail\s*:\s*([^;]+);/)?.[1].trim()).toBe("3px");
  });

  it("draws the rail on the inline start edge from the tone token", () => {
    expect(decl(".samograph-alert", "border")).toBe("1px solid var(--line)");
    expect(decl(".samograph-alert", "border-inline-start")).toBe(
      "var(--alert-rail) solid var(--alert-tone)",
    );
    expect(decl(".samograph-alert", "border-radius")).toBe("var(--radius-control)");
    expect(decl(".samograph-alert", "padding")).toBe("var(--space-3) var(--space-4)");
  });

  it("gives every tone an ink copy colour and its own rail token", () => {
    for (const [variant, tone] of [
      ["info", "var(--ink-soft)"],
      ["success", "var(--success-ink)"],
      ["warn", "var(--warn)"],
      ["error", "var(--crit)"],
    ] as const) {
      const selector = `.samograph-alert--${variant}`;
      expect(decl(selector, "--alert-tone")).toBe(tone);
      expect(decl(selector, "color")).toBe("var(--ink)");
      expect(decl(selector, "background")).toBe(
        `color-mix(in srgb, ${variant === "info" ? "var(--ink)" : tone} 8%, var(--surface))`,
      );
    }
  });

  it("styles the title and the action slot", () => {
    expect(decl(".samograph-alert-title", "font-weight")).toBe("600");
    expect(decl(".samograph-alert-action", "margin-inline-start")).toBe("auto");
  });
});

describe("Alert adoption (PLAN PR 8)", () => {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) files.push(path);
    }
  };
  visit(join(web, "components"));
  visit(join(web, "app"));

  it("has no hand-written samograph-alert className left outside Alert.tsx", () => {
    const offenders = files
      .filter((file) => !file.endsWith("/Alert.tsx"))
      .filter((file) => /samograph-alert/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(web.length + 1))
      .sort();
    expect(offenders).toEqual([]);
  });
});
