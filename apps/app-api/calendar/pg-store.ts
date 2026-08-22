import type { SQL } from "bun";
import { tenantActive } from "../auth/owner-session.ts";
import type { CalendarConnection, CalendarConnectionStore } from "./service.ts";

type Row = Record<string, unknown>;
function map(row: Row): CalendarConnection {
  return { id: String(row.id), userId: String(row.user_id), tenantId: String(row.tenant_id),
    encryptedRefreshToken: Buffer.from(row.encrypted_refresh_token as Uint8Array), refreshTokenIv: Buffer.from(row.refresh_token_iv as Uint8Array), refreshTokenTag: Buffer.from(row.refresh_token_tag as Uint8Array),
    encryptionKeyVersion: Number(row.encryption_key_version), grantedScopes: row.granted_scopes as string[], status: row.status as "connected" | "broken",
    connectedAt: new Date(row.connected_at as string), lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : null, lastSyncErrorAt: row.last_sync_error_at ? new Date(row.last_sync_error_at as string) : null };
}
export class PostgresCalendarConnectionStore implements CalendarConnectionStore {
  constructor(readonly sql: SQL) {}
  async tenantExists(tenantId: string) { return tenantActive(this.sql, tenantId); }
  async get(userId: string, tenantId: string) {
    const rows = await this.sql`SELECT * FROM calendar_connections WHERE user_id=${userId} AND tenant_id=${tenantId} AND provider='google'` as unknown as Row[];
    return rows[0] ? map(rows[0]) : null;
  }
  async save(r: CalendarConnection) {
    await this.sql`INSERT INTO calendar_connections (id,user_id,tenant_id,provider,encrypted_refresh_token,refresh_token_iv,refresh_token_tag,encryption_key_version,granted_scopes,status,broken_reason,connected_at,updated_at,last_sync_at,last_sync_error_at)
      VALUES (${r.id},${r.userId},${r.tenantId},'google',${r.encryptedRefreshToken},${r.refreshTokenIv},${r.refreshTokenTag},${r.encryptionKeyVersion},${r.grantedScopes},'connected',NULL,${r.connectedAt},${r.connectedAt},NULL,NULL)
      ON CONFLICT (user_id,provider) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, encrypted_refresh_token=EXCLUDED.encrypted_refresh_token, refresh_token_iv=EXCLUDED.refresh_token_iv, refresh_token_tag=EXCLUDED.refresh_token_tag, encryption_key_version=EXCLUDED.encryption_key_version, granted_scopes=EXCLUDED.granted_scopes, status='connected', broken_reason=NULL, connected_at=EXCLUDED.connected_at, updated_at=EXCLUDED.updated_at, last_sync_at=NULL, last_sync_error_at=NULL`;
  }
  async delete(userId: string, tenantId: string) { await this.sql`DELETE FROM calendar_connections WHERE user_id=${userId} AND tenant_id=${tenantId} AND provider='google'`; }
}
