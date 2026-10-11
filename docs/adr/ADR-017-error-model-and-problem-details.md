# ADR-017: Error categories, Problem Details and the generic link-error contract

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11): RFC 9457 Problem Details (API-D10); generic link-error contract with safe server errors (API-D1, approved with changes). Error categories and logging rules are binding requirements (ENG-ERR-1 to ENG-ERR-7). |
| **Requirements baseline** | REQUIREMENTS.md v1.6 |
| **Related** | ADR-010, ADR-011, [API_DESIGN.md §8](../api/API_DESIGN.md#8-errors-adr-017), [openapi.yaml](../api/openapi.yaml) |

## 1. Context

- ENG-ERR-1 to ENG-ERR-7 require typed error categories, a fixed HTTP mapping, safe bodies, structured and redacted logs, and retries only where safe.
- FR-LNK-7 and BR-30 require **one byte-identical response** for every unusable link token. ENG-GEN-1 says that uniformity overrides "meaningful errors".
- API-D1 adds a limit to that uniformity: genuine infrastructure failures must **not** be disguised as invalid links.

## 2. Decision

### 2.1 Format

Every error response except the generic link error is **RFC 9457 Problem Details** (`application/problem+json`):

| Field | Rule |
|---|---|
| `type` | `about:blank`, or a documentation URI on our origin |
| `title` | Short and fixed per code |
| `status` | The HTTP status |
| `code` | **Stable application code** from the closed list in `openapi.yaml` (`ProblemCode`, 40 codes). Clients branch on `code`, never on `title`. |
| `detail` | Optional, safe text |
| `correlationId` | Present on every problem; equals the `X-Correlation-Id` response header |
| Extensions | Only those declared in the `Problem` schema: `errors` (field errors), `minimumCapacity`, `reasons`, `offsets`, `currentScheduleVersion`, `firstCheckedInAt` |

**Never in an error response** (ENG-ERR-3): stack traces, SQL or parameters, constraint names, tokens or token hashes, secrets, internal host names, or another person's data.

### 2.2 Category → status (ENG-ERR-2)

| Category (ENG-ERR-1) | Status | Example codes |
|---|---|---|
| Validation | `400` (malformed JSON, unknown fields, wrong content type), `422` (field rules) | `bad_request`, `validation_failed`, `nonexistent_local_time`, `ambiguous_local_time` |
| Authentication | `401` | `unauthenticated`, `reauthentication_required` |
| Authorization | `403`, or `404` where existence must not be revealed | `forbidden`, `csrf_failed`, `origin_check_failed`, `not_found` |
| Not found or invalid link | `404` | `not_found`; **the generic link body** (§2.3) |
| Conflict | `409` with safe details | `capacity_below_confirmed`, `notifications_pending`, `request_id_reused`, … |
| Rate-limited | `429` with `Retry-After` | `rate_limited`, `resend_limit`, `rotation_limit`, `check_in_failures` |
| Infrastructure | `503` | `service_unavailable` |
| Unexpected | `500` | `internal_error` |

### 2.3 The generic link-error contract (FR-LNK-7; API-D1)

**Body** (`application/json`), fixed bytes, no correlation ID:

```json
{"code":"invalid_link","message":"This link is not valid or has expired.","hint":"If you were trying to register, please start again from the event page."}
```

| Situation on a `/api/links/…` route | Response |
|---|---|
| Token unknown, malformed, expired, revoked, replaced, already used and expired, of another type (wrong route), belonging to a deleted event, or whose registration has ended (FR-LNK-6) | **Generic `404`** |
| Failed-lookup limit reached (FR-LNK-7) | `429` with the **same body** and `Retry-After` |
| `Origin` mismatch on a `POST` | `403 origin_check_failed`, checked **before** the token, so it reveals nothing about the token |
| Valid token, but a malformed or invalid body | `400` or `422` problem. Tokens are always checked **before** bodies. |
| Valid token, business conflict or action limit | `409` or `429` problem (for example `cancellation_closed`, `rotation_limit`) |
| Valid token whose authority disappears while waiting for the event lock (re-validated under the lock) | **Generic `404`** |
| **Infrastructure failure** (database unavailable, timeouts, bounded retries exhausted) | **`503 service_unavailable`**, safe body (`SafeServerProblem`: code and correlation ID only) |
| **Unexpected failure** | **`500 internal_error`**, safe body |

**Side-channel rules** **[REC]**:
1. **The failed-lookup counter fails open.** If writing the counter fails, the error is logged and the generic `404` is still returned. Otherwise invalid tokens alone would turn into `503`s, which would reveal validity.
2. **Valid and invalid tokens follow the same read path** until the decision. `500` and `503` bodies are identical for every link type and token, and never mention the token, the account, the registration or the event.
3. **No correlation ID in the generic body**, so it stays byte-identical. It appears only in server logs.

### 2.4 Logging and correlation (ENG-ERR-6, NFR-OPS-2)

- **Correlation IDs:** every request gets one, carried request → outbox → provider → webhook.
- **Log content:** an allow-list of fields plus redaction. Never request bodies, credential headers (`Authorization`, `Cookie`, `X-CSRF-Token`), session IDs, tokens, hashes or unmasked email addresses.
- **URLs** are logged with any token segment redacted. Fragments never reach the server (ADR-011).

### 2.5 Retries (ENG-ERR-7)

- Only `503`, network errors and requests carrying a request ID are retried by clients, as listed in API_DESIGN §9.
- Bounded server-side retries for deadlock, serialization and lock-timeout errors end in `503` once they are exhausted.

## 3. Consequences

**Positive:**
- One machine-readable error format.
- Link uniformity is preserved without hiding real outages.

**Negative:**
- A `503` on a link route tells the user something failed, but never whether their link is valid. This is deliberate.
- AC-137 was aligned by R60.

## 4. Requirement alignment

Applied as **R60** (REQUIREMENTS.md v1.7): FR-LNK-7 and AC-137 now distinguish unusable tokens (the generic response) from infrastructure and unexpected failures (a safe `503` or `500`).

## Traceability

ENG-GEN-1, ENG-ERR-1 to ENG-ERR-7, FR-LNK-7, FR-LNK-8, BR-30, NFR-SEC-1b, NFR-OPS-2, AC-66, AC-103, AC-137, AC-139; API-D1, API-D10.
