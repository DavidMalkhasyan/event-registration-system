# ADR-013: One public origin for the frontend entries and the API

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11) |
| **Requirements baseline** | REQUIREMENTS.md v1.5 |
| **Related** | ADR-011, [ARCHITECTURE.md §5](../architecture/ARCHITECTURE.md#5-frontend-structure-and-routing) |

## Context

Several requirements only hold if the browser sees the frontend and the API as one origin:
- organizer and staff session cookies use the `__Host-` prefix with `SameSite=Lax` and `Path=/` (FR-ORG-4, FR-STAFF-2);
- link tokens are sent in the `Authorization: Link` header with no CORS headers ever returned (FR-LNK-10 c, AC-177);
- link pages allow scripts only from their own origin (FR-LNK-8).

## Decision

1. **One public origin** (scheme, host and port) serves:
   - the three HTML entries (`public`, `organizer`, `staff`) and their static assets;
   - the JSON API, including link resolution and actions;
   - the SSE endpoint;
   - the provider webhook endpoint.
2. **This is a routing and security requirement, not a deployment requirement.** Frontend and backend may be deployed separately behind a reverse proxy or CDN that routes paths on that origin. They don't have to run in one process.
3. **No CORS** is configured for any API route.
4. **How hosting implements this stays open** (OQ-2), including TLS termination, the routing component and proxy log redaction (ENG-ERR-6).

## Consequences

**Positive:**
- Cookies, the content security policy and link transport work without cross-origin exceptions.

**Negative:**
- The hosting choice must support path-based routing on one origin. That becomes a selection criterion for OQ-2.

## Alternatives considered

| Alternative | Why it was rejected |
|---|---|
| API on a separate subdomain with CORS | Conflicts with `__Host-` cookies and FR-LNK-10's no-CORS rule; widens the cross-site request forgery surface |
| Separate origins per area (public, organizer, staff) | Cookie isolation would gain little over separate cookie names, while needing CORS or several APIs |

## Traceability

FR-ORG-4, FR-STAFF-2, FR-LNK-8, FR-LNK-10, NFR-SEC-8, AC-51, AC-148, AC-174, AC-177, ENG-ERR-6, OQ-2.
