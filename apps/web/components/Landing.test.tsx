import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { Landing } from "./Landing.tsx";
import { installDom } from "../test/setup.tsx";

installDom();

describe("Landing (Refined redesign)", () => {
  it("renders navigation with branding, theme switcher, and auth CTA", () => {
    const { getByRole } = render(<Landing />);
    const nav = getByRole("navigation", { name: "Primary" });
    expect(nav.querySelector('img[src="/robot-mark.png"]')).not.toBeNull();
    expect(nav.textContent).toContain("samograph.dev");
    expect(getByRole("group", { name: "Theme" })).toBeDefined();
    expect((nav.querySelector('a[href="/auth"]') as HTMLAnchorElement).textContent).toBe("Get started");
  });

  it("uses the approved hero copy and sends every primary CTA to /auth", () => {
    const { getByRole, getAllByRole } = render(<Landing />);
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Paste a meeting link.The transcript starts arriving.");
    const links = getAllByRole("link", { name: "Get started" });
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.every((link) => link.getAttribute("href") === "/auth")).toBe(true);
  });

  it("renders the transcript instrument speakers and approved sample lines", () => {
    const { getByRole } = render(<Landing />);
    const transcript = getByRole("list", { name: "Sample transcript lines" });
    expect(transcript.textContent).toContain("Dana:");
    expect(transcript.textContent).toContain("Morgan:");
    expect(transcript.textContent).toContain("Jamie:");
    expect(transcript.textContent).toContain("P99 climbed right after we expanded the canary rollout to ten percent.");
    expect(transcript.textContent).toContain("The incident timeline shows the same three retries as last week.");
  });

  it("renders all approved pricing tier names and prices", () => {
    const { getByRole } = render(<Landing />);
    const pricing = getByRole("region", { name: "Pricing" });
    for (const text of ["Free", "$0", "Individual", "$20/mo", "Team", "$25/user/mo"]) expect(pricing.textContent).toContain(text);
  });

  it("renders the centered footer link set", () => {
    const { getByRole } = render(<Landing />);
    const labels = Array.from(getByRole("contentinfo").querySelectorAll("a"), (link) => link.textContent);
    expect(labels).toEqual(["get started", "docs", "cli on github", "dictionaries", "status", "privacy", "hello@samograph.dev"]);
  });
});
