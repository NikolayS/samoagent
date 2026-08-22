import { describe, expect, it } from "bun:test";
import { googleCalendarOAuthFromEnv } from "./google-calendar-oauth.ts";
import { calendarTokenEncryptionFromEnv } from "./encryption-config.ts";

const credentials = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
describe("Calendar production configuration", () => {
  it("derives the registered web origin and accepts an exact override", () => {
    expect(googleCalendarOAuthFromEnv(credentials, "https://samograph.dev")?.redirectUri).toBe("https://samograph.dev/calendar/connect/callback");
    expect(googleCalendarOAuthFromEnv({ ...credentials, GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/calendar/connect/callback" }, "https://unregistered.test")?.redirectUri).toBe("http://localhost:3000/calendar/connect/callback");
  });
  it("rejects unregistered derived origins and malformed overrides", () => {
    expect(() => googleCalendarOAuthFromEnv(credentials, "https://preview.samo.cat")).toThrow();
    expect(() => googleCalendarOAuthFromEnv({ ...credentials, GOOGLE_CALENDAR_REDIRECT_URI: "https://samograph.dev/auth/google/callback" }, "https://samograph.dev")).toThrow();
  });
  it("fails closed on missing/mismatched encryption configuration", () => {
    expect(() => calendarTokenEncryptionFromEnv({})).toThrow(/CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION/);
    const encoded = Buffer.alloc(32, 9).toString("base64");
    const config = calendarTokenEncryptionFromEnv({ CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION: "1", CALENDAR_TOKEN_ENCRYPTION_KEY: encoded, CALENDAR_TOKEN_DECRYPTION_KEYS: JSON.stringify({ 1: encoded }) });
    expect(config.activeKeyVersion).toBe(1);
    expect(config.decryptionKeys.get(1)?.equals(Buffer.alloc(32, 9))).toBe(true);
  });
});
