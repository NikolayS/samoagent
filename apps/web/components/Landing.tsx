import { ThemeSwitcher } from "./ThemeSwitcher.tsx";

const transcript = [
  ["141", "[00:11:52]", "Dana:", "P99 climbed right after we expanded the canary rollout to ten percent."],
  ["142", "[00:12:04]", "Morgan:", "The incident timeline shows the same three retries as last week."],
  ["143", "[00:12:11]", "Jamie:", "Then check idempotency and pull error rates per service."],
  ["144", "[00:12:19]", "Dana:", "Error rate is two percent. Not the emergency threshold, but close."],
  ["145", "[00:12:27]", "Morgan:", "Pause the rollout first; I will post the graph in chat."],
  ["146", "[00:12:35]", "Jamie:", "Agreed. I will write it up on the call page."],
] as const;
const differentiators = [
  ["Keyterm dictionaries", "Load technical terms, product names, and names before the call."],
  ["Code-switching", "Mixed-language speech stays in one transcript line."],
  ["Failures are loud", "Join and delivery failures appear with actionable status."],
  ["Revocable sharing", "Signed read-only links revoke individually; plain-text download remains available."],
] as const;
const steps = [
  ["Sign in", "Use a magic link or Google; no install or calendar access."],
  ["Paste the meeting link", "Paste Zoom or Google Meet and optionally select a dictionary."],
  ["The bot joins", "A named participant joins with recording disclosure enabled."],
  ["The page streams", "The call page streams over WebSocket and supports sharing or download."],
] as const;
const tiers = [
  ["Free", "today / v1", "$0", ["live transcripts for Zoom + Google Meet", "read-only share links", "plain-text download", "no card required"]],
  ["Individual", "planned", "$20/mo", ["everything in Free", "custom keyterm dictionaries", "retention controls", "priority transcription"]],
  ["Team", "planned", "$25/user/mo", ["everything in Individual", "shared calls across the team", "centralized billing", "access controls"]],
] as const;

export function SiteNav() {
  return <nav className="samograph-site-nav" aria-label="Primary"><div className="samograph-nav-left"><a className="samograph-brand" href="/" aria-label="samograph.dev home"><img src="/robot-mark.png" alt="" width="32" height="32" /><span>samograph<span>.dev</span></span></a><div className="samograph-nav-links"><a href="#how-it-works">how it works</a><a href="#dictionaries">dictionaries</a><a href="#cli">cli</a><a href="https://github.com/NikolayS/samograph">docs</a></div></div><div className="samograph-nav-actions"><ThemeSwitcher /><a className="samograph-button samograph-button--compact" href="/auth">Get started</a></div></nav>;
}

export function TranscriptInstrument() {
  return <div className="samograph-instrument" role="region" aria-label="Live transcript example"><div className="samograph-instrument-head"><div><strong>call / 4f2a9c1e</strong><i>|</i><span>meet.google.com/qty-hqvr-xnb</span><i>|</i><span>dict: <strong>custom</strong></span></div><div className="samograph-instrument-state"><span className="samograph-listening">⌁ listening</span><span><b aria-hidden="true" /> <strong>live</strong> 00:12:41</span></div></div><div className="samograph-degraded" role="note"><span aria-hidden="true">△</span> delivery degraded 14:02:09 — websocket reconnecting, attempt 2. lines are buffered, not dropped.</div><ol className="samograph-instrument-lines" aria-label="Sample transcript lines">{transcript.map(([number, time, speaker, line]) => <li key={number}><span className="samograph-line-number">{number}</span><time>{time}</time><b>{speaker}</b><span>{line}</span></li>)}<li className="samograph-partial"><span className="samograph-line-number">147</span><time>[00:12:41]</time><b>Dana:</b><span>And the dictionary caught idempoten<i className="samograph-caret" aria-hidden="true" /></span></li></ol><div className="samograph-instrument-foot"><div><span>keyterms matched</span>{["rollout", "canary", "idempotency", "wraparound"].map((term) => <b key={term}>{term}</b>)}</div><div><span>ru→en code-switching on</span><i>|</i><span>share link · revocable</span><i>|</i><span>download .txt</span></div></div></div>;
}

