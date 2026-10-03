SAMPLE — fictional data for the TabForest demo. Contoso Ltd. is a fictional company.

# CAM-142 · Customer Authentication Migration

Contoso Ltd. · Jira Software · Project **CAM** (Customer Accounts & Membership) / CAM-142

| Field | Value |
|---|---|
| Type | Story |
| Status | **IN PROGRESS** |
| Priority | High |
| Assignee | Priya Shah |
| Reporter | Marcus Lee |
| Sprint | CAM Sprint 14 (Sep 14 – Sep 25) |
| Story points | 13 |
| Labels | `auth` `azure` `fabrikam` `q4-commit` |
| Components | identity, customer-portal |
| Epic link | CAM-100 Platform modernization FY27 |
| Fix version | 2026.11 |
| Watchers | 6 |
| Created | 2026-09-02 · Updated 2026-09-23 |

## Description

**Goal:** Migrate customer authentication to Azure before the Fabrikam go-live, without forcing existing customers to reset their passwords.

Today every customer portal login goes through the on-prem identity box (`idp01`). It is out of vendor support in March, it does not scale for the 8–9 a.m. login peak, and Fabrikam's security questionnaire flagged it twice. The plan is a small token service on Azure, the portal moved to an OAuth 2.0 authorization code flow with PKCE, and `idp01` retired after a two-week dual-run.

Hosting for the token service is not decided yet (Functions vs App Service), see arch sync on 9/22. Plan doc: *Customer Auth Migration Plan* (Confluence, CAM space).

Out of scope: employee SSO, the partner API keys, MFA changes (CAM-160).

~~Use the legacy cookie domain for the callback~~ (dropped, see Sam's comment)

## Acceptance criteria

- [x] App registration created in the Contoso tenant (staging + prod redirect URIs)
- [ ] Token service deployed to Azure in staging and prod
- [ ] OAuth callback (`/auth/callback`) tested end to end against the Fabrikam test tenant
- [ ] Existing customers can sign in after cutover without a password reset
- [ ] Refresh tokens survive the cutover, OR users are asked to sign in again at most once
- [ ] Rollback rehearsed in staging (migration plan §4)
- [ ] Runbook + on-call notes updated
- [ ] App Insights dashboard for login success rate and p95 latency

## Sub-tasks

| Key | Summary | Assignee | Status |
|---|---|---|---|
| CAM-143 | Token service skeleton | Priya Shah | IN REVIEW (PR #418) |
| CAM-144 | App registration + redirect URIs | Sam Rivera | DONE |
| CAM-145 | OAuth callback handler `/auth/callback` | You | IN PROGRESS |
| CAM-146 | Session storage design | Unassigned | TO DO |
| CAM-147 | Cutover runbook | Marcus Lee | TO DO |

Linked issues: *blocks* CAM-150 (Fabrikam onboarding) · *relates to* CAM-160 (MFA) · *is cloned by* CAM-151 (do not use, created by mistake)

## Activity

**Marcus Lee** · 2026-09-02 09:14
Created from the Q4 architecture review. Priya to own the overall story, sub-tasks below.

**Jira Automation** · 2026-09-02 09:14
Added to board *CAM Kanban*. Story points estimate missing.

**Dana Ortiz** · 2026-09-05 16:40
Fabrikam is targeting go-live on Nov 3 and they keep asking if SSO comes "for free" with this. It does not, but I'd like a one-liner I can send them. Linking my account note in the CAM space.

**Marcus Lee** · 2026-09-09 11:02
Assigning the OAuth callback work to You (CAM-145), since you set up the portal redirect URIs last time. Priya stays on the token service itself.

**You** · 2026-09-09 11:20
👍 Will pick it up after the CAM-139 hotfix ships.

**Sam Rivera** · 2026-09-12 15:31
App registration done. Redirect URIs are in for staging and prod. The prod one is a placeholder hostname until hosting is decided. Also: please don't use the legacy cookie domain for the callback, it breaks SameSite in Safari.

**Priya Shah** · 2026-09-17 18:05
Draft PR #418 is up. Token issue + validate work locally. End-to-end is blocked until Fabrikam sends test credentials.

**Jira Automation** · 2026-09-21 08:00
Sprint *CAM Sprint 14* ends in 4 days. 3 sub-tasks are not done.

**Dana Ortiz** · 2026-09-22 10:12
Unrelated, but does anyone know if the Fabrikam renewal includes the support add-on? Asking here because their procurement person cc'd this thread.

**You** · 2026-09-23 17:48
Callback route works against the staging app registration with the mock IdP. Still need the real Fabrikam tenant before I can call it tested.

**Marcus Lee** · 2026-09-23 18:02
Thanks. Moving to Sprint 15 if it slips, no drama.

---
Worklog: Priya Shah 14h · You 6h · Sam Rivera 3h · Time remaining: 2d 4h
