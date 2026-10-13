# Authentication, Organization and Super Admin Security Audit (K-718)

**Date:** 2026-10-13 (session S-20, prompt 33). **Scope:** organization registration, email confirmation, password authentication and reset, pending-organization restrictions, Super Admin approval, rejection, suspension and reinstatement, memberships and roles, event ownership, staff devices, cross-organization isolation, sessions, cookies, CSRF, rate limits, enumeration resistance, audit records. **Method:** reading the code paths, mapping each required check to automated tests that run against the real PostgreSQL database (and, where the browser matters, the real web and worker processes), adding tests where a check had none, mutation runs for the security-relevant rules, and a run of the operator commands against real databases. Decisions: [PD-99](../process/DECISION_LOG.md).

## The ten required checks

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | The bootstrap command works | `pnpm admin:create` run against the **development database** on 2026-10-13 (a local test account; its generated password is in the Git-ignored `var/local-superadmin.json`, never printed or committed): the account exists with an Argon2id hash and an audit record (`platform_admin_created`, actor `system`); a second run for the same address exits 1 and changes nothing. Automated: `platform-admin.test.ts` ("the operator command"), `admin.spec.ts` (the command run by the browser test against the test database) | Pass |
| 2 | Public registration cannot create a Super Admin | No route creates or grants the role; `POST /api/admin/admins`, `/api/admin/platform-admins`, `/api/admin/bootstrap` answer 404 and create nothing (`platform-admin.test.ts`); organization and account registration write only `accounts`, `organizations`, memberships (`accounts.test.ts`, `members.test.ts`) | Pass |
| 3 | Ordinary organizers cannot use `/admin` | The page is a static entry; every `/api/admin/*` call needs an admin session: an organizer's cookie gets 401, an admin cookie is not an organizer session (`platform-admin.test.ts`, "keeps admin and organizer sessions apart"); organizer credentials are refused at the admin sign-in (`admin.spec.ts`) | Pass |
| 4 | Pending organizations cannot create events | `accounts.test.ts` ("a pending organization cannot manage events"): 403 `organization_not_active`; `organizations.test.ts` for inactive organizations | Pass |
| 5 | Approval grants the expected access | `platform-admin.test.ts` ("approves a pending organization"): event creation goes from 403 to 201; `admin.spec.ts` in the browser | Pass |
| 6 | Rejection and suspension revoke access | `platform-admin.test.ts`: rejected stays without access; suspended organizers get 404 on reads and 403 on changes at once; public pages continue; reinstating restores access | Pass |
| 7 | No organization reaches another's data | `organizations.test.ts` (every endpoint family answers another organization's event as unknown), `media.test.ts`, `location.test.ts`, `members.test.ts` (outsiders get 404 on members and invitations) | Pass |
| 8 | Organizations keep a valid owner | `members.test.ts`: the last owner can neither leave nor be demoted (409 `last_owner`); two owners demoting each other at the same moment leave exactly one owner (forced overlap; a mutation without the organization lock leaves none and fails the test) | Pass |
| 9 | Session expiry and revocation | Organizer: 7 days idle and 30 days absolute over HTTP (`auth-audit.test.ts`, new), sign-out and re-authentication revocation (`reauth.test.ts`, `accounts.test.ts`); Super Admin: 2 hours idle, sign-out, disabling ends sessions (`platform-admin.test.ts`); staff: owner revocation, the window end, self-ending (`staff.test.ts`) | Pass |
| 10 | A password reset ends the account's sessions | `accounts.test.ts` ("sets a new password once ... signs out every session"; a mutation without the revocation fails it); `accounts.spec.ts` signs another browser out in the browser | Pass |

## Hardening review

| Area | Finding | Action |
|---|---|---|
| Password hashing | Argon2id from Node's `crypto`, `m=19456` (19 MiB), `t=2`, `p=1`, 16-byte salt, PHC string checked by the database; the OWASP Password Storage Cheat Sheet's first recommended configuration. Measured on the development machine: median 36 ms per hash, 33 ms per verification | Kept. A larger memory cost (for example 46 MiB with `t=1`) can be chosen at deployment if the host has the memory; existing hashes keep verifying because the parameters are read from each PHC string |
| Password policy | 12 to 128 characters, any characters; no composition rules (NIST SP 800-63B) | Kept. A breached-password check would need an external service (for example the k-anonymity HIBP API): a stakeholder decision |
| Organizer sessions | `__Host-` cookie, Secure, HttpOnly, SameSite=Lax, host-only, path `/`; 30 days absolute, 7 days idle; hashed in the database; revoked on sign-out, re-authentication and password reset; protected actions need a sign-in within 15 minutes | Kept; cookie attributes and expiry now tested over HTTP |
| Super Admin sessions | Own table and cookie (`__Host-ers_admin`, SameSite=Strict), 12 hours absolute, 2 hours idle, own CSRF kind, disabled admins lose their sessions | Kept; **second factor added** (below) |
| CSRF | Exact `Origin` check on every state-changing `/api/` request (only the signed webhook path is exempt), plus an HMAC token bound to the session kind and ID | Kept; covered by tests for each kind |
| Rate limits | Sign-in 10 per 15 minutes per address and 30 per IP; Super Admin 5 and 20; registration, resets, invitations, uploads and map tiles have their own | Kept |
| Enumeration | Registration, resets and emailed links answer the same with or without an account; sign-in gives one answer for unknown, wrong and password-less, each verifying one Argon2id hash (similar timing) | Kept |
| Audit | Registrations, verifications, sign-ins (with whether a second factor was used), resets, decisions, membership and role changes, staff sessions, deletions; IDs only, append-only (a trigger refuses changes, observed during this audit) | Kept |
| Authorization | One access helper for organizer operations inside the event lock; membership checks per request (removal takes effect at once); staff limited to their event's check-in | Kept |

## Second factor

**Super Admins (implemented, PD-99).** They can approve, suspend and reinstate every organization: one stolen password must not be enough. Time-based one-time passwords (RFC 6238, the format of every authenticator app) need no external provider. Enrolment is an operator command on the server (`pnpm admin:totp --email …`): it shows a new secret once and enables it only after a current code from the app is typed. The secret is stored sealed with AES-256-GCM under `ADMIN_TOTP_KEY` (an operator secret outside the database). Sign-in then needs the current code (one step of clock drift either side); each step can be used once (stored atomically); a missing, wrong or reused code gets the same answer as a wrong password; attempts are rate-limited (5 per 15 minutes per address). **In production a second factor is required** (`ADMIN_REQUIRE_TOTP` defaults to on there, and the process refuses to start without `ADMIN_TOTP_KEY`); a Super Admin without one gets `second_factor_required` after a correct password and no session. Recovery: the operator enrols a new secret with the same command.

**Organizers (not implemented; stakeholder decision).** Organizer accounts manage events and participant data of their own organization only. Recommendation before a public launch with many organizations: optional TOTP for organizers (the same primitives), required for owners and admins. It adds enrolment screens and recovery codes; it is not built, and public production use with organizer accounts is not recommended until the stakeholder decides.

## Residual risks

- No breached-password check (needs an external service).
- No WebAuthn or passkeys.
- Session revocation lists are not exposed to organizers ("sign out everywhere" exists only through a password reset).
- The local development Super Admin has no second factor (allowed outside production).
