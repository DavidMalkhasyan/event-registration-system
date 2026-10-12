# UI implementation inventory

**Purpose:** a factual map of the current React client, written before a visual redesign (Kanban K-506). It is an inventory, not a plan: it records what exists, what the redesign must preserve, and where the code would have to change. Recorded on `dev` at `d219576` (2026-10-12), schema version 7.

## 1. What a redesign must preserve

| Area | Rule | Where it is enforced today |
|---|---|---|
| API contracts | Same endpoints, bodies and problem codes; the UI adds no client-only behaviour | `shared/api.ts`; server routes |
| Link tokens | Read from the URL fragment, removed from the address bar before any other code runs, kept **only in memory**, sent as `Authorization: Link …`; a reload loses them by design (FR-LNK-10) | `public/bootstrap-token.ts`, which must stay the **first import** of `public/main.tsx` (line 1) and must have no imports itself |
| Link pages | No third-party resources (fonts, scripts, images, analytics), `referrer: no-referrer`, `robots: noindex`; the QR code is generated locally | `public.html`; `shared/ui.tsx` (`qrcode` package); system fonts in `styles.css` |
| Sessions and CSRF | Cookies are HttpOnly; the CSRF token comes from `/api/auth/session` or `/api/staff/session` and stays in component state; every state-changing call passes it | `organizer/main.tsx` (`session.csrfToken`), `StaffApp` |
| Event authorization | Staff devices never call organizer endpoints: the staff screen gets its event data from `/api/staff/session` | `CheckIn` with the `staff` prop |
| Return after re-authentication | Only `/organizer…` paths are stored (localStorage, optional) | `shared/return-to.ts` |
| Live updates | One `EventSource` per event page; the count shown is the server's; `access_ended` closes it | `useLiveCount` |
| Check-in honesty | Never show success without a server answer; an unreachable server is shown as a failure to validate (FR-CHK-6) | `CheckIn` (`'offline'` result) |
| Confirmation steps | Destructive actions keep an explicit second step (cancel, delete, undo check-in, waiting-list removal, link rotation, participant cancellation) | Each action component |
| Mobile | Usable at phone width (one breakpoint at 560 px today) | `styles.css` |
| Tests | All 17 E2E tests and 6 client unit tests keep passing; locators may change only where the visible text or role changes for a reason | `apps/e2e/tests` (§5) |

## 2. Structure

| File | Lines | Contents |
|---|---:|---|
| `apps/client/organizer.html`, `public.html` | 14 each | Two HTML entries on one origin (ADR-013) |
| `src/organizer/main.tsx` | 1,394 | The whole organizer area, the check-in screen and the staff device page |
| `src/public/main.tsx` | 694 | Event page, verification, management, share view, sign-in confirmation, staff invitation |
| `src/public/bootstrap-token.ts` | 26 | Fragment token capture (security-sensitive, §4) |
| `src/shared/api.ts` | 54 | `api()`, `ApiError`, `errorMessage()` |
| `src/shared/ui.tsx` | 125 | `Page`, `Card`, `Alert`, `CopyLink`, `TicketQr`, `InvalidLink`, `DevMailboxHint`, `formatLocal`, `TRANSFER_STATEMENT` |
| `src/shared/return-to.ts` | 26 | Re-authentication return path |
| `src/shared/styles.css` | 261 | All styling: tokens, light and dark (`prefers-color-scheme`), classes `.page .card .alert-* .badge .stat(s) .ticket .ticket-code .row .stack .outcome-* .live-dot .copy-* .event-list .muted` |

Runtime dependencies: `react`, `react-dom`, `qrcode`. There is no router, state library or component library. Routing is `window.location.pathname` plus a small `navigate`/`Link` helper (organizer entry only). There are 9 inline `style={{…}}` attributes (8 in the organizer entry).

Entry routing is defined in **three places that must agree**: `vite.config.ts` (`entryRouter`, development), `apps/server/src/composition/web-app.ts` lines 79–81 (production static routes) and each entry's `App()`.

## 3. Screens and their API calls

