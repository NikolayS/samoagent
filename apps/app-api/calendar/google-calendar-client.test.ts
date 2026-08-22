import { describe, expect, it } from "bun:test";
import { FakeGoogleCalendar } from "../../../packages/test-fakes/google-calendar/index.ts";
import { GoogleCalendarClient, GoogleCalendarFailure } from "./google-calendar-client.ts";

describe("GoogleCalendarClient", () => {
  it("refreshes with exact credentials and fetches every page with the exact bounded query", async () => {
    const fake = new FakeGoogleCalendar();
    fake.seedEvents(Array.from({ length: 3 }, (_, i) => ({ id: `event-${i}`, status: "confirmed", summary: `Event ${i}`, start: { dateTime: `2026-08-2${i + 1}T10:00:00Z` }, end: { dateTime: `2026-08-2${i + 1}T11:00:00Z` } })), 2);
    const client = new GoogleCalendarClient({ clientId: "client-id", clientSecret: "client-secret", fetchImpl: fake.fetchImpl });
    const access = await client.refreshAccessToken("refresh-secret");
    const result = await client.listEvents(access, new Date("2026-08-21T00:00:00.000Z"), new Date("2026-09-20T00:00:00.000Z"));
    expect(result.map((event) => event.id)).toEqual(["event-0", "event-1", "event-2"]);
    expect(fake.refreshRequests).toEqual([{ grant_type: "refresh_token", refresh_token: "refresh-secret", client_id: "client-id", client_secret: "client-secret" }]);
    expect(fake.listRequests.map((r) => r.query)).toEqual([
      { timeMin: "2026-08-21T00:00:00.000Z", timeMax: "2026-09-20T00:00:00.000Z", singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "2500", fields: "nextPageToken,items(id,status,summary,organizer(email),attendees(self,responseStatus),start(date,dateTime),end(date,dateTime),updated,recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),location,description)" },
      { timeMin: "2026-08-21T00:00:00.000Z", timeMax: "2026-09-20T00:00:00.000Z", singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "2500", fields: "nextPageToken,items(id,status,summary,organizer(email),attendees(self,responseStatus),start(date,dateTime),end(date,dateTime),updated,recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),location,description)", pageToken: "page-2" },
    ]);
  });

  it("returns typed safe failures without response bodies", async () => {
    const fake = new FakeGoogleCalendar();
    fake.failNextList({ status: 429, retryAfter: "17", body: "secret google payload" });
    const client = new GoogleCalendarClient({ clientId: "id", clientSecret: "secret", fetchImpl: fake.fetchImpl });
    try { await client.listEvents("access", new Date(0), new Date(1)); throw new Error("expected failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(GoogleCalendarFailure);
      expect(error).toMatchObject({ kind: "rate_limited", retryAfterMs: 17_000 });
      expect(String(error)).not.toContain("secret google payload");
    }
  });
});
