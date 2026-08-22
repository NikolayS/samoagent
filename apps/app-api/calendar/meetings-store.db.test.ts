import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { connect } from "../../../packages/shared/db/client.ts";
import { migrate } from "../../../packages/shared/db/migrate.ts";
import { PostgresCalendarConnectionStore } from "./pg-store.ts";

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("calendar meetings cache query", () => {
  let sql: ReturnType<typeof connect>;
  const users: string[] = [];
  beforeAll(async () => { sql = connect(); await migrate(sql); });
  afterAll(async () => { for (const id of users) await sql`DELETE FROM users WHERE id=${id}`; await sql.close(); });

  it("is tenant-RLS scoped, excludes ended rows, orders starts_at/id, and limits exactly", async () => {
    const user = randomUUID(), tenant = randomUUID(), otherUser = randomUUID(), otherTenant = randomUUID();
    users.push(user, otherUser);
    await sql`INSERT INTO users(id,email) VALUES (${user},${`${user}@test`}),(${otherUser},${`${otherUser}@test`})`;
    await sql`INSERT INTO tenants(id,owner_user_id) VALUES (${tenant},${user}),(${otherTenant},${otherUser})`;
    const connection = randomUUID(), otherConnection = randomUUID(), now = new Date("2026-08-21T12:00:00.000Z");
    const bytes = Buffer.alloc(32), iv = Buffer.alloc(12), tag = Buffer.alloc(16);
    await sql`INSERT INTO calendar_connections(id,user_id,tenant_id,encrypted_refresh_token,refresh_token_iv,refresh_token_tag,encryption_key_version,granted_scopes) VALUES (${connection},${user},${tenant},${bytes},${iv},${tag},1,${["scope"]}),(${otherConnection},${otherUser},${otherTenant},${bytes},${iv},${tag},1,${["scope"]})`;
    const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
    await sql`INSERT INTO calendar_events(id,tenant_id,connection_id,provider_event_id,title,starts_at,ends_at) VALUES
      (${second},${tenant},${connection},'second','second',${new Date("2026-08-21T13:00:00Z")},${new Date("2026-08-21T14:00:00Z")}),
      (${first},${tenant},${connection},'first','first',${new Date("2026-08-21T13:00:00Z")},${new Date("2026-08-21T14:00:00Z")}),
      (${randomUUID()},${tenant},${connection},'ended','ended',${new Date("2026-08-21T10:00:00Z")},${now}),
      (${randomUUID()},${otherTenant},${otherConnection},'other','other',${new Date("2026-08-21T12:30:00Z")},${new Date("2026-08-21T14:00:00Z")})`;
    const snapshot = await new PostgresCalendarConnectionStore(sql).meetings(user, tenant, 1, now);
    expect(snapshot.connection?.status).toBe("connected");
    expect(snapshot.meetings.map((row) => row.id)).toEqual([first]);
  });
});
