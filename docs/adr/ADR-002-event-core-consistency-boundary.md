# ADR-002: Event-core as the single consistency boundary

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11) |
| **Requirements baseline** | REQUIREMENTS.md v1.5 |
| **Related** | [MODULES.md §2](../architecture/MODULES.md#2-event-core-as-the-consistency-boundary-adr-002), ADR-021 |

## Context

- NFR-CON-1 and NFR-CON-4 serialize every event-scoped state change on **one row lock: the event row**. This covers registration, verification, cancellation, promotion, waiting-list removal, capacity, reschedule, event cancellation, deletion, check-in, rotation, resend and staff changes.
- The invariants that lock protects cross entity types:
  - Capacity and the confirmed count (BR-1, NFR-CON-5).
  - FIFO promotion triggered by cancellation, capacity increase or removal (BR-4 to BR-6, BR-24).
  - Ticket validity changed by event cancellation (BR-16).
  - Reminder slots claimed while confirming or promoting (FR-NTF-2a).
  - Deletion eligibility that depends on registrations and pending notices (FR-EVT-10).
- If events, registrations, waiting list and tickets were separate modules, they would call each other in both directions. For example, event cancellation cancels registrations, while registration needs event rules. Breaking such cycles needs an event bus or similar indirection, which ENG-CQ-1 rules out without a current need.

## Decision

1. **`event-core` is the single module that owns all state serialized by the event-row lock:** events (including the confirmed-count triggers), registrations, waiting-list order, tickets, check-ins and check-in request results, and reminder slots.
2. **It is organized into internal domains, not one service file:** `event`, `registration`, `waitlist`, `ticket`, `checkin`, `reminders` and `schedule`. Internal domains may call each other directly. Business rules are pure functions called under the lock.
3. **Other modules use only its public interface** (`event-core/index.ts`). They never import its internals or write its tables.
4. **Write operations require an event-locked transaction** of the right kind (`exclusive` or `shared`, NFR-CON-4). Caller-specific authorization re-checks after the lock are passed in as an `authorize(tx)` callback, so `event-core` depends on neither `identity`, `staff` nor `participant-portal`.
5. **`event-core` doesn't send email, store tokens or write audit tables itself.** It calls `messaging`, `access-tokens` and `audit` inside the same transaction.

## Consequences

**Positive:**
- One module owns the locking protocol for all event invariants, so it can be reviewed and tested as a unit (AC-133 to AC-135).
- There are no cyclic module dependencies, and no event bus is needed.

**Negative:**
- `event-core` is the largest module. Its internal-domain structure must be maintained deliberately, and is checked in review.
- Changes to any event-scoped rule touch this module.

## Alternatives considered

| Alternative | Why it was rejected |
|---|---|
| Separate `events`, `registrations`, `tickets` and `checkin` modules | Cyclic dependencies; one lock protocol spread over several owners |
| Separate modules connected by in-process domain events | Adds indirection that ENG-CQ-1 forbids without a current need; harder to keep everything in one transaction (NFR-CON-3) |

## Traceability

NFR-CON-1 to NFR-CON-5, BR-1 to BR-18, BR-23 to BR-27, FR-EVT, FR-REG, FR-WL, FR-TKT, FR-CHK, FR-NTF-1 to FR-NTF-3, ENG-CQ-1, ENG-CQ-2, AC-133 to AC-135, AC-144.
