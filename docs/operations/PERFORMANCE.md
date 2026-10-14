# Performance and Reliability Measurements (K-723)

All figures below were measured on 2026-10-13 with `pnpm bench` (`apps/server/bench/load.ts`); nothing is estimated unless marked *derived*. Raw reports: `var/bench/<time>.json` (ignored by Git). Decisions: [PD-102](../process/DECISION_LOG.md).

## Method

- **System under test:** the built web and worker processes (one of each, as in production) and PostgreSQL 18.6, started by the script against the test database (recreated first; the development data is never touched). `NODE_ENV=development` (debug logging, so production should be equal or faster), fake email provider (one file per email), `TRUST_PROXY_HOPS=1` with a distinct `X-Forwarded-For` address per synthetic client, so per-IP limits apply per client as they would behind Caddy.
- **Machine:** one laptop, Intel Core i5-1135G7 (4 cores, 8 threads), 8 GB memory, Windows 10, Node.js 24.21.0. The load generator runs on the same machine, so the figures are conservative; run-to-run variation on this laptop is about ±30 %.
- **Synthetic data only:** `*@bench.example.test` addresses, no real recipients, no external service.
- **Scenario:** 5 organizers sign in; 50 events are created; the main event (capacity 100) gets 600 (or 2,000) registrations, all confirmed at once (100 confirmed, the rest waiting); a capacity-1 event gets 50 simultaneous confirmations; 50 confirmed participants cancel at once (50 promotions); dashboards and the participant list are polled; 200 live-count streams stay open during check-ins; ten devices scan the same ticket at once; six 3000 × 2000 JPEG photos are uploaded and their WebP files downloaded 2,000 times. The upload is a noise image (3.3 MB JPEG, 0.85 to 1.07 MB as WebP), a worst case for compression.

## Targets and results (final code)

32 requests in flight unless stated. Runs `2026-10-13T16-46-18` (600 participants) and `2026-10-13T16-47-52` (2,000 participants).

| Critical path | Target | 600 participants | 2,000 participants | Met |
|---|---|---|---|---|
| Public event page and availability poll (every 15 s per open page) | p95 ≤ 100 ms | p95 29 ms, 1,500/s | p95 32 ms, 1,523/s | Yes |
| Session validation | p95 ≤ 100 ms | p95 59 ms, 816/s | p95 73 ms, 747/s | Yes |
| Password sign-in (Argon2id), 4 at a time | p95 ≤ 500 ms | p95 130 ms | p95 115 ms | Yes |
| Event creation, 8 at a time | p95 ≤ 300 ms | p95 59 ms | p95 55 ms | Yes |
| Registration request | p95 ≤ 500 ms | p95 228 ms, 169/s | p95 208 ms, 184/s | Yes |
| Verification of one event's registrations, all at once | p95 ≤ 1 s | p95 368 ms, 117/s | p95 404 ms, 108/s | Yes |
| Last seat: 50 confirmations at the same moment (50 in flight) | exactly 1 seat; p95 ≤ 1 s | 1 confirmed, 49 waiting; p95 265 ms | 1 confirmed, 49 waiting; p95 429 ms | Yes |
| 50 cancellations at once with waiting-list promotion (50 in flight) | p95 ≤ 1.5 s; all promotion emails within 10 s | p95 653 ms; 50 emails in 1.9 s | p95 737 ms; 50 emails in 1.9 s | Yes |
| Organizer dashboard poll (every 15 s per open page) | p95 ≤ 200 ms | p95 62 ms, 710/s | p95 71 ms, 599/s | Yes |
| Participant list, first page (up to 1,000), 8 at a time | p95 ≤ 500 ms | p95 60 ms | p95 138 ms | Yes |
| Check-in, 16 at a time | p95 ≤ 300 ms | p95 92 ms | p95 89 ms | Yes |
| Same ticket scanned by 10 devices at once | exactly 1 admission | 1 `CHECKED_IN`, 9 `ALREADY_CHECKED_IN` | same | Yes |
| Live count to 200 open streams after a check-in | every stream within 1 s | 200 of 200; p95 334 ms (includes the 250 ms coalescing) | 200 of 200; p95 329 ms | Yes |
| Image upload and processing (3000 × 2000), one at a time | p95 ≤ 3 s | p95 596 ms | p95 580 ms | Yes |
| Image download | p95 ≤ 500 ms | p95 138 ms, 299/s (1.07 MB each) | p95 145 ms, 292/s | Yes |
| Error rate (answers other than 2xx) | 0 | 0 of 7,625 timed requests | 0 of 10,425 timed requests | Yes |
| Worker: verification emails (fake provider) | ≥ 20/s | 600 in 9.0 s (66/s) | 2,000 in 29.4 s (68/s) | Yes |
| Registration counts after every scenario | confirmed = capacity; waiting places distinct; list complete with positions 1..n | 100 / 500 → 100 / 450; list 600 of 600 | 100 / 1,900 → 100 / 1,850; list 2,000 of 2,000 in 2 pages | Yes |

