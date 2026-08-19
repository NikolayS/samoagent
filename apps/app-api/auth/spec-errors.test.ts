import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_ERRORS } from "./errors.ts";
import type { AuthErrorCode } from "./types.ts";

/**
 * The SPEC §5.16 table is the THIRD copy of the auth error copy (issue #225).
 *
 * `apps/app-api/auth/errors.ts` and `apps/web/lib/authErrors.ts` are already
 * asserted byte-for-byte against each other, because a silent edit to either is
 * a user-visible drift. Folding SPEC amendment S5-1 back into
 * `blueprints/samograph-dev/SPEC.md` adds a third place the same sentences live
 * — and a doc copy that quietly diverges from the shipped string is exactly the
 * drift the SPEC exists to prevent, only harder to notice because nothing runs
 * it. So the doc is pinned by a test too: the §5.16 table is parsed as data and
 * every `SAMO-AUTH-*` row is compared against `AUTH_ERRORS`.
 *
 * DOC-ONLY and DOM-free: it reads the markdown as text. It asserts the message
 * column, not the prose around it.
 */

const SPEC = readFileSync(
  join(import.meta.dir, "..", "..", "..", "blueprints", "samograph-dev", "SPEC.md"),
  "utf8",
);

/** `| \`SAMO-AUTH-006\` | … | … | "copy" | … |` → `["SAMO-AUTH-006", "copy"]`. */
function specAuthRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of SPEC.split("\n")) {
    const match = /^\| `(SAMO-AUTH-[0-9]{3})` \|/.exec(line);
    if (!match) continue;
    // Cells: ["", code, status, meaning, message, behavior, ""].
    const cells = line.split("|").map((c) => c.trim());
    const message = cells[4] ?? "";
    expect(message.startsWith('"') && message.endsWith('"')).toBe(true);
    rows.set(match[1]!, message.slice(1, -1));
  }
  return rows;
}

describe("SPEC §5.16 error table (S5-1 fold-in, #225)", () => {
  test("documents every SAMO-AUTH code that ships, exactly once", () => {
    const documented = specAuthRows();
    expect([...documented.keys()].sort()).toEqual(Object.keys(AUTH_ERRORS).sort());
  });

  test("every documented message is byte-identical to AUTH_ERRORS", () => {
    const documented = specAuthRows();
    for (const [code, message] of documented) {
      expect(message).toBe(AUTH_ERRORS[code as AuthErrorCode].message);
    }
  });
});
