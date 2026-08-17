# Google sign-in (OIDC) — Cloud Console setup, env vars, and the samohost trap

**Audience:** the project owner (Google Cloud Console steps) + the SRE / deploy
owner (env wiring). **Severity if done wrong:** either Google sign-in is simply
absent (safe — the magic-link path is untouched), or — the one dangerous failure
mode — the button *renders* and every sign-in dies at Google's token endpoint. See
[the `.samohost.toml` trap](#the-samohosttoml-trap--never-put-the-secret-in-secrets).

**SPEC provenance:** amendment **S5-1** in
[`SPEC.amendments.md`](../../blueprints/samograph-dev/SPEC.amendments.md) —
Google sign-in deliberately reverses the §1 v1 non-goal "no Google OAuth"
(post-v1, with owner sign-off). Issue **#209**. The calendar non-goal is **not**
reversed: scopes are `openid email` only, forever, on this client.

> **Nothing here is required for the app to run.** With no Google credentials set,
> `bun test` and `bunx tsc --noEmit` are green, the app boots, `GET /auth/providers`
> returns `{"google": false}`, and the button does not render. Magic link is the
> baseline credential on every environment and stays enabled everywhere Google is
> enabled — **Google is never the only way into an account.**

## Why there are TWO OAuth clients

| Client | Registered redirect URIs | Given to |
|---|---|---|
| `samograph-prod` | `https://samograph.samo.team/auth/google/callback` | prod only |
| `samograph-nonprod` | `https://samograph-main.samo.cat/auth/google/callback`, `http://localhost:3000/auth/google/callback` | the `samograph-main` preview + local dev machines |

Google **exact-matches** `redirect_uri` — scheme, host, port and path must be
byte-identical — and allows **no wildcards**. Three registrable URIs, two clients.

Two clients rather than one is deliberate: a preview `.env` on a shared VM is a
lower-trust store than prod's, and the ID-token verifier **pins `aud` to the
configured client id**, so a leaked *preview* credential cannot mint a token prod
will accept. One credential spanning both would erase that boundary.

**Branch previews (`samograph-<branch>.samo.cat`) get NO Google credentials, by
design.** Their hostnames are unbounded and dynamic, and an unbounded set of
hostnames must never be registrable redirect targets. `GET /auth/providers`
returns `{"google": false}` there, the button does not render, and
`/auth/google/*` answers with a credential-free stub that redirects to
`/auth?error=SAMO-AUTH-010`. Previews sign in with magic link — the same
credential they already have.

## Part 1 — create the `samograph-prod` client (owner, once)

Do these in order in <https://console.cloud.google.com>. Newer consoles have
renamed some screens; both names are given.

1. **Project.** Create or select a project named `samograph`. Note the project id.
2. **Consent screen.** Open **APIs & Services → OAuth consent screen** (newer:
   **Google Auth Platform → Branding**).
   - User type: **External**.
   - App name: exactly `samograph`.
   - Set the **user support email**.
   - **SKIP the app logo.** Uploading one triggers Google brand verification and
     delays publishing. It only affects how the consent screen looks.
   - App domain → Application home page: `https://samograph.samo.team`;
     Privacy policy link: `https://samograph.samo.team/privacy`;
     Terms of service link: `https://samograph.samo.team/terms`.
   - **Authorized domains: add BOTH `samo.team` AND `samo.cat`.** These are two
     distinct registrable domains; omitting `samo.cat` makes the non-prod client
     unusable.
   - Set the **developer contact email**. Save.
3. **Scopes.** Open **Data access** (older: the **Scopes** step) → *Add or remove
   scopes* → tick **only** `openid` and `.../auth/userinfo.email`.
   **Do NOT tick `.../auth/userinfo.profile`.** Do not add any calendar scope.
   Both selected scopes are **non-sensitive**, which is what lets this client
   publish with no Google security assessment and no restricted-scope review.
   Update, then Save.
4. **Test users / publishing.** Open **Audience** (older: the **Test users**
   step). While Publishing status is **Testing**, add the owner's own Google
   account under *Test users* — only listed accounts can sign in, capped at
   **100**. Click **Publish app** once `/privacy` and `/terms` are live; with only
   non-sensitive scopes this does **not** queue for review.
5. **Credentials.** **Credentials → Create credentials → OAuth client ID →
   Application type `Web application`.** Name it `samograph-prod`.
   - Leave **Authorized JavaScript origins EMPTY** — we never use the Google JS SDK.
   - Under **Authorized redirect URIs**, click *ADD URI* and enter exactly
     `https://samograph.samo.team/auth/google/callback` — one entry, **no trailing
     slash, no wildcard**.
   - Click **Create**.
6. **Copy the pair.** The dialog shows the **Client ID** and **Client secret**
   once, with a *Download JSON* button. Copy both now — the secret can be
   re-created later but never re-read.
7. **Hand them over OUT OF BAND.** Never paste either value into a GitHub issue, a
   PR comment, a commit, a chat log, or a screenshot. This repo is public.
8. **Wire prod.** Put them in prod's `envFile` (`/opt/samograph/app/.env`) as
   `GOOGLE_OAUTH_CLIENT_ID=` and `GOOGLE_OAUTH_CLIENT_SECRET=`, then restart the
   `samograph-web` unit.

> Redirect-URI edits can take **from five minutes to a few hours** to propagate.
> Until they do, sign-in fails with `Error 400: redirect_uri_mismatch`. That is
> expected, not a code bug — see [Troubleshooting](#troubleshooting).

## Part 2 — create the `samograph-nonprod` client (owner, once)

In the **same project**, under the **same consent screen** (do not create a second
consent screen):

1. **Credentials → Create credentials → OAuth client ID → `Web application`.**
   Name it `samograph-nonprod`.
2. Leave **Authorized JavaScript origins** empty.
3. Under **Authorized redirect URIs** add exactly **two** entries:
   - `https://samograph-main.samo.cat/auth/google/callback`
   - `http://localhost:3000/auth/google/callback` — `http` is permitted for
     `localhost` **only**.
4. **Create**, then copy the client id and secret.
5. Give this pair to the **`samograph-main` preview's env file** and to **local
   developer machines**. Give the **prod** pair to **nothing but prod**.
6. Give **neither** pair to a branch preview.

## Part 3 — the blocking owner input that is not a secret

Google will not publish an External consent screen out of Testing mode without
**live Privacy policy and Terms of service URLs**. Engineering ships the
`/privacy` and `/terms` routes; the **owner must supply the policy text** — what
samograph collects, that Google sign-in receives **only the account's email
address**, retention per §5.13, and the §5.14 erasure right.

Until both URLs return 200 on `https://samograph.samo.team`, the client stays in
**Testing** mode and only the ≤100 listed test users can sign in. The code is
fully functional in that state, so this blocks **general availability** — not
development, and not the owner's own end-to-end test.

## Environment variables

| Var | Where it belongs | Required? | Purpose |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | prod `.env` (prod client); `samograph-main` env + local dev (non-prod client). **Never** a branch preview. | No — absent ⇒ Google sign-in is simply OFF | Sent on `/authorize` and at the token exchange, and **pinned as the required `aud`** (and `azp` when present) during ID-token verification. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | same as above | No — absent ⇒ OFF. Setting **exactly one** of the pair **throws at boot**, naming the missing var and echoing no value | Authenticates the server-to-server token exchange. **See the trap below.** |
| `GOOGLE_OAUTH_REDIRECT_URI` | optional override, per env | No | Escape hatch for a host the derived default cannot produce. Derived default is `<base>/auth/google/callback`. Any value is shape-checked (https, or http for `localhost` only; no query; no fragment; path exactly `/auth/google/callback`). |
| `APP_API_ORIGIN` | already required, per env (`apps/web/next.config.mjs`) | **Yes** (pre-existing) | Proxies `/auth/google/start`, `/auth/google/callback` and `/auth/providers` from the web origin to app-api. The whole `rewrites()` key disappears when it is unset — this already-known trap now takes Google sign-in down with it. **Verify it per env on every deploy.** |

Both Google vars are read in `googleOAuthFromEnv()` from inside the server
entrypoint, never at module top level — so a repo with no Google config stays
importable under `bun test`.

> **Note on the derived redirect URI.** `apps/app-api/server.ts` resolves the web
> origin via `resolveMagicLinkBaseUrl(env, "https://samograph.dev")` — the
> hard-coded last-resort default is `https://samograph.dev`, while real prod is
> `samograph.samo.team`. Prod is only correct because it sets `WEB_ORIGIN` (and
> previews get `BASE_URL` from samohost). If both are ever missing, the **derived**
> redirect URI is validated against a compiled-in host allowlist and **throws at
> boot naming `GOOGLE_OAUTH_REDIRECT_URI`**, instead of letting every user click
> 400 at Google. An explicit override skips the host allowlist (the operator has
> asserted it) but still gets the shape check.

## The `.samohost.toml` trap — NEVER put the secret in `secrets`

> ### ⛔ `GOOGLE_OAUTH_CLIENT_SECRET` must NEVER be added to `.samohost.toml`'s `secrets` array.
>
> That array is a **per-env GENERATOR**, not a distributor. It exists to mint fresh
> random signing secrets per preview environment:
>
> ```toml
> secrets = ["SESSION_SECRET", "TOKEN_SECRET", "MAGIC_LINK_SECRET", "RECALL_WEBHOOK_SECRET"]
> ```
>
> Add `GOOGLE_OAUTH_CLIENT_SECRET` there and samohost will **mint a random
> string** for it. Then, in order:
>
> 1. the presence gate sees a non-empty value and reports Google as **configured**;
> 2. `GET /auth/providers` returns `{"google": true}`;
> 3. the **button renders** on the sign-in page;
> 4. every user who clicks it gets through Google's consent screen and then **fails
>    at Google's token endpoint**, because the "secret" is a random string Google
>    has never seen.
>
> That is **strictly worse than absent**: absent means the button never renders and
> the user is quietly served the magic-link path that works.

The same reasoning is why the OAuth **state** cookie reuses `SESSION_SECRET` with a
domain-separation prefix rather than introducing a new signed secret name: a new
name would either be added to that generator (fine, but one more per-env secret to
coordinate) or be missing on previews and crash-loop them.

Google credentials are **operator-placed values in the per-env env file**, exactly
like `RECALL_API_KEY` — never generated, never in the repo.

## Rotation

1. In **Credentials → `samograph-prod`** (or `-nonprod`), *Add secret* to create a
   second client secret. Google supports two live secrets per client during a
   rollover.
2. Update the env file(s) for that client's environments and restart the unit.
3. Confirm a live sign-in works.
4. Delete the old secret in the console.

Rotate immediately, out of band, if a secret is ever pasted anywhere public. The
client **id** is not a secret; the client **secret** is.

## Troubleshooting

**`Error 400: redirect_uri_mismatch`.** The `redirect_uri` the server sent is not
byte-identical to a registered one. In order of likelihood:

1. **You just edited the redirect URI in the console.** Propagation takes from
   **five minutes to a few hours**. Wait before changing anything else — this is
   the single most common cause of a false "the code is broken" diagnosis.
2. **Wrong host for the env** — a `samograph-main` request reaching the `-prod`
   client, or vice versa. Check which `GOOGLE_OAUTH_CLIENT_ID` that env holds.
3. **Trailing slash, `http` vs `https`, or a port.** Google compares the full
   string. `https://samograph.samo.team/auth/google/callback/` ≠
   `…/callback`.
4. **A branch preview.** It should never reach Google at all — it has no
   credentials and `/auth/google/*` returns `SAMO-AUTH-010`. If a branch preview
   *did* reach Google, a credential leaked into a preview env; rotate it.
5. **The derived default drifted.** Set `GOOGLE_OAUTH_REDIRECT_URI` explicitly for
   that env and restart.

**"Access blocked: samograph has not completed the Google verification process"**,
or a sign-in that works for the owner and nobody else. The client is still in
**Testing** mode: only the **≤100 listed test users** can sign in. Add the account
under *Audience → Test users*, or publish the app (needs `/privacy` and `/terms`
live — Part 3).

**The button does not render.** Expected on branch previews and on any env with no
credentials. Check `GET /auth/providers` on that env: `{"google": false}` means the
provider is genuinely not composed. A `5xx` or a network failure on that probe also
resolves to `false` in the client **by design**, so a broken probe can never break
the sign-in page — but it will hide a working button, so check app-api's health
too.

**The button renders but every sign-in fails at Google.** Read [the
`.samohost.toml` trap](#the-samohosttoml-trap--never-put-the-secret-in-secrets)
first — that is what this symptom means until proven otherwise. Then check that
the id/secret pair belongs to the **same** client.

**`SAMO-AUTH-009` — "email isn't verified".** The Google account's
`email_verified` is not boolean `true` on the ID token. This is a **hard gate**: we
create nothing, link nothing, and mint no cookie. Do not "fix" it by relaxing the
gate — it is the check that stands between the callback and an account takeover
(S5-1 item 4). The user verifies with Google, or signs in with magic link.

**Sign-in works but lands on the wrong host / 404s.** Check `APP_API_ORIGIN` for
that env — without it, `apps/web/next.config.mjs` drops the whole `rewrites()` key
and `/auth/google/*` never reaches app-api.

## See also

- [`SPEC.amendments.md` → S5-1](../../blueprints/samograph-dev/SPEC.amendments.md) — the amendment that reverses the §1 "no Google OAuth" non-goal, and the boundary it holds (no calendar scopes).
- [db-bootstrap.md](./db-bootstrap.md) — the per-env superuser bootstrap; a fresh DB without it breaks **all** sign-in, Google included.
- [trusted-proxy.md](./trusted-proxy.md) — `clientIp()` feeds the 20/hr/IP limit on `/auth/google/start` too.
- [README index](./README.md) — full runbook set.
