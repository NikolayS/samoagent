import { describe, expect, it } from "bun:test";
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
});