export function PricingBand() {
  return <section className="samograph-section" aria-labelledby="pricing-title"><header className="samograph-section-head"><h2 id="pricing-title">Pricing</h2><span>v1 / planned tiers</span></header><div className="samograph-pricing-grid">{tiers.map(([name, status, price, features], index) => <article className="samograph-tier" key={name}><header><h3>{name}</h3><span>{status}</span></header><strong className="samograph-price">{price}</strong><ul>{features.map((feature) => <li key={feature}>— {feature}</li>)}</ul>{index === 0 ? <a className="samograph-button" href="/auth">Get started</a> : <button type="button" disabled>Coming with billing</button>}</article>)}</div><small>v1 is free while billing is built. Planned prices — may change.</small></section>;
}

export function SiteFooter() {
  const links = [["get started", "/auth"], ["docs", "https://github.com/NikolayS/samograph"], ["cli on github", "https://github.com/NikolayS/samograph"], ["dictionaries", "#dictionaries"], ["hello@samograph.dev", "mailto:hello@samograph.dev"]] as const;
  return <footer className="samograph-site-footer"><nav aria-label="Footer">{links.map(([label, href], index) => <span key={label}>{index > 0 && <i aria-hidden="true">·</i>}<a href={href}>{label}</a></span>)}</nav><small>samograph.dev — live transcripts for Zoom and Google Meet. v1 is free.</small></footer>;
}

export function Landing() {
  return <main className="samograph-landing"><SiteNav /><section className="samograph-landing-hero"><div className="samograph-hero-copy"><p className="samograph-eyebrow"><i />zero-setup live transcription — zoom &amp; google meet</p><h1>Paste a meeting link.<br />The transcript starts arriving.</h1><p>Paste a Zoom or Google Meet URL to stream a keyterm-aware transcript, then share it read-only or download plain text.</p><div className="samograph-hero-actions"><a className="samograph-button" href="/auth">Get started</a><span>free while v1 is open · no install · no calendar scopes</span></div></div><TranscriptInstrument /></section><div className="samograph-rule" /><section className="samograph-section" id="dictionaries"><header className="samograph-section-head"><h2>What it does that a generic notetaker does not</h2><span>04 / differentiators</span></header><div className="samograph-differentiators">{differentiators.map(([title, copy], i) => <article key={title}><span>0{i + 1}</span><i /><h3>{title}</h3><p>{copy}</p></article>)}</div></section><div className="samograph-rule" /><section className="samograph-section" id="how-it-works"><header className="samograph-section-head"><h2>From link to live page</h2><span>four steps · about forty seconds</span></header><ol className="samograph-steps" aria-label="How it works">{steps.map(([title, copy], i) => <li key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{copy}</p></li>)}</ol></section><div className="samograph-rule" /><PricingBand /><div className="samograph-rule" /><section className="samograph-heritage" id="cli"><div><span className="samograph-label">heritage — the open-source cli</span><h2>The hosted product grew out of a CLI that puts an AI agent in the call.</h2><p>The open-source CLI lets coding agents join calls, read transcripts, use chat, and expose presence.</p><p className="samograph-repo"><a href="https://github.com/NikolayS/samograph">github.com/NikolayS/samograph</a><span>MIT · Zoom, Meet</span></p></div><div><div className="samograph-cli">{['samograph join "https://meet.google.com/..." --dict custom', "samograph watch", 'samograph presence thinking "checking rollout metrics"', 'samograph chat "plan attached — three retries, same as last week"', "samograph leave"].map((line) => <code key={line}><b>$</b>{line}</code>)}</div><aside><span>roadmap — not shipped</span><p>Planned: scoped, revocable per-call agent access over MCP.</p></aside></div></section><section className="samograph-closing"><strong>Paste a meeting link. Watch it stream.</strong><a className="samograph-button" href="/auth">Get started</a></section><SiteFooter /></main>;
}
