import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { Dashboard } from "./Dashboard.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import { installDom } from "../test/setup.tsx";
installDom();

describe("Dashboard upcoming meetings", () => {
  it("renders meetings independently with safe Join links and no Join for declined/unlinked rows", async () => {
    const client = createFakeAppApiClient({ seedCalendarMeetings: { connectionState: "connected", lastSyncAt: null, meetings: [
      { id: "1", title: "Planning", startsAt: "2026-08-21T17:00:00Z", endsAt: "2026-08-21T17:30:00Z", allDay: false, meetingUrl: "https://meet.google.com/abc-defg-hij", meetingProvider: "google_meet", organizerEmail: null, attendeeResponse: "accepted" },
      { id: "2", title: "Declined", startsAt: "2026-08-21T18:00:00Z", endsAt: "2026-08-21T18:30:00Z", allDay: false, meetingUrl: "https://zoom.us/j/2", meetingProvider: "zoom", organizerEmail: null, attendeeResponse: "declined" },
      { id: "3", title: "No link", startsAt: "2026-08-21T19:00:00Z", endsAt: "2026-08-21T20:00:00Z", allDay: false, meetingUrl: null, meetingProvider: null, organizerEmail: null, attendeeResponse: null },
    ] } });
    const view = render(<Dashboard client={client} redirect={() => {}} />);
    const join = await view.findByRole("link", { name: "Join Planning" });
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toBe("noopener noreferrer");
    expect(view.queryByRole("link", { name: /Join Declined/ })).toBeNull();
    expect(await view.findByText("No link")).toBeDefined();
    expect(view.getAllByText("Declined")[0]?.closest("li")?.getAttribute("data-declined")).toBe("true");
  });

  it("calendar failure never hides existing calls", async () => {
    const client = createFakeAppApiClient({ seedCalls: [{ id: "c", meetingUrl: "https://zoom.us/j/9", provider: "zoom", status: "PENDING" }], failListCalendarMeetingsWith: { code: "SAMO-CALENDAR-006", message: "no" } });
    const view = render(<Dashboard client={client} redirect={() => {}} />);
    expect(await view.findByText("https://zoom.us/j/9")).toBeDefined();
    expect(await view.findByText("Upcoming meetings couldn’t be refreshed. Please try again.")).toBeDefined();
  });
});
