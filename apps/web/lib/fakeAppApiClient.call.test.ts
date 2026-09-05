import { describe, expect, it } from "bun:test";
import { AppApiError, type Call } from "./appApiClient.ts";
import { createFakeAppApiClient } from "./fakeAppApiClient.ts";

describe("FakeAppApiClient.getCall", () => {
  const seeded: Call = {
    id: "call_1",
    meetingUrl: "https://zoom.us/j/1234567890?pwd=secret",
    provider: "zoom",
    status: "COULD_NOT_JOIN",
  };

  it("returns a seeded call by id and records GET /calls/:id", async () => {
    const client = createFakeAppApiClient({ seedCalls: [seeded] });
    expect(await client.getCall("call_1")).toEqual(seeded);
    expect(client.requests).toEqual([
      { path: "/calls/call_1", method: "GET", body: {} },
    ]);
  });

  // The fake must fail the way the SERVER fails, or a component tested against
  // it handles a status production never sends (#294 review). `GET /calls/:id`
  // in `apps/app-api/calls/http.ts` runs the tenancy gate and returns the single
  // bodyless 403 of `denied()` for a call that is unknown OR belongs to another
  // tenant — the RLS read simply finds no row, and the route deliberately does
  // not distinguish the two (no existence leak). It is 404 only on the SHARE
  // route, for a call with no live token.
  it("rejects an unknown id the way the server does: a bodyless 403", async () => {
    const client = createFakeAppApiClient({ seedCalls: [seeded] });
    let thrown: unknown;
    try {
      await client.getCall("missing");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppApiError);
    expect((thrown as AppApiError).status).toBe(403);
    expect((thrown as AppApiError).code).toBe("SAMO-AUTHZ-001");
  });
});
