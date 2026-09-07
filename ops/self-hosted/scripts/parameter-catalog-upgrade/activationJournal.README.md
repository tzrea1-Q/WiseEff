# Activation host journal

Chinese: [中文](activationJournal.README.zh-CN.md)

`activationJournal.ts` implements the existing-schema Cutover activation
`pending(intent)`, `committed(binding)`, and `unknown(intent)` port. Its separate
`activation` entry does not extend BindingPhase beyond P0–P10. It adds no SQL,
schema, grant, report approval, runtime startup, queue or traffic operation.

The parent controller must supply the actual issued host/target boundary assertion
and the formal activation module's `inspect` operation. They are composition-root
code dependencies, not configurable JSON, an environment receipt, or an operator's
claim of success. The controller keeps its real maintenance boundary held through
each call. This adapter neither acquires the PostgreSQL lock nor replaces the
domain's complete checkpoint/event/run/head and current-state observation.

## Persistence contract

- The host journal run and the Cutover run are different identities. The existing
  journal must already bind `cutoverRunId`; activation entries additionally bind
  its exact host run and observed database system identifier/OID.
- Intent fixes the attempt, plan, predecessor binding, approved report reference,
  expected observation digest, and canonical input digest. A report reference in
  a journal is not evidence that the report is approved.
- `pending` persists before returning to the domain. Only that adapter instance
  may acknowledge the identical binding after SQL commit. Another instance must
  inspect; it cannot promote an old pending record by calling `committed`.
- A pending or unknown attempt blocks another attempt. `unknown` never becomes
  committed through ordinary acknowledgment. `reconcile()` calls the injected
  formal readback; it accepts an exact current applied binding or an exact
  not-applied observation whose current head equals the original predecessor.
- A not-applied result records resolution; it does not retry SQL. A later explicit
  invocation needs a new attempt. A committed/reconciled run cannot be activated
  again. An identical acknowledged binding can replay without adding a record.
- Every write uses the existing complete-record CAS, exclusive filesystem write
  lock, file fsync, atomic rename and parent-directory fsync. Uncertain durability
  retains the write lock. Partial JSON, drift, missing fields and malformed types
  refuse. Diagnostic load does not authorize an effect.
- Activation metadata cannot change controller phase, next action, plan, Cutover
  identity, verification pins or failure state. No caller-provided hash alone
  substitutes for the typed event or its immutable predecessor.

## R3 threat and verification scope

| Threat | Permanent observation |
| --- | --- |
| Missing intent, crossed run/target, malformed fields or binding digest | Refusal before acknowledgment; bytes unchanged |
| Pending/unknown reuse, new process or concurrent invocation | No second execution admission; explicit inspection required |
| Lost host lock, retained filesystem lock, truncated journal | No terminal record, no automatic retry |
| Stale, wrong or mutated inspection / changed journal | Full binding/head/intent and complete-record CAS reject resolution |
| Directory fsync failure after rename | Pending remains diagnostic only; durability lock remains |
| Exception containing private information | Fixed `PCAT-UPG-ACTIVATION-JOURNAL-REFUSED` error |

Run the two focused files with the repository's scripts Vitest configuration.
The tests use real private temporary journal files and synthetic domain readbacks;
they do not establish PostgreSQL commit, complete P12/P13, runtime startup, or
controller acceptance. Their injected domain port is deliberately not described
as a real database proof. The parent must separately integrate and test the actual
domain readback and controlled target before claiming that boundary.

There is no production execution command in this module. Successful journal
persistence is neither runtime approval nor public-release permission.
