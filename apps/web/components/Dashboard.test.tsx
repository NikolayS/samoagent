import { describe, it, expect } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { Dashboard } from "./Dashboard.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import type { Call } from "../lib/appApiClient.ts";
import { installDom } from "../test/setup.tsx";

installDom();

const noopRedirect = () => {};

const SEED: Call[] = [
  { id: "call_2", meetingUrl: "https://zoom.us/j/2", provider: "zoom", status: "JOINING" },
  { id: "call_1", meetingUrl: "https://meet.google.com/abc-defg-hij", provider: "google_meet", status: "PENDING" },
];

describe("Dashboard — fetches and renders the tenant's calls (SPEC §3 Story 1)", () => {
  it("lists calls from GET /calls on load", async () => {
    const client = createFakeAppApiClient({ seedCalls: SEED });
    const { findByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    expect(await findByText("https://zoom.us/j/2")).toBeDefined();
    expect(await findByText("https://meet.google.com/abc-defg-hij")).toBeDefined();
    // The list came from a real GET /calls, not just component state.
    expect(client.requests.some((r) => r.path === "/calls" && r.method === "GET")).toBe(true);
  });

  it("shows an empty-state when the tenant has no calls", async () => {
    const client = createFakeAppApiClient();
    const { findByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    expect(await findByText(/No calls yet/)).toBeDefined();
  });

  it("adds a newly created call to the list (re-fetched after create)", async () => {
    const client = createFakeAppApiClient();
    const { container, getByLabelText, findByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    await findByText(/No calls yet/);
    fireEvent.change(getByLabelText("Meeting link"), {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    fireEvent.submit(form);
    // The created call shows up in the persisted "Your calls" list.
    expect(await findByText("https://meet.google.com/abc-defg-hij")).toBeDefined();
  });

  it("re-fetches calls after adding samograph from an upcoming meeting", async () => {
    const client = createFakeAppApiClient({ seedCalendarMeetings: {
      connectionState: "connected", lastSyncAt: null, meetings: [
        { id: "meeting-1", title: "Planning", startsAt: "2026-08-21T17:00:00Z", endsAt: "2026-08-21T17:30:00Z", allDay: false, meetingUrl: "https://meet.google.com/abc-defg-hij", meetingProvider: "google_meet", organizerEmail: null, attendeeResponse: "accepted" },
      ],
    } });
    const view = render(<Dashboard client={client} redirect={noopRedirect} />);
    await view.findByText("No calls yet.");

    fireEvent.click(await view.findByRole("button", { name: "Add samograph to Planning" }));

    await view.findByRole("link", { name: /Starting call https:\/\/meet\.google\.com\/abc-defg-hij/ });
    expect(client.requests.filter((request) => request.path === "/calls" && request.method === "GET")).toHaveLength(2);
  });

  it("leaves account identity and logout controls to AppShell", async () => {
    const client = createFakeAppApiClient({ seedCalls: SEED, seedAccountEmail: "person@example.com" });
    const { findByText, queryByRole, queryByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    await findByText("https://zoom.us/j/2");
    expect(queryByRole("button", { name: /log out/i })).toBeNull();
    expect(queryByText("Signed in as person@example.com")).toBeNull();
  });

  it("redirects an anonymous visitor (401 on GET /calls) to /auth", async () => {
    const client = createFakeAppApiClient({
      failListCallsWith: { code: "SAMO-CALL-LIST", message: "no session", status: 401 },
    });
    const seen: string[] = [];
    render(<Dashboard client={client} redirect={(p) => seen.push(p)} />);
    // Let the rejected probe settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["/auth"]);
  });
});

describe("Dashboard — Slice 4 information hierarchy", () => {
  it("renders exactly one h1 named 'Your calls'", async () => {
    const client = createFakeAppApiClient({ seedCalls: SEED });
    const view = render(<Dashboard client={client} redirect={noopRedirect} />);
    await view.findByText("https://zoom.us/j/2");
    const headings = view.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Your calls");
  });

  it("puts the samograph hero paste form in the first section", async () => {
    const client = createFakeAppApiClient({ seedCalls: SEED });
    const { container, findByText, getByPlaceholderText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    await findByText("https://zoom.us/j/2");
    const sections = Array.from(container.querySelectorAll("section"));
    const form = getByPlaceholderText("Paste a Zoom or Google Meet link").closest("form");
    const hero = form?.closest("section") ?? null;
    expect(hero).toBe(sections[0]);
    expect(hero?.classList.contains("samograph-dash-hero")).toBe(true);
    const upcoming = container.querySelector('section[aria-label="Upcoming meetings"]');
    const firstCallList = container.querySelector(".samograph-call-list");
    expect(hero!.compareDocumentPosition(upcoming!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(upcoming!.compareDocumentPosition(firstCallList!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero!.compareDocumentPosition(firstCallList!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts the danger zone after every call list", async () => {
    const client = createFakeAppApiClient({ seedCalls: SEED });
    const { container, findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    await findByText("https://zoom.us/j/2");
    const sections = Array.from(container.querySelectorAll("section"));
    const danger = container.querySelector(".samograph-danger-zone");
    const upcoming = container.querySelector('section[aria-label="Upcoming meetings"]');
    const callSections = Array.from(container.querySelectorAll(".samograph-call-list"),
      (list) => list.closest("section"));
    expect(danger).toBe(sections.at(-1) ?? null);
    expect(upcoming?.parentElement).toBe(danger?.parentElement ?? null);
    for (const section of callSections) {
      expect(section?.parentElement).toBe(danger?.parentElement ?? null);
    }
    for (const list of container.querySelectorAll(".samograph-call-list")) {
      expect(list.compareDocumentPosition(danger!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("keeps the no-calls message in the dashboard empty-state", async () => {
    const client = createFakeAppApiClient();
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    const message = await findByText("No calls yet.");
    expect(message.closest(".samograph-empty-state")).not.toBeNull();
  });

  it("autofocuses the paste input when the dashboard has no calls", async () => {
    const client = createFakeAppApiClient();
    const { findByPlaceholderText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    const input = await findByPlaceholderText("Paste a Zoom or Google Meet link");
    expect(document.activeElement === input).toBe(true);
  });
});

describe("Dashboard — Slice 4 call rows", () => {
  it("renders status chips with the exact state copy and kind", async () => {
    const calls: Call[] = [
      { id: "live", meetingUrl: "https://zoom.us/j/live", provider: "zoom", status: "IN_CALL" },
      { id: "joining", meetingUrl: "https://zoom.us/j/joining", provider: "zoom", status: "JOINING" },
      { id: "pending", meetingUrl: "https://zoom.us/j/pending", provider: "zoom", status: "PENDING" },
      { id: "ended", meetingUrl: "https://zoom.us/j/ended", provider: "zoom", status: "ENDED" },
      { id: "failed", meetingUrl: "https://zoom.us/j/failed", provider: "zoom", status: "COULD_NOT_JOIN" },
    ];
    const client = createFakeAppApiClient({ seedCalls: calls });
    const { container, findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    await findByText("https://zoom.us/j/live");
    const expected = [
      ["live", "Live"], ["joining", "Joining"], ["pending", "Starting"],
      ["ended", "Ended"], ["error", "Couldn't join"],
    ];
    const chips = Array.from(container.querySelectorAll(".samograph-status-chip"));
    expect(chips).toHaveLength(expected.length);
    expect(chips.map((chip) => [chip.getAttribute("data-kind"), chip.textContent])).toEqual(expected);
    for (const item of container.querySelectorAll("li.samograph-call-item")) {
      expect(item.querySelector(":scope > a.samograph-call-row")).not.toBeNull();
    }
    const endedRow = container.querySelector('[aria-label*="https://zoom.us/j/ended"]');
    expect(endedRow?.querySelector(".samograph-call-cta-open")).not.toBeNull();
  });

  it("preserves the full meeting URL in the URL title and row accessible name", async () => {
    const url = "https://meet.google.com/a-very-long-meeting-code?authuser=person%40example.com";
    const client = createFakeAppApiClient({
      seedCalls: [{ id: "long", meetingUrl: url, provider: "google_meet", status: "ENDED" }],
    });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    const urlSpan = await findByText(url);
    expect(urlSpan.classList.contains("samograph-call-url")).toBe(true);
    expect(urlSpan.getAttribute("title")).toBe(url);
    expect(urlSpan.closest("a.samograph-call-row")?.getAttribute("aria-label")).toContain(url);
  });
});

describe("Dashboard — failed calls display their error reason (SPEC §5.16, Story 4)", () => {
  const FAILED: Call[] = [
    {
      id: "call_9",
      meetingUrl: "https://meet.google.com/bad-code-xxx",
      provider: "google_meet",
      status: "COULD_NOT_JOIN",
      statusReason: "meeting_not_found",
    },
    {
      id: "call_8",
      meetingUrl: "https://zoom.us/j/8",
      provider: "zoom",
      status: "COULD_NOT_RECORD",
      statusReason: "recording_permission_denied_by_host",
    },
    { id: "call_7", meetingUrl: "https://zoom.us/j/7", provider: "zoom", status: "IN_CALL" },
  ];

  it("shows the §5.16 reason next to a failed call's status", async () => {
    const client = createFakeAppApiClient({ seedCalls: FAILED });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    // Exact §5.16 copy, reason included: "Couldn't join — <Recall reason>."
    expect(await findByText("Couldn't join — meeting_not_found.")).toBeDefined();
    expect(
      await findByText("Couldn't start recording — recording_permission_denied_by_host."),
    ).toBeDefined();
  });

  it("a COULD_NOT_JOIN call with no reason still gets the fallback copy (never silent)", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [
        {
          id: "call_5",
          meetingUrl: "https://zoom.us/j/5",
          provider: "zoom",
          status: "COULD_NOT_JOIN",
        },
      ],
    });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    expect(await findByText("Couldn't join — the meeting couldn't be reached.")).toBeDefined();
  });

  it("shows NO error copy for a healthy call", async () => {
    const client = createFakeAppApiClient({ seedCalls: FAILED });
    const { findByText, queryByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    await findByText("https://zoom.us/j/7");
    expect(queryByText(/Couldn't join.*zoom\.us\/j\/7/)).toBeNull();
  });

  it("links each call to its per-call page carrying ?url= (COULD_NOT_JOIN reaches Try-again, Story 4)", async () => {
    const client = createFakeAppApiClient({ seedCalls: FAILED });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    const anchor = (await findByText("https://meet.google.com/bad-code-xxx")).closest("a");
    expect(anchor).not.toBeNull();
    // The per-call page (OwnerCallView) owns "Try again"; ?url= carries the
    // original meeting URL so Try-again can pre-fill the dashboard input.
    expect(anchor?.getAttribute("href")).toBe(
      `/calls/call_9?url=${encodeURIComponent("https://meet.google.com/bad-code-xxx")}`,
    );
  });
});

describe("Dashboard — each call row is an obvious transcript link (affordance)", () => {
  it("renders the whole row as a link to the per-call page with a clear 'View transcript' CTA", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [
        { id: "call_e", meetingUrl: "https://zoom.us/j/e", provider: "zoom", status: "ENDED" },
      ],
    });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    const row = (await findByText("https://zoom.us/j/e")).closest("a");
    expect(row).not.toBeNull();
    // Whole row is the link into the transcript page.
    expect(row?.getAttribute("href")).toBe(
      `/calls/call_e?url=${encodeURIComponent("https://zoom.us/j/e")}`,
    );
    // Explicit, inviting affordance so a first-time user knows to tap it.
    expect(row?.textContent).toContain("View transcript");
    // Accessible: the link carries its own name.
    expect(row?.getAttribute("aria-label")).toBeTruthy();
  });

  it("a LIVE call (IN_CALL) shows a prominent pulsing 'Live — watch transcript' cue", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [
        { id: "call_live", meetingUrl: "https://zoom.us/j/live", provider: "zoom", status: "IN_CALL" },
      ],
    });
    const { findByText, container } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    // The live cue invites opening the transcript to watch in real time.
    expect(await findByText(/live — watch transcript/i)).toBeDefined();
    // The sole live indicator dot belongs to the status chip, not the CTA.
    expect(container.querySelectorAll(".samograph-call-live-dot")).toHaveLength(1);
    expect(container.querySelector(".samograph-status-chip > .samograph-call-live-dot")).not.toBeNull();
    expect(container.querySelector(".samograph-call-cta > .samograph-call-live-dot")).toBeNull();
    // The row still links into the per-call page.
    const row = (await findByText("https://zoom.us/j/live")).closest("a");
    expect(row?.getAttribute("href")).toBe(
      `/calls/call_live?url=${encodeURIComponent("https://zoom.us/j/live")}`,
    );
  });

  it("a terminal-failure row keeps its reason and does NOT show a transcript invite", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [
        {
          id: "call_f",
          meetingUrl: "https://zoom.us/j/f",
          provider: "zoom",
          status: "COULD_NOT_RECORD",
          statusReason: "recording_permission_denied_by_host",
        },
      ],
    });
    const { findByText, queryByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    // §5.16 reason is preserved.
    expect(
      await findByText("Couldn't start recording — recording_permission_denied_by_host."),
    ).toBeDefined();
    // A failure row must not be dressed up as a transcript invite.
    expect(queryByText(/view transcript/i)).toBeNull();
    expect(queryByText(/watch transcript/i)).toBeNull();
  });

  it("a COULD_NOT_JOIN row offers 'Try again' rather than a transcript invite", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [
        {
          id: "call_j",
          meetingUrl: "https://zoom.us/j/j",
          provider: "zoom",
          status: "COULD_NOT_JOIN",
          statusReason: "meeting_not_found",
        },
      ],
    });
    const { findByText, queryByText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    // Keeps the existing Story-4 "Try again" affordance (the per-call page owns it).
    expect(await findByText(/try again/i)).toBeDefined();
    expect(queryByText(/view transcript/i)).toBeNull();
  });
});

describe("Dashboard — Active vs Past grouping (Sprint-3 polish, SPEC §3)", () => {
  const MIXED: Call[] = [
    { id: "c_live", meetingUrl: "https://zoom.us/j/live", provider: "zoom", status: "IN_CALL" },
    { id: "c_pending", meetingUrl: "https://zoom.us/j/pending", provider: "zoom", status: "PENDING" },
    { id: "c_ended", meetingUrl: "https://zoom.us/j/ended", provider: "zoom", status: "ENDED" },
    {
      id: "c_norec",
      meetingUrl: "https://zoom.us/j/norec",
      provider: "zoom",
      status: "COULD_NOT_RECORD",
      statusReason: "recording_permission_denied_by_host",
    },
    { id: "c_removed", meetingUrl: "https://zoom.us/j/removed", provider: "zoom", status: "BOT_REMOVED" },
  ];

  it("renders two clearly-labelled groups: 'Active calls' and 'Past calls'", async () => {
    const client = createFakeAppApiClient({ seedCalls: MIXED });
    const { findByRole } = render(<Dashboard client={client} redirect={noopRedirect} />);
    expect(await findByRole("heading", { name: "Active calls" })).toBeDefined();
    expect(await findByRole("heading", { name: "Past calls" })).toBeDefined();
  });

  it("places PENDING/JOINING/IN_CALL under Active and terminal calls under Past", async () => {
    const client = createFakeAppApiClient({ seedCalls: MIXED });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    const active = (await findByText("Active calls")).closest("section");
    const past = (await findByText("Past calls")).closest("section");
    if (!active || !past) throw new Error("missing group sections");
    // Active group: live + pending only.
    expect(active.textContent).toContain("https://zoom.us/j/live");
    expect(active.textContent).toContain("https://zoom.us/j/pending");
    expect(active.textContent).not.toContain("https://zoom.us/j/ended");
    expect(active.textContent).not.toContain("https://zoom.us/j/norec");
    // Past group: ended + terminal failures only.
    expect(past.textContent).toContain("https://zoom.us/j/ended");
    expect(past.textContent).toContain("https://zoom.us/j/norec");
    expect(past.textContent).toContain("https://zoom.us/j/removed");
    expect(past.textContent).not.toContain("https://zoom.us/j/live");
  });

  it("omits the 'Past calls' heading entirely when every call is active", async () => {
    const client = createFakeAppApiClient({
      seedCalls: [{ id: "c1", meetingUrl: "https://zoom.us/j/a", provider: "zoom", status: "IN_CALL" }],
    });
    const { findByRole, queryByRole } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    expect(await findByRole("heading", { name: "Active calls" })).toBeDefined();
    expect(queryByRole("heading", { name: "Past calls" })).toBeNull();
  });

  it("renders the bespoke COULD_NOT_RECORD hint in the Past group", async () => {
    const client = createFakeAppApiClient({ seedCalls: MIXED });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    expect(
      await findByText("Check the meeting's recording permissions, then add the call again."),
    ).toBeDefined();
  });

  it("renders the bespoke BOT_REMOVED hint in the Past group", async () => {
    const client = createFakeAppApiClient({ seedCalls: MIXED });
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    expect(await findByText("A host removed samograph from the meeting.")).toBeDefined();
  });
});

describe("Dashboard — first-run empty & loading states (Sprint-3 polish)", () => {
  it("shows an accessible loading state on first paint", () => {
    const client = createFakeAppApiClient({ seedCalls: SEED });
    const { getByRole } = render(<Dashboard client={client} redirect={noopRedirect} />);
    // Before the GET /calls promise settles, a status region announces loading.
    const status = getByRole("status");
    expect(status.textContent).toBe("Loading your dashboard…");
  });

  it("gives first-run guidance (not just 'No calls yet') when there are no calls", async () => {
    const client = createFakeAppApiClient();
    const { findByText } = render(<Dashboard client={client} redirect={noopRedirect} />);
    expect(await findByText(/No calls yet/)).toBeDefined();
    // Concrete first-call guidance, so a new user knows exactly what to do.
    expect(
      await findByText(
        "Paste a Zoom or Google Meet link above to add samograph to your first call.",
      ),
    ).toBeDefined();
  });
});

describe("Dashboard — Story-4 URL pre-fill (SPEC §5.2, Story 4)", () => {
  const URL = "https://meet.google.com/abc-defg-hij";

  it("pre-fills the paste input from initialUrl and creates NO call on load", async () => {
    const client = createFakeAppApiClient();
    const { findByLabelText } = render(
      <Dashboard client={client} redirect={noopRedirect} initialUrl={URL} />,
    );
    const input = (await findByLabelText("Meeting link")) as HTMLInputElement;
    expect(input.value).toBe(URL);
    // Returning from a failed join must NOT auto-create a Call row (one action = one row).
    expect(
      client.requests.filter((r) => r.path === "/calls" && r.method === "POST"),
    ).toHaveLength(0);
  });

  it("creates exactly one Call only on explicit re-submit", async () => {
    const client = createFakeAppApiClient();
    const { container, findByLabelText, findByText } = render(
      <Dashboard client={client} redirect={noopRedirect} initialUrl={URL} />,
    );
    await findByLabelText("Meeting link");
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    fireEvent.submit(form);
    await findByText(URL);
    expect(
      client.requests.filter((r) => r.path === "/calls" && r.method === "POST"),
    ).toHaveLength(1);
  });

  it("leaves the input blank when no initialUrl is given", async () => {
    const client = createFakeAppApiClient();
    const { findByLabelText } = render(
      <Dashboard client={client} redirect={noopRedirect} />,
    );
    const input = (await findByLabelText("Meeting link")) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
