import { describe, expect, it } from "bun:test";
import { encryptSecret } from "../../../packages/shared/crypto.ts";
import { FakeGoogleCalendar } from "../../../packages/test-fakes/google-calendar/index.ts";
import { GoogleCalendarClient } from "./google-calendar-client.ts";
import { CalendarSyncService, type CalendarSyncStore, type SyncConnection } from "./sync.ts";

const now = new Date("2026-08-21T12:00:00.000Z");
const key = Buffer.alloc(32, 7);
const base = { id: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", tenantId: "00000000-0000-4000-8000-000000000003" };
function fixture() {
  const encrypted = encryptSecret("refresh-token", key, 1, `samo.calendar.refresh.v1|${base.id}|${base.userId}|${base.tenantId}`);
  const connection: SyncConnection = { ...base, encryptedRefreshToken: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenTag: encrypted.tag, encryptionKeyVersion: 1, status: "connected" };
  const reconciles: unknown[][] = [], failures: unknown[] = [];
  const store: CalendarSyncStore = { getById: async () => connection, reconcile: async (_c, events) => { reconciles.push(events); }, markFailure: async (_id, failure) => { failures.push(failure); } };
  const fake = new FakeGoogleCalendar();
  const service = new CalendarSyncService({ store, client: new GoogleCalendarClient({ clientId: "id", clientSecret: "secret", fetchImpl: fake.fetchImpl }), decryptionKeys: new Map([[1, key]]), clock: () => now.getTime() });
  return { service, fake, reconciles, failures };
}

describe("CalendarSyncService", () => {
  it("normalizes timed/all-day events and applies meeting URL priority safely", async () => {
    const x = fixture();
    x.fake.seedEvents([
      { id: "timed", status: "confirmed", summary: "Planning", organizer: { email: "owner@example.test" }, attendees: [{ self: true, responseStatus: "accepted" }], start: { dateTime: "2026-08-22T10:00:00-07:00" }, end: { dateTime: "2026-08-22T11:00:00-07:00" }, updated: "2026-08-20T01:02:03Z", recurringEventId: "series", conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] }, hangoutLink: "https://meet.google.com/zzz-yyyy-xxx", location: "https://zoom.us/j/123" },
      { id: "day", status: "confirmed", summary: "Offsite", start: { date: "2026-08-23" }, end: { date: "2026-08-24" }, location: "Join https://zoom.us.evil.example/j/1, or https://acme.zoom.us/j/42.", description: "backup https://meet.google.com/bad and https://zoom.us/j/99" },
      { id: "cancelled", status: "cancelled", start: { dateTime: "2026-08-22T10:00:00Z" }, end: { dateTime: "2026-08-22T11:00:00Z" } },
    ]);
    await x.service.sync(base.id);
    expect(x.reconciles).toHaveLength(1);
    expect(x.reconciles[0]).toEqual([
      { providerEventId: "timed", recurringEventId: "series", title: "Planning", organizerEmail: "owner@example.test", startsAt: new Date("2026-08-22T17:00:00.000Z"), endsAt: new Date("2026-08-22T18:00:00.000Z"), allDay: false, attendeeResponse: "accepted", meetingUrl: "https://meet.google.com/abc-defg-hij", meetingProvider: "google_meet", sourceUpdatedAt: new Date("2026-08-20T01:02:03.000Z") },
      { providerEventId: "day", recurringEventId: null, title: "Offsite", organizerEmail: null, startsAt: new Date("2026-08-23T00:00:00.000Z"), endsAt: new Date("2026-08-24T00:00:00.000Z"), allDay: true, attendeeResponse: null, meetingUrl: "https://acme.zoom.us/j/42", meetingProvider: "zoom", sourceUpdatedAt: null },
    ]);
  });

  it("preserves cache on partial failure and marks invalid_grant broken once", async () => {
    const transient = fixture(); transient.fake.seedEvents([
      { id: "one", status: "confirmed", start: { dateTime: "2026-08-22T10:00:00Z" }, end: { dateTime: "2026-08-22T11:00:00Z" } },
      { id: "two", status: "confirmed", start: { dateTime: "2026-08-23T10:00:00Z" }, end: { dateTime: "2026-08-23T11:00:00Z" } },
    ], 1); transient.fake.failListPage("page-2", { status: 500 });
    await expect(transient.service.sync(base.id)).rejects.toMatchObject({ kind: "transient" });
    expect(transient.reconciles).toEqual([]); expect(transient.failures).toEqual([{ brokenReason: null, at: now }]);
    const revoked = fixture(); revoked.fake.revokeGrant("refresh-token");
    await expect(revoked.service.sync(base.id)).rejects.toMatchObject({ kind: "invalid_grant" });
    expect(revoked.fake.refreshRequests).toHaveLength(1); expect(revoked.failures).toEqual([{ brokenReason: "invalid_grant", at: now }]);
  });
});