| Route | Entry | Component | Access | API calls |
|---|---|---|---|---|
| `/e/:publicId` | public | `EventPage` | anonymous | `GET /api/public/events/:publicId`, `POST …/registrations` |
| `/verify` | public | `VerifyPage` | link token | `GET /api/links/verify`, `POST /api/links/verify/confirm` |
| `/manage` | public | `ManagePage`, `TicketActions`, `LinkRotation` | link token | `GET /api/links/manage`, `POST …/cancel`, `…/resend`, `…/share-links`, `…/rotations` |
| `/ticket` | public | `TicketPage` | link token | `GET /api/links/ticket` |
| `/sign-in` | public | `SignInPage` | link token | `GET /api/links/sign-in`, `POST …/confirm`; then `takeReturnTo()` |
| `/invite` | public | `InvitePage` | link token | `GET /api/links/invite`, `POST …/accept` → `/staff` |
| `/`, `/organizer` | organizer | `SignInRequest`, or `EventsPage` with `CreateEvent`, `SignOut` | session | `GET /api/auth/session`, `POST /api/auth/sign-in-requests`, `GET`/`POST /api/events`, `POST /api/auth/sign-out` |
| `/organizer/events/:id` | organizer | `EventDetail` with `DetailsEditor`, `CapacityEditor`, `Reschedule`, `RecentSignIn`, `CancelEvent`, `DeleteEvent`, `StaffCard`, the participants table with `RemoveFromWaitlist` and `UndoCheckIn` | owner | `GET /api/events/:id`, `…/dashboard`, `…/participants`, `…/staff`, `…/deletion-preview`; `PATCH /api/events/:id`; `PUT …/capacity`; `POST …/reschedule`, `…/cancellation`, `…/deletion`, `…/staff-invitations(/:id/revocation)`, `…/staff-sessions/:id/revocation`, `…/registrations/:rid/waitlist-removal`, `…/check-ins/:cid/undo`, `/api/auth/reauthentication`; SSE `…/live` |
| `/organizer/events/:id/check-in` | organizer | `CheckIn` | owner | `GET /api/events/:id`, `POST …/check-ins`; SSE `…/live` |
| `/staff` | organizer | `StaffApp` → `CheckIn staff={…}` | staff cookie | `GET /api/staff/session`, `POST /api/events/:id/check-ins`; SSE `…/live` |

Every page is built from `Page` (title → the `h1` that E2E tests find by role) and `Card`. Feedback uses `Alert` (`role="alert"` for errors, `status` otherwise).

## 4. Security-sensitive points for the redesign

1. **Import order.** `import … from './bootstrap-token'` must remain the first line of the public entry. Moving pages into separate files is safe only if each link page reads the token through `linkToken()` and nothing imports a page module before `bootstrap-token`.
2. **No token persistence.** Do not add a router or state library that copies `location.hash`, serializes state to storage, or logs URLs. `replaceLinkToken` (rotation) changes memory only.
3. **Link pages stay self-contained.** No web fonts, icon CDNs, external images or analytics on the public entry; the organizer entry follows the same rule today.
4. **Generic invalid link.** All link pages show the same `InvalidLink` page for any token failure; do not add reason-specific messages.
5. **Staff isolation.** If check-in is restyled or moved, the staff path must keep skipping `GET /api/events/:id` (organizer endpoint, `403` for staff).
6. **`DevMailboxHint`** shows only when `/dev/mailbox` answers (development and demo setups); it must not become an always-on link.
7. **Observation:** the server sends `referrer-policy: no-referrer` and `cache-control: no-store` on API responses, but no `Content-Security-Policy` header. A redesign that keeps every resource local would allow a strict policy later; adding one is not part of this inventory.

## 5. E2E tests that depend on visible text

The 17 E2E tests (11 files) and `tests/helpers.ts` locate elements by **role with accessible name, label text or visible text** (about 200 locator lines, 21 of them in the shared helpers), plus two CSS classes. A redesign that changes wording, labels or headings must update these locators in the same change.

