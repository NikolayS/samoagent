import { describe, expect, it } from "bun:test";
import { g2ClientIp } from "./server.ts";

describe("g2ClientIp", () => {
  const request = new Request("http://relay/g2/pair", { headers: { "x-forwarded-for": "203.0.113.8, 127.0.0.1" } });

  it("trusts the first forwarded address from a loopback peer", () => {
    expect(g2ClientIp(request, "127.0.0.1")).toBe("203.0.113.8");
    expect(g2ClientIp(request, "::1")).toBe("203.0.113.8");
  });

  it("uses a non-loopback peer and ignores spoofed forwarding", () => {
    expect(g2ClientIp(request, "198.51.100.4")).toBe("198.51.100.4");
  });
});
