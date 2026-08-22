import { GOOGLE_TOKEN_URL } from "../auth/google-oauth.ts";

export const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const GOOGLE_CALENDAR_FIELDS = "nextPageToken,items(id,status,summary,organizer(email),attendees(self,responseStatus),start(date,dateTime),end(date,dateTime),updated,recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),location,description)";
const TIMEOUT_MS = 10_000;
const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 10_000;
export type GoogleCalendarFailureKind = "invalid_grant" | "unauthorized" | "forbidden" | "refresh_failed" | "rate_limited" | "transient" | "malformed" | "oversized";
export class GoogleCalendarFailure extends Error {
  constructor(readonly kind: GoogleCalendarFailureKind, readonly retryAfterMs?: number) { super(`Google Calendar request failed: ${kind}`); this.name = "GoogleCalendarFailure"; }
}
export type GoogleCalendarEvent = Record<string, unknown> & { id?: unknown };

async function bounded(res: Response): Promise<Record<string, unknown>> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) throw new GoogleCalendarFailure("oversized");
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_BODY) throw new GoogleCalendarFailure("oversized");
  try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch (error) { if (error instanceof GoogleCalendarFailure) throw error; throw new GoogleCalendarFailure("malformed"); }
}
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
export class GoogleCalendarClient {
  readonly #fetch: typeof fetch;
  constructor(readonly opts: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch }) { this.#fetch = opts.fetchImpl ?? fetch; }
  async refreshAccessToken(refreshToken: string): Promise<string> {
    let res: Response;
    try { res = await this.#fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.opts.clientId, client_secret: this.opts.clientSecret }).toString(), signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new GoogleCalendarFailure("transient"); }
    const value = await bounded(res);
    if (!res.ok) {
      if (res.status === 400 && value.error === "invalid_grant") throw new GoogleCalendarFailure("invalid_grant");
      if (res.status === 429) throw new GoogleCalendarFailure("rate_limited", retryAfter(res.headers.get("retry-after")));
      throw new GoogleCalendarFailure(res.status >= 500 ? "transient" : "unauthorized");
    }
    if (typeof value.access_token !== "string" || !value.access_token) throw new GoogleCalendarFailure("malformed");
    return value.access_token;
  }
  async listEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
    const all: GoogleCalendarEvent[] = []; let pageToken: string | undefined;
    do {
      const url = new URL(GOOGLE_CALENDAR_EVENTS_URL);
      for (const [key, value] of Object.entries({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "2500", fields: GOOGLE_CALENDAR_FIELDS, ...(pageToken ? { pageToken } : {}) })) url.searchParams.set(key, value);
      let res: Response;
      try { res = await this.#fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
      catch { throw new GoogleCalendarFailure("transient"); }
      if (!res.ok) {
        await bounded(res).catch(() => ({}));
        if (res.status === 401) throw new GoogleCalendarFailure("unauthorized");
        if (res.status === 403) throw new GoogleCalendarFailure("forbidden");
        if (res.status === 429) throw new GoogleCalendarFailure("rate_limited", retryAfter(res.headers.get("retry-after")));
        throw new GoogleCalendarFailure(res.status >= 500 ? "transient" : "malformed");
      }
      const body = await bounded(res); if (!Array.isArray(body.items)) throw new GoogleCalendarFailure("malformed");
      all.push(...body.items as GoogleCalendarEvent[]); if (all.length > MAX_EVENTS) throw new GoogleCalendarFailure("oversized");
      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    } while (pageToken);
    return all;
  }
}
