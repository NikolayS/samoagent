/**
 * OVER-THE-WIRE contract tests for `createHttpAppApiClient().getCall(id)`.
 *
 * Component tests use the in-memory fake and therefore cannot catch a mismatch
 * between the API's snake_case `meeting_url` and the web domain's camelCase
 * `meetingUrl`. These tests drive the real fetch client against a real Bun
 * server so a query-bearing join URL is proved intact at the wire boundary.
 *
 * Pure Bun (no DOM) — root `tsc --noEmit` typechecks this file with Bun types.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { AppApiError, createHttpAppApiClient } from "./appApiClient.ts";

let status = 200;
// `null` means a BODYLESS response — how the real route renders both of its
// denials (`denied()` / the share route's 404), which is the shape the client
// has to survive without a JSON parse error.
let body: Record<string, unknown> | null = {};
let requestPath = "";

const server = Bun.serve({
  port: 0,
  fetch(req) {
    requestPath = new URL(req.url).pathname;
    if (req.method === "GET" && requestPath.startsWith("/calls/")) {
      return body === null ? new Response(null, { status }) : Response.json(body, { status });
    }
    return new Response("not found", { status: 404 });
  },
});

const client = createHttpAppApiClient(`http://localhost:${server.port}`);

afterAll(() => {
  server.stop(true);
});

describe("getCall — one call over the wire (#286)", () => {
  it("maps the full raw Zoom URL and snake_case call fields", async () => {
    const id = "call/with spaces";
    status = 200;
    body = {
      id,
      meeting_url: "https://us04web.zoom.us/j/75208520803?pwd=s3cr3tPassw0rd",
      status: "COULD_NOT_JOIN",
      status_reason: "meeting_not_found",
      created_at: "2026-09-04T12:34:56.000Z",
    };

    expect(await client.getCall(id)).toEqual({
      id,
      meetingUrl: "https://us04web.zoom.us/j/75208520803?pwd=s3cr3tPassw0rd",
      provider: "zoom",
      status: "COULD_NOT_JOIN",
      statusReason: "meeting_not_found",
      createdAt: "2026-09-04T12:34:56.000Z",
    });
    expect(requestPath).toBe("/calls/call%2Fwith%20spaces");
  });

  it("maps a Google Meet URL to the google_meet provider", async () => {
    status = 200;
    body = {
      id: "call_google",
      meeting_url: "https://meet.google.com/abc-defg-hij",
      status: "PENDING",
    };
    expect((await client.getCall("call_google")).provider).toBe("google_meet");
  });

  // The status the real route actually renders for an unknown / cross-tenant id
  // is `denied()` — a bodyless 403 (#294 review). 404 is kept alongside it
  // because the share route still uses it for a call with no live token.
  for (const denial of [403, 404] as const) {
    it(`rejects a ${denial} with an AppApiError carrying status ${denial}`, async () => {
      status = denial;
      body = null;
      let thrown: unknown;
      try {
        await client.getCall("missing");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppApiError);
      expect((thrown as AppApiError).status).toBe(denial);
    });
  }

  it("maps a withheld meeting_url to an empty meetingUrl", async () => {
    status = 200;
    body = { id: "call_shared", status: "ENDED" };
    expect((await client.getCall("call_shared")).meetingUrl).toBe("");
  });
});
