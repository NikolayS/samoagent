/**
 * Readable presentation of a meeting URL. Pure, dependency-free, DOM-free.
 *
 * Two jobs, both about the same problem: a raw join link is not a title, and it
 * can carry a secret. `meetingTitle` names the meeting ("Google Meet ·
 * qpd-zbkg-jfo"); `displayMeetingUrl` shows the link with its query string and
 * fragment removed, so a Zoom `?pwd=` join password is NEVER rendered.
 *
 * Used by the call view header (M4) and the dashboard call rows (M7).
 */

const NBSP_SEPARATOR = " · ";

/** Zoom's own grouping: 9 → 3-3-3, 10 → 3-3-4, 11 → 3-4-4. */
function groupZoomId(digits: string): string {
  if (digits.length === 9) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  return digits;
}

function parse(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/**
 * A short, human title for a meeting URL:
 *   `https://meet.google.com/qpd-zbkg-jfo`     → `Google Meet · qpd-zbkg-jfo`
 *   `https://zoom.us/j/1234567890?pwd=secret`  → `Zoom · 123 456 7890`
 * Unknown provider → the hostname. Unparseable → the trimmed input. Empty → "".
 */
export function meetingTitle(url: string): string {
  const parsed = parse(url);
  if (parsed === null) return url.trim();

  const host = parsed.hostname.toLowerCase();
  // Path segments only — the query string is where join secrets live.
  const segments = parsed.pathname.split("/").filter((part) => part !== "");

  if (host === "meet.google.com") {
    const code = segments[0];
    return code ? `Google Meet${NBSP_SEPARATOR}${code}` : "Google Meet";
  }

  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    // /j/<id>, /w/<id>, /s/<id> — the numeric meeting id; /my/<vanity> — a personal room.
    const last = segments[segments.length - 1];
    if (last === undefined) return "Zoom";
    if (/^\d+$/.test(last)) return `Zoom${NBSP_SEPARATOR}${groupZoomId(last)}`;
    return `Zoom${NBSP_SEPARATOR}${last}`;
  }

  return host;
}

/**
 * The URL as it is safe to display: scheme + host (+ port) + path, with the
 * query string and fragment stripped. Unparseable → the trimmed input.
 */
export function displayMeetingUrl(url: string): string {
  const parsed = parse(url);
  if (parsed === null) return url.trim();
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${path}`;
}
