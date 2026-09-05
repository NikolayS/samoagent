# samograph web — Design system PR plan

Ordered PR lists implementing [`DESIGN-MODEL.md`](./DESIGN-MODEL.md), split into a desktop track
(PR 1–14, from the original `/settings`-centred audit) and a mobile track (M1–M9, additive on top
of PR 2). Each PR is 1–3 files and independently mergeable. Status as of 2026-09-04.

Findings backing this plan: [`AUDIT-2026-09-04.md`](./AUDIT-2026-09-04.md).

**Status:** the statuses below are updated per PR — check the PR itself for the current merge/review state if this doc lags. Snapshot as of 2026-09-04 evening. "merged" below means merged to `main` (live on prod); "staged" means merged into the `feat/web-design-v2` integration branch (tracked by draft PR #298) but not yet on `main`/prod.

---

## Desktop track — PR 1–14

| # | Status | PR | Files | Why here |
|---|---|---|---|---|
| **1** | **merged (#278)** | `fix(web): real Select control — end-cap chevron, sized to content` | `globals.css`, `SettingsPage.tsx`, `SettingsPage.test.tsx` | The reported complaint. Adds `.samograph-select` wrapper + `appearance:none` + end-cap; introduces `--control-h`, `--radius-control`, `--field-max`. |
| **2** | **merged (#279)** | `fix(web): one control height — 44/36/28` | `globals.css` (+ `AddToCallForm.tsx` if the grid needs it) | Retires the five inconsistent heights. Input, select and the hero button line up. Pure CSS + tokens. **Base height is 44px per the DESIGN-MODEL §2 deviation (WCAG target size), not the 36px the original audit proposed.** |
| **3** | **merged (#287)** | `fix(web): stop Settings buttons stretching full-width` | `globals.css`, `CalendarConnectionCard.tsx` | Splits `.samograph-signin`'s grid from the calendar card; adds `.samograph-actions` around button pairs. Landed together with PR 4 in #287. |
| **4** | **merged (#287)** | `fix(web): align page content with the app nav` | `globals.css`, `apps/web/app/settings/page.tsx` | `--prose`/`--form` constrain the inner column, not `<main>`. Large perceptual win, small diff. |
| **5** | **merged (#295)** | `feat(web): PageHeader component` | `components/PageHeader.tsx` (new), `globals.css`, `OwnerCallView.tsx` | Title/description/back/actions. Moves the raw meeting URL out of the `/calls/[id]` H1. Landed together with PR 6 in #295. |
| **6** | **merged (#295)** | `fix(web): section rhythm and a real h2 scale` | `globals.css` | `h2` → `--text-lg`; `.samograph-settings-section` → `.samograph-section` with a 1px rule and `--space-6` rhythm. |
| **7** | **merged (#293)** | `fix(web): button borders, disabled state, dark-mode legibility` | `globals.css` | Declares `border` on the base; `--secondary` text → `--ink-soft`; disabled gets a background, not just opacity. PR 12's dark hairline fix landed inside this same PR. |
| **8** | **staged (#296, on `feat/web-design-v2`)** | `feat(web): Alert with a tone rail, icon, and readable copy` | `globals.css`, `components/Alert.tsx` (new) | Ink copy + coloured rail; `--inline` variant for the savebar. Keeps `test/alert-contrast.test.ts` green. Not yet on `main`/prod — staged in integration PR #298. |
| **9+10** | **in review (#303, on `feat/web-design-v2`)** | `feat(web): real switch for auto-record` + `feat(web): skeletons everywhere a sentence used to be` | `globals.css`, `CalendarConnectionCard.tsx`, `components/PageSkeleton.tsx`, `SettingsPage.tsx` | Makes `role="switch"` look like a switch; adds `variant="row" \| "panel"` skeletons, deletes the three "Loading …" paragraphs. Delivered together as one PR against the integration branch. |
| **11** | **merged (#285)** | `feat(web): dashboard row — meeting title, meta column, closer CTA` | `globals.css`, `Dashboard.tsx` | Three-column row; URL demoted to the secondary line. Delivered by the mobile-track M7 PR (#285) — no separate desktop PR needed. |
| **12** | **merged (#293 + #297)** | `fix(web): dark-mode hairlines and instrument button variant` | `globals.css` | Dark-mode hairline lift + `--on-panel` instrument buttons landed inside #293; the matching light-mode hairline fix (`--line` contrast) landed in #297 (staged on `feat/web-design-v2`, not yet on `main`). |
| **13** | **merged (#301, on `feat/web-design-v2`)** | `fix(web): converge the landing on the app's control geometry` | `globals.css`, `Landing.tsx`, `components/__fixtures__/landing.baseline.html` | Merges `.samograph-button` into `.samograph-btn`. Updates the baseline fixture. Staged on `feat/web-design-v2`, not yet on `main`. |
| 14 | **in review** | `refactor(web): split globals.css by concern` | `globals.css` (now an import manifest) → `app/styles/*.css` (17 concern files), `test/helpers/stylesheet.ts`, `test/stylesheet-split.test.ts` | Only after 1–13 land — re-organising first would make every prior diff unreviewable. Pure move: no rule, declaration or value changed; the import list preserves the original source order (= the cascade). |

**Cross-cutting notes**
- PRs 1–4, 6–7 and 12 are CSS-only and should not move a single test (tests query by role/label,
  not class). PRs 3, 5, 9, 10, 11 change markup and need test updates.
- `apps/web/components/__fixtures__/landing.baseline.html` + `Landing.baseline.test.tsx` pin the
  landing markup — PR 13 must update the fixture in the same commit.
- `apps/web/test/greenroom-tokens.test.ts` pins the `--google-btn-*` values literally — do not
  touch them in any PR.
- `test/no-dead-css.test.ts` and `test/css-tokens-defined.test.ts` both read `globals.css` by
  path — this is why PR 14 (splitting the stylesheet) must come last. **Since PR 14 every CSS
  guard reads the sheet through `test/helpers/stylesheet.ts` (`readGlobalsCss()`), which resolves
  the `@import`s in `app/globals.css` and returns the concatenated sheet — never `readFileSync`
  a stylesheet by path in a new guard.**

---

## Mobile track — M1–M9

Additive on top of desktop PR 2 (`feat/web-control-height`). The `globals.css region` column is
the conflict surface — PRs touching disjoint regions can run in parallel.

| # | Status | PR | Files | globals.css region | Parallel with |
|---|---|---|---|---|---|
| **M1** | **merged (#280)** | `fix(web): transcript reflows to two rows below 1024` | `globals.css` | instrument/transcript block only | M2–M9 |
| **M2** | **merged (#284)** | `fix(web): real mobile nav — 56px shell, disclosure menu` | `globals.css`, `AppShell.tsx`, `AppShell.test.tsx` | app nav block | M1, M3–M9 |
| **M3** | **merged (#281)** | `fix(web): 44px touch targets + a 12px type floor` | `globals.css` | base rules + button block, new `@media` block | M1, M2, M5–M9 |
| **M4** | **merged (#283)** | `fix(web): collapse the call-view header on mobile` | `globals.css`, `OwnerCallView.tsx` | call view + panel head block | M2, M3, M5–M9 |
| **M5** | **merged (#290)** | `fix(web): landing footer separators + mobile wordmark` | `globals.css`, `Landing.tsx`, `__fixtures__/landing.baseline.html` | landing block only | all |
| **M6** | **merged (#292)** | `fix(web): savebar stops overlapping content; safe-area insets` | `globals.css`, `app/layout.tsx` | savebar block + `:root` | M1, M2, M4, M5 |
| **M7** | **merged (#285)** | `fix(web): dashboard row — title, meta, no query strings` | `globals.css`, `Dashboard.tsx`, `Dashboard.test.tsx` | dashboard row block | M1–M6, M8, M9 — also delivered desktop PR 11 |
| **M8** | **merged (#289)** | `fix(web): iOS-safe form fields (16px, full-width, one geometry)` | `globals.css` | base + auth blocks | M1, M2, M4, M5, M7 |
| **M9** | **in review (#305)** | `refactor(web): canonical breakpoints and fluid gutter` | `globals.css` | `:root` + every `@media` header | last — rebase others onto it |

**Scope per PR**

- **M1 — transcript reflow** (ship first; highest value). Two-row grid below `--bp-lg`: utterance
  width grows from ~114px to the full content width at 390px. Must not touch `.samograph-percall`
  colours or `--speaker-*` tokens; re-read `test/transcript-instrument-css.test.ts` first.
- **M2 — mobile nav.** Deletes the `flex-wrap: wrap` patch. Below `--bp-md`: brand + `☰` (44×44,
  `aria-expanded`/`aria-controls`); disclosure holds email, theme switcher, Log out. Nav height
  129px → ≤56px.
- **M3 — touch targets + type floor.** One `@media (max-width: 767px)` block: `min-height: 44px`
  on action elements; theme-switcher option text 10.88px → 12px; back-link target 20px → 44px;
  `--sm`/`--xs` button variants neutralised below `--bp-md`. Pure CSS — no test should move.
- **M4 — call-view header.** `<h1>` becomes the meeting name (or `Call · <date>`); URL demotes to
  a `--text-sm` mono description line. Panel header collapses below `--bp-md` to state chip +
  timer, with id/URL/dictionary moved into a `<details>`. Removes ~200px of chrome above the
  first transcript line.
- **M5 — landing.** Footer `·` separators move out of inline-flow (`span + span::before`) or drop
  below 480px; wordmark shrinks instead of hiding at the mobile breakpoint; `.samograph-instrument`
  `min-width: 780px` → `min-width: min(780px, 100%)`. Must update
  `__fixtures__/landing.baseline.html` in the same commit.
- **M6 — savebar + safe area.** Savebar gets `box-shadow` via a new `:root`-declared `--elev-*`
  token, spans the ground instead of floating, gets safe-area bottom padding; adds
  `export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" }` to
  `app/layout.tsx`.
- **M7 — dashboard row.** Title line / meta line (date · duration · status) / chevron. Display
  URLs as `origin + pathname` only — **query strings are never rendered** (closes the `?pwd=`
  join-secret leak). `Dashboard.test.tsx` needs updating for the markup change.
- **M8 — form fields.** `input/select/textarea` → 16px font below 480px (iOS zoom fix), full
  width; unifies the `/auth` stack around one reference height. Does not touch `--google-btn-*`
  (pinned by `test/greenroom-tokens.test.ts`).
- **M9 — breakpoint tokens** (last). Documents `--bp-sm/md/lg` in the `:root` comment block and
  in `apps/web/lib/breakpoints.ts` (the JS-readable source of truth, since `@media` cannot read a
  custom property); normalises `40rem`/`48rem`/`59.99rem`/`63.99rem` to the pixel set, one unit
  and one direction convention, guarded by `test/breakpoints.test.ts`; makes `--gutter` fluid.
  Three boundaries were consolidated rather than preserved: `40rem` (640) → `--bp-md`, because
  the blocks it guarded are nav-collapse and list-row-stacking, both `--bp-md` roles; `59.99rem`
  (959.84) → `--bp-lg`; `48rem` (768, *inclusive*, so it overlapped `min-width: 768px` at exactly
  768px) → `767.98px`.
  Touches every `@media` header — rebase M1–M8 onto it, not the reverse.

---

## Deviations recorded

- Button base height is 44px, not the 36px the original audit proposed (WCAG target size) — PR 2 / #279.
- Landing hero `<h1>` keeps its 2.65rem size rather than converging on the app type scale — PR 13 / #301.
- Switch OFF-track color uses `--muted`, not `--line-strong` — PR 9+10 / #303.
- Skeleton variants are page-specific (`row` vs `panel`), not one universal shape — PR 10 / #303.
- Alert CSS keeps the original variant names `--info`/`--success`/`--warn`/`--error` rather than renaming — PR 8 / #296.

## Follow-ups

Items from the wave-3 UI audit genuinely still open (condensed from `FOLLOWUPS.md`; the prior
eight items in this section — transcript-row reflow, `TranscriptTime` `dateTime`, the public-nav
hamburger, `meetingUrl.ts` host shapes + guard anchor, the touch-targets allowlist hole, the
`Dashboard.test.tsx` autofocus flake, and both `GET /calls/:id`/`GET /settings` 401 items — were
all fixed by #288, #289 and #302 and are ticked in `FOLLOWUPS.md`):

- `aria-disabled` is not covered anywhere in `apps/web` — `.samograph-btn[disabled]`-only selectors have no live gap today (`<a>` can't be `disabled`), but hardening `.samograph-btn[aria-disabled="true"]` + `:not([aria-disabled="true"])` on hover gates is optional future work (#293 review INFO).
- `POST /calls` returns `{ id, status }` with no `created_at`, so `createHttpAppApiClient.createCall`'s `typeof data.created_at === "string"` branch can never fire against the real server while `FakeAppApiClient.createCall` stamps one — harmless today (a refetch fills it in), but the fake is more capable than the server; add `created_at` to the 201 body or drop the client branch (#285 review INFO).
- `meetingUrl.ts` `parse()`'s `https://`-prefix retry produces cosmetic garbage titles for non-web schemes (`file:///etc/passwd` → "file", `ftp://host/x` → "ftp") — not a security issue and unreachable in practice (create-call validates the provider first); worth a `"Meeting"` fallback if this file is touched again (#285 review INFO).

## Status legend

- **merged** — landed on `main` (live on prod).
- **staged** — merged into the `feat/web-design-v2` integration branch, tracked by draft PR #298, not yet on `main`/prod.
- **in review** — PR open, awaiting/undergoing samorev review per the repo merge gate.
- **in progress** — actively being worked (branch exists or an agent/engineer owns it), not yet a
  reviewable PR.
- **not started** — scoped, not yet begun.
