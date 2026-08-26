"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AccountEmail } from "./AccountEmail.tsx";
import { CalendarConnectionCard } from "./CalendarConnectionCard.tsx";
import {
  AppApiError,
  type AppApiClient,
  type SettingsOptions,
  type SignInInfo,
} from "../lib/appApiClient.ts";

export interface SettingsPageProps {
  client: AppApiClient;
  /** Navigate away (injected so the component is testable without next router). */
  redirect: (path: string) => void;
}

type Phase = "loading" | "ready" | "saving" | "redirecting";

/**
 * Greenroom Settings page (SPEC §5.12). Loads the tenant's hosted settings
 * (dictionary preset + custom keyterms, transcription language, chat chime) into
 * a form and PUTs the edited full document back. Auth-gated like the dashboard:
 * a 401 on load/save redirects to sign-in rather than rendering a broken form.
 *
 * Keyterms are edited as free text — one term per line — and split on save; the
 * server normalizes (trim/dedupe/cap) so the client stays deliberately thin.
 *
 * It also renders the read-only "Sign-in" block (S5-1 item 8, #223) — see
 * {@link SignInBlock}.
 */
export function SettingsPage({ client, redirect }: SettingsPageProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [options, setOptions] = useState<SettingsOptions | null>(null);
  const [preset, setPreset] = useState("none");
  // Keyterms are an UNCONTROLLED textarea (ref + defaultValue), like the
  // dashboard's URL input: a controlled textarea does not receive edits under the
  // component-test DOM. `loadNonce` keys it so a reload reseeds the defaultValue.
  const keytermsRef = useRef<HTMLTextAreaElement>(null);
  const [initialKeyterms, setInitialKeyterms] = useState("");
  const [loadNonce, setLoadNonce] = useState(0);
  const [language, setLanguage] = useState("multi");
  const [chime, setChime] = useState("blip");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signin, setSignin] = useState<SignInInfo | null>(null);
  // `null` = the /auth/providers probe has not answered yet. Only an explicit
  // `true` renders the google row, so the row can never flash into existence on
  // an environment that has no Google (S5-1 item 8's omit branch).
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [calendarAvailable, setCalendarAvailable] = useState(false);

  const presetId = useId();
  const keytermsId = useId();
  const languageId = useId();
  const chimeId = useId();
  const calendarAuthFailure = useCallback(() => {
    setPhase("redirecting");
    redirect("/auth");
  }, [redirect]);

  const load = useCallback(async () => {
    try {
      const snap = await client.getSettings();
      setOptions(snap.options);
      setSignin(snap.signin);
      setPreset(snap.settings.dictionaryPreset);
      setInitialKeyterms(snap.settings.keyterms.join("\n"));
      setLoadNonce((n) => n + 1);
      setLanguage(snap.settings.language);
      setChime(snap.settings.chime);
      setPhase("ready");
    } catch (err) {
      if (err instanceof AppApiError && err.status === 401) {
        setPhase("redirecting");
        redirect("/auth");
        return;
      }
      setError("Couldn't load your settings. Try again.");
      setPhase("ready");
    }
  }, [client, redirect]);

  useEffect(() => {
    void load();
  }, [load]);

  // `GET /auth/providers` is the SOLE gate on Google in an environment
  // (`apps/app-api/auth/google-http.ts`). The contract says this cannot reject —
  // the `catch` is here anyway because the ONLY safe answer to "did the probe
  // break?" is the omit branch: a "Not connected — Google" row on a branch
  // preview advertises a credential that cannot be connected there.
  useEffect(() => {
    let active = true;
    client
      .authProviders()
      .then((providers) => {
        if (active) setGoogleAvailable(providers.google === true);
        if (active) setCalendarAvailable(providers.googleCalendar === true);
      })
      .catch(() => {
        if (active) setGoogleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    setPhase("saving");
    // One keyterm per line; trim + drop blanks (the server does the canonical
    // normalization — dedupe, per-term + count caps).
    const keyterms = (keytermsRef.current?.value ?? "")
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    try {
      await client.saveSettings({ dictionaryPreset: preset, keyterms, language, chime });
      setSaved(true);
      setPhase("ready");
    } catch (err) {
      if (err instanceof AppApiError && err.status === 401) {
        setPhase("redirecting");
        redirect("/auth");
        return;
      }
      setError(err instanceof AppApiError ? err.message : "Couldn't save your settings. Try again.");
      setPhase("ready");
    }
  }

  if (phase === "loading") {
    return (
      <section aria-live="polite" aria-busy="true">
        <p role="status">Loading your settings…</p>
      </section>
    );
  }

  if (phase === "redirecting") {
    return (
      <section aria-live="polite">
        <p>Redirecting to sign in…</p>
      </section>
    );
  }

  const presets = options?.presets ?? [preset];
  const languages = options?.languages ?? [{ code: language, label: language }];
  const chimes = options?.chimes ?? [chime];

  return (
    <section aria-label="Settings" className="samograph-settings">
      <h1>Settings</h1>
      {/* Which account these settings belong to (#238) — stated at the top, so it
          is answered before the reader scrolls to the Sign-in block below (where
          the same address appears as the magic-link method's destination). */}
      <AccountEmail email={signin?.email ?? null} />
      <form onSubmit={onSubmit}>
        <div className="samograph-field">
          <label htmlFor={presetId}>Dictionary preset</label>
          <select id={presetId} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <p className="samograph-field-hint">
            A shipped keyterm list (e.g. PostgresFM). Your custom terms below are added on top.
          </p>
        </div>

        <div className="samograph-field">
          <label htmlFor={keytermsId}>Custom keyterms (one per line)</label>
          <textarea
            className="samograph-keyterms"
            key={loadNonce}
            id={keytermsId}
            ref={keytermsRef}
            defaultValue={initialKeyterms}
            rows={6}
            placeholder="pg_stat_statements&#10;autovacuum"
          />
        </div>

        <div className="samograph-field">
          <label htmlFor={languageId}>Language</label>
          <select id={languageId} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="samograph-field">
          <label htmlFor={chimeId}>Chat chime</label>
          <select id={chimeId} value={chime} onChange={(e) => setChime(e.target.value)}>
            {chimes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {error ? <p role="alert" className="samograph-alert samograph-alert--error">{error}</p> : null}
        <button type="submit" className="samograph-btn samograph-btn--primary" disabled={phase === "saving"} aria-busy={phase === "saving"}>
          Save settings
        </button>
        {saved ? <p role="status" className="samograph-alert samograph-alert--success">Settings saved.</p> : null}
      </form>

      {/* OUTSIDE the form on purpose — it has no inputs and must never be
          submitted or saved (S5-1 item 8). */}
      {signin ? <SignInBlock signin={signin} googleAvailable={googleAvailable === true} /> : null}
      {calendarAvailable ? <CalendarConnectionCard client={client} onAuthFailure={calendarAuthFailure} /> : null}
    </section>
  );
}

/** Human labels for the machine method ids the block is specified in terms of. */
const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  magic_link: "Magic link",
  google: "Google",
};

/** `Connected 2026-03-04` — the day the link was made, or a bare `Connected`. */
function connectedLabel(connectedAt: string | null): string {
  const day = (connectedAt ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `Connected ${day}` : "Connected";
}

/**
 * The read-only "Sign-in" block (SPEC amendment S5-1 item 8, §5.12; #223).
 *
 * WHY IT EXISTS: item 5 makes same-email linking of a Google account to an
 * existing magic-link account SILENT, and nothing in this system revokes a
 * session. The one-time notification email is a moment in an inbox; this block
 * is the STANDING record — the one place a user can come back to later and see
 * which credentials open their tenant.
 *
 * THREE STATES, and the third is the load-bearing one:
 *   - `magic_link` is listed UNCONDITIONALLY. It is not read from data because it
 *     is not data: item 1 guarantees magic link stays enabled on every
 *     environment where Google is enabled, so an environment where it is missing
 *     does not exist.
 *   - `google` is `Connected …` when an identity row exists, `Not connected` when
 *     Google is configured here but nothing is linked, and
 *   - OMITTED ENTIRELY where `GET /auth/providers` says Google is not configured
 *     (branch previews, by design). Not "not connected" — omitted: a row for a
 *     method that cannot be connected on this host is an invitation to try.
 *
 * READ-ONLY, with nothing to click. Connect/disconnect are `[POSTPONED post-v1]`:
 * an unlink flow can strand a user with no way back into their own account, so it
 * needs its own design and its own review, not a button added here.
 */
function SignInBlock({
  signin,
  googleAvailable,
}: {
  signin: SignInInfo;
  googleAvailable: boolean;
}) {
  const linkedGoogle = signin.identities.find((i) => i.provider === "google");

  return (
    <section aria-label="Sign-in" className="samograph-signin">
      <h2>Sign-in</h2>
      <p className="samograph-field-hint">
        How you can sign in to this account. Connecting or disconnecting a method isn&apos;t
        available yet.
      </p>
      <ul className="samograph-signin-methods">
        <li className="samograph-signin-method" data-provider="magic_link">
          <span className="samograph-signin-method-name">
            {SIGN_IN_METHOD_LABELS.magic_link}
          </span>
          <span className="samograph-signin-method-state">{signin.email}</span>
        </li>
        {googleAvailable ? (
          <li className="samograph-signin-method" data-provider="google">
            <span className="samograph-signin-method-name">{SIGN_IN_METHOD_LABELS.google}</span>
            <span className="samograph-signin-method-state">
              {linkedGoogle ? connectedLabel(linkedGoogle.connectedAt) : "Not connected"}
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
