import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { OwnerCallView } from "./OwnerCallView.tsx";
import { createFakeTranscriptStreamClient } from "../lib/fakeTranscriptStreamClient.ts";
import { createFakeShareApiClient } from "../lib/fakeShareApiClient.ts";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import type { CallDetail } from "../lib/transcriptStreamClient.ts";
import { installDom } from "../test/setup.tsx";

installDom();

const TS = "2026-06-29 10:00:00";
const MEETING_URL = "https://meet.google.com/abc-defg-hij";

// Default PENDING so the async `fetchCallDetail` seed is a deterministic no-op
// (initial state is already PENDING) — these tests drive status through the
// stream. A non-PENDING seed left un-awaited would schedule a React render task
// that outlives happy-dom's teardown ("window is not defined").
function detail(over: Partial<CallDetail> = {}): CallDetail {
  return { id: "call_1", status: "PENDING", degraded: false, ...over };
}

function renderOwner(
  over: { redirect?: (p: string) => void } = {},
) {
  const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
  const share = createFakeShareApiClient();
  const app = createFakeAppApiClient();
  const redirected: string[] = [];
  const utils = render(
    <OwnerCallView
      streamClient={stream}
      shareClient={share}
      appClient={app}
      callId="call_1"
      meetingUrl={MEETING_URL}
      redirect={over.redirect ?? ((p) => redirected.push(p))}
    />,
  );
  return { stream, share, app, redirected, ...utils };
}

