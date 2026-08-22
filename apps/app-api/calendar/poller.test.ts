import { describe, expect, it } from "bun:test";
import { MetricsRegistry } from "../../../packages/shared/observe/registry.ts";
import { GoogleCalendarFailure } from "./google-calendar-client.ts";
import { CALENDAR_SYNC_INTERVAL_MS, startCalendarSyncPoller } from "./poller.ts";

type Row = { id: string };

function fakeSql(rows: Row[]) {
  const sql = (() => Promise.resolve(rows)) as any;
  return sql;
}

describe("calendar sync poller", () => {
  it("schedules the exact five-minute default and stop() stops it", () => {
    let interval = -1, stopped = 0;
    const poller = startCalendarSyncPoller({
      sql: fakeSql([]),
      syncConnection: async () => {},
      schedule: (_fn, ms) => { interval = ms; return { stop: () => { stopped++; } }; },
    });
    expect(CALENDAR_SYNC_INTERVAL_MS).toBe(300_000);
    expect(interval).toBe(300_000);
    poller.stop();
    expect(stopped).toBe(1);
  });

  it("passes an injected interval to the scheduler exactly", () => {
    let interval = -1;
    startCalendarSyncPoller({
      sql: fakeSql([]), syncConnection: async () => {}, intervalMs: 12_345,
      schedule: (_fn, ms) => { interval = ms; return { stop() {} }; },
    });
    expect(interval).toBe(12_345);
  });

  it("never exceeds four concurrent connections across ten rows", async () => {
    let active = 0, maximum = 0;
    const releases: Array<() => void> = [];
    const poller = startCalendarSyncPoller({
      sql: fakeSql(Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }))),
      syncConnection: async () => {
        active++; maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
      },
      schedule: () => ({ stop() {} }),
    });
    const sweep = poller.tick();
    await Bun.sleep(0);
    expect(active).toBe(4);
    while (releases.length) { releases.shift()?.(); await Bun.sleep(0); }
    await sweep;
    expect(maximum).toBe(4);
  });

  it("makes a tick during an in-flight sweep an exact no-op", async () => {
    let selected = 0, release!: () => void;
    const sql = (() => { selected++; return Promise.resolve([{ id: "c1" }]); }) as any;
    const poller = startCalendarSyncPoller({
      sql,
      syncConnection: () => new Promise<void>((resolve) => { release = resolve; }),
      schedule: () => ({ stop() {} }),
    });
    const first = poller.tick();
    await Bun.sleep(0);
    await poller.tick();
    expect(selected).toBe(1);
    release();
    await first;
  });

  it("isolates a failed connection and logs only id plus controlled category", async () => {
    const synced: string[] = [], warnings: string[] = [];
    const poller = startCalendarSyncPoller({
      sql: fakeSql([{ id: "good-a" }, { id: "bad" }, { id: "good-b" }]),
      syncConnection: async (id) => {
        if (id === "bad") throw new GoogleCalendarFailure("transient");
        synced.push(id);
      },
      logger: { warn: (message) => warnings.push(message) },
      schedule: () => ({ stop() {} }),
    });
    await poller.tick();
    expect(synced.sort()).toEqual(["good-a", "good-b"]);
    expect(warnings).toEqual(["[calendar-poller] connection bad failed: transient"]);
  });

  it("honors Retry-After per connection without delaying the rest", async () => {
    let now = 1_000;
    const attempts: string[] = [];
    const poller = startCalendarSyncPoller({
      sql: fakeSql([{ id: "limited" }, { id: "healthy" }]), clock: () => now,
      syncConnection: async (id) => {
        attempts.push(id);
        if (id === "limited") throw new GoogleCalendarFailure("rate_limited", 5_000);
      },
      schedule: () => ({ stop() {} }),
    });
    await poller.tick();
    now = 5_999; await poller.tick();
    now = 6_000; await poller.tick();
    expect(attempts).toEqual(["limited", "healthy", "healthy", "limited", "healthy"]);
  });

  it("contains a rejected selection sweep and clears the in-flight guard", async () => {
    let selections = 0;
    const synced: string[] = [], warnings: string[] = [];
    const metrics = new MetricsRegistry();
    const sql = (() => {
      selections++;
      if (selections === 1) return Promise.reject(new Error("database secret"));
      return Promise.resolve([{ id: "recovered" }]);
    }) as any;
    const poller = startCalendarSyncPoller({
      sql, metrics,
      syncConnection: async (id) => { synced.push(id); },
      logger: { warn: (message) => warnings.push(message) },
      schedule: () => ({ stop() {} }),
    });

    await expect(poller.tick()).resolves.toBeUndefined();
    await expect(poller.tick()).resolves.toBeUndefined();
    expect(selections).toBe(3);
    expect(synced).toEqual(["recovered"]);
    expect(warnings).toEqual(["[calendar-poller] sweep failed: sweep_failed"]);
    expect(metrics.renderPrometheus()).toContain('calendar_sync_total{result="sweep_failed"} 1');
  });

  it("the scheduled callback does not emit an unhandled rejection", async () => {
    let scheduled!: () => void;
    const unhandled: unknown[] = [];
    const listener = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", listener);
    try {
      startCalendarSyncPoller({
        sql: (() => Promise.reject(new Error("database secret"))) as any,
        syncConnection: async () => {},
        schedule: (fn) => { scheduled = fn; return { stop() {} }; },
      });
      scheduled();
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("contains a rejecting gauge refresh and the next tick runs normally", async () => {
    let calls = 0;
    const warnings: string[] = [];
    const metrics = new MetricsRegistry();
    const sql = (() => {
      calls++;
      if (calls === 1) return Promise.resolve([]);
      if (calls === 2) return Promise.reject(new Error("database secret"));
      return Promise.resolve([]);
    }) as any;
    const poller = startCalendarSyncPoller({
      sql, metrics, syncConnection: async () => {},
      logger: { warn: (message) => warnings.push(message) },
      schedule: () => ({ stop() {} }),
    });

    await expect(poller.tick()).resolves.toBeUndefined();
    await expect(poller.tick()).resolves.toBeUndefined();
    expect(calls).toBe(4);
    expect(warnings).toEqual(["[calendar-poller] sweep failed: sweep_failed"]);
    expect(metrics.renderPrometheus()).toContain('calendar_sync_total{result="sweep_failed"} 1');
  });

  it("reports 21600 seconds for syncs at six hours and one minute", async () => {
    let calls = 0;
    const queries: string[] = [];
    const metrics = new MetricsRegistry();
    const sql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return ++calls === 1
        ? Promise.resolve([])
        : Promise.resolve([{ status: "connected", count: 2, sync_age_seconds: 21_600 }]);
    }) as any;
    const poller = startCalendarSyncPoller({ sql, metrics, syncConnection: async () => {}, schedule: () => ({ stop() {} }) });
    await poller.tick();
    expect(metrics.renderPrometheus()).toContain("calendar_sync_age_seconds 21600");
    expect(queries[1]).toContain("min(COALESCE(last_sync_at, connected_at))");
  });

  it("uses connected_at as the age reference for a connected row never synced", async () => {
    let calls = 0;
    const metrics = new MetricsRegistry();
    const sql = (() => ++calls === 1
      ? Promise.resolve([])
      : Promise.resolve([{ status: "connected", count: 1, sync_age_seconds: 43_200 }])) as any;
    const poller = startCalendarSyncPoller({ sql, metrics, syncConnection: async () => {}, schedule: () => ({ stop() {} }) });
    await poller.tick();
    expect(metrics.renderPrometheus()).toContain("calendar_sync_age_seconds 43200");
    expect(metrics.renderPrometheus()).toContain("connected_at for never-synced connections; 0 when none are connected");
  });

  it("evicts retry state for removed connections and keeps it bounded under churn", async () => {
    let selected: Row[] = [{ id: "limited" }];
    let now = 1_000;
    const attempts: string[] = [];
    const poller = startCalendarSyncPoller({
      sql: (() => Promise.resolve(selected)) as any, clock: () => now,
      syncConnection: async (id) => { attempts.push(id); throw new GoogleCalendarFailure("rate_limited", 60_000); },
      schedule: () => ({ stop() {} }),
    });
    await poller.tick();
    selected = Array.from({ length: 100 }, (_, i) => ({ id: `churn-${i}` }));
    await poller.tick();
    selected = [];
    await poller.tick();
    selected = [{ id: "limited" }];
    now = 2_000;
    await poller.tick();
    expect(attempts.filter((id) => id === "limited")).toEqual(["limited", "limited"]);
  });
});
