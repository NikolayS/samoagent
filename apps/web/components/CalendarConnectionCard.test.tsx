import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage.tsx";
import { CalendarConnectionCard } from "./CalendarConnectionCard.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import { installDom } from "../test/setup.tsx";
installDom();

describe("Settings Calendar connection", () => {
  it("formats last sync with the supplied locale and time zone", async () => {
    const client = createFakeAppApiClient({ seedCalendarStatus: { provider: "google", state: "connected", connectedAt: "2026-08-20T18:30:00Z", lastSyncAt: "2026-08-20T18:35:00Z", lastSyncErrorAt: null } });
    const view = render(<CalendarConnectionCard client={client} onAuthFailure={() => {}} locale="en-US" timeZone="UTC" />);

    expect((await view.findByText(/^Last synced /)).textContent).toBe("Last synced 8/20/2026, 6:35:00 PM");
  });

  it.each([
    "javascript:alert(1)",
    "https://evil.example/o/oauth2/v2/auth",
    "http://accounts.google.com/o/oauth2/v2/auth",
  ])("rejects an unsafe calendar authorization URL: %s", async (authorizationUrl) => {
    const assign = mock(() => {});
    Object.defineProperty(window.location, "assign", { configurable: true, value: assign });
    const client = createFakeAppApiClient({ seedCalendarStatus: { provider: "google", state: "not_connected", connectedAt: null, lastSyncAt: null, lastSyncErrorAt: null } });
    client.startCalendarConnect = async () => ({ authorizationUrl });
    const view = render(<CalendarConnectionCard client={client} onAuthFailure={() => {}} />);

    fireEvent.click(await view.findByRole("button", { name: "Connect Google Calendar" }));

    expect((await view.findByRole("status")).textContent).toBe("Something went wrong connecting Google Calendar.");
    expect(assign).not.toHaveBeenCalled();
    view.unmount();
  });

  it("navigates to an exact Google Accounts HTTPS authorization URL", async () => {
    const assign = mock(() => {});
    Object.defineProperty(window.location, "assign", { configurable: true, value: assign });
    const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&scope=calendar";
    const client = createFakeAppApiClient({ seedCalendarStatus: { provider: "google", state: "not_connected", connectedAt: null, lastSyncAt: null, lastSyncErrorAt: null } });
    client.startCalendarConnect = async () => ({ authorizationUrl });
    const view = render(<CalendarConnectionCard client={client} onAuthFailure={() => {}} />);

    fireEvent.click(await view.findByRole("button", { name: "Connect Google Calendar" }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
    view.unmount();
  });

  it("fails closed when calendar capability is absent", async () => {
    const view = render(<SettingsPage client={createFakeAppApiClient()} redirect={() => {}} />);
    await view.findByRole("heading", { name: "Settings" });
    expect(view.queryByRole("region", { name: "Google Calendar" })).toBeNull();
  });

  it("renders status and keeps calendar controls out of settings PUT", async () => {
    const client = createFakeAppApiClient({ googleCalendarEnabled: true, seedCalendarStatus: { provider: "google", state: "not_connected", connectedAt: null, lastSyncAt: null, lastSyncErrorAt: null } });
    const view = render(<SettingsPage client={client} redirect={() => {}} />);
    expect(await view.findByText("Show upcoming meetings from your calendar.")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Save settings" }));
    await view.findByText("Settings saved.");
    expect(client.requests.find((r) => r.path === "/settings" && r.method === "PUT")?.body).not.toHaveProperty("calendar");
  });

  it("disconnects only after confirmation and refreshes to not connected", async () => {
    const client = createFakeAppApiClient({ googleCalendarEnabled: true, seedCalendarStatus: { provider: "google", state: "connected", connectedAt: "2026-08-20T18:30:00Z", lastSyncAt: "2026-08-20T18:35:00Z", lastSyncErrorAt: null } });
    window.confirm = () => true;
    const view = render(<SettingsPage client={client} redirect={() => {}} />);
    fireEvent.click(await view.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(client.requests.some((r) => r.path === "/calendar/connection" && r.method === "DELETE")).toBe(true));
    expect(await view.findByRole("button", { name: "Connect Google Calendar" })).toBeDefined();
  });

  it("clears a failed reconnect error when disconnect succeeds", async () => {
    const client = createFakeAppApiClient({
      seedCalendarStatus: { provider: "google", state: "broken", connectedAt: "2026-08-20T18:30:00Z", lastSyncAt: null, lastSyncErrorAt: "2026-08-20T18:35:00Z" },
      failStartCalendarConnectWith: { code: "unexpected", message: "failed" },
    });
    window.confirm = () => true;
    const view = render(<CalendarConnectionCard client={client} onAuthFailure={() => {}} />);

    fireEvent.click(await view.findByRole("button", { name: "Reconnect" }));
    expect((await view.findByRole("status")).textContent).toBe("Google Calendar couldn’t be connected. Please try again.");
    fireEvent.click(view.getByRole("button", { name: "Disconnect" }));

    expect(await view.findByRole("button", { name: "Connect Google Calendar" })).toBeDefined();
    expect(view.queryByText("Google Calendar couldn’t be connected. Please try again.")).toBeNull();
  });
});
