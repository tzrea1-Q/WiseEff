# Populated self-hosted upgrade compatibility

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-06-populated-upgrade.md)

## Scope and state

### Accepted bounded contract evolution, 2026-09-07

The user explicitly authorizes implementation and isolated verification of two
independent R3 changes at `f00f94435` (code `11d8147a5`, main `cda6737a8`).
Refreshed refs are unchanged and the worktree is clean. Earlier pending decisions
for these two scopes are superseded; this is implementation authorization.

Recovery: retain S11-RP capture/verify/restore-check manifest, exact target,
quiescence and run-bound token ownership. No direct or transitive execution from
check-only entrypoints. Register every storage module and its dependencies under
an independent controlled execution contract. Restore consumes existing verified
package/token contracts with persistent attempt, source provenance, authorization
and live target/lock checks at each store. Unknown/partial outcomes remain locked;
success cannot resume traffic. The blanket token scan evolves only into this
exhaustive split, preserving every unrelated forbidden operation.

Reader: append the next migration (currently 0140; recheck before integration),
preserving every historical SQL/checksum. NOLOGIN capability grants only schema
USAGE and SELECT required by real Kernel SQL, with an exact object manifest.
Retain historical 0138 negatives and test new opt-in real LOGIN reads. No DML,
ownership, grant/admin option, high role reachability, governance EXECUTE or new
privileged system metadata capability. Report reads retain the separate 0139 role.

Single writers: recovery Scratch owns storage execution/check ownership/tests;
reader Scratch owns the new migration, role manifest and real Kernel/role tests;
parent owns runtime roots/controller, generated schema, fingerprint publication
and final bilingual operator/evidence changes. Each lane writes its own bilingual
module contract. Integrate reader then recovery serially after independent
Standards/Spec review. Test clusters cannot share cluster-global roles. Do not
apply the old proposal wholesale. Parent continues startup/P12/P13 integration.

Threats: missing modules, indirect/dynamic check-to-execution imports, command
obfuscation, forged/stale/cross-run package/token, nonempty/wrong/shared target,
lost locks between stores, unknown restore outcomes, source stopped after capture,
PUBLIC/owner/indirect membership escalation, unsafe INHERIT/SET/ADMIN options,
unauthorized reads/writes, invalid Kernel pins and pool cleanup failures. These
require permanent negatives and real isolated positive evidence before sealing.

Documentation impact: existing plan pair, module contracts, ownership/grant
manifests, relevant tests/fingerprints and generated schema, operator/evidence
pairs. No global trusted-base reset or unrelated allowance changes. Neither
authorization approves #815, real backups, enterprise CA, production operations,
merge or release. PR #824 remains Draft; these slices do not replace the full
startup and populated controller acceptance.

## Continuation: M1 and M2

### Current integration ownership

Parent next owns typed recovery capture events in the existing journal and its
capture bridge. The real capture return, not caller JSON, supplies source/package
digests. A durable pending attempt precedes capture; missing/unknown journal
outcomes retain the package and block retry. Old hash-only events remain
inspectable but cannot become trusted producer records. A module-issued live
host lock is checked for the exact configured root before every step. This does
not certify the writer-boundary producer or grant restoration. Recovery Scratch
owns a separate five-file deployment authority adapter using real production
authentication and private per-run assignments; no new product role or implicit
admin mapping. Parent remains sole writer of journal, handoff and controller;
Scratch cannot add those seams independently. Documentation impact is this plan
pair, recovery execution contract pair and the existing operator/evidence pairs.

Parent owns the database foundation and composition roots. Activation Scratch owns
additive 0141 and `catalog-cutover/activation/`: management-only mapping epochs
and P12 CAS, separate from P5 and actual consumer routing. No runtime grants or
historical migration edits. Explicit preparation may persist an epoch; inspect
remains read-only. Reports cannot supply their own current-state facts.

The parent will add an opt-in per-checkout observation hook so the management
owner's target challenge covers the actual session used by Kernel. A before/after
probe on another pooled connection is insufficient. The hook receives only the
checked-out query session, precedes its first caller statement/BEGIN, and covers
the raw pool exposed to formal Kernel. Failure destroys the lease and preserves
the admission error; pending verification must not expose the session. No external
transaction enters Kernel and no database privilege is added. Regressions cover
root queries/transactions, raw promise/callback checkout, delay and cleanup. The
generic hook is neither target proof nor approval; the owner supplies actual
nonce/physical-target observations. Documentation impact: this plan pair,
foundation documentation and activation contracts, then operator/evidence pairs
after execution. Reader and recovery retain separate reviews and execution SHAs.

