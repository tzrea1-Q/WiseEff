# Jobs Repository Behavior Tests (TD-096 slice)

Status: **Completed** (PR #378)

## Goal

Retire `server/modules/jobs/repository.test.ts` (6 tests, 24 SQL-substring assertions against a row-count fake) for `repository.integration.test.ts` — 9 behavior tests running the real lease state machine against Postgres via `createInMemoryTestDatabase()` (rollback-per-test, `describe.skipIf`).

The lease fencing that the fake could only grep for is now exercised for real: FIFO claim of due jobs only, live leases refusing rival workers, expired-lease reclaim incrementing attempts, owner-fenced progress/complete/fail writes (including the previous owner after expiry), retry requeue staying unclaimable until due, terminal dead-lettering, and the snapshot join to the owning log record.

## Old → new mapping

| Old test | New coverage |
| --- | --- |
| only claims queued jobs whose next run time is due | creates a queued job and claims only due jobs in FIFO order |
| claims a specific queue-delivered job with the same lease guard as polling | claimJobById targets one job under the same lease guard as polling |
| fences progress writes by active lease owner | fences progress and completion writes by the active lease owner |
| fences terminal job writes by active lease owner | same + fences writes once the lease expires, even for the previous owner; failJob records the error and releases the lease |
| schedules retries by requeueing, clearing lease, and storing next run metadata | retry scheduling requeues with next-run metadata and the job stays unclaimable until due |
| dead-letters jobs by failing, clearing lease, and storing dead-letter metadata | dead-letters a job terminally: failed, stamped, never claimable again |
| (net-new) | does not steal a live lease but reclaims an expired one, incrementing attempts |
| (net-new) | getJobSnapshot joins the run and log record to expose the owning log |

## Verification

- `vitest run server/modules/jobs`: 30/30 on the post-cutover local DB and on a fresh migrated DB
- `tsc -b` clean; `npm run docs:check` green

## Documentation Impact Matrix

| Area | File(s) | Impact |
| --- | --- | --- |
| Planning docs | `docs/PLANS.md`, this plan | Update |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update (TD-096 progress) |
| All other areas | — | No change (test-only; no behaviour, contract, or schema impact) |

## Documentation Update Gate

- [x] `docs/PLANS.md` lists this plan
- [x] TD-096 row updated
- [x] `npm run docs:check` green
- [ ] Move to `completed/` after merge
