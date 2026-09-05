import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { PageSkeleton } from "./PageSkeleton.tsx";
import { installDom } from "../test/setup.tsx";

installDom();

describe("PageSkeleton", () => {
  it("renders an accessible loading status and variant classes", () => {
    const { getByRole, rerender } = render(<PageSkeleton variant="form" />);
    const loading = getByRole("status", { name: "Loading" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.className).toBe("samograph-skeleton samograph-skeleton--form");
    expect(loading.textContent).toBe("Loading…");
    expect(loading.querySelector(".samograph-visually-hidden")?.textContent).toBe("Loading…");
    rerender(<PageSkeleton variant="page" />);
    expect(getByRole("status", { name: "Loading" }).className).toBe(
      "samograph-skeleton samograph-skeleton--page",
    );
  });

  /**
   * Design PR 10. `form`/`page` are three anonymous bars — right for a card,
   * useless as a stand-in for a settings form or a call list, which is why
   * those two loads shipped sentences instead. `panel` and `row` carry the
   * SHAPE of what is arriving (DESIGN-MODEL §4 Skeleton, §1.4), and the shape
   * is page-specific on purpose: /settings is sections of fields above a
   * savebar, /dashboard is a hero form, an upcoming block, two labelled lists
   * and a danger zone. The measured heights are in the PR body.
   */
  const classes = (el: Element) => [...el.children].map((c) => c.className);

  it("shapes the panel variant like the settings page", () => {
    const { getByRole } = render(<PageSkeleton variant="panel" />);
    const loading = getByRole("status", { name: "Loading" });
    expect(loading.className).toBe("samograph-skeleton samograph-skeleton--panel");
    expect(classes(loading)).toEqual([
      "samograph-visually-hidden",
      "samograph-skeleton-bar samograph-skeleton-bar--title",
      "samograph-skeleton-group",
      "samograph-skeleton-group",
      "samograph-skeleton-group",
      "samograph-skeleton-bar samograph-skeleton-bar--savebar",
    ]);
    const [transcription, inCall, account] = [...loading.querySelectorAll(".samograph-skeleton-group")];
    // Transcription: preset + hint, the keyterms textarea, language.
    expect(classes(transcription!)).toEqual([
      "samograph-skeleton-bar samograph-skeleton-bar--head",
      "samograph-skeleton-field",
      "samograph-skeleton-field",
      "samograph-skeleton-field",
    ]);
    expect(classes(transcription!.querySelectorAll(".samograph-skeleton-field")[0]!)).toEqual([
      "samograph-skeleton-bar samograph-skeleton-bar--label",
      "samograph-skeleton-bar samograph-skeleton-bar--control",
      "samograph-skeleton-bar",
    ]);
    expect(classes(transcription!.querySelectorAll(".samograph-skeleton-field")[1]!)).toEqual([
      "samograph-skeleton-bar samograph-skeleton-bar--label",
      "samograph-skeleton-bar samograph-skeleton-bar--area",
    ]);
    // In-call: one field. Account: a heading and four lines.
    expect(inCall!.querySelectorAll(".samograph-skeleton-field").length).toBe(1);
    expect(account!.querySelectorAll(".samograph-skeleton-bar").length).toBe(5);
  });

  it("shapes the row variant like the dashboard", () => {
    const { getByRole } = render(<PageSkeleton variant="row" count={3} />);
    const loading = getByRole("status", { name: "Loading" });
    expect(loading.className).toBe("samograph-skeleton samograph-skeleton--row");
    expect(classes(loading)).toEqual([
      "samograph-visually-hidden",
      "samograph-skeleton-bar samograph-skeleton-bar--title",
      "samograph-skeleton-bar samograph-skeleton-bar--hero",
      "samograph-skeleton-bar samograph-skeleton-bar--block",
      // Active calls
      "samograph-skeleton-bar samograph-skeleton-bar--head",
      "samograph-skeleton-bar samograph-skeleton-bar--row",
      // Past calls — the remaining rows
      "samograph-skeleton-bar samograph-skeleton-bar--head",
      "samograph-skeleton-bar samograph-skeleton-bar--row",
      "samograph-skeleton-bar samograph-skeleton-bar--row",
      // Danger zone
      "samograph-skeleton-bar samograph-skeleton-bar--head",
      "samograph-skeleton-bar samograph-skeleton-bar--para",
      "samograph-skeleton-field",
      "samograph-skeleton-bar samograph-skeleton-bar--control",
    ]);
  });

  it("keeps at least one row in each list however low count goes", () => {
    const { getByRole } = render(<PageSkeleton variant="row" count={0} />);
    expect(getByRole("status", { name: "Loading" }).querySelectorAll(".samograph-skeleton-bar--row").length).toBe(2);
  });

  it("hides every bar from assistive tech — the wrapper is the one announcement", () => {
    const { getByRole } = render(<PageSkeleton variant="panel" />);
    const loading = getByRole("status", { name: "Loading" });
    for (const bar of loading.querySelectorAll(".samograph-skeleton-bar")) {
      expect(bar.getAttribute("aria-hidden")).toBe("true");
    }
    expect(loading.textContent).toBe("Loading…");
  });

  it("replaces literal paragraph Suspense fallbacks on app pages", () => {
    const app = join(import.meta.dir, "../app");
    for (const file of ["auth/page.tsx", "auth/callback/page.tsx", "dashboard/page.tsx", "calls/[id]/page.tsx"]) {
      expect(readFileSync(join(app, file), "utf8")).not.toContain("<p>Loading…</p>");
    }
  });
});
