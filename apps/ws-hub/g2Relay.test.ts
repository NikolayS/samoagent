import { describe, expect, it } from "bun:test";
import { G2Relay, isG2Path } from "./g2Relay.ts";

const socket = () => ({
  sent: [] as string[],
  closed: [] as Array<[number, string]>,
  send(value: string) {
    this.sent.push(value);
  },
  close(code: number, reason: string) {
    this.closed.push([code, reason]);
  },
});

describe("G2Relay", () => {
  it("pairs, authenticates whispers, queues by policy, and relays cues", async () => {
    let now = 1_000;
    const relay = new G2Relay({
      now: () => now,
      randomCode: () => "483920",
      randomToken: () => crypto.randomUUID(),
    });
    const app = socket();
    relay.openApp(app);
    expect(JSON.parse(app.sent[0]!).code).toBe("483920");
    const paired = await relay.fetch(
      new Request("http://x/g2/pair", {
        method: "POST",
        body: JSON.stringify({ code: "483920" }),
      }),
      "127.0.0.1",
    );
    expect(paired.status).toBe(200);
    const credentials = await paired.json() as { room_id: string; room_token: string };
    expect(JSON.parse(app.sent.at(-1)!).type).toBe("paired");

    relay.closeApp(app);
    const post = (text: string, priority = "normal") =>
      relay.fetch(
        new Request(`http://x/g2/rooms/${credentials.room_id}/whisper`, {
          method: "POST",
          headers: { authorization: `Bearer ${credentials.room_token}` },
          body: JSON.stringify({ text, priority, ttl_ms: null }),
        }),
        "127.0.0.1",
      );
    expect((await post("one")).status).toBe(202);
    expect((await post("urgent", "high")).status).toBe(202);
    expect((await post("bad")).status).toBe(202);
    const bad = await relay.fetch(
      new Request(`http://x/g2/rooms/${credentials.room_id}/whisper`, {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: JSON.stringify({ text: "x" }),
      }),
      "127.0.0.1",
    );
    expect(bad.status).toBe(401);

    const resumed = socket();
    relay.openApp(resumed);
    relay.messageApp(
      resumed,
      JSON.stringify({
        type: "resume",
        device_token: JSON.parse(app.sent.at(-1)!).device_token,
      }),
    );
    expect(
      resumed.sent
        .map((value) => JSON.parse(value))
        .filter((value) => value.type === "whisper")
        .map((value) => value.text),
    ).toEqual(["urgent", "one", "bad"]);
    const agent = socket(); relay.openAgent(agent, credentials.room_id);
    relay.messageAgent(agent, JSON.stringify({ type: "auth", token: credentials.room_token }));
    relay.messageApp(resumed, JSON.stringify({ type: "cue", cue: "confirm" }));
    expect(JSON.parse(agent.sent.at(-1)!).cue).toBe("confirm");
    const replacement = socket();
    relay.openApp(replacement);
    relay.messageApp(
      replacement,
      JSON.stringify({
        type: "resume",
        device_token: JSON.parse(app.sent.at(-1)!).device_token,
      }),
    );
    expect(resumed.closed.at(-1)?.[0]).toBe(4409);
  });

  it("rate-limits bad claims by IP without disconnecting pending phones", async () => {
    const relay = new G2Relay({
      randomCode: () => "111111",
      randomToken: () => crypto.randomUUID(),
    });
    const app = socket();
    relay.openApp(app);
    const claim = (ip: string) =>
      relay.fetch(
        new Request("http://x/g2/pair", {
          method: "POST",
          body: JSON.stringify({ code: "999999" }),
        }),
        ip,
      );

    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await claim("attacker")).status).toBe(404);
    }
    expect((await claim("attacker")).status).toBe(429);
    expect(app.closed).toEqual([]);
    expect((await claim("different-client")).status).toBe(404);
  });

  it("enforces expiry and frame bounds", async () => {
    let now = 0;
    const relay = new G2Relay({
      now: () => now,
      randomCode: () => "111111",
      randomToken: () => crypto.randomUUID(),
    });
    const expiring = socket();
    relay.openApp(expiring);
    now = 600_001;
    const response = await relay.fetch(
      new Request("http://x/g2/pair", {
        method: "POST",
        body: JSON.stringify({ code: "111111" }),
      }),
      "other",
    );
    expect(response.status).toBe(410);

    const huge = socket();
    relay.openApp(huge);
    relay.messageApp(huge, "x".repeat(8193));
    expect(huge.closed.at(-1)?.[0]).toBe(4400);
  });

  it("only owns /g2 routes", () => {
    expect(isG2Path("/g2/health")).toBe(true);
    expect(isG2Path("/calls/a/stream")).toBe(false);
  });

  it("binds agents only after first-frame auth and times out after five seconds", async () => {
    const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
    const relay = new G2Relay({
      randomCode: () => "222222",
      randomToken: (() => { const values = ["room", "secret", "device"]; return () => values.shift()!; })(),
      setTimeout: (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer as any; },
      clearTimeout: (timer) => void ((timer as any).cleared = true),
    });
    const app = socket(); relay.openApp(app);
    await relay.fetch(new Request("http://x/g2/pair", { method: "POST", body: JSON.stringify({ code: "222222" }) }));

    const waiting = socket(); relay.openAgent(waiting, "room");
    expect(timers[0]?.ms).toBe(5_000);
    expect(waiting.closed).toEqual([]);
    timers[0]!.callback();
    expect(waiting.closed).toEqual([[4401, "unauthorized"]]);

    const invalid = socket(); relay.openAgent(invalid, "room");
    relay.messageAgent(invalid, JSON.stringify({ type: "auth", token: "wrong" }));
    expect(invalid.closed).toEqual([[4401, "unauthorized"]]);
    expect(timers[1]?.cleared).toBe(true);
  });

  it("sweeps expired per-IP claim windows", async () => {
    let now = 0;
    const relay = new G2Relay({ now: () => now });
    await relay.fetch(new Request("http://x/g2/pair", { method: "POST", body: "{}" }), "old");
    expect(relay.claimWindowCount()).toBe(1);
    now = 60_000;
    await relay.fetch(new Request("http://x/g2/health"), "new");
    expect(relay.claimWindowCount()).toBe(0);
  });

  it("caps live per-IP claim windows at 10,000", async () => {
    const relay = new G2Relay({ now: () => 0 });
    const request = () => new Request("http://x/g2/pair", { method: "POST", body: "{}" });
    for (let i = 0; i <= 10_000; i += 1) await relay.fetch(request(), `client-${i}`);
    expect(relay.claimWindowCount()).toBe(10_000);
  });

  it("rejects a whisper when the offline queue reaches hardMax", async () => {
    const tokens = ["room", "secret", "device"];
    const relay = new G2Relay({ randomCode: () => "333333", randomToken: () => tokens.shift()! });
    const app = socket(); relay.openApp(app);
    await relay.fetch(new Request("http://x/g2/pair", { method: "POST", body: JSON.stringify({ code: "333333" }) }));
    relay.closeApp(app);
    const post = () => relay.fetch(new Request("http://x/g2/rooms/room/whisper", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ text: "urgent", priority: "high" }) }));
    for (let i = 0; i < 32; i += 1) expect((await post()).status).toBe(202);
    const full = await post();
    expect(full.status).toBe(429);
    expect(await full.json()).toEqual({ error: "queue full" });
  });
});
