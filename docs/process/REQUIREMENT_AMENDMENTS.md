# Requirement Amendments

[REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 is the approved baseline and is not edited by the development process. When the stakeholder approves work that conflicts with it, the conflict and the wording are recorded here, first as proposed and then as approved, with the decision that governs the implementation. The history of each amendment stays visible.

| ID | Status |
|---|---|
| A-1 | **Approved** by the stakeholder on 2026-10-13 (prompt 29, S-19); proposed in S-18. Implemented in `dev` under PD-83 (K-703, PR #22). REQUIREMENTS.md itself is unchanged; this record is the amendment. |
| A-2 | **Approved** (prompt 29, S-19): capacity can only be increased. Implemented by K-707 (PD-87) on `feature/capacity-increase-only`. |
| A-3 | **Approved** (prompt 29, S-19): organizations, organizer accounts with passwords, Super Admin approval. K-708 (data model, authorization, migration; PD-88) and K-709 (registration, passwords, verification, reset; PD-89) merged into `dev`; K-710 (Super Admin; PD-90) merged into `dev`; K-716 (member invitations) to follow. |
| A-4 | **Approved** (prompt 29, S-19): event photographs and a gallery. The server side is implemented by K-712 (PD-92); the interface follows in K-713. |
| A-5 | **Approved** (prompt 29, S-19): event location and venue-change notices. Implemented by K-711 (PD-91). |
| A-6 | **Approved in principle** (prompt 29, S-19): a real map for confirmed participants; the map data provider awaits the stakeholder's choice (POST_RELEASE_PLAN.md). K-714. |

## A-1 Organizer cancellation of one confirmed registration

**Conflict.** REQUIREMENTS.md §1.2 (out of scope) lists: "Organizer removing or cancelling an individual **confirmed** participant. Removing a **waiting-list** entry is in scope (FR-WL-10)" (A, R29). Prompt 27 explicitly authorizes the owner to cancel one confirmed registration.

**Proposed change to §1.2.** Replace the row with: "Organizer removing or cancelling an individual participant **with an active check-in**. Removing a waiting-list entry (FR-WL-10) and cancelling a confirmed registration without an active check-in (FR-ORG-CXL-1 to FR-ORG-CXL-7) are in scope."

**Proposed new requirements.**

| ID | Requirement |
|---|---|
| FR-ORG-CXL-1 | The owner can cancel one `CONFIRMED` registration of their event while the event is `SCHEDULED` and before its Start, with an explicit confirmation step. Staff and other organizers cannot. |
| FR-ORG-CXL-2 | A registration with an active (not undone) check-in cannot be cancelled this way; the owner is told why. Check-in history and check-in undo are unchanged. |
| FR-ORG-CXL-3 | The decision is made under the exclusive event lock with the registration re-read under it, so it is serialized with verification, promotion, participant cancellation, check-in, waiting-list removal and event cancellation (NFR-CON-4). A registration that is no longer `CONFIRMED` is refused and nothing changes. |
| FR-ORG-CXL-4 | The registration becomes `CANCELLED` with the end reason "cancelled by organizer", distinct from the participant's own cancellation. Its ticket and its management and share links stop working through the registration state. |
| FR-ORG-CXL-5 | Exactly one required notice (never dropped, BR-23) tells the participant that the organizer cancelled the registration, with the event details and that the ticket is no longer valid; it contains no management link, share link or ticket code. |
| FR-ORG-CXL-6 | If the cancellation frees a seat before the cutoff, the first waiting participant is promoted in the same transaction (FR-WL-2, BR-5), with the usual promotion email. |
| FR-ORG-CXL-7 | An audit record holds the action, the owner, the event, the registration and counts only (no personal data, AC-100). Cancelled registrations stay visible in the owner's participant list with their end reason. |

**Not changed:** waiting-list removal (FR-WL-10 to FR-WL-14, BR-24, BR-27), its FIFO rules and its notice; participant cancellation (FR-SELF-2); event cancellation (FR-EVT-9).

## A-2 Capacity can only be increased

**Conflict.** FR-EVT-7 and FR-EVT-8 allow decreasing capacity down to the confirmed count (`capacity_below_confirmed`).

**Approved change.** After creation, capacity can only be increased, up to 100 000 (FR-EVT-1's range). A request for a lower value than the current capacity is refused (the API reports the current capacity); a value outside 1 to 100 000 is a validation error. Increases keep TX-E03: the exclusive event lock, the authoritative value read under it, FIFO promotion into the new seats before the cutoff, idempotent absolute values. The forms normalize out-of-range values on commit (create: 1 to 100 000; edit: current capacity to 100 000).

## A-3 Organizations, organizer accounts and Super Admin

**Conflict.** REQUIREMENTS.md v1.7 has one organizer per event (co-organizers out of scope, §1.2, Q3), passwordless organizer sign-in (FR-ORG-1 to FR-ORG-5) and no platform admin role (§1.2, Q3).

**Approved change.** Events belong to organizations; an organization has several organizer accounts with roles; organizers sign in with a password (Argon2id) after email verification, with password reset by an expiring single-use emailed link; a new organization needs Super Admin approval before it can create or manage events; a separate Super Admin area approves, rejects and suspends organizations, with audit records; the first Super Admin is created by an operator command, never publicly. Participants keep email-only registration; staff stay event-scoped device sessions. Existing organizers, events and history are migrated without loss (POST_RELEASE_PLAN.md, assumptions 1 and 2).

## A-4 Event photographs and gallery

**Change.** An event can have one cover photograph and up to 8 gallery photographs, uploaded by its organization's organizers, validated by content, re-encoded without metadata and served from our own origin; events without photographs keep the CSS posters.

## A-5 Event location and venue-change notices

**Change.** An event can have a venue (name, street address, city, optional region, country, optional postal code, optional arrival instructions, coordinates only when established). Existing events without a location stay valid. A change of the venue after registrations exist queues one notice per confirmed and waiting participant through the transactional outbox.

## A-6 Participant map

**Change, approved in principle.** Confirmed participants see the venue on a real map, with its address and a directions link, served without third-party requests from participant link pages and without passing participant tokens or data to any provider. The data provider is a separate stakeholder decision.
