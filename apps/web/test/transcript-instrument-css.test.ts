import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../app/globals.css"), "utf8");
const heading = "/* ===== Slice 3 — Transcript instrument (calls/[id], c/[token]) ===== */";

describe("Slice 3 transcript instrument CSS", () => {
  it("keeps the complete Slice 3 override section at the end of globals.css", () => {
    const section = css.slice(css.indexOf(heading));
    expect(css).toContain(heading);
    expect(section).toMatch(/\.samograph-instrument-lines\s*>\s*li\.samograph-transcript-row\s*\{/);
    expect(section).toMatch(
      /grid-template-columns\s*:\s*56px\s+19ch\s+fit-content\(22ch\)\s+minmax\(0\s*,\s*1fr\)/,
    );
    expect(section).toMatch(/\.samograph-line-time\s*\{[^}]*white-space\s*:\s*nowrap/s);
    expect(section).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*?\.samograph-instrument-lines\s*>\s*li\.samograph-transcript-row\s*\{[^}]*grid-template-columns\s*:\s*42px\s+10ch\s+fit-content\(22ch\)\s+minmax\(0\s*,\s*1fr\)/,
    );
    expect(section).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*?\.samograph-line-time\s*\{[^}]*white-space\s*:\s*normal[^}]*overflow-wrap\s*:\s*normal[^}]*word-break\s*:\s*normal/s,
    );
    expect(section).toMatch(/\.samograph-line-speaker\s*\{[^}]*min-width\s*:\s*8ch[^}]*white-space\s*:\s*nowrap[^}]*overflow\s*:\s*hidden[^}]*text-overflow\s*:\s*ellipsis/s);
    expect(section).toMatch(/\.samograph-transcript-row\s*>\s*\*\s*\{[^}]*min-width\s*:\s*0[^}]*overflow\s*:\s*hidden/s);
    expect(section).toMatch(/word-break\s*:\s*normal/);
    expect(section).toMatch(/overflow-wrap\s*:\s*anywhere/);
  });

  it("does not constrain transcript or call-view classes to 32rem", () => {
    const offending = [...css.matchAll(/([^{}]*\.samograph-(?:transcript|percall|call-view|share-page)[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => /max-width\s*:\s*(?:32rem|512px)/.test(body ?? ""));
    expect(offending).toEqual([]);
  });
});
