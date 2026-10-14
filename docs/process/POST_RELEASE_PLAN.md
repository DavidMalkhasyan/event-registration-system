# Post-Release Implementation Plan (S-19)

**Source:** prompt 29, "EVENTFLOW — COMPLETE POST-RELEASE PRODUCT ENHANCEMENT ROADMAP" (2026-10-13). This plan turns it into Kanban cards and pull requests. Statuses live in [KANBAN.md](KANBAN.md); decisions in [DECISION_LOG.md](DECISION_LOG.md); requirement changes in [REQUIREMENT_AMENDMENTS.md](REQUIREMENT_AMENDMENTS.md). A card is Done only with merge and CI evidence.

**Baseline checked on 2026-10-13 00:05:** `dev` `937baac` (PRs #21, #22, #23 merged), `main` `8e7f6c1` (v1.0.0), schema 8, tests 156 / 24 / 29.

## Pull requests, in order

| PR | Cards | Content | Depends on |
|---|---|---|---|
| A | K-706 | Organizer navigation and scroll: no jump on section changes, refreshes or actions; sections keep search, filters and unsaved edits; back and forward | — |
| B | K-707 | Capacity: increase-only on the server (amendment A-2) and in the forms; 1 to 100 000, normalized on blur | — |
| C | K-708 | Organizations, memberships and roles in the database; events owned by organizations; migration of every existing organizer and event | — |
| D | K-709 | Organization registration, password sign-in (Argon2id), email verification, password reset, sign-out, transition of existing passwordless organizers | C |
| E | K-710 | Super Admin area: applications, approval, rejection, suspension, audit; documented bootstrap command | C, D |
| F | K-711 | Event location: venue fields, organizer editing, public, management and ticket display, copy and directions, venue-change notices through the outbox | — |
| G | K-712 | Event media backend: uploads, validation, re-encoding, storage adapter, serving, lifecycle | C (authorization by organization) |
| H | K-713 | Organizer image management and the public gallery with a viewer | G |
| I | K-714 | Participant map | **Awaiting the stakeholder's provider decision** (below) |
| J | K-715 | Staff experience review and refinements; final end-to-end review | — |

Each PR branches from the latest `dev`, carries its tests and records, passes the local gates and GitHub CI, and is merged after a diff review. `main` is not touched.

## Assumptions (to be confirmed or corrected by the stakeholder)

1. **Organizations and existing data.** Each existing organizer account becomes the Owner of one new organization named after the account's email address (which the owner can rename); its events move to that organization. Public URLs, registrations, tickets, staff invitations, audit and outbox history are unchanged. No existing account becomes Super Admin.
2. **Existing organizers' transition.** Migrated organizations are approved (they were already operating). Their owners keep signing in by emailed link until they set a password through the same emailed-link mechanism; after that, password sign-in is available. Passwordless sign-in for organizers is kept as a fallback only for accounts without a password, so nobody is locked out.
3. **New organizations** need email verification and Super Admin approval before they can create or manage events.
4. **Roles.** Owner (everything, including members), Admin (events and members except owners), Member (events). Only what the current application needs is enforced; staff stay event-scoped device sessions.
5. **Super Admin bootstrap** is a server command run by an operator with database access (`pnpm admin:create`), never a web form; no credentials are committed.
6. **Media** is stored as files under a configurable directory outside the repository (local adapter), behind an interface for a later object-storage adapter; metadata in PostgreSQL.
7. **Re-authentication** (FR-ORG-5) keeps its rule (a sign-in within 15 minutes for protected actions); with passwords, re-authentication can also be by password.

## Stakeholder decision: the participant map (K-714)

**Decided in prompt 33 (2026-10-13 16:46): option A** for local development and the assignment demonstration, under the OSM Tile Usage Policy. Implemented as an identified, bounded caching proxy (PD-96).

A real map needs map data (tiles) and, unless organizers enter coordinates, geocoding. Participant pages allow only same-origin resources (FR-LNK-8), so any option serves tiles from our own origin; no participant token or page URL ever reaches a provider.

| Option | What it means | Cost and terms | Privacy and operations |
|---|---|---|---|
| **A. OpenStreetMap tiles through our server** | The server fetches and caches standard OSM tiles; the browser loads them from our origin with a bundled map library (Leaflet, BSD-2) | Free; attribution "© OpenStreetMap contributors" required; the OSM Foundation's tile usage policy allows light use only, with no service guarantee, and forbids heavy or bulk use | The OSM server sees our server, not participants. Fine for development and low traffic; a production deployment would need a commercial or self-hosted source |
| **B. Commercial tile provider through our server** (for example MapTiler or Stadia Maps) | Same as A with a provider's tiles and an API key in the server configuration | Free tiers exist; paid beyond them; provider terms and attribution apply; needs an account and a key | The provider sees our server only. Production-suitable |
| **C. Self-hosted tiles** (an OpenMapTiles or Protomaps extract served by us) | No third party at run time | Free data (ODbL attribution); storage of a regional extract (hundreds of MB to GB) and more operations | Fully first-party |

**Coordinates:** without a geocoding provider, the organizer enters latitude and longitude (or none: then no map is shown and only the address and the directions link appear). A geocoder (for example Nominatim, rate-limited with attribution, or a commercial one) is a separate decision. **Coordinates are never fabricated.**

**Recommendation:** A for development and the assignment demonstration, with manual coordinates; B or C before any real production use. Until decided, K-711 stores and validates coordinates and shows the address and a directions link; the map itself (K-714) waits.

## Production readiness (prompt 33, S-20)

**Source:** prompt 33, "EVENTFLOW — PRODUCTION READINESS & RELEASE CANDIDATE" (2026-10-13 16:46). No tag, release pull request, deployment, submission, paid account or new recurring cost without the stakeholder's explicit authorization.

| PR | Cards | Content | External dependency |
|---|---|---|---|
| A | K-714 | Participant map (option A) | An operator contact for the tile User-Agent (`MAP_TILE_CONTACT`) |
| B | K-717 | Real email provider behind the provider interface | A Resend account, a verified sending domain and an API key |
| C | K-402 | Delivery webhooks, bounces and complaints, delivery facts | The provider's webhook signing secret |
| D | K-718 | Authentication and Super Admin security audit and hardening; second-factor decision | A stakeholder decision on a second factor |
| E | K-719 | Media reliability and orphan cleanup; malware-scanning assessment | — |
| F | K-720, K-721 | Deployment architecture and templates; backups and a restore drill | A hosting decision (not needed for the templates) |
| G | K-723, K-724 | Performance measurements; CI action versions | — |
| H | K-722 | End-to-end audit findings and fixes | — |
| I | K-725 | Documentation and the release candidate report | — |

**Outcome (2026-10-13 21:58):** A [#35](https://github.com/DavidMalkhasyan/event-registration-system/pull/35), B [#36](https://github.com/DavidMalkhasyan/event-registration-system/pull/36), C [#37](https://github.com/DavidMalkhasyan/event-registration-system/pull/37), D [#38](https://github.com/DavidMalkhasyan/event-registration-system/pull/38), E [#39](https://github.com/DavidMalkhasyan/event-registration-system/pull/39), F [#40](https://github.com/DavidMalkhasyan/event-registration-system/pull/40), G as two pull requests (CI versions [#41](https://github.com/DavidMalkhasyan/event-registration-system/pull/41), measurements [#42](https://github.com/DavidMalkhasyan/event-registration-system/pull/42), as prompt 33 asks for separate CI changes), H [#43](https://github.com/DavidMalkhasyan/event-registration-system/pull/43), all merged into `dev` after green CI; I is the release candidate report ([RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)). The external dependencies in the table are still open and are the report's blockers.
