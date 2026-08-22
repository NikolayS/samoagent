import type { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { tenantActive } from "../auth/owner-session.ts";
import { setTenant } from "../../../packages/shared/db/client.ts";
import type { CalendarConnection, CalendarConnectionStore } from "./service.ts";
import type { BrokenReason, CalendarSyncStore, NormalizedCalendarEvent, SyncConnection } from "./sync.ts";

type Row = Record<string, unknown>;
function map(row: Row): CalendarConnection {
  return { id: String(row.id), userId: String(row.user_id), tenantId: String(row.tenant_id),
    encryptedRefreshToken: Buffer.from(row.encrypted_refresh_token as Uint8Array), refreshTokenIv: Buffer.from(row.refresh_token_iv as Uint8Array), refreshTokenTag: Buffer.from(row.refresh_token_tag as Uint8Array),
    encryptionKeyVersion: Number(row.encryption_key_version), grantedScopes: row.granted_scopes as string[], status: row.status as "connected" | "broken",
    connectedAt: new Date(row.connected_at as string), lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : null, lastSyncErrorAt: row.last_sync_error_at ? new Date(row.last_sync_error_at as string) : null };
}
export class PostgresCalendarConnectionStore implements CalendarConnectionStore, CalendarSyncStore {
  constructor(readonly sql: SQL) {}
  async tenantExists(tenantId: string) { return tenantActive(this.sql, tenantId); }
  async get(userId: string, tenantId: string) {
    const rows = await this.sql`SELECT * FROM calendar_connections WHERE user_id=${userId} AND tenant_id=${tenantId} AND provider='google'` as unknown as Row[];
    return rows[0] ? map(rows[0]) : null;
  }
  async save(r: CalendarConnection) {
    await this.sql`INSERT INTO calendar_connections (id,user_id,tenant_id,provider,encrypted_refresh_token,refresh_token_iv,refresh_token_tag,encryption_key_version,granted_scopes,status,broken_reason,connected_at,updated_at,last_sync_at,last_sync_error_at)
      VALUES (${r.id},${r.userId},${r.tenantId},'google',${r.encryptedRefreshToken},${r.refreshTokenIv},${r.refreshTokenTag},${r.encryptionKeyVersion},${r.grantedScopes},'connected',NULL,${r.connectedAt},${r.connectedAt},NULL,NULL)
      ON CONFLICT (user_id,provider) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, encrypted_refresh_token=EXCLUDED.encrypted_refresh_token, refresh_token_iv=EXCLUDED.refresh_token_iv, refresh_token_tag=EXCLUDED.refresh_token_tag, encryption_key_version=EXCLUDED.encryption_key_version, granted_scopes=EXCLUDED.granted_scopes, status='connected', broken_reason=NULL, connected_at=EXCLUDED.connected_at, updated_at=EXCLUDED.updated_at, last_sync_at=NULL, last_sync_error_at=NULL, sync_seq=calendar_connections.sync_seq+1, committed_sync_seq=calendar_connections.sync_seq+1`;
  }
  async delete(userId: string, tenantId: string) { await this.sql`DELETE FROM calendar_connections WHERE user_id=${userId} AND tenant_id=${tenantId} AND provider='google'`; }
  async startSync(connectionId: string): Promise<SyncConnection | null> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${connectionId}))`;
      const rows = await tx`UPDATE calendar_connections SET sync_seq=sync_seq+1 WHERE id=${connectionId} AND status='connected' RETURNING *` as unknown as Row[];
      const row = rows[0] ? map(rows[0]) : null;
      return row ? { id: row.id, userId: row.userId, tenantId: row.tenantId, encryptedRefreshToken: row.encryptedRefreshToken, refreshTokenIv: row.refreshTokenIv, refreshTokenTag: row.refreshTokenTag, encryptionKeyVersion: row.encryptionKeyVersion, status: row.status, syncSeq: BigInt(rows[0].sync_seq as bigint) } : null;
    });
  }
  async reconcile(connection: SyncConnection, events: NormalizedCalendarEvent[], input: { windowStart: Date; windowEnd: Date; syncStartedAt: Date }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${connection.id}))`;
      const state = await tx`SELECT committed_sync_seq FROM calendar_connections WHERE id=${connection.id} FOR UPDATE` as unknown as Array<{ committed_sync_seq: bigint }>;
      if (!state[0] || BigInt(state[0].committed_sync_seq) > connection.syncSeq) return;
      const syncId = randomUUID();
      await tx.unsafe("SET LOCAL ROLE samograph_app");
      await setTenant(tx, connection.tenantId);
      for (const event of events) {
        await tx`INSERT INTO calendar_events (tenant_id,connection_id,provider_event_id,recurring_event_id,title,organizer_email,starts_at,ends_at,all_day,attendee_response,meeting_url,meeting_provider,source_updated_at,sync_id,synced_at,updated_at)
          VALUES (${connection.tenantId},${connection.id},${event.providerEventId},${event.recurringEventId},${event.title},${event.organizerEmail},${event.startsAt},${event.endsAt},${event.allDay},${event.attendeeResponse},${event.meetingUrl},${event.meetingProvider},${event.sourceUpdatedAt},${syncId},${input.syncStartedAt},${input.syncStartedAt})
          ON CONFLICT (connection_id,provider_event_id) DO UPDATE SET recurring_event_id=EXCLUDED.recurring_event_id,title=EXCLUDED.title,organizer_email=EXCLUDED.organizer_email,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,all_day=EXCLUDED.all_day,attendee_response=EXCLUDED.attendee_response,meeting_url=EXCLUDED.meeting_url,meeting_provider=EXCLUDED.meeting_provider,source_updated_at=EXCLUDED.source_updated_at,sync_id=EXCLUDED.sync_id,synced_at=EXCLUDED.synced_at,updated_at=EXCLUDED.updated_at`;
      }
      await tx`DELETE FROM calendar_events WHERE connection_id=${connection.id} AND ends_at > ${input.windowStart} AND starts_at < ${input.windowEnd} AND sync_id <> ${syncId}`;
      await tx`DELETE FROM calendar_events WHERE connection_id=${connection.id} AND ends_at <= ${input.syncStartedAt}`;
      // Credential state is privileged; temporarily return to the transaction owner.
      await tx.unsafe("RESET ROLE");
      await tx`UPDATE calendar_connections SET status='connected',broken_reason=NULL,committed_sync_seq=${connection.syncSeq},last_sync_at=${input.syncStartedAt},updated_at=${input.syncStartedAt} WHERE id=${connection.id}`;
    });
  }
  async markFailure(connectionId: string, input: { syncSeq: bigint; brokenReason: BrokenReason | null; at: Date }): Promise<void> {
    if (input.brokenReason) await this.sql`UPDATE calendar_connections SET status='broken',broken_reason=${input.brokenReason},last_sync_error_at=${input.at},updated_at=${input.at} WHERE id=${connectionId} AND committed_sync_seq<=${input.syncSeq}`;
    else await this.sql`UPDATE calendar_connections SET last_sync_error_at=${input.at},updated_at=${input.at} WHERE id=${connectionId} AND committed_sync_seq<=${input.syncSeq}`;
  }
}
