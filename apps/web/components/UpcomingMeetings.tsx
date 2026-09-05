"use client";

import { useEffect, useState } from "react";
import { Alert } from "./Alert.tsx";
import { AppApiError, type AppApiClient, type Call, type CalendarMeetingsSnapshot } from "../lib/appApiClient.ts";
import { isSessionInvalid } from "../lib/apiError.ts";
import { authErrorMessage } from "../lib/authErrors.ts";
import { safeExternalUrl } from "../lib/safeExternalUrl.ts";
import { formatDateTime, type DateTimeFormatOptions } from "../lib/formatDateTime.ts";
import { useCalendarConnect } from "../lib/useCalendarConnect.ts";

type UpcomingMeetingsProps = DateTimeFormatOptions & {
  client: AppApiClient;
  onAuthFailure: () => void;
  onCreated?: (call: Call) => void;
};

type AddMeetingPhase = "idle" | "creating" | "created" | "error";

function MeetingActions({ client, meetingUrl, title, onAuthFailure, onCreated }: {
  client: AppApiClient;
  meetingUrl: string;
  title: string;
  onAuthFailure: () => void;
  onCreated?: (call: Call) => void;
}) {
  const [phase, setPhase] = useState<AddMeetingPhase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [alreadyActive, setAlreadyActive] = useState(false);

  async function addSamograph() {
    setCreateError(null);
    setAlreadyActive(false);
    setPhase("creating");
    try {
      const call = await client.createCall({ meetingUrl });
      setCallId(call.id);
      setPhase("created");
      onCreated?.(call);
    } catch (err) {
      if (err instanceof AppApiError && err.code === "SAMO-CALL-ACTIVE" && err.id) {
        setCallId(err.id);
        setAlreadyActive(true);
        setPhase("created");
        return;
      }
      if (isSessionInvalid(err)) {
        setPhase("error");
        onAuthFailure();
        return;
      }
      setCreateError(err instanceof AppApiError ? err.message : "Couldn't add samograph to that call. Try again.");
      setPhase("error");
    }
  }

  return <span>
    {phase === "created" && callId ?
      <a className="samograph-btn samograph-btn--primary samograph-btn--sm" href={`/calls/${encodeURIComponent(callId)}`} aria-label={alreadyActive ? "samograph is already in this call" : `View ${title} call`}>{alreadyActive ? "samograph is already in this call" : "Added — view call"}</a> :
      <button type="button" className="samograph-btn samograph-btn--primary samograph-btn--sm" disabled={phase === "creating"} aria-busy={phase === "creating"} aria-label={`Add samograph to ${title}`} onClick={() => void addSamograph()}>{phase === "creating" ? "Adding…" : "Add samograph"}</button>}
    <a className="samograph-btn samograph-btn--secondary samograph-btn--sm" href={meetingUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title}`}>Open</a>
    {createError ? <Alert tone="danger" as="span">{createError}</Alert> : null}
  </span>;
}

function AutoMeetingActions({ client, meetingId, meetingUrl, title, initialExcluded, onAuthFailure }: { client: AppApiClient; meetingId: string; meetingUrl: string; title: string; initialExcluded: boolean; onAuthFailure: () => void }) {
  const [excluded, setExcluded] = useState(initialExcluded); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!busy) setExcluded(initialExcluded); }, [initialExcluded]);
  async function toggle() {
    const previous = excluded, next = !previous; setExcluded(next); setBusy(true); setError(null);
    try { const confirmed = await client.setCalendarMeetingExcluded(meetingId, next); setExcluded(confirmed.excluded); }
    catch (err) { setExcluded(previous); if (isSessionInvalid(err)) onAuthFailure(); else setError("Auto-record couldn’t be updated. Try again."); }
    finally { setBusy(false); }
  }
  return <span><span className="samograph-chip">Auto</span> <button type="button" className="samograph-btn samograph-btn--secondary samograph-btn--sm" disabled={busy} aria-busy={busy} aria-label={`${excluded ? "Undo skip" : "Skip"} auto-record for ${title}`} onClick={() => void toggle()}>{excluded ? "Undo skip" : "Skip"}</button> <a className="samograph-btn samograph-btn--secondary samograph-btn--sm" href={meetingUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title}`}>Open</a>{error ? <Alert tone="danger" as="span">{error}</Alert> : null}</span>;
}

export function UpcomingMeetings({ client, onAuthFailure, onCreated, locale, timeZone }: UpcomingMeetingsProps) {
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
    {error ? <Alert tone="danger">{error}</Alert> : !snapshot ? <p aria-busy="true">Loading upcoming meetings…</p> : snapshot.connectionState === "not_connected" ? <div className="samograph-empty-state">
      <p className="samograph-empty-title">No calendar connected.</p>
      {calendarAvailable === true ?
        <button className="samograph-btn samograph-btn--primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect Google Calendar"}</button>
        : <a className="samograph-btn samograph-btn--secondary" href="/settings">Manage in Settings</a>}
      {connectError ? <Alert tone="danger">{connectError}</Alert> : null}
    </div> : snapshot.connectionState === "broken" ? <Alert tone="warning" live="off">Google Calendar needs to be reconnected. <a href="/settings">Reconnect in Settings</a>.</Alert> : snapshot.meetings.length === 0 ? <div className="samograph-empty-state"><p className="samograph-empty-title">No upcoming meetings.</p></div> : <ul className="samograph-meeting-list">
      {snapshot.meetings.slice(0, 20).map((meeting) => {
        const minutes = Math.max(0, Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60000));
        const declined = meeting.attendeeResponse === "declined";
        const meetingUrl = safeExternalUrl(meeting.meetingUrl);
        return <li key={meeting.id} data-declined={declined ? "true" : undefined} className="samograph-meeting-item">
          <span className="samograph-meeting-body">
            <span className="samograph-meeting-title" title={meeting.title}>{meeting.title}</span>
            <span className="samograph-meeting-meta">{meeting.allDay ? "All day" : formatDateTime(meeting.startsAt, { locale, timeZone })} · {minutes} min{meeting.meetingProvider ? ` · ${meeting.meetingProvider === "google_meet" ? "Google Meet" : "Zoom"}` : ""}</span>
          </span>
          {declined ? <span className="samograph-meeting-meta">Declined</span> : meetingUrl ? snapshot.autoJoin === true ? <AutoMeetingActions client={client} meetingId={meeting.id} meetingUrl={meetingUrl} title={meeting.title} initialExcluded={meeting.autoJoinExcluded === true} onAuthFailure={onAuthFailure} /> : <MeetingActions client={client} meetingUrl={meetingUrl} title={meeting.title} onAuthFailure={onAuthFailure} onCreated={onCreated} /> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
