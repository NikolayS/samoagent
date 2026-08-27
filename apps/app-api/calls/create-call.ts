import type { SQL } from "bun";
import type { OrchestratorJob } from "../../bot-orchestrator/index.ts";
import type { CallSource } from "../../../packages/shared/db/calls.ts";
import { setTenant } from "../../../packages/shared/db/client.ts";
import { resolveKeyterms } from "../../../packages/shared/settings/index.ts";
import type { RateLimiter } from "../auth/rate-limit.ts";
import { readTenantSettings } from "../settings/store.ts";
import { validateMeetingUrl } from "./validate.ts";
import { tenantActive } from "../auth/owner-session.ts";

export const BOT_CREATE_PER_TENANT_LIMIT = 30;
export const BOT_CREATE_WINDOW_MS = 60 * 60 * 1000;
export const RECALL_COST_CODE = "SAMO-RECALL-COST" as const;

const UNIQUE_VIOLATION = "23505";

export interface CreateCallInput {
  tenantId: string;
  actor: string;
  meetingUrl: unknown;
  source: CallSource;
  sourceEventId: string | null;
}

export interface CreateCallDeps {
  sql: SQL;
  enqueue: (job: OrchestratorJob) => void | Promise<void>;
  rateLimiter: RateLimiter;
  now: () => number;
}

export type CreateCallResult =
  | { kind: "created"; call: { id: string; status: string } }
  | { kind: "invalid_url" }
  | { kind: "tenant_inactive" }
  | { kind: "cost_cap"; retryAfterMs: number }
  | { kind: "duplicate" };

export async function createCallForTenant(
  input: CreateCallInput,
  deps: CreateCallDeps,
): Promise<CreateCallResult> {
  const valid = validateMeetingUrl(input.meetingUrl);
  if (!valid.ok) return { kind: "invalid_url" };
  if (!(await tenantActive(deps.sql, input.tenantId))) return { kind: "tenant_inactive" };

  const rateKey = `bot-create:${input.tenantId}`;
  const rateNow = deps.now();
  const reservation = await deps.rateLimiter.hit(
    rateKey, BOT_CREATE_PER_TENANT_LIMIT, BOT_CREATE_WINDOW_MS, rateNow,
  );
  if (!reservation.allowed) return { kind: "cost_cap", retryAfterMs: reservation.retryAfterMs };

  let created: { id: string; status: string };
  try {
    created = await deps.sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE samograph_app");
      await setTenant(tx, input.tenantId);
      const rows = await tx`
        INSERT INTO calls (tenant_id, meeting_url, status, ingest_degraded, source, source_event_id)
        VALUES (${input.tenantId}, ${valid.url}, 'PENDING', false, ${input.source}, ${input.sourceEventId})
        RETURNING id, status`;
      const row = rows[0] as { id: string; status: string };
      await tx`
        INSERT INTO audit_log (tenant_id, call_id, actor, action)
        VALUES (${input.tenantId}, ${row.id}, ${input.actor}, 'call.create')`;
      return row;
    });
  } catch (error) {
    await deps.rateLimiter.refund(rateKey, BOT_CREATE_WINDOW_MS, rateNow);
    if ((error as { errno?: string }).errno === UNIQUE_VIOLATION) return { kind: "duplicate" };
    throw error;
  }

  const settings = await readTenantSettings(deps.sql, input.tenantId);
  await deps.enqueue({
    callId: created.id,
    meetingUrl: valid.url,
    keyterms: resolveKeyterms(settings),
    language: settings.language,
  });
  return { kind: "created", call: created };
}
