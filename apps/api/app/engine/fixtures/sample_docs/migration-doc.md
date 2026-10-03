SAMPLE — fictional data for the TabForest demo. Contoso Ltd. is a fictional company.

# Customer Auth Migration Plan

Contoso Ltd. · Confluence · Space: CAM · Owner: Marcus Lee · Contributors: Priya Shah, Sam Rivera, You
Status: **DRAFT v0.6** · Last edited 2026-09-18 by Marcus Lee · Related: CAM-142, PR #418

> ⚠️ This page predates the 9/22 arch sync. Hosting in §3 may be out of date.

## §1 Background and goals

Customer logins for the Contoso customer portal go through `idp01`, an on-prem identity server that leaves vendor support in March. Fabrikam (new enterprise customer, go-live Nov 3) flagged it in their security review. Goal: move customer authentication to Azure with no forced password reset and less than one minute of total login downtime.

Non-goals: employee SSO, partner API keys, MFA policy changes (tracked in CAM-160).

## §2 Current state

- ~41,000 active customer accounts, ~2,300 logins in the 8–9 a.m. peak hour (Mon).
- `idp01` issues opaque session cookies (12 h) and refresh tokens (30 d) stored in its local SQL database.
- Password hashes are PBKDF2, exportable; Sam confirmed the import path on 9/10.
- The portal calls `idp01` directly from 4 places (login, logout, refresh, `/me`). Two of them are copy-pasted. Yes, really.

## §3 Target architecture

- **Token service** (new): issues and validates access and refresh tokens for the portal. Hosting: Azure Functions *or* App Service, decision at the arch sync.
- **Portal**: stays on App Service. Moves to authorization code flow + PKCE; callback at `/auth/callback`.
- **Secrets**: signing keys in Key Vault, referenced from app settings, rotated every 90 days.
- **Telemetry**: App Insights, login success rate and p95 latency; no token values or emails in logs.
- **Session storage: TBD.** Options so far: Azure Cache for Redis, Cosmos DB, signed cookie only. Needs an owner.

## §4 Cutover and rollback

### 4.1 Preconditions (all must be true at T-1 day)

1. Token service deployed to prod and passing synthetic logins every 5 minutes for 72 hours.
2. OAuth callback tested end to end against the Fabrikam test tenant (CAM-145).
3. Password hash import completed and spot-checked on 200 random accounts.
4. Rollback rehearsed in staging at least once, with the timings recorded below.
5. On-call rota for cutover week confirmed (primary: Sam Rivera, secondary: Priya Shah).

### 4.2 Cutover sequence

The portal decides where to send a login using the feature flag `auth.provider` (values `idp01` / `azure`, with a percentage rollout).

| Step | When | Action | Owner |
|---|---|---|---|
| 1 | T-7 d | Freeze changes to `idp01`. Announce maintenance window to Fabrikam via Dana. | Marcus Lee |
| 2 | T-1 d | Final hash import (delta since the bulk import). | Sam Rivera |
| 3 | T0 06:00 | `auth.provider=azure` at 5 % of new logins. Watch dashboards 30 min. | Priya Shah |
| 4 | T0 07:00 | 25 %, before the 8 a.m. peak. | Priya Shah |
| 5 | T0 10:00 | 100 % of new logins. Existing `idp01` sessions keep working until they expire. | Priya Shah |
| 6 | T+14 d | Stop accepting `idp01` refresh tokens. Decommission ticket for `idp01`. | Marcus Lee |

### 4.3 Dual-run

For 14 days both systems are live. The portal middleware accepts a valid session from either `idp01` or the token service. New refresh tokens are only issued by the token service. Account changes (password, email) are written to both systems by the portal during dual-run; the double write is the riskiest code in this plan and needs its own review.

### 4.4 Rollback triggers

Roll back if any of these hold for 10 consecutive minutes:

- login success rate below 97 % (baseline 99.2 %)
- p95 login latency above 2 s
- token service 5xx above 1 %
- any confirmed cross-account session (immediate rollback, no 10-minute wait)

### 4.5 Rollback steps

1. Set `auth.provider=idp01` at 100 %. Takes effect for new logins within 60 s (flag cache TTL).
2. Keep the token service running so already-issued access tokens stay valid until expiry (1 h).
3. Post in #cam-cutover and notify Dana so she can tell Fabrikam.
4. Open an incident review within 2 business days.

### 4.6 Known gap: refresh tokens on rollback

Refresh tokens issued by the token service are **not** valid on `idp01`. After a rollback, every user who signed in through Azure will be asked to sign in again when their access token expires. Options, none chosen yet:

- (a) accept the one-time re-login and warn customers up front;
- (b) teach `idp01` to validate token-service refresh tokens (touches frozen code);
- (c) keep the rollout at 25 % for longer to limit the blast radius.

Rehearsal timings (staging, 9/16): flag flip 41 s, dashboards green after 6 min. Second rehearsal not done yet.

### 4.7 Communication

Customer-facing message drafted by Dana, reviewed by Marcus. Internal status updates every 30 minutes during the window.

## §5 Testing and validation

- Unit + contract tests in the token service repo (CI). One flaky test (`test_refresh_rotation`, CAM-139).
- Synthetic login probe from two regions.
- End-to-end against the Fabrikam test tenant: **blocked**, waiting for their test credentials.
- Load test at 3× the Monday peak before T-1 d.

## §6 Open items and risks

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Hosting for the token service | Marcus Lee | Decide at arch sync 9/22 |
| 2 | Session storage design (§3) | ? | TBD |
| 3 | Fabrikam test credentials | Priya Shah / Dana Ortiz | Waiting on customer |
| 4 | Refresh tokens on rollback (§4.6) | Marcus Lee | Open |
| 5 | Quarantine flaky CI test | Sam Rivera | Open |

_Page comments (3) · Last viewed by You 2026-09-19_
