# ADR-022: Organizations, memberships and organizer accounts

| | |
|---|---|
| **Status** | **Approved** in principle (stakeholder, 2026-10-13, prompt 29; amendment A-3). Parts implemented: the data model and authorization (K-708, PD-88). Planned: password accounts and approval (K-709, K-710) |
| **Supersedes in part** | ADR-010 for organizer sign-up and sign-in (participants and staff are unchanged) |
| **Related** | [POST_RELEASE_PLAN.md](../process/POST_RELEASE_PLAN.md), [REQUIREMENT_AMENDMENTS.md](../process/REQUIREMENT_AMENDMENTS.md) A-3, [POST_RELEASE_SCHEMA.md](../database/POST_RELEASE_SCHEMA.md) |

## Context

In v1.0.0 an event belongs to one organizer account, and anyone who confirms an emailed sign-in link becomes an organizer. The stakeholder requires organizations with several organizers, a real registration with passwords and email verification, and approval of new organizations by a platform administrator, without losing existing organizers, events or history, and without changing how participants register or how staff check tickets in.

## Decision

1. **Organizations own events.** `events.organization_id` (not null) refers to `organizations`; `events.owner_account_id` stays as the account that created the event (history, idempotent creation by request ID).
2. **Membership is the only organizer authorization.** An account acts on an event only through a membership (`owner`, `admin` or `member`) of the event's organization, and only while that organization is `active`. The check runs at the API boundary inside the event lock of each protected operation, with the membership row read `FOR SHARE`. Another organization's event answers 404, as an unknown one (AC-155); a member of an inactive organization gets 403 `organization_not_active`.
3. **Organization lifecycle:** `pending_verification` → `pending_approval` → `active`, or `rejected`; `active` ↔ `suspended`. Only `active` organizations can create or manage events. Public event pages and registration are not affected by an organization's status.
4. **Platform administration is separate** (K-710): a Super Admin role held outside organizations, created only by an operator command, never by a web form, and never implied by an organization role.
5. **Staff stay event-scoped** device sessions (ADR-010, FR-STAFF); they never reach organization or administration checks.
6. **Migration of existing data** (migration 0009): each existing organizer account becomes the owner of one active organization (named after the account's address until renamed), and its events move to it. A membership-less account that signs in by emailed link before K-709 gets the same personal organization (transitional; removed when organization registration replaces passwordless organizer sign-up).

## Consequences

- Every ownership check in event, check-in, deletion, staff and reporting code uses one helper; owner-based queries use a subquery of the account's active organizations.
- An account in several active organizations names the organization when creating an event (422 `organization_required` otherwise).
- Roles are stored now; their differences (members and owners management) are enforced as the features that need them arrive (K-709, K-710).
- The schema is ready for a later public organization profile (name and description exist; logo and contact fields can be added without changing ownership).
