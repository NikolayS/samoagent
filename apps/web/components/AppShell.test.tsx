import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { AppShell } from "./AppShell.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import { installDom } from "../test/setup.tsx";

let pathname = "/dashboard";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

installDom();
const redirect = () => {};

describe("AppShell", () => {
  it("renders the signed-in shell landmarks, navigation, controls and account", async () => {
    const client = createFakeAppApiClient({ seedAccountEmail: "person@example.com" });
    const { container, findByText, getAllByRole, getByRole } = render(
      <AppShell client={client} redirect={redirect}><p>Page content</p></AppShell>,
    );
    expect(getByRole("banner")).toBeDefined();
    expect(getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
    expect(getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBeNull();
    expect(getByRole("link", { name: "samograph" }).getAttribute("href")).toBe("/dashboard");
    expect(getByRole("group", { name: "Theme" })).toBeDefined();
    expect(getByRole("button", { name: "Log out" })).toBeDefined();
    expect(await findByText("Signed in as person@example.com")).toBeDefined();
    const mains = getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0].id).toBe("main");
    expect(mains[0].classList.contains("samograph-page")).toBe(true);
    expect(mains[0].textContent).toContain("Page content");
    const skip = getByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    expect(container.querySelectorAll('a[href], button:not([disabled]), input, select, textarea')[0]).toBe(skip);
  });

  it("renders the minimal public shell and appends pageClassName", () => {
    const client = createFakeAppApiClient();
    const { getByRole, queryByRole } = render(
      <AppShell client={client} redirect={redirect} variant="public" pageClassName="samograph-page--form"><span>Public child</span></AppShell>,
    );
    expect(queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(queryByRole("link", { name: "Settings" })).toBeNull();
    expect(queryByRole("button", { name: "Log out" })).toBeNull();
    expect(getByRole("link", { name: "samograph" })).toBeDefined();
    expect(getByRole("link", { name: "samograph" }).getAttribute("href")).toBe("/");
    expect(getByRole("group", { name: "Theme" })).toBeDefined();
    const main = getByRole("main");
    expect(main.className.split(/\s+/)).toEqual(["samograph-page", "samograph-page--form"]);
    expect(main.textContent).toContain("Public child");
  });

  it("marks Settings as the current route", () => {
    pathname = "/settings";
    const client = createFakeAppApiClient();
    const { getByRole } = render(<AppShell client={client}><p>Settings</p></AppShell>);
    expect(getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
    expect(getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    pathname = "/dashboard";
  });

  it("logs out through the shell and redirects to /auth", async () => {
    const client = createFakeAppApiClient();
    const seen: string[] = [];
    const { getByRole } = render(
      <AppShell client={client} redirect={(path) => seen.push(path)}><p>Page content</p></AppShell>,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Log out" }));
    });

    expect(client.requests).toContainEqual({ path: "/auth/logout", method: "POST", body: {} });
    expect(seen).toEqual(["/auth"]);
  });

  it("opens keyboard shortcut help only in the app variant and closes it with Escape", () => {
    const client = createFakeAppApiClient();
    const app = render(<AppShell client={client}><p>App</p></AppShell>);
    fireEvent.keyDown(document, { key: "?", shiftKey: true });
    expect(app.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(app.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
    app.unmount();

    const publicView = render(<AppShell client={client} variant="public"><p>Public</p></AppShell>);
    fireEvent.keyDown(document, { key: "?", shiftKey: true });
    expect(publicView.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
  });
});