**Database load** (PostgreSQL statistics over a whole run): 39,153 (600) and 65,415 (2,000) committed transactions, **0 rollbacks, 0 deadlocks**, buffer cache hit ratio 1.00 (35 to 49 blocks read from disk), at most 15 connections to the database (pools of both processes plus the script), at most 2 active at the 250 ms samples.

**Memory** (working set): web 91 to 93 MB at start, 212 to 219 MB with 200 live streams open, 265 to 279 MB after image processing; worker 68 to 70 MB at start, 124 to 125 MB at the end. Within the Compose limits (web 1 GB, worker 512 MB).

## Defect found and fixed: the participant list (K-723)

1. **Quadratic waiting-list positions.** Each waiting participant's position was a separate count over the waiting list. Replaced by one window function. Same runs, same machine, only that query changed:

   | Participants | Before: p50, throughput | After: p50, throughput | Rows read by PostgreSQL over the whole run |
   |---|---|---|---|
   | 600 (runs 16-32-31, 16-35-07) | 117.7 ms, 65/s | 30.6 ms, 255/s | 24.7 M → 3.5 M |
   | 2,000 (runs 16-38-42, 16-37-04) | 391.4 ms, 20/s | 55.9 ms, 140/s | 87.4 M → 14.0 M |

2. **The list stopped silently at 1,000 rows** (`LIMIT 1000` with `nextCursor: null`), although an event may have up to 100,000 places: at 2,000 registrations the organizer saw half of them, and the check of positions failed. The list now comes in pages ordered by registration time (keyset cursor of time and id; `limit` 1 to 1,000, default 1,000), positions are still counted over the whole event, and the organizer page loads every page. Tests: `participant-list.test.ts` (pages, ties at a page edge, positions across pages, invalid cursors and limits) and `use-event-data.test.ts` (the client follows the cursor). Mutation checks: without the waiting-state filter, without the id tie-break, or without the cursor, a test fails.

## Conclusions

- Every critical path meets its target on a laptop shared with the load generator; no request failed and no invariant was broken under concurrency.
- **No Redis, queue or cache is justified:** the database answered from memory (hit ratio 1.00), used at most 15 connections, and no path was limited by it after the participant-list fix. The outbox in PostgreSQL drained 2,000 emails at 68/s.
- **Known limits (by design):** confirmations of one event are serialized by its event lock (about 110 to 160 per second per event here), which is what guarantees the seat count; image processing is CPU-bound (about 0.55 s per 6-megapixel photo; two at a time per web process); password sign-in is deliberately slow (Argon2id).
- **Real email throughput** will be set by the provider: Resend documents a per-team API rate limit ([usage limits](https://resend.com/docs/api-reference/rate-limit): 10 requests per second by default at the time of writing). At that rate 2,000 verification emails take about 200 s; the dispatcher already honours `429` with `Retry-After` (K-717). Batch sending is a possible later improvement if events of that size are expected.
- *Derived* capacity on this machine: one web process serves about 1,500 public-page polls per second, that is roughly 20,000 open event pages refreshing every 15 s; and about 600 dashboard polls per second, that is several thousand open organizer pages. These are extrapolations from the measured throughput, not measurements with that many clients.

## Limitations of these measurements

One laptop, client and server on the same machine, development logging, the fake email provider, no TLS or Caddy in the path, one web process; memory is sampled at points, not continuously. Repeat `pnpm bench` (and `BENCH_PARTICIPANTS=2000 pnpm bench`) on the production host before launch.
