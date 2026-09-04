import { describe, expect, it } from "bun:test";
import { readGlobalsCss } from "./helpers/stylesheet";

/**
 * Follow-up from the #280 review. An inline `SAMOGRAPH-WARNING` line is rendered
 * as a bare `<li>` inside `.samograph-instrument-lines`, so it matched only the
 * baseline rule
 *
 *   .samograph-instrument-lines li { grid-template-columns: 56px 82px 66px minmax(480px, 1fr) }
 *
 * — a 480px minimum utterance column plus three fixed columns and three 14px
 * gaps, i.e. ~684px of intrinsic minimum width. Every transcript row that is a
 * real utterance opts out of that grid via `.samograph-transcript-row`; the
 * warning row did not, so the whole transcript scrolled horizontally at 390px
 * the moment a warning existed. The warning row is one full-width cell instead.
 */
const css = readGlobalsCss();

/**
 * The rule body for `selector`, or `null` when the sheet does not declare it.
 *
 * Anchored on `selector` followed by `{` (#288 review NB1). A bare `indexOf`
 * matched a PREFIX, so renaming the class to `.samograph-warning-row-2` — which
 * detaches every assertion below from the markup — still found the rule and the
 * guard stayed green. `ruleIn` takes the sheet as an argument so the anchoring
 * itself is testable against a fixture.
 */
function ruleIn(sheet: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(sheet);
  return match ? match[0] : null;
}

function rule(selector: string): string {
  const found = ruleIn(css, selector);
  expect(found).not.toBeNull();
  return found as string;
}

describe("SAMOGRAPH-WARNING transcript row CSS", () => {
  const selector = ".samograph-instrument-lines > li.samograph-warning-row";

  it("takes the warning row off the fixed four-column transcript grid", () => {
    expect(rule(selector)).toMatch(/display\s*:\s*block/);
  });

  it("never re-declares a fixed-width column track for the warning row", () => {
    expect(rule(selector)).not.toMatch(/grid-template-columns/);
    expect(rule(selector)).not.toMatch(/minmax\(480px/);
  });

  it("applies at every viewport, not only inside a media query", () => {
    // Everything before the rule must have balanced braces — a rule nested in an
    // `@media` block would leave one open.
    const head = css.slice(0, css.indexOf(selector));
    const depth = head.split("{").length - head.split("}").length;
    expect(depth).toBe(0);
  });

  it("drops the tally-rail counter the instrument hides on every other row", () => {
    expect(css).toMatch(
      /\.samograph-percall \.samograph-warning-row::before,\s*\.samograph-percall \.samograph-warning-row::after\s*\{\s*content\s*:\s*none;\s*\}/,
    );
  });

  it("keeps the warn-toned system-note styling on the line itself", () => {
    expect(rule(".samograph-warning-line")).toMatch(/color\s*:\s*var\(--warn\)/);
  });
});

describe("the guard's own selector anchoring (#288 review NB1)", () => {
  const renamed = ".samograph-instrument-lines > li.samograph-warning-row-2 { display: block; }";

  it("does not match a rule whose class merely STARTS with the selector", () => {
    expect(ruleIn(renamed, ".samograph-instrument-lines > li.samograph-warning-row")).toBeNull();
  });

  it("still matches the real selector, whitespace-insensitively", () => {
    expect(
      ruleIn(".samograph-instrument-lines>li.samograph-warning-row{display:block}", ".samograph-instrument-lines > li.samograph-warning-row"),
    ).not.toBeNull();
  });
});
