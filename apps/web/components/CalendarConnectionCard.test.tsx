import { describe, expect, it } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import { installDom } from "../test/setup.tsx";
installDom();

describe("Settings Calendar connection", () => {
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
});
