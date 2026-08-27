import { describe, expect, it } from "bun:test";
import type { SQL } from "bun";
import type { OrchestratorJob } from "../../bot-orchestrator/index.ts";
import { InMemoryRateLimiter } from "../auth/rate-limit.ts";
import { createCallForTenant, type CreateCallDeps } from "./create-call.ts";

const tenantId = "22222222-2222-4222-8222-222222222222";

function fakeSql(options: { duplicate?: boolean } = {}): SQL {
  // Bun's SQL callable has richer Query/transaction overloads than this small
  // in-memory fake needs, so keep the fake dynamic and cast only at its edge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag: any = (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("FROM tenants")) return Promise.resolve([{ ok: 1 }]);
    if (query.includes("INSERT INTO calls")) {
      if (options.duplicate) return Promise.reject(Object.assign(new Error("duplicate"), { errno: "23505" }));
      return Promise.resolve([{ id: "call-1", status: "PENDING" }]);
    }
    if (query.includes("FROM settings")) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  tag.unsafe = async () => [];
  tag.begin = async (fn: (tx: SQL) => Promise<unknown>) => fn(tag as SQL);
  return tag as SQL;
}

function deps(sql = fakeSql()): CreateCallDeps & { jobs: OrchestratorJob[] } {
  const jobs: OrchestratorJob[] = [];
  return {
    sql,
    rateLimiter: new InMemoryRateLimiter(),
    enqueue: (job) => { jobs.push(job); },
    now: () => 1234,
    jobs,
  };
}

describe("createCallForTenant", () => {
  it("creates, audits, resolves settings, and enqueues", async () => {
    const d = deps();
    const result = await createCallForTenant({
      tenantId, actor: "user:u1", meetingUrl: "https://meet.google.com/abc-defg-hij",
      source: "calendar", sourceEventId: "event-1",
    }, d);
    expect(result).toEqual({ kind: "created", call: { id: "call-1", status: "PENDING" } });
    expect(d.jobs).toEqual([{ callId: "call-1", meetingUrl: "https://meet.google.com/abc-defg-hij", keyterms: [], language: "multi" }]);
  });

  it("returns invalid_url before touching the database", async () => {
    const d = deps(new Proxy(() => {}, { apply() { throw new Error("db touched"); }, get() { throw new Error("db touched"); } }) as unknown as SQL);
    expect(await createCallForTenant({ tenantId, actor: "user:u1", meetingUrl: "nope", source: "manual", sourceEventId: null }, d))
      .toEqual({ kind: "invalid_url" });
  });

  it("returns cost_cap when the tenant has exhausted its budget", async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) await d.rateLimiter.hit(`bot-create:${tenantId}`, 30, 3_600_000, 1234);
    const result = await createCallForTenant({ tenantId, actor: "user:u1", meetingUrl: "https://zoom.us/j/123", source: "manual", sourceEventId: null }, d);
    expect(result.kind).toBe("cost_cap");
  });

  it("returns duplicate for a repeated source event and refunds the cost slot", async () => {
    const d = deps(fakeSql({ duplicate: true }));
    const result = await createCallForTenant({ tenantId, actor: "calendar", meetingUrl: "https://zoom.us/j/123", source: "calendar", sourceEventId: "event-1" }, d);
    expect(result).toEqual({ kind: "duplicate" });
    expect(await d.rateLimiter.peek(`bot-create:${tenantId}`, 30, 3_600_000, 1234)).toBe(true);
    expect(d.jobs).toEqual([]);
  });
});
