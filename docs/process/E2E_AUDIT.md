# End-to-End Product and Device Audit (K-722)

Prompt 33, phases 7 and 8. Run on 2026-10-13 against the real system: the built client served by the web process, a separate worker process, PostgreSQL 18 (the test database, recreated for the run), the fake email provider (a file per email) and a local stand-in for the map tile service. Only synthetic accounts and addresses (`*@example.test`) were used; no message reached a real person. Decisions: [PD-103](DECISION_LOG.md).

The audit is automated, so it can be repeated and is part of every CI run: `apps/e2e/tests/audit.spec.ts` (scenarios A to G) and `apps/e2e/tests/audit-devices.spec.ts` (the device audit). Each run writes its reports and screenshots to `var/e2e-audit` (not in Git).

**What every scenario also checks**, in every browser context it opens:

- no uncaught error in the page;
- no Content-Security-Policy violation;
- no request leaving our origin;
- no console error other than the browser's own report of an expected 4xx answer (for example, 401 before sign-in). These reports are counted in the report, not treated as failures.

## Scenarios (full run 2026-10-13 21:35 to 21:45, 51/51 browser tests passed)

| Scenario | Steps verified | Result |
|---|---|---|
| **A. Organization onboarding** | Registration through the form; email verification link; sign-in before approval shows "Awaiting approval" and no event creation; the API refuses event creation (403 `organization_not_active`); a Super Admin created by the operator command approves it in the admin area; the approval email; the organizer's dashboard; an invitation to a second organizer, who creates an account, verifies it, signs in and accepts; a member sees no invitation form and the API refuses their invitation (403); after the owner makes them an admin, the invitation form appears | Passed; 159 requests, none external, no errors |
| **B. Event creation** | Date, time, capacity, venue, address and coordinates through the form; a cover and three gallery photos; a description; a new order (moved photo first); the public page at 1440 and 390 px shows title, venue, cover (WebP from our origin) and the gallery in the new order, availability and the registration button; no sideways scrolling; layout shift 0 at both widths | Passed |
| **C. Participant registration** | The public page with live availability (2 seats); the form asks for the email address only; the emailed verification link; the confirmation page with ticket code and QR code; the ticket email with the same code; the management page with the QR code; the event fills; the next two join the waiting list; the management page shows "Waiting list · #2"; the open public page switches to "Waiting list available, 2 people waiting" at its next 15-second refresh without reloading | Passed |
| **D. Cancellation and FIFO** | The organizer cancels a confirmed participant from Participants; the first waiting participant is confirmed and the second stays waiting, in place; counts 2 confirmed and 1 waiting; no page load; the page did not scroll (766 px before and after) and the row stayed in view (it moved 80 px down because the confirmation message appeared above the list); the cancellation notice (no link token in it) and the promotion notice ("A place became free") to the first waiting person only; the cancelled participant's management link is dead and the ticket is refused at the door ("Ticket cancelled"); the open public page shows "1 person waiting" at its next refresh | Passed |
| **E. Staff check-in** | Invitation by email; acceptance on a phone-sized device; `/staff`; a valid ticket ("Checked in"); the same ticket again ("Already checked in"); the live count on the staff phone and on the owner's open page, without a reload; the staff session gets 403 from the organizer API (participant list and event list); revocation; the staff page then shows "No check-in access" and check-in requests are refused | Passed |
| **F. Event lifecycle** | Rescheduling notifies confirmed and waiting participants ("Date changed"); a venue change (name, street, coordinates) is confirmed and emailed with the new address; the participant's page shows the new venue and its directions lead to the new coordinates, without the link token; cancelling the event emails both participants ("Event cancelled"), refuses the ticket at the door ("Event cancelled"), and closes registration on the public page and in the API (409 `registration_closed`) | Passed |
| **G. Security** | Without a session the API answers 401 and the organizer UI asks to sign in; another organization's organizer gets 404 for the event, its participants and its cancellation, and "Event not found." in the UI; staff on organizer APIs (scenario E); a verification link used a second time only says "Already confirmed" and grants nothing; link pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; a session idle beyond its limit is refused and the UI asks to sign in again, and the old CSRF token stops working; CSRF: no token → 403 `csrf_failed`, another origin → 403; uploads: an SVG sent as PNG → 422 `image_rejected`, a text file → 415, nothing stored; rate limit: registrations from one address are refused from the 30th request with 429 and `Retry-After`; **no link token from any of the 80 links emailed so far appears in any request URL or in the real web and worker logs (1.03 MB checked)** | Passed |

## Device audit (1440, 768 and 390 px)

These pages were opened at each width with real data: an event with a venue and map, a cover and gallery, one confirmed and one waiting participant, an accepted staff device, a pending organization and a Super Admin.

- **Organizer:** dashboard, event creation, the event's overview, participants, waiting list, check-in, staff, gallery and settings.
- **Other roles:** the Super Admin area, the staff device and organization registration.
- **Participant and visitor:** the public page with availability, the gallery viewer, the participant's ticket with map, and the shared ticket.

That is 48 page and width combinations. Each was checked for:

- **Width:** nothing scrolls sideways, and no action button reaches beyond the screen's edge.
- **Stability:** the layout shift stays below 0.1 (the largest measured was 0.068).
- **Errors and requests:** no page error, console error or CSP violation, and no external request.

The organizer page's automatic refresh (15 s) kept the scroll position and an unsaved edit at 1440 and 390 px.

**Defects found and fixed (first run, before the fix):**

| Width | Page | Finding | Fix |
|---|---|---|---|
| 768 px (tablets) | Participants, waiting list | The five-column table had about 450 px beside the sidebar: email addresses broke letter by letter and the "Cancel registration" and "Remove from waiting list" buttons ended beyond the screen's edge (at 689 to 876 px of 768) | Below 1,024 px participant tables use the stacked card layout that phones already had |
| 768 and 390 px | Every event section | The section tabs ran off the edge (Check-in, Staff, Photos and Settings partly or wholly outside the screen, reachable only by swiping an invisible scroll strip) | Below 1,024 px the tabs wrap onto a second line; every section is visible |

After the fix, all 48 combinations pass; screenshots were reviewed for the participants pages at 768 and 390 px.

**Earlier finding of this audit cycle** (performance measurements, PR #42): the participant list stopped silently at 1,000 registrations; fixed with paging (PD-102).

## Behaviour confirmed as designed (not defects)

- A participant's management page shows the waiting-list position as of the page load (FR-WL-7). The automatic refresh belongs to the public page (availability) and the organizer pages.
- With coordinates set, directions lead to the coordinates. A change of the venue name alone does not change them; a new address with new coordinates does.
- A second use of a verification link shows "Already confirmed" without any ticket or link, rather than "Link not valid".
- A staff session asking for organizer data gets 403, not 401: the session is recognised, but staff have no organizer rights.

## Not verified

- **Camera scanning with a physical device:** no camera-equipped phone was available. `camera-scan.spec.ts` checks the scanner with a simulated camera stream; scanning a printed or on-screen QR code with a real phone camera is **unverified**.
- **Other browsers and real devices:** the audit ran in Microsoft Edge (Chromium) on Windows, and CI runs Chromium. Safari (iOS) and Firefox were not tested; phone and tablet sizes were emulated.
- **Real email delivery:** the fake provider stands in for Resend (no account exists; see the blockers in the release-candidate report).
- **The real tile service:** a local stand-in was used, checked once live against OpenStreetMap (K-714).
