import { decryptSecret } from "../../../packages/shared/crypto.ts";
import { validateMeetingUrl } from "../calls/validate.ts";
import { GoogleCalendarFailure, type GoogleCalendarClient, type GoogleCalendarEvent } from "./google-calendar-client.ts";

export type BrokenReason = "invalid_grant" | "revoked" | "scope_missing" | "refresh_failed";
export interface SyncConnection { id: string; userId: string; tenantId: string; encryptedRefreshToken: Buffer; refreshTokenIv: Buffer; refreshTokenTag: Buffer; encryptionKeyVersion: number; status: "connected" | "broken"; }
export interface NormalizedCalendarEvent { providerEventId: string; recurringEventId: string | null; title: string; organizerEmail: string | null; startsAt: Date; endsAt: Date; allDay: boolean; attendeeResponse: "needsAction" | "declined" | "tentative" | "accepted" | null; meetingUrl: string | null; meetingProvider: "google_meet" | "zoom" | null; sourceUpdatedAt: Date | null; }
export interface CalendarSyncStore {
  getById(connectionId: string): Promise<SyncConnection | null>;
  reconcile(connection: SyncConnection, events: NormalizedCalendarEvent[], input: { windowStart: Date; windowEnd: Date; syncStartedAt: Date }): Promise<void>;
  markFailure(connectionId: string, input: { brokenReason: BrokenReason | null; at: Date; retryAfterMs?: number }): Promise<void>;
}
const responses = new Set(["needsAction", "declined", "tentative", "accepted"]);
function date(value: unknown): Date | null { if (typeof value !== "string") return null; const out = new Date(value); return Number.isNaN(out.getTime()) ? null : out; }
function tokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.match(/https:\/\/[^\s<>"']+/gi)?.map((token) => token.replace(/[),.;!?\]}]+$/g, "")) ?? [];
}
function meeting(raw: unknown): Pick<NormalizedCalendarEvent, "meetingUrl" | "meetingProvider"> | null {
  for (const token of typeof raw === "string" ? [raw, ...tokens(raw)] : []) {
    const result = validateMeetingUrl(token); if (result.ok) return { meetingUrl: result.url, meetingProvider: result.provider === "meet" ? "google_meet" : "zoom" };
  }
  return null;
}
export function normalizeGoogleEvent(raw: GoogleCalendarEvent): NormalizedCalendarEvent | null {
  if (raw.status === "cancelled" || typeof raw.id !== "string" || !raw.id) return null;
  const start = raw.start as Record<string, unknown> | undefined, end = raw.end as Record<string, unknown> | undefined;
  const allDay = typeof start?.date === "string";
  const startsAt = date(allDay ? `${start?.date}T00:00:00.000Z` : start?.dateTime);
  const endsAt = date(allDay ? `${end?.date}T00:00:00.000Z` : end?.dateTime);
  if (!startsAt || !endsAt || endsAt < startsAt) return null;
  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
  const self = attendees.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).self === true) as Record<string, unknown> | undefined;
  const attendeeResponse = typeof self?.responseStatus === "string" && responses.has(self.responseStatus) ? self.responseStatus as NormalizedCalendarEvent["attendeeResponse"] : null;
  const conference = raw.conferenceData as Record<string, unknown> | undefined;
  const points = Array.isArray(conference?.entryPoints) ? conference.entryPoints : [];
  const video = points.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).entryPointType === "video") as Record<string, unknown> | undefined;
  const selected = meeting(video?.uri) ?? meeting(raw.hangoutLink) ?? meeting(raw.location) ?? meeting(raw.description) ?? { meetingUrl: null, meetingProvider: null };
  return { providerEventId: raw.id, recurringEventId: typeof raw.recurringEventId === "string" ? raw.recurringEventId : null, title: typeof raw.summary === "string" ? raw.summary : "", organizerEmail: typeof (raw.organizer as Record<string, unknown> | undefined)?.email === "string" ? (raw.organizer as Record<string, string>).email : null, startsAt, endsAt, allDay, attendeeResponse, ...selected, sourceUpdatedAt: date(raw.updated) };
}
export class CalendarSyncService {
  constructor(readonly deps: { store: CalendarSyncStore; client: GoogleCalendarClient; decryptionKeys: Map<number, Buffer>; clock?: () => number }) {}
  async sync(connectionId: string): Promise<void> {
    const connection = await this.deps.store.getById(connectionId); if (!connection || connection.status === "broken") return;
    const syncStartedAt = new Date((this.deps.clock ?? Date.now)()); const windowEnd = new Date(syncStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    try {
      const key = this.deps.decryptionKeys.get(connection.encryptionKeyVersion); if (!key) throw new GoogleCalendarFailure("refresh_failed");
      let refresh: string;
      try { refresh = decryptSecret({ ciphertext: connection.encryptedRefreshToken, iv: connection.refreshTokenIv, tag: connection.refreshTokenTag, keyVersion: connection.encryptionKeyVersion }, key, `samo.calendar.refresh.v1|${connection.id}|${connection.userId}|${connection.tenantId}`); }
      catch { throw new GoogleCalendarFailure("refresh_failed"); }
      let access: string;
      try { access = await this.deps.client.refreshAccessToken(refresh); }
      catch (error) { if (error instanceof GoogleCalendarFailure && ["invalid_grant", "rate_limited", "transient"].includes(error.kind)) throw error; throw new GoogleCalendarFailure("refresh_failed"); }
      let raw: GoogleCalendarEvent[];
      try { raw = await this.deps.client.listEvents(access, syncStartedAt, windowEnd); }
      catch (error) {
        if (!(error instanceof GoogleCalendarFailure) || (error.kind !== "unauthorized" && error.kind !== "forbidden")) throw error;
        try { access = await this.deps.client.refreshAccessToken(refresh); }
        catch (refreshError) { if (refreshError instanceof GoogleCalendarFailure && ["invalid_grant", "rate_limited", "transient"].includes(refreshError.kind)) throw refreshError; throw new GoogleCalendarFailure("refresh_failed"); }
        try { raw = await this.deps.client.listEvents(access, syncStartedAt, windowEnd); }
        catch (second) {
          if (second instanceof GoogleCalendarFailure && second.kind === "forbidden") throw new GoogleCalendarFailure("forbidden");
          if (second instanceof GoogleCalendarFailure && second.kind === "unauthorized") throw new GoogleCalendarFailure("unauthorized");
          throw second;
        }
      }
      await this.deps.store.reconcile(connection, raw.map(normalizeGoogleEvent).filter((event): event is NormalizedCalendarEvent => event !== null), { windowStart: syncStartedAt, windowEnd, syncStartedAt });
    } catch (error) {
      const failure = error instanceof GoogleCalendarFailure ? error : new GoogleCalendarFailure("transient");
      const brokenReason: BrokenReason | null = failure.kind === "invalid_grant" ? "invalid_grant" : failure.kind === "forbidden" ? "scope_missing" : failure.kind === "unauthorized" ? "revoked" : failure.kind === "refresh_failed" ? "refresh_failed" : null;
      await this.deps.store.markFailure(connectionId, { brokenReason, at: syncStartedAt, ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }) });
      throw failure;
    }
  }
}
