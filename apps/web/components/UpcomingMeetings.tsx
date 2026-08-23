"use client";

import { useEffect, useState } from "react";
import { AppApiError, type AppApiClient, type CalendarMeetingsSnapshot } from "../lib/appApiClient.ts";
import { authErrorMessage } from "../lib/authErrors.ts";
import { safeExternalUrl } from "../lib/safeExternalUrl.ts";
import { formatDateTime, type DateTimeFormatOptions } from "../lib/formatDateTime.ts";
import { useCalendarConnect } from "../lib/useCalendarConnect.ts";

type UpcomingMeetingsProps = DateTimeFormatOptions & { client: AppApiClient; onAuthFailure: () => void };

export function UpcomingMeetings({ client, onAuthFailure, locale, timeZone }: UpcomingMeetingsProps) {
  const [snapshot, setSnapshot] = useState<CalendarMeetingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarAvailable, setCalendarAvailable] = useState<boolean | null>(null);
  const { busy, error: connectError, connect } = useCalendarConnect({
    client,
    onAuthFailure,
    navigate: (authorizationUrl) => window.location.assign(authorizationUrl),
  });
  useEffect(() => {
    let active = true;
    client.listCalendarMeetings(20).then((s) => { if (active) setSnapshot(s); }).catch((e) => {
      if (!active) return;
      if (e instanceof AppApiError && e.status === 401) onAuthFailure();
      else setError(e instanceof AppApiError ? authErrorMessage(e.code) : "Upcoming meetings couldn’t be refreshed. Please try again.");
    });
    return () => { active = false; };
  }, [client, onAuthFailure]);
  useEffect(() => {
    let active = true;
    client.authProviders().then((providers) => {
      if (active) setCalendarAvailable(providers.googleCalendar === true);
    }).catch(() => {
      if (active) setCalendarAvailable(false);
    });
    return () => { active = false; };
  }, [client]);

  return <section aria-label="Upcoming meetings" className="samograph-upcoming-meetings">
    <h2>Upcoming meetings</h2>
    {error ? <p role="alert">{error}</p> : !snapshot ? <p aria-busy="true">Loading upcoming meetings…</p> : snapshot.connectionState === "not_connected" ? <>
      <p>Connect Google Calendar to see upcoming meetings.</p>
      {calendarAvailable === true ? <p>
        <button type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect Google Calendar"}</button>{" "}
        <a href="/settings">Manage in Settings</a>
      </p> : <p><a href="/settings">Manage in Settings</a></p>}
      {connectError ? <p role="alert">{connectError}</p> : null}
    </> : snapshot.connectionState === "broken" ? <p>Google Calendar needs to be reconnected. <a href="/settings">Reconnect in Settings</a>.</p> : snapshot.meetings.length === 0 ? <p>No upcoming meetings.</p> : <ul className="samograph-meeting-list">
      {snapshot.meetings.slice(0, 20).map((meeting) => {
        const minutes = Math.max(0, Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60000));
        const declined = meeting.attendeeResponse === "declined";
        const meetingUrl = safeExternalUrl(meeting.meetingUrl);
        return <li key={meeting.id} data-declined={declined ? "true" : undefined} className="samograph-meeting-item">
          <span className="samograph-meeting-title">{meeting.title}</span>
          <span>{meeting.allDay ? "All day" : formatDateTime(meeting.startsAt, { locale, timeZone })} · {minutes} min{meeting.meetingProvider ? ` · ${meeting.meetingProvider === "google_meet" ? "Google Meet" : "Zoom"}` : ""}</span>
          {declined ? <span>Declined</span> : meetingUrl ? <a href={meetingUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join ${meeting.title}`}>Join</a> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
