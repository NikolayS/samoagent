import { GOOGLE_CALENDAR_EVENTS_URL, GOOGLE_CALENDAR_FIELDS } from "../../../apps/app-api/calendar/google-calendar-client.ts";
import { GOOGLE_TOKEN_URL } from "../../../apps/app-api/auth/google-oauth.ts";

export type FakeCalendarEvent = Record<string, unknown> & { id: string };
type Failure = { status?: number; retryAfter?: string; body?: string; timeout?: boolean; malformed?: boolean; oversized?: boolean };

export class FakeGoogleCalendar {
  readonly refreshRequests: Record<string, string>[] = [];
  readonly listRequests: Array<{ token: string | null; query: Record<string, string> }> = [];
  #events: FakeCalendarEvent[] = [];
  #pageSize = 2500;
  #nextFailure: Failure | undefined;
  #pageFailures = new Map<string, Failure>();
  #expired = new Set<string>();
  #revoked = new Set<string>();

  seedEvents(events: FakeCalendarEvent[], pageSize = 2500): void { this.#events = structuredClone(events); this.#pageSize = pageSize; }
  failNextList(failure: Failure): void { this.#nextFailure = failure; }
  failListPage(token: string, failure: Failure): void { this.#pageFailures.set(token, failure); }
  expireAccessToken(token: string): void { this.#expired.add(token); }
  revokeGrant(token: string): void { this.#revoked.add(token); }

  #failure(value: Failure): Promise<Response> | Response {
    if (value.timeout) return new Promise(() => {});
    const headers = value.retryAfter ? { "retry-after": value.retryAfter } : undefined;
    const body = value.oversized ? "x".repeat(70_000) : value.malformed ? "{" : value.body ?? JSON.stringify({ error: "fake" });
    return new Response(body, { status: value.status ?? 500, headers });
  }

  readonly fetchImpl: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.toString() === GOOGLE_TOKEN_URL) {
      const request = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      this.refreshRequests.push(request);
      const token = request.refresh_token ?? "";
      if (this.#revoked.has(token)) return Response.json({ error: "invalid_grant", error_description: "sensitive" }, { status: 400 });
      return Response.json({ access_token: "access-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.origin + url.pathname !== GOOGLE_CALENDAR_EVENTS_URL) return new Response("not found", { status: 404 });
    const query = Object.fromEntries(url.searchParams);
    const token = init?.headers instanceof Headers ? init.headers.get("authorization") : new Headers(init?.headers).get("authorization");
    this.listRequests.push({ token, query });
    const pageToken = query.pageToken;
    const failure = (pageToken && this.#pageFailures.get(pageToken)) || this.#nextFailure;
    if (pageToken) this.#pageFailures.delete(pageToken); else this.#nextFailure = undefined;
    if (failure) return this.#failure(failure);
    const access = token?.replace(/^Bearer /, "") ?? "";
    if (this.#expired.delete(access)) return Response.json({ error: { status: "UNAUTHENTICATED" } }, { status: 401 });
    if (this.#revoked.has(access)) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
    if (query.fields !== GOOGLE_CALENDAR_FIELDS) return new Response("bad fields", { status: 400 });
    const offset = pageToken ? (Number(pageToken.replace("page-", "")) - 1) * this.#pageSize : 0;
    const items = this.#events.slice(offset, offset + this.#pageSize);
    const next = offset + this.#pageSize < this.#events.length ? `page-${offset / this.#pageSize + 2}` : undefined;
    return Response.json({ items, ...(next ? { nextPageToken: next } : {}) });
  }) as typeof fetch;
}
