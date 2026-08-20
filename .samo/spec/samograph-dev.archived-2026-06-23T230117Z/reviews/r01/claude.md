# Reviewer B — Claude

## summary

v0.2 is a strong, well-scoped first authored draft and clears every mandatory baseline section (version header, goal/why, 8 user stories, architecture, implementation details, TDD-flagged tests, 5-person veteran team, two-sprint plan with parallelization, embedded changelog). The anti-framing disclaimers (NOT a CLI, NOT a plugin, NOT an AI product in v1) are honored throughout — no contradictions found there. The substantive issues cluster in two places: (1) tenant-isolation and webhook-auth mechanisms are described aspirationally rather than mechanically (RLS without saying how the worker honors it, webhook signing referenced but not specified, resync sequence undefined relative to the data model), and (2) tunnel topology contradicts itself between §5.1 (single cloudflared per region) and Q6 (active/active replicas), which also leaves the multi-call watchdog semantics ambiguous. Several user-story acceptance tests are weak (U4 dictionary "expected direction," U2 mismatched route, U6 chat-post fallback). v0.3 should resolve the tunnel-topology contradiction, define the per-write tenant-isolation mechanism, add `seq` to the transcript model and the resync flow, replace U4's manual recipe with a contract test on the Recall keyterm payload, and write down behavior at the rate-limit and viewer-cap boundaries.

## contradiction

- (major) Section 5 contains a scaffold marker block `<!-- architecture:begin --> ... (architecture not yet specified) ... <!-- architecture:end -->` immediately before §5.1, which fully specifies the architecture. The literal sentence "architecture not yet specified" directly contradicts the diagram and component list below it. Either delete the placeholder block or wrap the §5.1 diagram inside the markers so a future automated check doesn't read the section as unfinished.
- (major) Tunnel topology is described two different ways. §5.1 commits to "one persistent cloudflared per region" and §6.3's watchdog is built on the assumption that a single tunnel down = every active call degraded. Q6 then commits to "Two cloudflared replicas per region (active/active under one name)" as the SPOF mitigation. v1 cannot simultaneously ship single-node tunnels and active/active HA — pick one, and re-derive the watchdog semantics (when do we fan out a SAMOGRAPH-WARNING if a peer is still healthy?).
- (minor) U2's manual test verifies that words populate `/calls/:id`, but the live-page route is `/c/<token>` everywhere else (U3, §5.1, §9). Either `/calls/:id` is an authenticated owner view that should be introduced in §5.1 alongside `/c/<token>`, or this is a typo. As written, a reader can't tell which page they're supposed to be staring at during the test.

## ambiguity

- (major) §6.3 says the WS hub sends `{type:"resync", from: last_seq}` on backpressure overflow, but the `TranscriptLine` data model in §5.2 only defines `version` (per-line interim/final counter) — no `seq` exists. The client cannot ask the server for "everything since seq N" if no monotonically-increasing per-call sequence is persisted. Either add `seq BIGSERIAL` to `transcript_lines` and specify how the WS hub assigns it, or redefine resync to replay by `started_at`/`id` ordering.
- (major) The tenant-isolation story in §5.3 leans on Postgres RLS on `calls` and `transcript_lines`, but the actual writer is the bot worker reacting to a Recall webhook. Workers typically hold a service-role connection that bypasses RLS, which is exactly the path the threat model worries about (bot_id misrouting → cross-tenant write). The spec doesn't say whether the worker (a) runs each write under `SET LOCAL ROLE user_<uid>` / `SET app.current_user_id`, (b) calls a SECURITY DEFINER function that re-checks ownership, or (c) just trusts the `bot_id → user_id` lookup. Without that mechanism named, RLS is decorative and the §5.3 promise is unverifiable.
- (major) §5.3 says inbound webhooks are validated by "sign[ing] join requests with a per-bot nonce," but that describes outgoing createBot calls, not how the worker verifies that an *incoming* webhook actually came from Recall. Recall provides a webhook signing secret; the spec never says we check it. Specify the inbound-webhook authentication (signature header + secret, replay window, clock skew) — otherwise any attacker who guesses `bot_id` can POST forged transcript lines into a victim's call.
- (minor) U2 says "Within 5 minutes of signing in, her Calendar shows a new event with a Meet/Zoom link; she does nothing." It conflates "signing in" with "meeting time" — is the 5 min the latency the poller is allowed, or the gap to the meeting start? The manual-test recipe ("create a Calendar event 3 minutes out") doesn't match the 5-minute phrasing either. Reword as: precondition = Calendar contains an event whose start is within the next 15-minute polling window; acceptance = bot is in the lobby by T-60s ± poller jitter.
- (minor) U6 mandates that the bot auto-posts a disclosure message in meeting chat on join, but Recall.ai's chat-send capability differs by platform (Google Meet host-controlled chat, Zoom in-meeting chat permissions, waiting-room state). The spec doesn't acknowledge the failure mode where the platform silently swallows the message — in which case the only disclosure act left is the bot display name, which §6.4 lists as separate from "the explicit disclosure act." Specify the fallback when chat-post fails (retry? surface to owner? hard-fail the join?) so the legal posture in two-party-consent jurisdictions doesn't quietly collapse.
- (minor) §5.4 caps users at "6 hours/day, 30 hours/month" but only specifies the *pre-call* enforcement ("calendar events are silently skipped with a dashboard banner"). What happens when a user crosses the cap mid-call — does the bot leave abruptly, finish the call but lock further joins, or warn into the transcript? Without a stated behavior, the implementation will pick one and surprise users (and possibly cut off recording of a paid customer pitch).
- (minor) §5.4 caps a call at 100 concurrent share-link viewers, but neither §5.4 nor U3 says what the 101st viewer sees: connection refused, queued, downgraded to REST-poll, or a friendly "this read-along is full" page. Decide and write it down so the frontend has something to render and the share-link affordance can warn the host.

