import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { connect, migrate } from "../../../packages/shared/db/index.ts";
import { InMemoryRateLimiter } from "../auth/rate-limit.ts";
import { createCallForTenant } from "./create-call.ts";

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("createCallForTenant calendar concurrency", () => {
  let setupSql: ReturnType<typeof connect>;
  let firstSql: ReturnType<typeof connect>;
  let secondSql: ReturnType<typeof connect>;
  const userId = randomUUID();
  const tenantId = randomUUID();

  beforeAll(async () => {
    setupSql = connect();
    firstSql = connect();
    secondSql = connect();
    await migrate(setupSql);
    await setupSql`INSERT INTO users (id, email) VALUES (${userId}, ${`${userId}@test.invalid`})`;
    await setupSql`INSERT INTO tenants (id, owner_user_id) VALUES (${tenantId}, ${userId})`;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM users WHERE id=${userId}`;
    await Promise.all([setupSql.close(), firstSql.close(), secondSql.close()]);
  });

  it("serializes two calendar creates for one tenant and normalized meeting URL", async () => {
    const meetingUrl = `https://zoom.us/j/${Date.now()}`;
    const jobs: string[] = [];
    const create = (sql: ReturnType<typeof connect>, sourceEventId: string) =>
      createCallForTenant({
        tenantId,
        actor: "calendar-autojoin",
        meetingUrl,
        source: "calendar",
        sourceEventId,
      }, {
        sql,
        enqueue: (job) => { jobs.push(job.callId); },
        rateLimiter: new InMemoryRateLimiter(),
        now: Date.now,
      });

    const results = await Promise.all([
      create(firstSql, `first:${randomUUID()}`),
      create(secondSql, `second:${randomUUID()}`),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["already_active", "created"]);
    expect(jobs).toHaveLength(1);
    const rows = await setupSql`SELECT id FROM calls WHERE tenant_id=${tenantId} AND meeting_url=${meetingUrl}`;
    expect(rows).toHaveLength(1);
    const alreadyActive = results.find((result) => result.kind === "already_active");
    expect(alreadyActive?.kind === "already_active" ? alreadyActive.callId : null).toBe(String(rows[0]?.id));
  });
});
