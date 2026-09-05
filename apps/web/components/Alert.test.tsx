import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { installDom } from "../test/setup.tsx";

import { Alert } from "./Alert.tsx";

installDom();

/**
 * Design PR 8 — `DESIGN-MODEL.md` §4 "Alert / Banner", `PLAN.md` desktop PR 8.
 *
 * One Alert primitive replaces every ad-hoc alert/error box. The contract the
 * rest of the app depends on:
 *   - the announced role is decided by the tone, not by the caller;
 *   - the tone class stays `.samograph-alert--{info,success,warn,error}` so
 *     `test/alert-contrast.test.ts` and `test/greenroom-tokens.test.ts` keep
 *     pinning the same four CSS variants;
 *   - a body-only alert puts its copy on the ROOT element, so the existing
 *     `getByText(copy).getAttribute("role")` assertions across the suite keep
 *     resolving to the alert itself and not to a wrapper.
 */
describe("Alert (DESIGN-MODEL §4 Alert / Banner, PLAN PR 8)", () => {
  it("announces info and success as status, warning and danger as alert", () => {
    for (const [tone, role] of [
      ["info", "status"],
      ["success", "status"],
      ["warning", "alert"],
      ["danger", "alert"],
    ] as const) {
      const { getByRole, unmount } = render(<Alert tone={tone}>Copy for {tone}.</Alert>);
      expect(getByRole(role).getAttribute("role")).toBe(role);
      unmount();
    }
  });

  it("maps each tone onto the pinned CSS variant class", () => {
    for (const [tone, variant] of [
      ["info", "info"],
      ["success", "success"],
      ["warning", "warn"],
      ["danger", "error"],
    ] as const) {
      const { container, unmount } = render(<Alert tone={tone}>Copy.</Alert>);
      const root = container.firstElementChild!;
      expect(root.className).toContain(`samograph-alert samograph-alert--${variant}`);
      unmount();
    }
  });

  it("defaults to the info tone", () => {
    const { getByRole } = render(<Alert>Nothing is wrong.</Alert>);
    const root = getByRole("status");
    expect(root.className).toContain("samograph-alert samograph-alert--info");
  });

  it("puts body-only copy on the root element itself", () => {
    const { getByText } = render(<Alert tone="danger">Could not save.</Alert>);
    const found = getByText("Could not save.");
    expect(found.getAttribute("role")).toBe("alert");
    expect(found.className).toContain("samograph-alert samograph-alert--error");
  });

  it("renders an optional title above the body", () => {
    const { getByRole, getByText } = render(
      <Alert tone="warning" title="Calendar disconnected">
        Reconnect to keep auto-record running.
      </Alert>,
    );
    const root = getByRole("alert");
    const title = getByText("Calendar disconnected");
    expect(title.className).toBe("samograph-alert-title");
    expect(title.parentElement).toBe(root as HTMLElement);
    expect(root.textContent).toBe("Calendar disconnectedReconnect to keep auto-record running.");
  });

  it("renders an action slot after the copy", () => {
    const { getByRole } = render(
      <Alert tone="danger" action={<button type="button">Retry</button>}>
        Upload failed.
      </Alert>,
    );
    const root = getByRole("alert");
    const action = root.querySelector(".samograph-alert-action")!;
    expect(action.children.length).toBe(1);
    expect(action.firstElementChild!.tagName).toBe("BUTTON");
    expect(root.lastElementChild).toBe(action);
  });

  it("keeps the base classes first and appends the caller's className", () => {
    const { getByRole } = render(
      <Alert tone="danger" className="samograph-delete-error">
        Nope.
      </Alert>,
    );
    expect(getByRole("alert").className).toBe(
      "samograph-alert samograph-alert--error samograph-delete-error",
    );
  });

  it("renders as a <p> by default and honours the `as` element", () => {
    const { getByRole, unmount } = render(<Alert tone="danger">Boom.</Alert>);
    expect(getByRole("alert").tagName).toBe("P");
    unmount();
    const inline = render(<Alert tone="danger" as="span">Boom.</Alert>);
    expect(inline.getByRole("alert").tagName).toBe("SPAN");
  });
});