Fresh preflight confirms base `67d4a77325b6009b77c2373bd788298a6d022bcf`, inherited report head `1a9ba7745b6f4e0ba1e52aede3e0ee5fe1ab6016`, clean candidate worktree. Source deployment is unchanged. M1 is independently reviewable interception; M2 requires a successful actual isolated upgrade and remains separate.

The later remote refresh found documentation-only PR #823 at
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`. Parent read its current security/test
guidance and appended merge `7218a43dcd5402d52b5e57166b746d0c6409642f`.
Existing implementation/report/test identities are retained; M1's independent
backup is still based on `67d4a7732`. The source deployment is still `82344044…`.

Parent owns M1 CLI/debt shrink, fixed-entry handoff, shared upgrade/Compose/migrations, integration and delivery. `m2_release` owns the existing release-gate script and tests; `m2_runtime` owns runtime connection/startup files and tests; `m2_recovery` owns package restore adapters and synthetic recovery tests. Each works in isolated Scratch; parent integrates serially. No agent owns production actions or permission changes.

Incremental threat review: preserve absent-diagnostic versus release refusal; remove only proven unused imports and four exact debt IDs, reject reintroduction, retain immutable fixture/relocation/base; bind handoff to artifact/daemon/project/storage identities before effects; produce reports from real state; runtime initialization precedes all queue effects and never repairs; restore consumes only a verified package with external secret inputs, binds the target and stops on partial/unknown outcomes. Package verification must resist file replacement, path traversal and stale Redis AOF. These augment the matrix below. First Red is the inherited boundary failure, then retired-module load rejection at the CLI diagnostic seam.

Documentation impact: update this existing bilingual plan, existing bilingual operator/evidence documents, and module-owned runtime/recovery guidance together with executable paths. No duplicate status report. Focused checks own inner loops; final build/contracts/docs and independent reviews precede a milestone PR. Synthetic schema preservation is not canonical conversion; sentinel RDB restore is not AOF production-shape recovery.

M1 now has exact four-ID debt removal, permanent reintroduction negatives and
independent Standards/Spec review. Its final scripts batch at `ffc240498` has
1301 passed / 1 source-lock timeout / 5 skipped. Boundary passes. It remains
Scratch pending the frozen source-lock performance decision; no PR or Hosted run.
The remote M1 branch is a backup, not release authorization.

M2 ownership refinement: `m2_runtime` is the sole writer of additive migration
0140 and governance read-port separation; parent has not edited that migration.
`m2_release` owns S7 exact conversion manifests plus S6 management import and
evidence Archive capability, preserving classification and immutable history.
`m2_recovery` owns fixed-entry identity/private-input hardening and controlled
package restoration. Parent owns Compose/Dockerfile/ignore rules, root dispatch,
generated documentation and final integration. Parent's independent review
requires the new reader role to reject pre-existing unverified capability;
the runtime command role must not receive broad Catalog/audit SELECT.

Current integrated M2 pieces are report-action binding, restricted-login startup,
separate governance pool, exact formal-definition mapping/source fingerprints,
package-only restore with source stopped, initial handoff, and explicit Catalog
Compose credential/profile/external-volume separation. These are not the M2
success chain. P2 live writer isolation, phase-aware handoff resume, P12/P13
producer ownership, full post-retirement report/runtime loader, complete consumer
and business permissions, browser/capacity, and root upgrade success remain open.
Secrets must remain outside the candidate build context; `.dockerignore` defense
does not replace descriptor-bound private input verification. Recovery package
limits and actual enterprise/real-data evidence remain separately tracked.

Current state: SCRATCH, incomplete. See the [execution evidence](../../../ops/self-hosted/populated-upgrade-evidence.md) for refreshed base/candidate, passing checks and unresolved boundary/release blockers. The following paragraph records the initial preflight.

PREFLIGHT, R3. Source deployment stays `82344044b436a8dafecefbb85dfd724cecb05e3f`; development base is freshly fetched `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d` (no difference from the supplied main). Source counts and image identity are supplied historical observations, not rerun evidence. The local clean isolated worktree uses `codex/populated-upgrade-scratch`. No production access is authorized. Stop at a reviewed candidate/PR; do not merge, close historical issues, approve release, or operate production.

Latest code candidate `21f5aa4a8bdbb7208504396bce62796cf55875da` has real
Binding producer/import component evidence (50/50), final compatibility/gate
regressions (63/63), and a passing build. Recovery remains at its own commits
(35/35 with database settings refusal); totals are not combined. Parent still
owns the concrete writer/recovery boundary, journal adapter/reconciliation,
phase-aware handoff, runtime/public state producers, and complete
business/browser/capacity acceptance. These independent code tasks do not require
a production backup. The full root milestone remains incomplete.

Three decisions remain separate: a frozen source-lock performance amendment for
M1; the separate 0140 proposal's two new governance EXECUTE grants; and #815
authoritative Policy counting versus an explicitly approved unavailable contract.
None is assumed. Implementing P12/P13 within the existing ownership is still the
parent's internal work; an unavailable constant alone is not an external decision.
The runtime proposal is backed up separately, not installed by this candidate.
No PR, Hosted or production action is claimed. The terminal guide supplies tested
component/inspection commands, not an invented full-upgrade command.

## Ownership and dependencies

### Increment on 2026-09-07

The parent continues implementation rather than treating missing production
authorization as a coding blocker. Parent owns controller admission, S7 P4
composition and its immutable preparation pins, documentation and actual test
execution. Release lane owns the controlled migration/structure receipt;
runtime lane independently reviews management and P4, and recovery lane reviews
controller cross-run admission. No parallel PostgreSQL test cluster shares roles.

New R3 threats: a live-looking but dead host lock; file/directory fsync uncertainty;
another run's pending Binding/management attempt; caller mutation after an await;
search_path redirection; a new table/column outside the frozen source; a different
candidate borrowing a management receipt; physical schema/ACL drift despite an
unchanged migration ledger; and resume skipping historical P4 applicability.
Receipts describe observed preparation, never report approval. P4 pins bind the
outer preparation run/plan and candidate SHA/tree without a circular S7 digest.

Actual additional matrix uses a separately owned `postgres:16-alpine` cluster.
The pgvector Catalog lane and its required setup remain unchanged. Recovery now
has package-only real three-store tests for both PG16 bootstrap identities,
original MinIO version, AOF and explicit unsupported database-property refusal.
Precise batches, including setup failures and zero-collection mistakes, belong
in the existing evidence pair; they are not combined across SHAs.

Documentation impact: this plan and companion, existing operator and evidence
pairs. Parent still owns the unfinished terminal composition, full source-family
producers, P12/P13 implementation within frozen ownership, new report chain,
runtime startup/pool integration and application/browser/capacity acceptance.
These are internal implementation gaps. Real backup, enterprise CA/network,
production authorization and the separately documented Policy/permission
decisions are distinct external dependencies. Neither group closes M2 or OP-09.

### Increment at report `1190ba591`

R3 continuation: parent owns controller/journal, root composition and all actual
execution. Release lane owns handoff lock liveness; runtime lane owns new
startup/state readers; recovery lane owns controlledRecovery adapter/test files.
Independent pre-review found replay before live admission, stale journal writes,
unknown phase outcomes across runs, lost host locks and stopped-writer resume
mismatches. These are implementation work, not external dependencies. P12/P13
must retain existing ownership and approvals; its unavailable constant alone is
not an approval requirement. No frozen grant or Policy decision changes.

First Red at `1190ba591` plus tests: stale handles overwrite newer entries and
symlink paths are accepted (5 passed, 2 failed). The first fix checks the current
digest under an exclusive writer lock, uses exclusive temporary files, file and
directory fsync, and refuses unsafe journal files. Journal/controller tests then
pass 19/19 on the working tree. Next: durable phase intents across process and run
boundaries, with replay checked against the current real target. The root must
hold the deployment lock and re-observe identity before each external effect.
Documentation impact: this plan and its Chinese companion now; the existing
operator/evidence pair after actual adapter execution. No full-upgrade or
production readiness is inferred from component results.

| Package | Owner / paths | Dependencies / success |
| --- | --- | --- |
| A | Parent: this bilingual plan, final evidence and operator guide | Freeze threats before production edits; independent Spec challenge |
| B | Parent: reconcile CLI/tests, upgrade.sh/upgrade-lib.sh and tests, new handoff helper | Real old invocation fails closed; diagnostic queries cannot authorize release |
| C | Parent: release-verification integration and controller adapters | B, approved role/recovery contracts; unavailable frozen phases remain blocked |
| D | Identity/recovery lane, initially read-only: runtime roots, database roles | Explicit parent handoff before edits; real restricted login proof |
| E | Identity/recovery lane, initially read-only: storage/recovery | Isolated three-store evidence, never target proof |
| F | Build lane: build-network-specific helpers/tests | Existing policy; synthetic trust evidence separate from corporate CA |
| G | Parent: isolated rehearsal, documentation, delivery archive | A-F; authentic backup and production approval are external dependencies |

Single writers: parent owns upgrade shell, Compose, runtime integration, migrations, generated docs and proof fingerprints. Other worktrees and inherited bytes are preserved. Development WIP 2 for shared schema; path-disjoint build work may proceed. Final Standards and Spec reviews run against one candidate. One final Hosted batch after integration readiness, no speculative broad reruns.

## Threat matrix

### PR #824 continuation

Parent owns runtime admission, API/worker roots and this plan pair. The independent
CI Scratch lane owns recovery execution attribution; a read-only Spec reviewer
challenges startup facts and privileges. Refreshed main remains `cda6737a8` and
head remains `7fabeb8c4`. Hosted `34067803219` executed merge-ref
`51ec49131ea542d499607021c20012ad1b39266c`: scripts 1427 passed, 1 failed,
39 skipped. The failure is the recovery executor's `pg_restore` token against
the S11-RP contract, not the historical source-lock timeout. Same-selector local
candidate/base comparison reproduced candidate failure and base success.

Additional R3 threats: missing namespace bypasses application startup admission;
the report becomes its own current-state oracle; management credentials enter
runtime; isolated startup starts business consumers; public restart borrows stale
approval; initialization failures leak pools or private diagnostics. Independent
Spec review confirmed the namespace and worker cleanup seams. Production missing
DATABASE_URL already fails in env validation; it is not a new defect.

Actual process success requires a real P12/P13/current-pin producer and authorized
Catalog read capability. Neither exists in the current integration. `0139` report
reader privileges do not grant Catalog reads; `0138` explicitly denies production
Catalog SELECT. Do not grant synchronizer membership or manufacture a passed
report. Continue independent initialization fixes; proposed capability and restore
ownership changes require explicit decisions. No scans, grants or timeouts are
relaxed. Documentation impact: this plan pair and existing operator/evidence pair.
The Draft remains partial; no production operations are authorized.

| Threat | Required observation / evidence owner |
| --- | --- |
| Missing args, absent/unapproved/blocked report; unknown CLI option | Nonzero typed refusal at real CLI, parent B |
| Old source controller invokes new check | Actual source command cannot resume traffic on diagnostic success, parent B |
| Cross candidate/target/release/mapping/source, stale purpose/attempt | Existing verifier rejects exact-input mismatch; no Bash verifier, parent B/C |
| Pre-activation used for runtime/public release; forged approvals | Refusal at each action; distinct approval records, parent C |
| apply/resume/recover-candidate/no-op bypass | All reachable release paths gated; old-service recovery distinct, parent B |
| Missing/ordered phases, concurrent controller, unknown commit | Journal/lock refusal; no reset/guess, parent C |
| Fresh with any old inventory; partial migration/checksum drift | Refuse false fresh; immutable historical SQL; retry evidence, parent G |
| Runtime superuser/role inheritance/DEFINER escalation | Real limited logins and business/negative PG proof, D |
| Wrong DB/host/Compose/volume/bucket/Redis or partial restore | Keep isolated; explicit bound recovery, E |
| Candidate write/queue/public traffic followed by pointer rollback | Persistent refusal, E |
| Untrusted/expired/wrong TLS chain; insecure readiness | Reject; trusted synthetic chain succeeds; no secret leakage, F |
| Lost values/history/protected references or unknown Policy count | Full classification/consumer oracle, no count equivalence, G |
| Lane pgvector assumed equivalent to source postgres:16-alpine | Separate extension compatibility evidence, G |

## Test levels and stop points

Red then focused Green at CLI/controller seams; real subprocess exit codes; real PostgreSQL migration/role tests; isolated Docker/Compose ordering; synthetic populated oracle; build/contract/boundary/selfhost/docs checks. Browser changes require playwright-cli desktop/tablet/mobile. Each run records exact SHA/tree, command, exit and collected/passed/failed/skipped separately. Setup failure is not zero-test success. A synthetic rehearsal, B authorized backup rehearsal and C production execution remain separate.

External blockers: no authorized real backup, enterprise CA, or production maintenance authorization supplied. #815 still needs authoritative Policy association or approved unavailable contract. Frozen unavailable release phases are an integration blocker, not permission to forge implementation or approvals. Continue independent work while these remain blocked.

## Documentation Impact Matrix

| Change | English | Chinese | Gate |
| --- | --- | --- | --- |
| Scope/threats/evidence | This plan | Companion plan | docs:check |
| Upgrade/diagnostic/handoff contract | ops/self-hosted/upgrade.md | ops/self-hosted/upgrade.zh-CN.md | CLI tests + docs:check |
| Operator procedure | New populated-upgrade runbook | Chinese terminal procedure | Only tested real commands; unavailable steps explicit |
| Build trust | Existing build-network documentation as needed | Matching companion | Trust tests |

## Documentation Update Gate

Update both language files in the same change; generators own generated artifacts. Run `npm run docs:check` before plan completion. This plan remains active until its independent deliverables and limitations are recorded; no production readiness inferred from code completion.