## weak-testing

- (major) U4's manual test for the custom dictionary reads: "repeat the same spoken phrase in a second call — confirm transcripts diverge in the expected direction." ASR with keyterm hints is probabilistic; "diverge in the expected direction" is not a falsifiable criterion and will pass-or-fail at the tester's mood. Replace with a deterministic test of the *integration contract*: assert the worker forwards `dictionary` rows as Recall `keyterms` on `createBot`, and snapshot the createBot payload. Treat ASR quality improvement as a manual smoke separately, not as the U4 acceptance gate.
- (major) §7.2's TDD list omits the join-job scheduler — the T-60s enqueue from the 1-minute calendar poll. This is exactly the kind of code that fails silently (clock skew, missed-minute due to a long poll, double-enqueue on event re-poll, late event added inside the T-60 window) and is hard to debug from logs. Add a TDD entry: "Join scheduler — for a given clock and event set, produces the correct set of join jobs exactly once, including events appearing inside the T-60 window."
- (minor) §7.1 lists a single "nightly real-bot E2E against a dedicated test Meet link." Recall payload/contract regressions discovered nightly mean up to a day of broken transcripts in prod before the alarm fires. Add an on-PR sandbox smoke (or a Recall-mocked but realistic webhook replay using captured payloads — the CLI already has fixtures) so contract drift is caught at merge time, not at 3 AM.

## suggested-next-version

v0.3

