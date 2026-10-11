# ADR-011: Fragment-based link-token transport

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11). Requirements recorded as **R58** in REQUIREMENTS.md v1.5. |
| **Requirements baseline** | REQUIREMENTS.md v1.5 |
| **Related** | ADR-012 (token storage), ADR-013 (same origin) |

## Context

- Six link types carry bearer tokens: verification, staff invitation, management, share, sign-in and email change (FR-LNK-1, NFR-SEC-1).
- A token in a URL path or query string reaches server and proxy request logs and `Referer` headers, and is sent automatically whenever a scanner or link preview fetches the URL.
- Opening a link must never change state (FR-LNK-9). Every invalid case must get one uniform response (FR-LNK-7, BR-30).

## Decision

The full normative text is **FR-LNK-10** in REQUIREMENTS.md v1.5. In summary:

1. **Fragment:** links carry the token in the URL fragment (`/<link path>#t=<token>`). The fragment is not transmitted during normal HTTP navigation.
2. **Bootstrap ordering:** the browser loads the page's HTML and script first. The page's first application module then:
   - reads the fragment;
   - keeps the token **only in page memory**;
   - removes the fragment from the address bar and the current history entry (`history.replaceState`).

   All of this happens before any other application module executes, before any application-initiated API request, and before any optional external resource loads.
3. **Transport:** the token reaches the **same-origin** API only in `Authorization: Link <token>`. No CORS headers are returned. Link endpoints ignore organizer and staff session cookies, and the route determines the token type.
4. **Read vs. act:** opening a link makes only a read-only link-resolution request (`GET /api/links/<type>`). Every state change is a separate explicit `POST`.
5. **Uniform response:** FR-LNK-7's single `404` status and body apply to the **link-resolution API response**. The page served at a link address is byte-identical for every token, because the token is never sent with the page request.
6. **Headers:** every link page and link API response carries the FR-LNK-8 headers, including a content security policy that allows only same-origin scripts and `frame-ancestors 'none'`.
7. **Reload:** reloading a link page loses the token **by design**. Pages that show newly issued links offer copy actions and explain the **existing** recovery paths (FR-LNK-10 f). There is no new recovery mechanism, and tokens are never stored persistently in the browser.

## Accepted limitations

- **Browser history:** the browser's global or synced history may keep the original URL with its fragment (EC-97).
- **Email gateways:** a link-rewriting gateway may log the full URL, or drop the fragment and make the link unusable (EC-98). A manual check before launch covers Gmail, Outlook with Safe Links, and Apple Mail (AC-179).
- **Automated agents:** an agent that executes JavaScript **and** submits forms could still act. This was already accepted (EC-79, NFR-SEC-8).

## Consequences

**Positive:**
- Tokens never appear in our request logs, proxy logs or `Referer` headers. ENG-ERR-6 URL redaction remains as a backstop.
- Scanners that fetch the page receive identical bytes, and change nothing.

**Negative:**
- JavaScript is required on link pages.
- Recovery after a reload relies on email and resubmitting the registration form.

## Alternatives considered

| Alternative | Why it was rejected |
|---|---|
| Token in the path or query string | Leaks into request logs and `Referer`; page responses would vary by token |
| Exchange the token for a cookie on first open | Opening would change state (FR-LNK-9); cross-site request forgery exposure; mixes link authority with sessions (AC-178) |
| Persist the token in `sessionStorage` to survive reloads | Explicitly excluded by the stakeholder (no persistent browser storage for bearer tokens) |

## Follow-ups

- **Resolved by R59** (REQUIREMENTS.md v1.6, 2026-10-11): §6 flow F11 step 3 now matches FR-ROT-5. The page switches to the new token in memory and doesn't put it back into the address bar.

## Traceability

R58; FR-LNK-7, FR-LNK-8, FR-LNK-9, FR-LNK-10; FR-ROT-5, FR-ROT-11 (c); FR-SELF-3; EC-97, EC-98, EC-99; AC-51, AC-60, AC-66, AC-83, AC-93, AC-103, AC-126, AC-173 to AC-179; ENG-ERR-6.
