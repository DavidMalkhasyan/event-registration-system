# ADR-010: Passwordless authentication, sessions and anti-forgery

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11). Authentication method from R55; anti-forgery mechanism from API-D9 (API design review). |
| **Requirements baseline** | REQUIREMENTS.md v1.6 |
| **Related** | ADR-011 (link-token transport), ADR-012 (hashing), ADR-013 (one origin), ADR-017 (errors), [API_DESIGN.md](../api/API_DESIGN.md), [openapi.yaml](../api/openapi.yaml) |

## 1. Context

- Organizers sign in with single-use email links and server-side PostgreSQL sessions (FR-ORG-1 to FR-ORG-8, R55).
- Staff get a device session by accepting an invitation (FR-STAFF-2).
- Every state-changing request needs protection against cross-site request forgery: a token tied to the session, plus an `Origin` check (FR-ORG-4, NFR-SEC-8).
- Sign-in confirmation happens **before** any session exists. It needs a **pre-session** anti-forgery token (FR-ORG-3 d).
- Session identifiers must never be readable by JavaScript.

## 2. Decision summary

| Concern | Decision |
|---|---|
| Authentication | Passwordless sign-in links (FR-ORG-3); re-authentication by a fresh link (FR-ORG-5); MFA can be added later (OQ-15) |
| Sessions | Opaque 256-bit IDs, stored only as domain-separated SHA-256 hashes (ADR-012, D-6), in `__Host-` cookies that are `HttpOnly` |
| Anti-forgery, sessions | A **session-bound HMAC token** in the `X-CSRF-Token` header, plus an exact `Origin` check |
| Anti-forgery, sign-in confirmation | A **signed pre-session token** bound to the sign-in request and to a pre-session nonce cookie, plus an `Origin` check |
| Link routes | Authority comes only from `Authorization: Link` (ADR-011). Session cookies are ignored; `Origin` is checked on `POST`. |

## 3. Cookies

All cookies use the `__Host-` prefix, so browsers enforce `Secure`, `Path=/` and no `Domain`. None is ever readable by JavaScript (`HttpOnly`), and no response body ever contains a cookie value.

| Cookie | Value | Attributes | Set by | Cleared by | Lifetime |
|---|---|---|---|---|---|
| `__Host-ers_org` | Organizer session ID: 32 random bytes, base64url | `Secure; HttpOnly; SameSite=Lax; Path=/` | `POST /api/links/sign-in/confirm` | Sign-out; sign-out everywhere (on the calling device); any request that finds the session invalid (`Max-Age=0`) | `Max-Age` = seconds until `absolute_expires_at` (at most 30 days). The server also enforces the 7-day idle limit and revocation (FR-ORG-4). |
| `__Host-ers_staff` | Staff session ID: 32 random bytes, base64url | `Secure; HttpOnly; SameSite=Lax; Path=/` | `POST /api/links/invite/accept` | Any request that finds the session invalid (`Max-Age=0`) | `Max-Age` = seconds until the earlier of the absolute expiry (30 days, D-4) and the end of the check-in window. The server enforces revocation, idle limit, event status and window (FR-STAFF-2). |
| `__Host-ers_presession` | Nonce: 32 random bytes, base64url | `Secure; HttpOnly; SameSite=Strict; Path=/` | `GET /api/links/sign-in`, only for a valid link and never on `HEAD` | A successful `POST /api/links/sign-in/confirm` (`Max-Age=0`) | `Max-Age=900` (15 minutes, the longest validity of a sign-in link) |

**Session validation on every request:**
1. Hash the cookie value (SHA-256, domain `organizer_session` or `staff_session`).
2. Look the session up by that hash.
3. Check revocation, absolute expiry and idle expiry against the decision time. Staff sessions are also checked against event status and the check-in window.
4. Update "last seen" in its own transaction, at most every 5 minutes (TX-A07, TX-A08).
5. On failure: `401 unauthenticated`, and the cookie is cleared.

Event-scoped writes repeat the check after taking the event lock (`authorize(tx)`, AC-156).

## 4. Pre-session anti-forgery token (sign-in confirmation)

**Issued by `GET /api/links/sign-in`** for a valid sign-in link:
- **Cookie:** `__Host-ers_presession = nonce`.
- **Body field `preSessionToken`:** `v1.<keyId>.<exp>.<mac>`, where:
  - `exp` = `min(now + 15 min, sign_in_request.expires_at)`, in Unix seconds;
  - `mac` = `base64url(HMAC-SHA-256(K_presession[keyId], "ers/presession/v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ sign_in_request_id ‖ 0x00 ‖ exp))`.
- **No database write.** The `GET` stays read-only (FR-LNK-9, AC-60), and nothing about the token is stored.

**Verified by `POST /api/links/sign-in/confirm`, in this order:**
1. **`Origin`** must exactly equal the configured public origin. Otherwise `403 origin_check_failed`.
2. **The link token** (`Authorization: Link`) must resolve to an active sign-in request. Otherwise the **generic `404`** (FR-LNK-7).
3. **The pre-session token** must be valid:
   - the `X-CSRF-Token` header is present and well-formed, with a known key ID;
   - `exp` is later than the server time;
   - the pre-session cookie is present;
   - the MAC, recomputed from the cookie nonce, the request ID resolved in step 2 and `exp`, matches (constant-time comparison).

   Otherwise `403 csrf_failed`, and nothing changes.
