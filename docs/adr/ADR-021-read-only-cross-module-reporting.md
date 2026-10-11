# ADR-021: Read-only cross-module reporting

| | |
|---|---|
| **Status** | **Approved** (stakeholder, 2026-10-11) |
| **Requirements baseline** | REQUIREMENTS.md v1.5 |
| **Related** | ADR-002, [MODULES.md §5](../architecture/MODULES.md#5-rules-that-prevent-unauthorized-cross-module-writes) |

## Context

The organizer dashboard and participant list combine data owned by several modules:
- confirmed, waiting and checked-in counts, and registration state (`event-core`);
- email-failure flags derived from send states and delivery facts (`messaging`);
- staff lists (`staff`).

These are FR-DSH-1 to FR-DSH-6. NFR-CON-6 requires failure flags to be derived by **reading** outbox status, never written onto registrations. Assembling these views by calling each module's interface would multiply queries and add read-only functions that exist only for the dashboard.

## Decision

1. **The `reporting` module may run read-only SQL queries across tables owned by other modules.** This is the only exception to the single-owner rule for table access.
2. **It must not modify any module's state.** Its queries run in `READ ONLY` transactions, and it owns no tables.
3. **It must not bypass authorization.** Its routes use the same route policies as every other route. Every query is scoped to an event that the caller is authorized for, using `event-core`'s ownership check and the staff event scope. Staff never see participant data (§3, FR-CHK-4).
4. **It must not become a dependency of domain writes.** No write path imports `reporting` or waits for it, and no business rule is computed only in reporting.
5. **It reads committed state only.** Live counts are re-fetched after reconnect (FR-DSH-3).

## Consequences

**Positive:**
- Simple, efficient dashboard queries.
- Failure flags stay derived, as NFR-CON-6 requires.

**Negative:**
- Reporting queries depend on other modules' physical schemas. Schema changes must update reporting queries, and the integration tests cover them.

## Traceability

FR-DSH-1 to FR-DSH-6, NFR-CON-6, NFR-REL-11, NFR-SEC-6, NFR-PERF-2, AC-12, AC-25, AC-26, AC-53, AC-112, AC-131, AC-155, AC-171.
