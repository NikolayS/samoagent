import { describe, expect, it } from "bun:test";
import { createCalendarHandler } from "./http.ts";
import { CalendarService, type CalendarConnection, type CalendarConnectionStore } from "./service.ts";
import { InMemoryRateLimiter } from "../auth/rate-limit.ts";
import { signSession } from "../auth/session.ts";

const now = 50_000, secret = "session-secret";
class Store implements CalendarConnectionStore {
  row: CalendarConnection | null = null;
  async tenantExists() { return true; }
  async get() { return this.row; }
  async save(row: CalendarConnection) { this.row = row; }
  async delete() { this.row = null; }
}
function handler() {
  const store = new Store();
  const service = new CalendarService({ provider: undefined, store,
    rateLimiter: new InMemoryRateLimiter(), sessionSecret: secret, clock: () => now,
    activeKey: Buffer.alloc(32), activeKeyVersion: 1, decryptionKeys: new Map([[1, Buffer.alloc(32)]]) });
  return createCalendarHandler(service, secret, () => now);
}
const session = () => `samo_session=${signSession({ userId: "user", tenantId: "tenant", iat: now }, secret)}`;

describe("calendar HTTP adapter", () => {
  it("rejects unauthenticated start/status/delete and callback clears state", async () => {
    const h = handler();
    for (const [method, path] of [["POST", "/calendar/connect/start"], ["GET", "/calendar/status"], ["DELETE", "/calendar/connection"]]) {
      expect((await h(new Request(`http://api.test${path}`, { method }))).status).toBe(401);
    }
    const callback = await h(new Request("http://api.test/calendar/connect/callback"));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/settings?calendar_error=SAMO-CALENDAR-003");
    expect(callback.headers.get("set-cookie")).toBe("__Host-samo_calendar_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("returns exact not-connected status and idempotent 204", async () => {
    const h = handler();
    const status = await h(new Request("http://api.test/calendar/status", { headers: { cookie: session() } }));
    expect(await status.json()).toEqual({ provider: "google", state: "not_connected", connected_at: null, last_sync_at: null, last_sync_error_at: null });
    expect((await h(new Request("http://api.test/calendar/connection", { method: "DELETE", headers: { cookie: session() } }))).status).toBe(204);
  });

  it("returns SAMO-CALENDAR-001 JSON when start is unconfigured", async () => {
    const res = await handler()(new Request("http://api.test/calendar/connect/start", { method: "POST", headers: { cookie: session(), "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "SAMO-CALENDAR-001" });
  });
});
