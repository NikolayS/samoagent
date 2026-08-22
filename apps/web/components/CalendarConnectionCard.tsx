"use client";

import { useCallback, useEffect, useState } from "react";
import { AppApiError, type AppApiClient, type CalendarStatus } from "../lib/appApiClient.ts";
import { authErrorMessage, isAuthErrorCode } from "../lib/authErrors.ts";

export function CalendarConnectionCard({ client, onAuthFailure }: { client: AppApiClient; onAuthFailure: () => void }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof AppApiError && error.status === 401) { onAuthFailure(); return; }
    setMessage(error instanceof AppApiError && isAuthErrorCode(error.code) ? authErrorMessage(error.code) : fallback);
  }, [onAuthFailure]);

  const load = useCallback(async () => {
    try { setStatus(await client.getCalendarStatus()); }
    catch (error) { handleError(error, "Couldn’t load Google Calendar. Try again."); }
  }, [client, handleError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("calendar_error");
    if (error) setMessage(authErrorMessage(error));
    else if (params.get("calendar") === "connected") setMessage("Google Calendar connected.");
    if (error || params.has("calendar")) {
      params.delete("calendar_error"); params.delete("calendar");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);

  async function connect() {
    setBusy(true); setMessage(null);
    try { const result = await client.startCalendarConnect(); window.location.assign(result.authorizationUrl); }
    catch (error) { handleError(error, "Google Calendar couldn’t be connected. Please try again."); setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Google Calendar? Upcoming meetings will be removed.")) return;
    setBusy(true); setMessage(null);
    try { await client.disconnectCalendar(); await load(); }
    catch (error) { handleError(error, "Google Calendar couldn’t be disconnected. Try again."); }
    finally { setBusy(false); }
  }

  return <section aria-label="Google Calendar" className="samograph-signin samograph-calendar-card">
    <h2>Google Calendar</h2>
    {message ? <p role="status">{message}</p> : null}
    {!status ? <p aria-busy="true">Loading Google Calendar…</p> : status.state === "not_connected" ? <>
      <p>Show upcoming meetings from your calendar.</p>
      <button type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect Google Calendar"}</button>
    </> : status.state === "broken" ? <>
      <p>Google Calendar needs to be reconnected.</p>
      <button type="button" disabled={busy} onClick={() => void connect()}>Reconnect</button>{" "}
      <button type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
    </> : <>
      <p><strong>Connected</strong></p>
      {status.lastSyncAt ? <p className="samograph-field-hint">Last synced {new Date(status.lastSyncAt).toLocaleString()}</p> : null}
      <button type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
    </>}
  </section>;
}
