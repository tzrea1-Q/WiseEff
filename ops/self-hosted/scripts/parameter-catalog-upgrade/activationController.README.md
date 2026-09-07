# Management P12 dispatch

> [Chinese](activationController.README.zh-CN.md)

Scratch dependency: candidate `07919b498`, with main `cda6737a8` in its ancestry.
This module owns only the connection between the existing host lock/journal,
Release Verification admission and Cutover Activation. It adds no permission,
migration, S7 phase, startup, retirement or public-release effect.

## R3 threat matrix and scope

| Threat | Required observation |
| --- | --- |
| Structural, wrong-root, expired or replaced host lock | Refuse before target observation or journal mutation |
| Changed run, plan, target, predecessor or owner observation | Refuse; never populate current facts from the report |
| Missing/unapproved/wrong-purpose report | Existing release admission refuses; no activation pending or SQL effect |
| Interrupted SQL or host commit | Retain the existing exact pending/unknown intent; no automatic apply retry |
| Reconciliation against another attempt or stale binding | Existing journal and actual domain inspection refuse |
| Nested dispatch or asynchronous drift | No concurrent effect; recheck the held lock and journal |
| Forged command fields or unavailable owner | Reject unknown fields and preserve static diagnostics |

Tests use actual private host journals and issued host locks. Simulated domain or
report ports are explicitly adapter tests, not real PostgreSQL, approved P12,
application startup or a complete controller upgrade. The parent owns the live
state producer and terminal integration. No production operation is authorized.

## Invocation contract

`openActivationController({journal, lock, owner})` does not acquire another host
lock. The management root calls it inside `withHostOperationLock`, forwarding the
issued handle for the exact journal parent. The root retains ownership of the
management pool and report-reader connection and closes them after dispatch,
including failures. The domain destroys its management leases as usual.
`owner.verify()` checks the actual resource/maintenance boundary; it must remain
usable during this action's pending record and after its intended P12 change.
The adapter itself checks journal and observation applicability. Treating every
pending entry as unrelated work would reject its own in-flight action.

The only command fields are:

- `activate-p12`: `attemptId`, `reportDigest`.
- `inspect-activation` and `reconcile-activation`: the recorded `attemptId`.

Run and plan come from the settled host journal. Physical target and live
observations come from the management owner, not command JSON. `owner.observe()`
returns the actual `ActivationObservation`, the independently observed P12/P13
phase fields, and the comparison owner's actual `ComparisonReport` artifact.
The module clones these observations, constructs the formal intent using actual
`activation.inspectFacts()` predecessor state, and dispatches through the
existing `runCatalogReleaseAction` and `activation.apply`. It does not create an
epoch implicitly; explicit management preparation remains the domain's
`prepareMappingEpoch` operation.

A missing or unapproved report produces the existing admission refusal without
writing pending. When approval later exists for the same still-current facts,
the same action implementation can proceed; the root must obtain a fresh live
observation. An effect that began is different: pending/unknown blocks another
apply. Reconcile calls only the actual domain `inspect` through the existing
activation journal, producing `reconciled` or `not-applied`. A `not-applied`
result never retries automatically; the existing journal requires a distinct
attempt for an explicit subsequent apply. Inspect never appends or repairs.

An unavailable owner, lost lock, malformed command or failed journal yields only
`PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED`; ordinary report refusals retain their
typed admission reason. Neither result permits startup, P13 or traffic. Unknown
file/SQL commit outcomes retain the journal for inspection; do not reset it.

## Current evidence boundary

The initial real-domain intent/host-journal integration exposed different inner
digest encodings. The earlier standalone journal tests did not establish domain
compatibility. The correction is dependency `3c0fe1d66` (picked as `0b93430f7`);
the host journal envelope checksum remains a separate contract. The initial
adapter execution had 9 passed / 2 failed before that fix. The expanded adapter
run passed 20 / 20 on `0b93430f7` plus these then-uncommitted files. It uses genuine
issued host locks, filesystem journals and formal intent digests; positive domain
effects and report approvals are explicitly simulated. This is not a real
PostgreSQL P12 execution. No S6 grant, Policy decision or production approval is
changed here.

The pure adapter and persistence regression command is:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.scripts.config.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/activationController.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/activationJournal.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/journal.test.ts \
  ops/self-hosted/scripts/parameter-catalog-upgrade/controller.test.ts
```

Run in an isolated development checkout with dependencies already installed. It
creates temporary private files and real host-lock subprocesses; it does not
connect to a database, stop services, approve a report or invoke Docker. No
production terminal command is supplied by this module.
