import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { connect, migrate, setTenant } from "./index.ts";
import { PostgresCalendarConnectionStore } from "../../../apps/app-api/calendar/pg-store.ts";
import type { NormalizedCalendarEvent, SyncConnection } from "../../../apps/app-api/calendar/sync.ts";

const d = process.env.DATABASE_URL ? describe : describe.skip;
d("calendar_events migration", () => {
  let sql: ReturnType<typeof connect>; const users: string[] = [];
  async function owner() {
    const userId = randomUUID(); users.push(userId);
    await sql`INSERT INTO users(id,email) VALUES (${userId},${`${userId}@example.test`})`;
    const tenant = await sql`INSERT INTO tenants(owner_user_id) VALUES (${userId}) RETURNING id` as unknown as Array<{ id: string }>;
    const connection = await sql`INSERT INTO calendar_connections(user_id,tenant_id,encrypted_refresh_token,refresh_token_iv,refresh_token_tag,encryption_key_version,granted_scopes) VALUES (${userId},${tenant[0].id},${Buffer.from("x")},${Buffer.alloc(12)},${Buffer.alloc(16)},1,ARRAY[]::text[]) RETURNING id` as unknown as Array<{ id: string }>;
    return { userId, tenantId: tenant[0].id, connectionId: connection[0].id };
  }
  async function event(connectionId: string, tenantId: string, providerId: string = randomUUID()) {
    return sql`INSERT INTO calendar_events(tenant_id,connection_id,provider_event_id,starts_at,ends_at) VALUES (${tenantId},${connectionId},${providerId},now(),now()+interval '1 hour') RETURNING id`;
  }
  beforeAll(async () => { sql = connect(); await migrate(sql); });
  afterAll(async () => { for (const id of users) await sql`DELETE FROM users WHERE id=${id}`; await sql.close(); });

  it("enables and forces RLS with the scalar sub-SELECT policy", async () => {
    const posture = await sql`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='calendar_events'::regclass`;
    const policy = await sql`SELECT qual,with_check FROM pg_policies WHERE tablename='calendar_events' AND policyname='calendar_events_tenant_isolation'`;
    expect(posture).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(String(policy[0].qual)).toContain("( SELECT current_setting('app.tenant_id'::text)");
    expect(String(policy[0].with_check)).toContain("( SELECT current_setting('app.tenant_id'::text)");
  });
  it("isolates tenants through the runtime role", async () => {
    const a = await owner(), b = await owner(); await event(a.connectionId, a.tenantId, "a"); await event(b.connectionId, b.tenantId, "b");
    const rows = await sql.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE samograph_app"); await setTenant(tx, a.tenantId); return tx`SELECT provider_event_id FROM calendar_events WHERE provider_event_id IN ('a','b') ORDER BY provider_event_id`; });
    expect(rows).toEqual([{ provider_event_id: "a" }]);
  });
  it("rejects connection/tenant mismatch and cascades connection deletion", async () => {
    const a = await owner(), b = await owner();
    let errno: string | undefined; try { await event(a.connectionId, b.tenantId); } catch (error) { errno = (error as { errno?: string }).errno; }
    expect(errno).toBe("23503"); await event(a.connectionId, a.tenantId, "cascade"); await sql`DELETE FROM calendar_connections WHERE id=${a.connectionId}`;
    const remaining = await sql`SELECT provider_event_id FROM calendar_events WHERE provider_event_id='cascade'` as unknown as Array<{ provider_event_id: string }>;
    expect(remaining).toEqual([]);
  });

  it("never lets an older reconciliation overwrite a newer success", async () => {
    const row = await owner(); const store = new PostgresCalendarConnectionStore(sql); const connection = { ...row, id: row.connectionId, encryptedRefreshToken: Buffer.from("x"), refreshTokenIv: Buffer.alloc(12), refreshTokenTag: Buffer.alloc(16), encryptionKeyVersion: 1, status: "connected" } as SyncConnection;
    const normalized = (title: string): NormalizedCalendarEvent => ({ providerEventId: "race", recurringEventId: null, title, organizerEmail: null, startsAt: new Date("2026-08-24T10:00:00Z"), endsAt: new Date("2026-08-24T11:00:00Z"), allDay: false, attendeeResponse: null, meetingUrl: null, meetingProvider: null, sourceUpdatedAt: null });
    const newer = new Date("2026-08-21T12:00:02Z"), older = new Date("2026-08-21T12:00:01Z");
    await store.reconcile(connection, [normalized("newer")], { windowStart: older, windowEnd: new Date("2026-09-20T00:00:00Z"), syncStartedAt: newer });
    await store.reconcile(connection, [normalized("older")], { windowStart: older, windowEnd: new Date("2026-09-20T00:00:00Z"), syncStartedAt: older });
    expect(await sql`SELECT title FROM calendar_events WHERE connection_id=${row.connectionId} AND provider_event_id='race'` as unknown).toEqual([{ title: "newer" }]);
    expect(await sql`SELECT last_sync_at FROM calendar_connections WHERE id=${row.connectionId}` as unknown).toEqual([{ last_sync_at: newer }]);
    await store.markFailure(row.connectionId, { brokenReason: "revoked", at: older });
    expect(await sql`SELECT status,broken_reason,last_sync_at FROM calendar_connections WHERE id=${row.connectionId}` as unknown).toEqual([{ status: "connected", broken_reason: null, last_sync_at: newer }]);
  });

  it("uses a unique sync identity when two reconciliations share a timestamp", async () => {
    const row = await owner(); const store = new PostgresCalendarConnectionStore(sql); const connection = { ...row, id: row.connectionId, encryptedRefreshToken: Buffer.from("x"), refreshTokenIv: Buffer.alloc(12), refreshTokenTag: Buffer.alloc(16), encryptionKeyVersion: 1, status: "connected" } as SyncConnection;
    const at = new Date("2026-08-21T12:00:00Z"); const event: NormalizedCalendarEvent = { providerEventId: "cancelled-next", recurringEventId: null, title: "first", organizerEmail: null, startsAt: new Date("2026-08-24T10:00:00Z"), endsAt: new Date("2026-08-24T11:00:00Z"), allDay: false, attendeeResponse: null, meetingUrl: null, meetingProvider: null, sourceUpdatedAt: null };
    const bounds = { windowStart: at, windowEnd: new Date("2026-09-20T00:00:00Z"), syncStartedAt: at };
    await store.reconcile(connection, [event], bounds); await store.reconcile(connection, [], bounds);
    expect(await sql`SELECT provider_event_id FROM calendar_events WHERE connection_id=${row.connectionId}` as unknown).toEqual([]);
  });
});