<!-- samospec:critique v1 -->
{
  "findings": [
    {
      "category": "contradiction",
      "text": "Section 5 contains a scaffold marker block `<!-- architecture:begin --> ... (architecture not yet specified) ... <!-- architecture:end -->` immediately before §5.1, which fully specifies the architecture. The literal sentence \"architecture not yet specified\" directly contradicts the diagram and component list below it. Either delete the placeholder block or wrap the §5.1 diagram inside the markers so a future automated check doesn't read the section as unfinished.",
      "severity": "major"
    },
    {
      "category": "contradiction",
      "text": "Tunnel topology is described two different ways. §5.1 commits to \"one persistent cloudflared per region\" and §6.3's watchdog is built on the assumption that a single tunnel down = every active call degraded. Q6 then commits to \"Two cloudflared replicas per region (active/active under one name)\" as the SPOF mitigation. v1 cannot simultaneously ship single-node tunnels and active/active HA — pick one, and re-derive the watchdog semantics (when do we fan out a SAMOGRAPH-WARNING if a peer is still healthy?).",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§6.3 says the WS hub sends `{type:\"resync\", from: last_seq}` on backpressure overflow, but the `TranscriptLine` data model in §5.2 only defines `version` (per-line interim/final counter) — no `seq` exists. The client cannot ask the server for \"everything since seq N\" if no monotonically-increasing per-call sequence is persisted. Either add `seq BIGSERIAL` to `transcript_lines` and specify how the WS hub assigns it, or redefine resync to replay by `started_at`/`id` ordering.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "The tenant-isolation story in §5.3 leans on Postgres RLS on `calls` and `transcript_lines`, but the actual writer is the bot worker reacting to a Recall webhook. Workers typically hold a service-role connection that bypasses RLS, which is exactly the path the threat model worries about (bot_id misrouting → cross-tenant write). The spec doesn't say whether the worker (a) runs each write under `SET LOCAL ROLE user_<uid>` / `SET app.current_user_id`, (b) calls a SECURITY DEFINER function that re-checks ownership, or (c) just trusts the `bot_id → user_id` lookup. Without that mechanism named, RLS is decorative and the §5.3 promise is unverifiable.",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "§5.3 says inbound webhooks are validated by \"sign[ing] join requests with a per-bot nonce,\" but that describes outgoing createBot calls, not how the worker verifies that an *incoming* webhook actually came from Recall. Recall provides a webhook signing secret; the spec never says we check it. Specify the inbound-webhook authentication (signature header + secret, replay window, clock skew) — otherwise any attacker who guesses `bot_id` can POST forged transcript lines into a victim's call.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "U4's manual test for the custom dictionary reads: \"repeat the same spoken phrase in a second call — confirm transcripts diverge in the expected direction.\" ASR with keyterm hints is probabilistic; \"diverge in the expected direction\" is not a falsifiable criterion and will pass-or-fail at the tester's mood. Replace with a deterministic test of the *integration contract*: assert the worker forwards `dictionary` rows as Recall `keyterms` on `createBot`, and snapshot the createBot payload. Treat ASR quality improvement as a manual smoke separately, not as the U4 acceptance gate.",
      "severity": "major"
    },
    {
      "category": "weak-testing",
      "text": "§7.2's TDD list omits the join-job scheduler — the T-60s enqueue from the 1-minute calendar poll. This is exactly the kind of code that fails silently (clock skew, missed-minute due to a long poll, double-enqueue on event re-poll, late event added inside the T-60 window) and is hard to debug from logs. Add a TDD entry: \"Join scheduler — for a given clock and event set, produces the correct set of join jobs exactly once, including events appearing inside the T-60 window.\"",
      "severity": "major"
    },
    {
      "category": "ambiguity",
      "text": "U2 says \"Within 5 minutes of signing in, her Calendar shows a new event with a Meet/Zoom link; she does nothing.\" It conflates \"signing in\" with \"meeting time\" — is the 5 min the latency the poller is allowed, or the gap to the meeting start? The manual-test recipe (\"create a Calendar event 3 minutes out\") doesn't match the 5-minute phrasing either. Reword as: precondition = Calendar contains an event whose start is within the next 15-minute polling window; acceptance = bot is in the lobby by T-60s ± poller jitter.",
      "severity": "minor"
    },
    {
      "category": "contradiction",
      "text": "U2's manual test verifies that words populate `/calls/:id`, but the live-page route is `/c/<token>` everywhere else (U3, §5.1, §9). Either `/calls/:id` is an authenticated owner view that should be introduced in §5.1 alongside `/c/<token>`, or this is a typo. As written, a reader can't tell which page they're supposed to be staring at during the test.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "U6 mandates that the bot auto-posts a disclosure message in meeting chat on join, but Recall.ai's chat-send capability differs by platform (Google Meet host-controlled chat, Zoom in-meeting chat permissions, waiting-room state). The spec doesn't acknowledge the failure mode where the platform silently swallows the message — in which case the only disclosure act left is the bot display name, which §6.4 lists as separate from \"the explicit disclosure act.\" Specify the fallback when chat-post fails (retry? surface to owner? hard-fail the join?) so the legal posture in two-party-consent jurisdictions doesn't quietly collapse.",
      "severity": "minor"
    },
    {
      "category": "weak-testing",
      "text": "§7.1 lists a single \"nightly real-bot E2E against a dedicated test Meet link.\" Recall payload/contract regressions discovered nightly mean up to a day of broken transcripts in prod before the alarm fires. Add an on-PR sandbox smoke (or a Recall-mocked but realistic webhook replay using captured payloads — the CLI already has fixtures) so contract drift is caught at merge time, not at 3 AM.",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.4 caps users at \"6 hours/day, 30 hours/month\" but only specifies the *pre-call* enforcement (\"calendar events are silently skipped with a dashboard banner\"). What happens when a user crosses the cap mid-call — does the bot leave abruptly, finish the call but lock further joins, or warn into the transcript? Without a stated behavior, the implementation will pick one and surprise users (and possibly cut off recording of a paid customer pitch).",
      "severity": "minor"
    },
    {
      "category": "ambiguity",
      "text": "§5.4 caps a call at 100 concurrent share-link viewers, but neither §5.4 nor U3 says what the 101st viewer sees: connection refused, queued, downgraded to REST-poll, or a friendly \"this read-along is full\" page. Decide and write it down so the frontend has something to render and the share-link affordance can warn the host.",
      "severity": "minor"
    }
  ],
  "summary": "v0.2 is a strong, well-scoped first authored draft and clears every mandatory baseline section (version header, goal/why, 8 user stories, architecture, implementation details, TDD-flagged tests, 5-person veteran team, two-sprint plan with parallelization, embedded changelog). The anti-framing disclaimers (NOT a CLI, NOT a plugin, NOT an AI product in v1) are honored throughout — no contradictions found there. The substantive issues cluster in two places: (1) tenant-isolation and webhook-auth mechanisms are described aspirationally rather than mechanically (RLS without saying how the worker honors it, webhook signing referenced but not specified, resync sequence undefined relative to the data model), and (2) tunnel topology contradicts itself between §5.1 (single cloudflared per region) and Q6 (active/active replicas), which also leaves the multi-call watchdog semantics ambiguous. Several user-story acceptance tests are weak (U4 dictionary \"expected direction,\" U2 mismatched route, U6 chat-post fallback). v0.3 should resolve the tunnel-topology contradiction, define the per-write tenant-isolation mechanism, add `seq` to the transcript model and the resync flow, replace U4's manual recipe with a contract test on the Recall keyterm payload, and write down behavior at the rate-limit and viewer-cap boundaries.",
  "suggested_next_version": "v0.3",
  "usage": null,
  "effort_used": "max"
}
<!-- samospec:critique end -->