4. **TX-A02** runs. On success the response sets `__Host-ers_org` and clears `__Host-ers_presession`.

**Binding:** the token works only together with **this** browser's nonce cookie and **this** sign-in request. It can't be replayed for another request or from another browser, and it expires with the link.

## 5. Session-bound anti-forgery token (organizer and staff)

- **Format:** `v1.<keyId>.<mac>`, where `mac` = `base64url(HMAC-SHA-256(K_csrf[keyId], "ers/csrf/v1" ‖ 0x00 ‖ kind ‖ 0x00 ‖ session_row_id))` and `kind` is `org` or `staff`. The session's internal row ID is used, never the cookie value.
- **Delivery:** only in the JSON body of `GET /api/auth/session` or `GET /api/staff/session`. Other origins can't read it, because no CORS headers exist. The page keeps it **in memory** only and fetches it again after a reload.
- **Required on** every `POST`, `PUT`, `PATCH` and `DELETE` on cookie-authenticated routes, including sign-out. Not required on `GET`, `HEAD` or SSE, which never change domain state.
- **Verification:** recompute the MAC for the session resolved from the cookie and compare in constant time. The current and the previous key ID are both accepted (§7).
- **Lifetime:** the token lives exactly as long as its session. A new session (sign-in or re-authentication) means a new token.
- **Failure:** `403 csrf_failed`, and nothing changes. The client may fetch the token again and retry **once**, which is safe because nothing changed.
- **No database storage:** the token is stateless, so the schema needs no column.

## 6. `Origin` rule

| Request | Rule |
|---|---|
| Every `POST`, `PUT`, `PATCH`, `DELETE` under `/api/` (public, link, organizer, staff) | `Origin` is **required** and must exactly equal the configured public origin (scheme, host, port). Otherwise `403 origin_check_failed`. |
| `GET` and `HEAD` | Not checked; they never change state |
| `POST /webhooks/email` | Exempt: server-to-server, authenticated by the Svix signature |

Browsers in the supported matrix send `Origin` on same-origin `POST` requests. The end-to-end tests verify this (NFR-UX-1). **[RISK]** An unusual client that omits `Origin` is rejected.

## 7. Keys and rotation

| Key | Purpose | Previous key accepted for |
|---|---|---|
| `K_csrf` | Session anti-forgery tokens | 24 hours (afterwards clients get `403 csrf_failed`, fetch the token again and retry) |
| `K_presession` | Pre-session tokens | 15 minutes |
| `K_preview` | Event-deletion preview tokens (API_DESIGN §7.4) | 10 minutes |
| `K_ratelimit` | HMAC of rate-limit identifiers (D-6) | One rate-limit window (DATABASE_DESIGN §6.2) |

- **Separation:** the keys are separate secrets of at least 256 bits each, held in the hosting secret store (OQ-2). They are never stored in the database, logs or repository (ENG-DOC-3).
- **Key IDs:** each token embeds the ID of the key that signed it, so a new current key can be introduced at any time.

## 8. Re-authentication (FR-ORG-5)

1. Routes flagged `x-recent-authentication` require `decision time < session.authenticated_at + 15 min`. Otherwise `401 reauthentication_required`.
2. The client calls `POST /api/auth/reauthentication`, which sends a link to the account's current address (TX-A01, purpose `reauth`).
3. Confirming that link creates a **new** session and revokes the requesting one. The client then fetches the new session's anti-forgery token, and the user confirms the original action again. The link never performs the action itself (AC-149).

## 9. What JavaScript can and cannot see

| Value | Visible to page JavaScript? |
|---|---|
| Organizer and staff session IDs; pre-session nonce | **Never** (`HttpOnly` cookies only) |
| Session anti-forgery token; pre-session token | In memory only; never persisted |
| Link tokens | In memory only (ADR-011) |

## 10. Consequences

**Positive:**
- No server-side state for anti-forgery tokens.
- Login CSRF is blocked on top of the header-based link authority.
- Sessions remain revocable at once (FR-ORG-4).

**Negative:**
- Clients must fetch the token after a reload, and handle `csrf_failed` after a key rotation.
- Clients that don't send `Origin` are rejected.

## 11. Tests

AC-85, AC-146, AC-147, AC-148, AC-149, AC-151, AC-156, AC-177, AC-178.

Additional design tests:
- the pre-session token fails with another browser's nonce, another sign-in request, after `exp`, or with a forged key ID;
- an anti-forgery token from another session, or of another kind, is rejected;
- `GET /api/links/sign-in` writes nothing to the database;
- `HEAD` never sets the pre-session cookie.

## Traceability

FR-ORG-1 to FR-ORG-8, FR-STAFF-2, FR-STAFF-3, FR-STAFF-6, FR-LNK-9, FR-LNK-10, NFR-SEC-1, NFR-SEC-8, NFR-CON-7, §12.2; R55; API-D9; D-4, D-6.
