import { randomUUID } from "node:crypto";
import type { RateLimiter } from "../auth/rate-limit.ts";
import { RATE_WINDOW_MS } from "../auth/service.ts";
import { randomToken } from "../auth/crypto.ts";
import { codeChallengeS256 } from "../auth/oauth-state.ts";
import { decryptSecret, encryptSecret } from "../../../packages/shared/crypto.ts";
import type { GoogleCalendarOAuthPort } from "./google-calendar-oauth.ts";
import { issueCalendarOAuthStateCookie, verifyCalendarOAuthStateForCallback } from "./oauth-state.ts";

export type CalendarErrorCode = "SAMO-CALENDAR-001" | "SAMO-CALENDAR-002" | "SAMO-CALENDAR-003" | "SAMO-CALENDAR-004" | "SAMO-CALENDAR-005" | "SAMO-CALENDAR-006" | "SAMO-CALENDAR-500";
export interface CalendarConnection {
  id: string; userId: string; tenantId: string;
  encryptedRefreshToken: Buffer; refreshTokenIv: Buffer; refreshTokenTag: Buffer;
  encryptionKeyVersion: number; grantedScopes: string[]; status: "connected" | "broken";
  connectedAt: Date; lastSyncAt: Date | null; lastSyncErrorAt: Date | null;
}
export interface CalendarConnectionStore {
  tenantExists(tenantId: string): Promise<boolean>;
  get(userId: string, tenantId: string): Promise<CalendarConnection | null>;
  save(row: CalendarConnection): Promise<void>;
  delete(userId: string, tenantId: string): Promise<void>;
}
export interface CalendarServiceDeps {
  provider?: GoogleCalendarOAuthPort; store: CalendarConnectionStore; rateLimiter: RateLimiter;
  sessionSecret: string; clock: () => number; randomValue?: () => string;
  activeKey: Buffer; activeKeyVersion: number; decryptionKeys: Map<number, Buffer>;
  immediateSync?: (connectionId: string) => Promise<void>;
}
const START_LIMIT = 20, CALLBACK_LIMIT = 20;
const aad = (row: Pick<CalendarConnection, "id" | "userId" | "tenantId">) => `samo.calendar.refresh.v1|${row.id}|${row.userId}|${row.tenantId}`;

export class CalendarService {
  readonly #deps: CalendarServiceDeps; readonly #random: () => string;
  constructor(deps: CalendarServiceDeps) { this.#deps = deps; this.#random = deps.randomValue ?? randomToken; }
  get configured() { return this.#deps.provider !== undefined; }
  async tenantExists(tenantId: string) { return this.#deps.store.tenantExists(tenantId); }
  async start(input: { userId: string; tenantId: string; ip: string }) {
    if (!this.#deps.provider) return { ok: false as const, code: "SAMO-CALENDAR-001" as const };
    const decision = await this.#deps.rateLimiter.hit(`calendar-start:ip:${input.ip}`, START_LIMIT, RATE_WINDOW_MS, this.#deps.clock());
    if (!decision.allowed) return { ok: false as const, code: "SAMO-CALENDAR-500" as const };
    const state = this.#random(), codeVerifier = this.#random();
    return { ok: true as const,
      authorizationUrl: this.#deps.provider.authorizeUrl({ state, codeChallenge: codeChallengeS256(codeVerifier) }),
      setCookie: issueCalendarOAuthStateCookie({ state, codeVerifier, userId: input.userId, tenantId: input.tenantId }, this.#deps.sessionSecret, this.#deps.clock),
    };
  }
  async callback(input: { userId: string; tenantId: string; ip: string; stateCookie: string | null; params: URLSearchParams }) {
    if (!this.#deps.provider) return { ok: false as const, code: "SAMO-CALENDAR-001" as const };
    if (input.params.has("error")) return { ok: false as const, code: input.params.get("error") === "access_denied" ? "SAMO-CALENDAR-002" as const : "SAMO-CALENDAR-004" as const };
    if (!input.stateCookie) return { ok: false as const, code: "SAMO-CALENDAR-003" as const };
    const claims = verifyCalendarOAuthStateForCallback(input.stateCookie, this.#deps.sessionSecret, input.params.get("state"), input.userId, input.tenantId, this.#deps.clock());
    if (!claims) return { ok: false as const, code: "SAMO-CALENDAR-003" as const };
    const code = input.params.get("code");
    if (!code) return { ok: false as const, code: "SAMO-CALENDAR-004" as const };
    const decision = await this.#deps.rateLimiter.hit(`calendar-callback:ip:${input.ip}`, CALLBACK_LIMIT, RATE_WINDOW_MS, this.#deps.clock());
    if (!decision.allowed) return { ok: false as const, code: "SAMO-CALENDAR-500" as const };
    const exchanged = await this.#deps.provider.exchangeCode({ code, codeVerifier: claims.codeVerifier });
    if (!exchanged.ok) return { ok: false as const, code: "SAMO-CALENDAR-004" as const };
    try {
      const existing = await this.#deps.store.get(input.userId, input.tenantId);
      const rowBase = { id: existing?.id ?? randomUUID(), userId: input.userId, tenantId: input.tenantId };
      const encrypted = encryptSecret(exchanged.refreshToken, this.#deps.activeKey, this.#deps.activeKeyVersion, aad(rowBase));
      const row: CalendarConnection = { ...rowBase, encryptedRefreshToken: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenTag: encrypted.tag, encryptionKeyVersion: encrypted.keyVersion, grantedScopes: exchanged.scopes, status: "connected", connectedAt: new Date(this.#deps.clock()), lastSyncAt: null, lastSyncErrorAt: null };
      await this.#deps.store.save(row);
      // Slice 2 seam: Slices 3/4 inject the shared immediate synchronization service.
      await this.#deps.immediateSync?.(row.id).catch(() => {});
      return { ok: true as const };
    } catch { return { ok: false as const, code: "SAMO-CALENDAR-500" as const }; }
  }
  async status(userId: string, tenantId: string) { return this.#deps.store.get(userId, tenantId); }
  async disconnect(userId: string, tenantId: string): Promise<void> {
    const row = await this.#deps.store.get(userId, tenantId);
    if (!row) return;
    try {
      const key = this.#deps.decryptionKeys.get(row.encryptionKeyVersion);
      if (key && this.#deps.provider) await this.#deps.provider.revoke(decryptSecret({ ciphertext: row.encryptedRefreshToken, iv: row.refreshTokenIv, tag: row.refreshTokenTag, keyVersion: row.encryptionKeyVersion }, key, aad(row)));
    } catch { /* Revocation is best effort; local deletion is the privacy boundary. */ }
    await this.#deps.store.delete(userId, tenantId);
  }
}