| Kind | Examples (used across several specs) |
|---|---|
| Shared helpers (`helpers.ts`, used by every spec) | Labels `Email address`, `Title`, `Description`, `Date and time (local)`, `Capacity`, `Public registration link`; buttons `Send sign-in link`, `Sign in`, `Create event`, `Register`, `Confirm my registration`; heading `Your events`; texts `Check your email for a sign-in link`, `Check your email.`; the result heading pattern of the verification page |
| CSS classes | `.stat` with its `strong` (dashboard and check-in counts, `stat()` helper); `.ticket-code` (ticket code) |
| Check-in | label `Ticket code`, button `Check in`, outcomes `✔ Checked in`, `✖ Already checked in`, `✖ Unknown ticket code`, `✖ Event cancelled`, `Checked in (live)` |
| Event detail | `Update capacity`, `Number of seats`, `Save details`, `Reschedule and notify`, `New date and time`, `Cancel this event…`, `Yes, cancel the event permanently`, `Delete this event…`, `Yes, delete the event permanently`, `Undo check-in`, `Remove from waiting list`, `Yes, remove`, `Send invitation`, `Staff email address`, `Revoke access`; status texts such as `Status: CANCELLED.`, `WAITLISTED #2` |
| Link pages | headings `Link not valid`, `Check-in invitation`; `Status: confirmed`; `Email me my ticket again`; rotation and share texts |
| Re-authentication | `Confirm it is you`, `Confirm it’s you` (both spellings occur), `Your sign-in counts as recent until`, `Your last sign-in was more than 15 minutes ago.` |
| Result messages | Exact sentences such as `Capacity is now 2.`, `Rescheduled. Every confirmed and waiting participant…`, `Check-in undone for … The ticket can be checked in again.`, `… was removed from the waiting list and has been emailed.` |

Locators by role and label also act as accessibility checks, so replacing them with test IDs would lose coverage; updating the names is preferable.

## 6. Splitting `organizer/main.tsx` (no behaviour change)

The file has clear seams. A split into modules with the same exports keeps every test valid:

| Module | Contents today | Notes |
|---|---|---|
| `organizer/app.tsx` | `App`, `navigate`, `Link`, the `Session` and `EventItem` types | Keep `/staff` routed before the session lookup |
| `organizer/auth.tsx` | `SignInRequest`, `SignOut`, `RecentSignIn`, `ReauthPrompt` (exported today) | `ReauthPrompt` is used by `CancelEvent` and `DeleteEvent` |
| `organizer/events-list.tsx` | `EventsPage`, `CreateEvent`, `defaultZone`, `PHASE_LABEL` | |
| `organizer/event-detail/*` | `EventDetail`, `DetailsEditor`, `CapacityEditor`, `Reschedule`, `CancelEvent`, `DeleteEvent` (+ `BLOCKER_TEXT`, `NOTICE_TEXT`), `StaffCard` (+ `INVITATION_STATUS`), `RemoveFromWaitlist`, `UndoCheckIn`, the `Participant` type | Each card already takes `session`, `event` and an `onDone` callback |
| `checkin/` (shared by owner and staff) | `CheckIn`, `OUTCOME_TEXT`, `useLiveCount`, `StaffEventInfo` | Moving it out of the organizer entry is the prerequisite for §7 |
| `staff/` | `StaffApp` | |

`UndoCheckIn` and `RemoveFromWaitlist` share the same confirm, reason and result pattern; it could become one shared confirmation component.

## 7. Dedicated staff entry (K-504 remainder)

Today `/staff` is a minimal page inside the organizer bundle (PD-57), so staff devices download organizer code they can't use. A dedicated entry would touch:

1. a third HTML file (`staff.html`) and its Vite `input`;
2. the three routing places in §2 (`vite.config.ts`, `web-app.ts` lines 79–81, the entries' `App()`); `/invite` → `/staff` redirection stays in `InvitePage`;
3. `CheckIn` and `useLiveCount` moved to a shared module (§6);
4. `staff.spec.ts` keeps working if the URL `/staff`, the heading `Check-in: <title>` and the `No check-in access` heading are kept.

## 8. Test coverage of the client itself

Client unit tests cover only `bootstrap-token.ts` and `return-to.ts` (6 tests). Components are covered by the E2E tests, which is where a redesign would show regressions.
