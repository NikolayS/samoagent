import { describe, expect, it } from "bun:test";
import { displayMeetingUrl, meetingTitle } from "./meetingUrl.ts";

describe("meetingTitle — a readable name for a meeting URL", () => {
  it("names a Google Meet room by its code", () => {
    expect(meetingTitle("https://meet.google.com/qpd-zbkg-jfo")).toBe("Google Meet · qpd-zbkg-jfo");
  });

  it("ignores Google Meet query strings", () => {
    expect(meetingTitle("https://meet.google.com/qpd-zbkg-jfo?authuser=1&hs=122")).toBe(
      "Google Meet · qpd-zbkg-jfo",
    );
  });

  it("groups a 10-digit Zoom meeting id like Zoom does", () => {
    expect(meetingTitle("https://zoom.us/j/1234567890")).toBe("Zoom · 123 456 7890");
  });

  it("groups a 9-digit Zoom meeting id", () => {
    expect(meetingTitle("https://zoom.us/j/123456789")).toBe("Zoom · 123 456 789");
  });

  it("groups an 11-digit Zoom meeting id", () => {
    expect(meetingTitle("https://us02web.zoom.us/j/12345678901")).toBe("Zoom · 123 4567 8901");
  });

  it("never leaks a Zoom join password into the title", () => {
    expect(meetingTitle("https://zoom.us/j/1234567890?pwd=s3cr3tPassw0rd")).toBe(
      "Zoom · 123 456 7890",
    );
  });

  it("names a Zoom personal room by its vanity path", () => {
    expect(meetingTitle("https://zoom.us/my/alex.room")).toBe("Zoom · alex.room");
  });

  it("falls back to the bare provider name when there is no meeting code", () => {
    expect(meetingTitle("https://meet.google.com/")).toBe("Google Meet");
    expect(meetingTitle("https://zoom.us")).toBe("Zoom");
  });

  it("falls back to the hostname for an unknown provider", () => {
    expect(meetingTitle("https://teams.microsoft.com/l/meetup-join/x?p=y")).toBe(
      "teams.microsoft.com",
    );
  });

  it("returns the trimmed input for something that is not a URL", () => {
    expect(meetingTitle("  not a url  ")).toBe("not a url");
  });

  it("returns an empty string for empty input", () => {
    expect(meetingTitle("")).toBe("");
    expect(meetingTitle("   ")).toBe("");
  });
});

describe("displayMeetingUrl — the URL minus its secrets", () => {
  it("strips the query string and fragment", () => {
    expect(displayMeetingUrl("https://zoom.us/j/1234567890?pwd=s3cr3t#success")).toBe(
      "https://zoom.us/j/1234567890",
    );
  });

  it("keeps scheme, host and path", () => {
    expect(displayMeetingUrl("https://meet.google.com/qpd-zbkg-jfo")).toBe(
      "https://meet.google.com/qpd-zbkg-jfo",
    );
  });

  it("keeps a non-default port", () => {
    expect(displayMeetingUrl("https://meet.example.com:8443/room?x=1")).toBe(
      "https://meet.example.com:8443/room",
    );
  });

  it("drops a bare root path", () => {
    expect(displayMeetingUrl("https://zoom.us/?pwd=nope")).toBe("https://zoom.us");
  });

  it("returns the trimmed input for something that is not a URL", () => {
    expect(displayMeetingUrl("  not a url  ")).toBe("not a url");
  });

  it("returns an empty string for empty input", () => {
    expect(displayMeetingUrl("")).toBe("");
  });
});
