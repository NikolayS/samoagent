import { describe, expect, it } from "bun:test";
import { signSession } from "../auth/session.ts";
import { createCalendarHandler, type CalendarHttpService } from "./http.ts";

const now = Date.parse("2026-08-21T12:00:00.000Z");
const secret = "meetings-session-secret";
const cookie = `samo_session=${signSession({ userId: "user", tenantId: "tenant", iat: now }, secret)}`;

function handler(overrides: Partial<CalendarHttpService> = {}) {
  const service: CalendarHttpService = {
    tenantExists: async () => true,
    start: async () => ({ ok: false, code: "SAMO-CALENDAR-001" }),
    callback: async () => ({ ok: false, code: "SAMO-CALENDAR-004" }),
    status: async () => null,
    disconnect: async () => "not_connected",
    meetings: async () => ({ connection: null, meetings: [] }),
    ...overrides,
  };
  return createCalendarHandler(service, secret, () => now);
}

describe("GET /calendar/meetings", () => {
  it("returns the exact stable not-connected snapshot", async () => {
    const response = await handler()(new Request("http://api.test/calendar/meetings", { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connection_state: "not_connected", meetings: [], last_sync_at: null });
  });

  it("returns the exact broken snapshot and excludes cached meetings", async () => {
    const response = await handler({ meetings: async () => ({
      connection: { status: "broken", lastSyncAt: new Date("2026-08-20T18:35:00.000Z") },
      meetings: [{ id: "stale" } as any],
    }) })(new Request("http://api.test/calendar/meetings", { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connection_state: "broken", meetings: [], last_sync_at: "2026-08-20T18:35:00.000Z",
      error: { code: "SAMO-CALENDAR-005" },
    });
  });

  it("maps the exact connected wire shape and passes default/non-numeric/clamped limits", async () => {
    const limits: number[] = [];
    const meeting = {
      id: "e7f7fbcf-1f73-40d5-b730-f488104485e2", title: "Weekly planning",
      startsAt: new Date("2026-08-21T17:00:00.000Z"), endsAt: new Date("2026-08-21T17:30:00.000Z"),
      allDay: false, meetingUrl: "https://meet.google.com/abc-defg-hij" as string | null,
      meetingProvider: "google_meet" as const, organizerEmail: "owner@example.com" as string | null,
      attendeeResponse: "accepted" as const,
    };
    const h = handler({ meetings: async (_user, _tenant, limit) => {
      limits.push(limit);
      return { connection: { status: "connected", lastSyncAt: new Date("2026-08-20T18:35:00.000Z") }, meetings: [meeting] };
    } });
    const first = await h(new Request("http://api.test/calendar/meetings", { headers: { cookie } }));
    await h(new Request("http://api.test/calendar/meetings?limit=nope", { headers: { cookie } }));
    await h(new Request("http://api.test/calendar/meetings?limit=0", { headers: { cookie } }));
    await h(new Request("http://api.test/calendar/meetings?limit=999", { headers: { cookie } }));
    expect(limits).toEqual([20, 20, 1, 100]);
    expect(await first.json()).toEqual({
      connection_state: "connected", meetings: [{
        id: meeting.id, title: "Weekly planning", starts_at: "2026-08-21T17:00:00.000Z",
        ends_at: "2026-08-21T17:30:00.000Z", all_day: false,
        meeting_url: "https://meet.google.com/abc-defg-hij", meeting_provider: "google_meet",
        organizer_email: "owner@example.com", attendee_response: "accepted",
      }], last_sync_at: "2026-08-20T18:35:00.000Z",
    });
  });

  it("uses the tombstone-aware tenant gate and rejects unauthenticated reads", async () => {
    expect((await handler()(new Request("http://api.test/calendar/meetings"))).status).toBe(401);
    const dead = await handler({ tenantExists: async () => false })(new Request("http://api.test/calendar/meetings", { headers: { cookie } }));
    expect(dead.status).toBe(401);
    expect(await dead.json()).toMatchObject({ code: "SAMO-AUTH-005" });
  });
});