describe("OwnerCallView — owner per-call page (SPEC §4.1, Stories 1/2/4)", () => {
  it("renders exactly one h1 — the readable meeting name, not the raw URL", () => {
    const { getAllByRole, getByRole } = renderOwner();
    expect(getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(getAllByRole("heading", { level: 1 })[0]?.textContent).toBe("Google Meet \u00b7 abc-defg-hij");
    expect(getByRole("link", { name: /dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("demotes the meeting URL to a small secondary line that opens the meeting", () => {
    const { container } = renderOwner();
    const link = container.querySelector("a.samograph-call-view-url");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(MEETING_URL);
    expect(link?.getAttribute("href")).toBe(MEETING_URL);
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("never shows a Zoom join password anywhere in the page or panel header", () => {
    const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
    const { container } = render(
      <OwnerCallView
        streamClient={stream}
        shareClient={createFakeShareApiClient()}
        appClient={createFakeAppApiClient()}
        callId="call_1"
        meetingUrl="https://zoom.us/j/1234567890?pwd=s3cr3tPassw0rd"
        redirect={() => {}}
      />,
    );
    const heading = container.querySelector(".samograph-call-view-heading");
    expect(heading?.querySelector("h1")?.textContent).toBe("Zoom \u00b7 123 456 7890");
    expect(heading?.textContent).not.toContain("s3cr3tPassw0rd");
    expect(heading?.querySelector("a.samograph-call-view-url")?.textContent).toBe(
      "https://zoom.us/j/1234567890",
    );
    // The panel header shows the URL too — at EVERY width (it is only hidden
    // below 768px by CSS), so it must be query-stripped in the markup itself.
    expect(container.querySelector(".samograph-instrument-url")?.textContent).toBe(
      "https://zoom.us/j/1234567890",
    );
    // No visible text and no tooltip anywhere leaks the password.
    expect(container.textContent).not.toContain("pwd=");
    for (const el of container.querySelectorAll("[title]")) {
      expect(el.getAttribute("title")).not.toContain("pwd=");
    }
  });

  it("keeps the RAW join URL as the header link href so the link still joins", () => {
    const raw = "https://zoom.us/j/1234567890?pwd=s3cr3tPassw0rd";
    const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
    const { container } = render(
      <OwnerCallView
        streamClient={stream}
        shareClient={createFakeShareApiClient()}
        appClient={createFakeAppApiClient()}
        callId="call_1"
        meetingUrl={raw}
        redirect={() => {}}
      />,
    );
    const link = container.querySelector("a.samograph-call-view-url");
    // Deliberate: the href is the real join link (stripping it would break
    // click-to-join for a password-protected Zoom room). Only what is RENDERED
    // — link text and tooltips — is query-stripped.
    expect(link?.getAttribute("href")).toBe(raw);
    expect(link?.textContent).toBe("https://zoom.us/j/1234567890");
    expect(link?.getAttribute("title")).toBe("https://zoom.us/j/1234567890");
  });

  it("falls back to the call id when no meeting URL is known", () => {
    const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
    const { container } = render(
      <OwnerCallView
        streamClient={stream}
        shareClient={createFakeShareApiClient()}
        appClient={createFakeAppApiClient()}
        callId="call_abcdefgh"
        meetingUrl=""
        redirect={() => {}}
      />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Call call_abc");
    expect(container.querySelector("a.samograph-call-view-url")).toBeNull();
  });

  it("keeps the call-id fallback when the URL yields no usable title", () => {
    const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
    const { container } = render(
      <OwnerCallView
        streamClient={stream}
        shareClient={createFakeShareApiClient()}
        appClient={createFakeAppApiClient()}
        callId="call_abcdefgh"
        meetingUrl="not a url"
        redirect={() => {}}
      />,
    );
    // `meetingTitle` returns the constant "Meeting" and `displayMeetingUrl` ""
    // for an unparseable input — neither is a heading, so the id wins.
    expect(container.querySelector("h1")?.textContent).toBe("Call call_abc");
    expect(container.querySelector("a.samograph-call-view-url")).toBeNull();
    expect(container.querySelector(".samograph-instrument-url")).toBeNull();
  });

  it("classes the panel-header URL and dictionary so mobile can drop them", () => {
    const { container } = renderOwner();
    expect(container.querySelector(".samograph-instrument-url")?.textContent).toBe(MEETING_URL);
    expect(container.querySelector(".samograph-instrument-dictionary")?.textContent).toBe(
      "dictionary: account default",
    );
  });

  it("renders the transcript as the shared instrument panel", () => {
    const { container } = renderOwner();
    expect(container.querySelectorAll(".samograph-instrument")).toHaveLength(1);
  });

  it("renders the live transcript + status with an owner Share control", () => {
    const { stream, getByText, getByRole } = renderOwner();
    act(() => stream.emitLine({ seq: 1, ts: TS, speaker: "Alice", text: "owner hears this", final: true }));
    expect(getByText(`[${TS}] Alice: owner hears this`)).toBeDefined();
    expect(getByRole("button", { name: "Share" })).toBeDefined();
    expect(getByRole("button", { name: "Share" }).className).toContain("samograph-btn--secondary");
    expect(getByRole("button", { name: "Delete" }).className).toContain("samograph-btn--danger");
  });

  it("opens the Share modal from the Share button", async () => {
    const { share, getByRole, findByText } = renderOwner();
    fireEvent.click(getByRole("button", { name: "Share" }));
    expect(await findByText("Create share link")).toBeDefined();
    expect(share.requests.some((r) => r.path === "/calls/call_1/share" && r.method === "GET")).toBe(true);
  });

  it("shows Try-again only on COULD_NOT_JOIN and returns to the dashboard with the URL pre-filled", async () => {
    const { stream, redirected, findByRole, queryByRole } = renderOwner();
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    act(() => stream.emitStatus("COULD_NOT_JOIN"));
    const tryAgain = await findByRole("button", { name: "Try again" });
    expect(tryAgain.className).toContain("samograph-btn--secondary");
    fireEvent.click(tryAgain);
    expect(redirected).toEqual([
      `/dashboard?url=${encodeURIComponent(MEETING_URL)}`,
    ]);
  });

  it("shows NO Try-again on ENDED and keeps the finalized transcript", () => {
    const { stream, getByText, queryByRole } = renderOwner();
    act(() => stream.emitLine({ seq: 1, ts: TS, speaker: "Bob", text: "recorded utterance", final: true }));
    act(() => stream.emitStatus("ENDED"));
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    expect(getByText(`[${TS}] Bob: recorded utterance`)).toBeDefined();
  });

  it("subscribes as the owner session (no share token)", () => {
    const { stream } = renderOwner();
    expect(stream.connects[0]?.auth).toEqual({ kind: "session" });
  });

  // ── Delete a call (SPEC §5.14 GDPR per-call erasure) ────────────────────────
  it("Delete requires confirmation: the first click does NOT hit the endpoint", async () => {
    const { app, getByRole, findByRole, findByText } = renderOwner();
    fireEvent.click(getByRole("button", { name: "Delete" }));
    expect((await findByRole("button", { name: "Cancel" })).className).toContain("samograph-btn--secondary");
    expect(getByRole("button", { name: "Confirm delete" }).className).toContain("samograph-btn--danger");
    expect(getByRole("button", { name: "Confirm delete" }).className).toContain("samograph-btn--solid");
    // A confirmation prompt appears; no DELETE has been sent yet.
    expect(await findByText(/can.t be undone/i)).toBeDefined();
    expect(app.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("marks Confirm delete busy and disabled while deleting", async () => {
    const rendered = renderOwner();
    rendered.app.deleteCall = () => new Promise(() => {});
    fireEvent.click(rendered.getByRole("button", { name: "Delete" }));
    const confirm = await rendered.findByRole("button", { name: "Confirm delete" }) as HTMLButtonElement;
    fireEvent.click(confirm);
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
  });

  it("Cancel dismisses the confirmation without deleting", async () => {
    const { app, getByRole, findByRole, queryByText } = renderOwner();
    fireEvent.click(getByRole("button", { name: "Delete" }));
    fireEvent.click(await findByRole("button", { name: "Cancel" }));
    expect(queryByText(/can.t be undone/i)).toBeNull();
    expect(app.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("Confirm delete hits DELETE /calls/:id and returns to the dashboard", async () => {
    const redirected: string[] = [];
    const { app, getByRole, findByRole } = renderOwner({
      redirect: (p) => redirected.push(p),
    });
    fireEvent.click(getByRole("button", { name: "Delete" }));
    const confirm = await findByRole("button", { name: "Confirm delete" });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(
      app.requests.some((r) => r.path === "/calls/call_1" && r.method === "DELETE"),
    ).toBe(true);
    expect(redirected).toEqual(["/dashboard"]);
  });

  it("styles call deletion failures as error alerts", async () => {
    const stream = createFakeTranscriptStreamClient({ callDetail: detail() });
    const app = createFakeAppApiClient({ failDeleteCallWith: { code: "SAMO-CALL", message: "no", status: 500 } });
    const view = render(<OwnerCallView streamClient={stream} shareClient={createFakeShareApiClient()} appClient={app} callId="call_1" meetingUrl={MEETING_URL} redirect={() => {}} />);
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    fireEvent.click(await view.findByRole("button", { name: "Confirm delete" }));
    const alert = await view.findByRole("alert");
    expect(alert.className).toContain("samograph-alert samograph-alert--error");
  });
});
