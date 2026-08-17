import { describe, it, expect } from "bun:test";
import {
  authErrorMessage,
  isAuthErrorCode,
  isAuthInfoCode,
  AUTH_FALLBACK_MESSAGE,
} from "./authErrors.ts";

describe("authErrorMessage — exact §5.16 copy for each SAMO-AUTH code", () => {
  it("maps SAMO-AUTH-001 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-001")).toBe("This sign-in link isn't valid.");
  });

  it("maps SAMO-AUTH-002 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-002")).toBe("This sign-in link has expired.");
  });

  it("maps SAMO-AUTH-003 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-003")).toBe("This link was already used.");
  });

  it("maps SAMO-AUTH-004 to the exact user-facing string (em dash)", () => {
    expect(authErrorMessage("SAMO-AUTH-004")).toBe(
      "Too many sign-in attempts — try again shortly.",
    );
  });

  it("returns the fallback message for an unknown code", () => {
    expect(authErrorMessage("SAMO-NOPE-999")).toBe(AUTH_FALLBACK_MESSAGE);
    expect(AUTH_FALLBACK_MESSAGE).toBe("Couldn't sign you in. Request a new link.");
  });

  it("isAuthErrorCode is a precise type guard", () => {
    expect(isAuthErrorCode("SAMO-AUTH-001")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-004")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-005")).toBe(false);
    expect(isAuthErrorCode("")).toBe(false);
  });
});

/**
 * Google sign-in codes (issue #209, PR 6). These arrive as `?error=<CODE>` on a
 * 302 back to `/auth` — a browser redirect carries no JSON body — and render
 * through the SAME code→copy map the magic-link callback already uses. Copy is
 * verbatim from the §5.16 rows in `SPEC.amendments.md` (S5-1).
 *
 * `SAMO-AUTH-005` stays UNMAPPED on purpose: it is a server-side "session
 * outlived its tenant" 401 that clears the cookie, never a `?error=` value on the
 * sign-in page. Adding 006–010 must not quietly add 005.
 */
describe("authErrorMessage — exact §5.16 copy for the Google codes (#209)", () => {
  it("maps SAMO-AUTH-006 to the exact user-facing string (cancelled at Google)", () => {
    expect(authErrorMessage("SAMO-AUTH-006")).toBe(
      "Sign-in cancelled. Choose a way to sign in below.",
    );
  });

  it("maps SAMO-AUTH-007 to the exact user-facing string (em dash)", () => {
    expect(authErrorMessage("SAMO-AUTH-007")).toBe(
      "That sign-in attempt expired — please try again.",
    );
  });

  it("maps SAMO-AUTH-008 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-008")).toBe(
      "Google couldn't sign you in right now.",
    );
  });

  it("maps SAMO-AUTH-009 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-009")).toBe(
      "Your Google account's email isn't verified.",
    );
  });

  it("maps SAMO-AUTH-010 to the exact user-facing string", () => {
    expect(authErrorMessage("SAMO-AUTH-010")).toBe(
      "Google sign-in isn't available here.",
    );
  });

  it("recognizes 006–010 and still rejects 005 and 011", () => {
    expect(isAuthErrorCode("SAMO-AUTH-006")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-007")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-008")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-009")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-010")).toBe(true);
    expect(isAuthErrorCode("SAMO-AUTH-005")).toBe(false);
    expect(isAuthErrorCode("SAMO-AUTH-011")).toBe(false);
  });

  it("marks ONLY SAMO-AUTH-006 as info tone, not an error (§5.16 S5-1)", () => {
    expect(isAuthInfoCode("SAMO-AUTH-006")).toBe(true);
    expect(isAuthInfoCode("SAMO-AUTH-007")).toBe(false);
    expect(isAuthInfoCode("SAMO-AUTH-008")).toBe(false);
    expect(isAuthInfoCode("SAMO-AUTH-009")).toBe(false);
    expect(isAuthInfoCode("SAMO-AUTH-010")).toBe(false);
    expect(isAuthInfoCode("SAMO-AUTH-001")).toBe(false);
    expect(isAuthInfoCode("SAMO-NOPE-999")).toBe(false);
  });
});
