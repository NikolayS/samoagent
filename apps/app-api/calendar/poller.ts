import type { SQL } from "bun";
import type { MetricsRegistry } from "../../../packages/shared/observe/registry.ts";
import { GoogleCalendarFailure, type GoogleCalendarFailureKind } from "./google-calendar-client.ts";

export const CALENDAR_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;

export interface CalendarSyncPollerDeps {
  sql: SQL;
  syncConnection(connectionId: string): Promise<number | void>;
  clock?: () => number;
  intervalMs?: number;
  schedule?: (fn: () => void, ms: number) => { stop(): void };
  logger?: { warn(message: string): void };
  metrics?: MetricsRegistry;
}

export interface CalendarSyncPollerHandle {
  tick(): Promise<void>;
  stop(): void;
}

function defaultSchedule(fn: () => void, ms: number): { stop(): void } {
  const timer = setInterval(fn, ms);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

function category(error: unknown): GoogleCalendarFailureKind | "unexpected" {
  return error instanceof GoogleCalendarFailure ? error.kind : "unexpected";
}

export function startCalendarSyncPoller(deps: CalendarSyncPollerDeps): CalendarSyncPollerHandle {
  const clock = deps.clock ?? Date.now;
  const retryUntil = new Map<string, number>();
  let inFlight = false;

  async function refreshGauges(): Promise<void> {
    if (!deps.metrics) return;
    const rows = await deps.sql`
      SELECT status, count(*)::int AS count,
             EXTRACT(EPOCH FROM (now() - max(last_sync_at)))::double precision AS sync_age_seconds
        FROM calendar_connections
       GROUP BY status` as unknown as Array<{ status: "connected" | "broken"; count: number; sync_age_seconds: number | null }>;
    const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
    deps.metrics.setCalendarConnections("connected", counts.get("connected") ?? 0);
    deps.metrics.setCalendarConnections("broken", counts.get("broken") ?? 0);
    const ages = rows.map((row) => row.sync_age_seconds).filter((age): age is number => age !== null).map(Number);
    deps.metrics.setCalendarSyncAgeSeconds(ages.length ? Math.max(0, Math.max(...ages)) : 0);
  }

  async function syncOne(id: string): Promise<void> {
    if ((retryUntil.get(id) ?? 0) > clock()) return;
    try {
      const events = await deps.syncConnection(id);
      retryUntil.delete(id);
      deps.metrics?.incCalendarSync("ok");
      deps.metrics?.incCalendarSyncEvents(events ?? 0);
    } catch (error) {
      const failure = category(error);
      if (error instanceof GoogleCalendarFailure && error.retryAfterMs !== undefined) {
        retryUntil.set(id, clock() + error.retryAfterMs);
      }
      deps.metrics?.incCalendarSync(failure);
      deps.logger?.warn(`[calendar-poller] connection ${id} failed: ${failure}`);
    }
  }

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const rows = await deps.sql`
        SELECT id FROM calendar_connections WHERE status = 'connected' ORDER BY id` as unknown as Array<{ id: string }>;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
        while (next < rows.length) {
          const row = rows[next++];
          if (row) await syncOne(row.id);
        }
      }));
      await refreshGauges();
    } finally {
      inFlight = false;
    }
  }

  const scheduled = (deps.schedule ?? defaultSchedule)(() => void tick(), deps.intervalMs ?? CALENDAR_SYNC_INTERVAL_MS);
  return { tick, stop: () => scheduled.stop() };
}
