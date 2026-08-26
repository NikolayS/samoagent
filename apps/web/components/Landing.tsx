import { ThemeSwitcher } from "./ThemeSwitcher.tsx";

const glimpse = [
  ["[00:12:04]", "Dana:", "P99 climbed after the canary rollout."],
  ["[00:12:11]", "Morgan:", "Same three retries as last week."],
  ["[00:12:19]", "Jamie:", "Check idempotency and error rates."],
  ["[00:12:27]", "Dana:", "Pausing the rollout now."],
] as const;

const REPO = "https://github.com/NikolayS/samograph";

export function SiteNav() {
  return (
    <nav className="samograph-site-nav" aria-label="Primary">
      <a className="samograph-brand" href="/" aria-label="samograph.dev home">
        <img src="/robot-mark.png" alt="" width="32" height="32" />
        <span>
          samograph<span>.dev</span>
        </span>
      </a>
      <div className="samograph-nav-actions">
        <ThemeSwitcher />
        <a className="samograph-button samograph-button--compact" href="/auth">
          Get started
        </a>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  const links = [
    ["get started", "/auth"],
    ["cli on github", REPO],
    ["hello@samograph.dev", "mailto:hello@samograph.dev"],
  ] as const;
  return (
    <footer className="samograph-site-footer">
      <nav aria-label="Footer">
        {links.map(([label, href], index) => (
          <span key={label}>
            {index > 0 && <i aria-hidden="true">·</i>}
            <a href={href}>{label}</a>
          </span>
        ))}
      </nav>
      <small>
        samograph.dev — live transcripts for Zoom and Google Meet. v1 is free.
      </small>
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <a className="samograph-skip-link" href="#main">
        Skip to content
      </a>
      <main className="samograph-landing" id="main" tabIndex={-1}>
        <SiteNav />
        <section className="samograph-landing-hero">
          <h1>An agent that joins your call and transcribes it live.</h1>
          <p>Zoom and Google Meet. No install.</p>
          <div className="samograph-hero-actions">
            <a className="samograph-button" href="/auth">
              Get started
            </a>
            <a className="samograph-hero-secondary" href={REPO}>
              github
            </a>
          </div>
          <ol className="samograph-glimpse" aria-label="Transcript format">
            {glimpse.map(([time, speaker, text]) => (
              <li key={time}>
                <time>{time}</time>
                <b>{speaker}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
