# Proposed Requirement Amendments

[REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 is the approved baseline and is not edited by the development process. When the stakeholder approves work that conflicts with it, the conflict and the proposed wording are recorded here, with the decision that governs the implementation, until the stakeholder amends the baseline.

| ID | Status |
|---|---|
| A-1 | **Proposed** (S-18, 2026-10-12): awaiting the stakeholder's amendment of REQUIREMENTS.md. Implemented in `dev` under PD-83 (K-703) on the stakeholder's explicit authorization (prompt 27). |

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
