import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "..");
const css = readFileSync(join(web, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const defined = new Set([...css.matchAll(/\.((?:samograph-)[\w-]+)/g)].map((m) => m[1]));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tsxFiles(join(dir, entry.name)) : entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [join(dir, entry.name)] : [],
  );
}

const source = [...tsxFiles(join(web, "components")), ...tsxFiles(join(web, "app"))]
  .map((file) => readFileSync(file, "utf8")).join("\n");
const used = new Set<string>();
for (const match of source.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
  for (const token of match[1].split(/\s+/)) if (/^samograph-[\w-]+$/.test(token)) used.add(token);
}
for (const match of source.matchAll(/["'`]((?:samograph-)[\w-]+)["'`]/g)) used.add(match[1]);
if (source.includes("samograph-call-cta-${kind}")) {
  used.add("samograph-call-cta-live"); used.add("samograph-call-cta-open"); used.add("samograph-call-cta-retry");
}

// shrinks each slice
const ALLOWLIST = new Set([
  "samograph-field", "samograph-field-hint", "samograph-signin", "samograph-signin-methods",
  "samograph-signin-method", "samograph-signin-method-name", "samograph-signin-method-state",
  "samograph-share-modal", "samograph-share-header", "samograph-share-actions", "samograph-share-url",
  "samograph-share-blurb", "samograph-share-active", "samograph-share-rotated", "samograph-share-page",
  "samograph-danger-zone", "samograph-danger-zone-title", "samograph-danger-confirm", "samograph-danger-delete",
  "samograph-danger-error", "samograph-delete-confirm", "samograph-delete-error", "samograph-call-item",
  "samograph-call-cta-text", "samograph-line", "samograph-download-transcript-speech", "samograph-theme",
  "samograph-call-cta-open",
]);

describe("samograph CSS class coverage", () => {
  it("styles every used class unless it is explicitly deferred", () => {
    const missing = [...used].filter((name) => !defined.has(name) && !ALLOWLIST.has(name)).sort();
    expect(missing).toEqual([]);
  });
});
