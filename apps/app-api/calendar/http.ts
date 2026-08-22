import { clientIp } from "../auth/http.ts";
import { AUTH_ERROR_REDIRECT_PATH } from "../auth/google-http.ts";
import { sessionInvalidResponse } from "../auth/owner-session.ts";
import { buildClearedSessionCookie, SESSION_COOKIE_NAME, verifySession } from "../auth/session.ts";
import { buildClearedCalendarOAuthStateCookie, readCalendarOAuthStateCookie } from "./oauth-state.ts";
import type { CalendarErrorCode, CalendarService } from "./service.ts";

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) { const i = part.indexOf("="); if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
function jsonError(code: CalendarErrorCode, status: number) { return Response.json({ code }, { status, headers: { "cache-control": "no-store" } }); }
function redirect(code?: CalendarErrorCode) {
  return new Response(null, { status: 302, headers: { location: code ? `/settings?calendar_error=${code}` : "/settings?calendar=connected", "set-cookie": buildClearedCalendarOAuthStateCookie(), "cache-control": "no-store" } });
}
function deadSessionCallbackRedirect(): Response {
  const headers = new Headers({ location: AUTH_ERROR_REDIRECT_PATH, "cache-control": "no-store" });
  headers.append("set-cookie", buildClearedSessionCookie());
  headers.append("set-cookie", buildClearedCalendarOAuthStateCookie());
  return new Response(null, { status: 302, headers });
}
export function createCalendarHandler(service: CalendarService, sessionSecret: string, now: () => number) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url), isCallback = req.method === "GET" && url.pathname === "/calendar/connect/callback";
    const raw = cookie(req, SESSION_COOKIE_NAME), claims = raw ? verifySession(raw, sessionSecret, now()) : null;
    if (!claims) return isCallback ? redirect("SAMO-CALENDAR-003") : new Response(null, { status: 401 });
    if (!(await service.tenantExists(claims.tenantId).catch(() => false))) return isCallback ? deadSessionCallbackRedirect() : sessionInvalidResponse();
    if (req.method === "POST" && url.pathname === "/calendar/connect/start") {
      const result = await service.start({ userId: claims.userId, tenantId: claims.tenantId, ip: clientIp(req) });
      return result.ok ? Response.json({ authorization_url: result.authorizationUrl }, { headers: { "set-cookie": result.setCookie, "cache-control": "no-store" } }) : jsonError(result.code, result.code === "SAMO-CALENDAR-001" ? 503 : 500);
    }
    if (isCallback) {
      const result = await service.callback({ userId: claims.userId, tenantId: claims.tenantId, ip: clientIp(req), stateCookie: readCalendarOAuthStateCookie(req), params: url.searchParams }).catch(() => ({ ok: false as const, code: "SAMO-CALENDAR-500" as const }));
      return result.ok ? redirect() : redirect(result.code);
    }
    if (req.method === "GET" && url.pathname === "/calendar/status") {
      const row = await service.status(claims.userId, claims.tenantId);
      if (!row) return Response.json({ provider: "google", state: "not_connected", connected_at: null, last_sync_at: null, last_sync_error_at: null }, { headers: { "cache-control": "no-store" } });
      return Response.json({ provider: "google", state: row.status, connected_at: row.connectedAt.toISOString(), last_sync_at: row.lastSyncAt?.toISOString() ?? null, last_sync_error_at: row.lastSyncErrorAt?.toISOString() ?? null, ...(row.status === "broken" ? { error: { code: "SAMO-CALENDAR-005" } } : {}) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "DELETE" && url.pathname === "/calendar/connection") { await service.disconnect(claims.userId, claims.tenantId); return new Response(null, { status: 204 }); }
    return new Response("not found", { status: 404 });
  };
}
