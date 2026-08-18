/**
 * Auth error codes and their exact user-facing copy (SPEC §5.16).
 *
 * Two delivery shapes, ONE map. The magic-link callback page switches on the
 * stable `SAMO-AUTH-00x` code in the `/auth/callback` JSON envelope; the Google
 * callback cannot return a body at all (it 302s the browser), so it appends
 * `?error=<CODE>` to `/auth` and the sign-in page renders the same string.
 * Codes are stable and safe to switch on.
 *
 * Pure, DOM-free — typechecked by the repo-wide `tsc --noEmit`.
 */
export const AUTH_ERROR_CODES = [
  "SAMO-AUTH-001",
  "SAMO-AUTH-002",
  "SAMO-AUTH-003",
  "SAMO-AUTH-004",
  // Google sign-in (issue #209 / SPEC.amendments S5-1). These never arrive in a
  // JSON body: the Google callback is a browser redirect, so it hands the code
  // back as `/auth?error=<CODE>` and the sign-in page renders it from this same
  // map. `SAMO-AUTH-005` is deliberately NOT here — it is a server-side
  // session-outlived-its-tenant 401 that clears the cookie, never a `?error=`.
  "SAMO-AUTH-006",
  "SAMO-AUTH-007",
  "SAMO-AUTH-008",
  "SAMO-AUTH-009",
  "SAMO-AUTH-010",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  "SAMO-AUTH-001": "This sign-in link isn't valid.",
  "SAMO-AUTH-002": "This sign-in link has expired.",
  "SAMO-AUTH-003": "This link was already used.",
  "SAMO-AUTH-004": "Too many sign-in attempts — try again shortly.",
  "SAMO-AUTH-006": "Sign-in cancelled. Choose a way to sign in below.",
  "SAMO-AUTH-007": "That sign-in attempt expired — please try again.",
  "SAMO-AUTH-008": "Google couldn't sign you in right now.",
  "SAMO-AUTH-009": "Your Google account's email isn't verified.",
  "SAMO-AUTH-010": "Google sign-in isn't available here.",
};

/**
 * Codes that report a normal outcome rather than a failure. §5.16 (S5-1) marks
 * `SAMO-AUTH-006` — the user pressed "Cancel" on Google's consent screen — as
 * "(info tone, not an error)": they did exactly what they meant to, so shouting
 * at them in `role="alert"` red would be the UI lying about what happened.
 */
export function isAuthInfoCode(code: string): boolean {
  return code === "SAMO-AUTH-006";
}

/** Shown when the server returns an unrecognized / non-auth error code. */
export const AUTH_FALLBACK_MESSAGE = "Couldn't sign you in. Request a new link.";

/**
 * Shown for infra failures (HTTP 5xx or a network error) — NOT the token itself.
 * A 5xx body often lacks a `code`, so the typed error's `code` falls back to
 * `SAMO-AUTH-001`; the callback must branch on `status`, not `code`, so it does
 * not mislead the user into thinking a valid link is invalid.
 */
export const AUTH_INFRA_MESSAGE =
  "Something went wrong on our end — please try again.";

export function isAuthErrorCode(code: string): code is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(code);
}

export function authErrorMessage(code: string): string {
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : AUTH_FALLBACK_MESSAGE;
}
