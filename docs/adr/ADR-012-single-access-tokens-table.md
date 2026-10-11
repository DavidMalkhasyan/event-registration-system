# ADR-012: One access_tokens table; SHA-256 token hashing

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11). The table was approved in principle in Phase 1 and specified by the approved database design. The hash functions were decided in the database design review (D-6, 2026-10-11). |
| **Requirements baseline** | REQUIREMENTS.md v1.6 |
| **Related** | ADR-011 (transport), [MODULES.md](../architecture/MODULES.md) (`access-tokens` module), [DATABASE_DESIGN.md §5.3, §6](../database/DATABASE_DESIGN.md#53-access-tokens-adr-012) |

## Context

- Six link types share one pattern:
  - a random value with at least 128 bits of entropy;
  - hash-only storage, with the raw value existing only at issuance;
  - issued per delivery (FR-LNK-2), with email tokens issued at send time inside the claim transaction (FR-LNK-3);
  - lookup by hash;
  - expiry and revocation;
  - one uniform invalid response (FR-LNK-7, BR-30).

  The link types are verification, staff invitation, management, share, sign-in and email change (NFR-SEC-1, FR-ORG-3, FR-ORG-6, FR-STAFF-1).
- REQUIREMENTS.md §10 recommended a link-token table and left the hash function open. Phase 1 approved one table in principle and deferred the hash choice to the database design.

## Decision

1. **All six link-token types live in one `access_tokens` table**, owned by the `access-tokens` module. That module is also the only producer of the generic invalid-link response.
2. **The approved database design specifies** the token types and ownership references, uniqueness, fixed and derived expiry, consumption on the owner row, revocation, and the `CHECK` constraints. See [DATABASE_DESIGN.md §5.3](../database/DATABASE_DESIGN.md#53-access-tokens-adr-012) and [CONSTRAINTS_AND_INDEXES.md](../database/CONSTRAINTS_AND_INDEXES.md) CK-33 to CK-39.
3. **Hashing (D-6)** for random link tokens **and** organizer and staff session IDs:
   - **Raw values:** 32 random bytes from a secure generator.
   - **Hash:** `SHA-256("ers/v1/" || domain || 0x00 || raw)`, where `domain` is the token type (or `organizer_session` / `staff_session`).
   - **Domain separation:** a token presented on the wrong route matches nothing.
   - **No key:** inputs are uniformly random, so no key or salt is needed.
   - **Algorithm identifier:** every row stores `hash_alg` (`1` = this scheme).
4. **Predictable identifiers** used for rate limiting (email addresses, IP addresses) are **not** stored with this scheme. They use HMAC-SHA-256 with a separately managed secret and a key-version column (D-6).
5. **Changing the algorithm:** add a new `hash_alg` value. New credentials use it, and lookups try older algorithms until those credentials expire. Rows are never rewritten.
6. **Raw tokens, raw session IDs and HMAC secrets are never stored or logged** (BR-19, AC-61, ENG-ERR-6).

## Scope notes

- **Session IDs** use the same hash scheme with their own domains, but are stored in the session tables owned by `identity` and `staff` (FR-ORG-4, FR-STAFF-2), not in `access_tokens`.
- **Ticket codes** are not tokens. They are short bearer codes with their own unique constraint (FR-TKT-1, FR-TKT-2), owned by `event-core`.

## Consequences

**Positive:**
- One resolution path, one uniform response, one rate limiter, and one place to audit hash-only storage (AC-61).
- A token type confused with another can never match.

**Negative:**
- The table holds rows of several types. Integrity relies on type-specific `CHECK` constraints instead of separate tables.
- A future algorithm change needs dual lookup until the longest-lived tokens (management and share, valid until the check-in window ends) have expired.

## Traceability

FR-LNK-1 to FR-LNK-10, FR-REG-3, FR-REG-7, FR-REG-11, FR-REG-12, FR-ROT-3, FR-ROT-9, FR-ROT-11, FR-STAFF-1, FR-STAFF-5, FR-ORG-3, FR-ORG-4, FR-ORG-6, NFR-SEC-1, NFR-SEC-1b, BR-19, BR-20, BR-22, BR-28, BR-30, §12.3 item 3, AC-61, AC-66, AC-103; D-6.
