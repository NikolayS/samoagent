import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { connect, migrate } from "../../../packages/shared/db/index.ts";
import { PostgresCalendarConnectionStore } from "./pg-store.ts";

const d = process.env.DATABASE_URL ? describe : describe.skip;
d("calendar auto-join window query", () => {
  let sql: ReturnType<typeof connect>; const users: string[] = [];
  beforeAll(async () => { sql = connect(); await migrate(sql); });
  afterAll(async () => { for (const id of users) await sql`DELETE FROM users WHERE id=${id}`; await sql.close(); });
  it("returns the exact eligible provider ids in the look-back and lead window", async () => {
    const user = randomUUID(), tenant = randomUUID(), connection = randomUUID(); users.push(user);
    await sql`INSERT INTO users(id,email) VALUES (${user},${`${user}@test`})`;
    await sql`INSERT INTO tenants(id,owner_user_id) VALUES (${tenant},${user})`;
    await sql`INSERT INTO calendar_connections(id,user_id,tenant_id,encrypted_refresh_token,refresh_token_iv,refresh_token_tag,encryption_key_version,granted_scopes,auto_join) VALUES (${connection},${user},${tenant},${Buffer.alloc(32)},${Buffer.alloc(12)},${Buffer.alloc(16)},1,ARRAY['scope'],true)`;
    const now = new Date("2026-08-27T12:00:00Z"), from = new Date("2026-08-27T11:50:00Z"), to = new Date("2026-08-27T12:06:00Z"), end = new Date("2026-08-27T13:00:00Z");
    const rows = [
      ["linked-timed-accepted", now, end, false, "accepted", "https://zoom.us/j/1"],
      ["null-response", to, end, false, null, "https://zoom.us/j/2"],
      ["lookback-running", new Date(now.getTime() - 5 * 60_000), end, false, "accepted", "https://zoom.us/j/3"],
      ["too-old", new Date(now.getTime() - 15 * 60_000), end, false, "accepted", "https://zoom.us/j/4"],
      ["beyond-lead", new Date(to.getTime() + 1), end, false, "accepted", "https://zoom.us/j/5"],
      ["ended", new Date(now.getTime() - 5 * 60_000), now, false, "accepted", "https://zoom.us/j/6"],
      ["declined", now, end, false, "declined", "https://zoom.us/j/7"],
      ["all-day", now, end, true, "accepted", "https://zoom.us/j/8"],
      ["linkless", now, end, false, "accepted", null],
    ] as const;
    for (const [id, starts, ends, allDay, response, url] of rows) await sql`INSERT INTO calendar_events(tenant_id,connection_id,provider_event_id,starts_at,ends_at,all_day,attendee_response,meeting_url) VALUES (${tenant},${connection},${id},${starts},${ends},${allDay},${response},${url})`;
    expect((await new PostgresCalendarConnectionStore(sql).autoJoinCandidates(connection, tenant, now, from, to)).map((row) => row.providerEventId)).toEqual(["lookback-running", "linked-timed-accepted", "null-response"]);
  });
});
