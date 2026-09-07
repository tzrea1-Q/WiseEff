# Populated upgrade candidate evidence

> Chinese: [Chinese](populated-upgrade-evidence.zh-CN.md)

## Authorized contract implementation checkpoint, 2026-09-07

### Current integration failures and separately verified increments

The P12 prototype in `c120f92da`/`cf4813652` adds three management tables through
0141. Its focused PG16 tests do **not** authorize changing frozen S2 schema
contracts. Full server execution at `28c9902a4ea9cca600d7355e91276629f8c6647d`,
14:01:54 UTC+8, exited 1: **4184 collected, 3919 passed, 53 failed, 212 skipped**;
521 files: 482 passed, 38 failed, 1 skipped; 151.36s, owned cleanup verified.
The new tables cause the historical 43-relation assertions and S2 fingerprint
to reject the current 46-relation schema. The expected fingerprint remains
`5424d2588395ab736b7af2ad5146091d7c9592ede4a59eea48480917e84516f5`;
the observed candidate is
`23fe1747c1c5e5477277654e90b3a0a002db6123a05c9342ef11a57fdc270646`.
This is a candidate integration failure, not inherited main failure. P12 remains
unsealed Scratch pending a separate, bounded S2/S2-RBAC/S2-PGH decision; neither
of the two approved contracts grants permission to replace this freeze.
The old manifests, assertions and fingerprints are unchanged.

`1066cd05f` connects the existing recovery capture implementation to typed
pending/committed/unknown journal events and an issued, root-bound host lock.
The execution consumer refuses historical hash-only capture events. Directory
replacement leaves the original pending evidence intact; it cannot write a
copied journal in the substituted root. Capture does not create approval or
advance release phases. Final precommit focused execution at 13:44:03:
105 collected, **104 passed, 1 opt-in Docker skipped**, exit 0, 4.70s.
This is filesystem/journal evidence, not an actual source-bound controller run.

`f96833510` binds each recovery output to its original directory and file
descriptor. `81d99a6c0` (source `fff28cf7a8104f2284b424afc47f59b7abcc79db`)
syncs every payload and manifest file, then the directory before success.
Source Red was 4 failures/38 filtered; source Green was **84/84**, no skips,
with TypeScript check exit 0. Parent integrated package/capture/authorization
selectors at 14:12:44: **83/83**, exit 0, 4.46s. These are different selectors,
not a decreasing or combined total. Independent Standards/Spec reviews accepted
the bounded descriptor and sync changes. Partial packages remain after failure;
neither filesystem tests nor descriptor binding prove atomic cleanup against a
replacement after the final pathname check in the shell lock release.

Actual deployment authentication is implemented through `5fafaff65` (source
`0c4a57e110fdddb7255d9a1dbc4a1b1b767b0540`): a restricted authentication LOGIN,
existing session authorization and private per-run custodian assignments, with
effective ACL/member/function/system-parameter checks. Its owned PG16 run was
**38/38**, unit run **14/14**, build and documentation governance exit 0.
Assignments do not turn product administrators into deployment operators.
The later report-writer target is a separate Scratch change under review;
its intermediate 54/54 run is not a passed-report approval or startup proof.

At `2ae097c939b611f94efe45fa878932f60fe2852c`, tree
`e774874e6fd86e0c43c1362c95664586c64c2c3c`, build exited 0 (Vite 8.76s,
existing warnings). Owned schema generation exited 0 and generated the additional
0141 inventory, committed as `28c9902a4`; generation does not approve that schema.
Mandatory reader/report/activation/authority CI lanes each have a separate cluster;
their exact exclusions from shared suites do not count as passes without those
required jobs. No new Hosted execution or production operation is implied here.

New raw log hashes:

- Full server `28c9902a4`: `0328b620ad6839d1f57d377eb849f093f5e3ddd50e57c1f17f9278207426f5b7`.
- Integrated recovery sync selectors: `18207bff46a7d7ee089961476c6398ccd77cdbbf6d6e6f37cca0bcb90e502365`.
- Build `2ae097c93`: `3ddb73e02838a41b4fd38ebb5330e71ebc1a71592d4b11b46304f7ec46ea411e`.

### Earlier executions in this same continuation

The user's two bounded decisions supersede the pending recovery/reader decisions
in the historical follow-up below. Base remains `cda6737a8`; source deployment
remains `82344044b436a8dafecefbb85dfd724cecb05e3f`. PR #824 was independently
read as Draft/Open/unmerged at remote `f00f94435` before publishing this work.
No historical execution is reassigned to a later report commit.

Reader commits `cf06d5a79` through `9caeae155` append 0140, its exact ten-table
query/grant manifest and privilege-drift negatives. Historical 0138 SHA256 is
`a575205695852b11a536c7d41293f87634242b3c8d98f2345b3599e144aca8c5`;
0139 is `36fdd85de86ab09309dd6531594feca16a5bce00b343fa858ac04f4cdbf49f31`.
`3f2e8f7a7` keeps the historical role contract comparison explicitly at 0139;
new reader permission acceptance is separate. No runtime LOGIN or production
credentials were changed. Independent Standards/Spec reviews of the reader
found no remaining P1/P2 after the documented privilege-audit corrections.

Recovery commits `6b8febdc2`, `d22efaccc` and `44eaa7a9a` implement the registered
check/execution split, opaque execution target and durable authorization consumer.
Check-only entrypoints cannot import the executor; missing modules and disguised
commands are negative cases, while unrelated S10-PER prohibitions remain. The
consumer requires capture/approval records already committed in the existing
journal; the synthetic fixture is not the missing authenticated controller
producer. Independent reviews found no remaining P1/P2 in that consumer or the
four-case acceptance split. Real restore acceptance and complete controller
approval production remain separate results.

| Execution identity / command | Observed result |
| --- | --- |
| `0a4d6a4b6e86151aac87794f681e02d06cb47bb1`, tree `2aaf410e77adcda983bdd01cda4861e4403cc361`, owned runner `--suite reader-pg16`, 11:33:23 UTC+8 | 46 collected/passed, 0 failed/skipped/filtered, exit 0; formal Kernel through real restricted LOGIN; PG16 Alpine image `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`, linux/arm64; cleanup verified |
| Same commit, startup config selecting `verifyStartup.test.ts` and `publishedStartup.test.ts`, 11:35:21 | 41 passed, 0 failed/skipped; adapter units only, no production entrypoint success |
| Same commit, boundary test selector `locks the post-refresh`, 11:35:22 | 1 passed, 23 selector-filtered; not the whole suite |
| `6e6ceb6b57dc6b493ebe9629cbd8deb0d2eb2e7d`, owned runner `--suite schema-doc` | exit 0, real generated inventory now 138 migrations through 0140; pgvector image `sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`, cleanup verified; generation committed separately as `4f0b54413` |
| Precommit bytes later committed as `2ff5e46b2`, CI/runner/Hosted admission selectors, 11:54:32 | 4 files, 75 passed, 0 failed/skipped; synthetic cryptography plus real Git fixtures, not Hosted issuance |
| `44eaa7a9a71b3951c9af6292f439d64e5dd17702`, tree `aeb64d15e656d9e8d4a12a515a4825eba08b7ab7`, owned runner `--suite scripts-pgvector`, 11:54:54 | 118 files: 115 passed, 2 failed, 1 skipped; 1572 tests: 1482 passed, 65 failed, 25 skipped; exit 1, 63.14s; owned cluster cleanup verified |

The full-scripts failures are not collapsed into the old Hosted failure. One is
the unchanged source-lock test's 60-second deadline. The other 64 are rehearsal
cases: a missing canonical TMPDIR triggers the frozen symlink-safe cleanup
refusal, and the database cases also retain a default development container
instead of the runner's owned container. The first batch therefore does not
prove complete target isolation for those nested CLI calls. `d7b7215c4` supplies
the run's private canonical TMPDIR, exact owned container/pinned Docker endpoint
and matching isolated bootstrap login. It changes no frozen assertion or timeout;
the corrected full execution is recorded below.

| Later execution identity / command | Observed result |
| --- | --- |
| `a39294fff7d061249f229438c2a56c54234e8dd2`, tree `ba88e0792cb2d432c378f4166d8ce8c1dfa1462b`, evidence-doc WIP only; owned `scripts-pgvector`, 12:08:34 | 118 files: 116 passed, 1 failed, 1 skipped; 1572 tests: **1546 passed, 1 failed, 25 skipped**, exit 1, 193.19s. All 64 rehearsal failures now passed; the source-lock deadline remains. Cleanup verified. |
| Same code, owned `server-pgvector`, 12:15:32 | 517 files: 515 passed, 1 failed, 1 skipped; 4111 tests: **4101 passed, 1 failed, 9 skipped**, exit 1, 295.65s. Sole failure: legacy dependency guard mistakes canonical schema-qualified relations for retired flat identities. |
| Same code, `npm run build` | exit 0; Vite 15.40s, existing chunk/externalization warnings. Contract, selfhost and documentation-governance checks also exit 0; not a target build. |
| Same code, boundary CLI with explicit trusted base `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74` | exit 0: 3509 matches/allowances, zero unallowlisted/stale/metadata/growth findings. |
| Same code, actual owned PG runtime integration, 12:14:31 | **9/9**, exit 0, 7.33s. Actual production `server/index.ts` and `workerRunner.ts` refuse privileged or missing-schema restricted login before listener/consumer construction. No legal production startup was demonstrated. |
| `2437ab790` plus checkout WIP later committed as `9d55cde1950a1e5108d01b72b1d0531435225df4`, runtime config, 12:45:08 | **38/38**, exit 0, 6.85s: 11 actual PG/entry-negative cases and 27 hook units. Actual backend termination during delayed checkout rejects and destroys the lease; formal Kernel/root/raw-pool paths cannot bypass observation. These are not approved startup positives. |
| `9d55cde1950a1e5108d01b72b1d0531435225df4` plus runner/config WIP later committed as `503c20b2850ddb3bfe9e84da1df6fea04c361b4c`, owned `report-pg16`, 12:46:49 | **34/34**, exit 0, 8.95s; PG16 Alpine image as reader above, independent nonce cluster cleanup verified. Real restricted LOGIN calls formal report projection and rejects extra memberships/ACL/definer delegation. The positive reads an absent report; it is not a passing technical report. Separate same-code report units **27/27**, exit 0. |

The unchanged source-lock file was compared on candidate/base in the same slim
environment with the direct Command Line Tools Git executable. Both bounded
70-second supervisors terminated with 143; neither is a pass or proof that all
candidate failures are inherited. No test deadline, expected output or trusted
base was changed. `c837829314c20ee6557334676c7970e728fe3ba3` fixes only the legacy
scanner's two schema-name collisions, retaining all path/token prohibitions and
testing each occurrence; its independent source commit passed 8/8. The subsequent
full server result must be recorded separately, not inferred from that selector.

`9d55cde19` followed real counterexamples: eleven bypass cases failed before the
per-checkout hook, seven non-Error refusals exposed pg's falsy callback branch,
and five delayed-disconnect cases exposed an unhandled client event. The final
callback acquisition and continuous listener handoff passed independent Standards
and Spec review. It adds no role grant or release permission.

Recovery execution source `4bd547437a1e6981ad14430899b5a2df032cf198`
(integrated as `44eaa7a9a`) ran **4/4 actual Docker cases**, exit 0, 566.22s,
under unchanged per-case 180-second limits. PostgreSQL bootstrap identities
`postgres` and `wiseeff` each cover complete independent package restore and the
nonempty-target matrix. PostgreSQL owner/ACL and restricted reads, object bytes,
content types/metadata, and Redis AOF survive source shutdown and separate restore.
Queue-shaped keys are not actual Bull business-consumer acceptance. The later
fixture-only source `a957f7f998ea583d1dd4183aefbc04fe38ee81bb` (integrated through
`954022cd8`) retains private evidence for both success/failure and writes its
marker through the original file descriptor. Its separate focused result is
102 passed/10 opt-in Docker skipped; legacy CLI selector is 1 passed/11 filtered,
20.25s, exit 0. No four-case rerun is relabeled to this fixture commit.
Independent final reviews of the retention changes found no remaining P1/P2.

Additional raw-log SHA256 values (private logs, not uploaded backups):

- Corrected scripts: `1f2af023f54a78e150c5cd4ee9dc5599a0828b122588de09e87edafae96d03ba`.
- Final checkout PG/units: `3fb09556e9cea3fd40bbfb714b3702aea4612ca3685ff1cc3cb6c504cd8c296f`.
- Report PG: `f51e7118d40c8afa22a362651fa2a92e50d7e4efaa9c46842e6d730f19e079ad`.
- Four-case restore: `afc8dac2356bfddd90c3d23d6fd522f763f2743ad80de94e5b6710c988b1220d`.
- Later legacy CLI: `044c666c0d8a89e9103dff178c6b05d4dac2722c7a8f2314e29cf1cd8852b560`.

At code `c837829314c20ee6557334676c7970e728fe3ba3`, tree
`ecf59fd9cb98d82f531e68f31bcb4e370ac8f59d`, `npm run build` passed (Vite 9.16s,
same existing warnings). Full owned server execution at 12:54:42 collected
4158 tests: **4147 passed, 0 assertion failures, 11 skipped**, but **one suite
failed collection** (`selfHostedUpgrade/database.test.ts`: its Client-only pg
mock lacked Pool after the new import-time subclass). Overall exit 1, 243.61s;
the 519 files were 517 passed/1 failed/1 skipped. `d93ae67a6` supplies a mock Pool
which throws if accidentally instantiated; no actual database fallback is added.
Its 12:59:50 focused run passed **41/41** (14 fixture + 27 checkout), exit 0.
This does not replace the full server failure. Build log SHA256 is
`d4b4272c5eb0a732323d77e026079774cc34148a9ad59027fbcd2f7f44bb9007`;
server log is `318091fde20e83e312657d1fde45d1e301f85948a1f686240b307a24b8fe4ea1`.

The independently reviewable normative amendments are `7cb047d1b10fbb74cf70b0cb2ab4d7b9e9e5d243`
(reader, two specification files) and `a3e58024b3b20a2fdcc154a6bab3981310be7571`
(recovery, four specification files). These add the user's exact authorization;
original phase, approval, retirement and whole-state eligibility clauses remain.
Standards review found no P1/P2 and checked both languages and relative links.
Full-file delivery records scoped contract fingerprints separately from any
global trusted baseline, implementation candidate or test checkout.

Reader log SHA256: `ff5f63523cd4418541d022ac20166d5d3a698b5ce5f211eddd01de2ac9c3d553`.
Startup log: `854670dda36ec5d67ab63391a417a8da8cdf5254b2505583cb6c04e5aeeaff5f`.
Boundary selector log: `94fea2760b9d43e95e3b71b2ed3ba2ccc6d1978349243ff2e9f3b45636a6207a`.
These are private execution-log fingerprints, not claims of uploaded raw logs.

`e7f72e800` adds approved published-restart projection checks, not a live state
producer. `1ebb03bf6` and `0a4d6a4b6` give the 38 retired HTTP writes one owner
and return 410 before any Catalog pointer lookup, including real branded-pool
root dispatch tests. Neither completes P13's database/background writer census.
`d60043451` closes the missing-schema production-startup bypass: two new unit
counterexamples failed before the fix, then the three selected runtime files
passed 25 tests. Actual restricted-login process negatives are recorded above.

The actual API/worker startup callback, current-state producer, P12/P13 effects,
post-retirement report/approval chain and full controller remain internal work.
S6 Binding/Value tenancy permissions are a separate bounded decision, not part
of reader 0140. Real backup authorization/materials, enterprise CA/network,
Policy #815 and production approval remain distinct external dependencies.
No real-data-copy, enterprise build, browser/capacity acceptance or production
execution is established by this checkpoint. PR remains Draft; M2 is incomplete.

## Historical PR #824 follow-up, 2026-09-07

Code `11d8147a5accf08867bfaf792346af0d555b1d05`, tree
`570163372b9b8e1cdae5a6880262d66ae0fde408`, parent report `7fabeb8c4`.
Worker initialization now closes the admitted pool and emits a static refusal
on downstream initialization failure, including cleanup failure. Original login
and runtime-pin refusals remain outside this handler and are preserved.

Two lifecycle counterexamples failed before the fix (private diagnostic escaped).
Final focused command: `./node_modules/.bin/vitest run --config
vitest.runtime-bootstrap.config.ts server/modules/logs/workerRunnerBootstrap.test.ts
server/modules/logs/workerRunner.test.ts`: exit 0, 2 files, 15 collected/passed,
0 failed/skipped/filtered. These are lifecycle unit tests, not real startup
acceptance. `npm run build` passed on the same production code before the final
test-only assertion addition; existing chunk/externalization warnings remain.
Documentation governance passed. The schema-document DB check and full new
scripts/server/contract/boundary/browser/capacity/PG batches were not run for this
slice. Independent Standards and Spec reviews passed only this lifecycle slice;
neither attests the entire PR or M2.

Hosted run `34067803219`, head `7fabeb8c4`, actually checked out
`51ec49131ea542d499607021c20012ad1b39266c` (merge-ref onto `cda6737a8`).
Scripts: 114 files, 1467 collected: 1427 passed, 1 failed, 39 skipped. The sole
failure is `scripts/run-restore-drill.test.ts`: the S11-RP production-token guard
matches `pg_restore` in `ops/self-hosted/storage/controlledRecovery.docker.ts`.
It is not the historical source-lock timeout. The same selector on local base
passed 1 with 12 filtered; candidate failed 1 with 12 filtered. Both use Node
22.22.3/npm 10.9.8/Vitest 4.1.5; Hosted uses Node 22.23.2. Boundary/bridge/backend/
contract/log-eval steps following scripts were skipped. Acceptance quality/smoke
jobs succeeded in that historical run, without proving production startup.

Raw CI-log SHA256: `7e01dcbdd93b9cae2e21c559146b1f9b2bfcadfe36cbf6964d8f2021ff3fc115`.
Candidate selector: `87ce9486226ae219a6dd23586c4c61c2c2b999a61f58c8a5c707ef60f521acd2`.
Base selector: `698920a886a67deab69d33617d3e22cc12d81425ce81e8582143eea757e68143`.
Raw logs remain private; these hashes do not assert public log availability.

Milestones A/B/C remain incomplete: no CI fix by scan relaxation; no real root
startup adapter/positive process acceptance; no complete controller upgrade.
Runtime read capability and restore-execution ownership need explicit contract
decisions. Current-state/P12/P13/report producers remain internal implementation
gaps, not missing production authorization. No new Docker/PG/real backup/
enterprise-network/production execution or approval occurred.

## Continuation checkpoint, 2026-09-07

Code `df644163e28d0aaa11733b9b08f398ac7d2429e4`, tree
`4690333c6d62a9c613b344d9616c473c92bcc0e9`; later report-only changes are
limited to the existing six bilingual plan/operator/evidence files. Refreshed
origin/main is still `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`.
Source deployment remains `82344044b436a8dafecefbb85dfd724cecb05e3f`, with the
supplied historical image ID recorded below, not the locally rebuilt image.
No candidate PR, Hosted checkout/job, merge-ref, merge SHA or production operation
exists at this checkpoint. M1 remains Scratch over its recorded full-scripts
failure; M2 is incomplete. A component success is not a full upgrade or approval.

Implemented since report `1190ba591`: durable target-scoped Binding and management
attempts in the existing journal; actual host-lock liveness; fail-closed fsync and
cross-run admission; stopped-source handoff observations; complete old public
projection with immutable migration inventory; controlled management migrations
and checkpoints; candidate/run/plan-bound P4 receipt consumption on resume/no-op;
physical structure/privilege continuity; and package-only PG16/MinIO/AOF recovery
for two bootstrap profiles. Key fixes are `b91c98a31`, `45e2d07cd`, `bbefbfc25`,
`0a88f831b`, `273e0b26e`, `4f3f1485c`, `aa47072bc` and `a77e0ea6a`.

| Actual execution (local time UTC+8) | Result and scope |
| --- | --- |
| `df644163e`, 00:28:33, real PG16 Alpine component terminal entry | 9 files, 92 collected/passed, 0 failed/skipped, 71.88s, exit 0; source schema, canonical Binding component, P4, Archive and structure tests |
| `df644163e`, 00:28:29, runtime bootstrap configuration | 10 files, 96 collected/passed, 0 failed/skipped, 9.57s, exit 0; includes 7 real restricted-login/checkpoint cases on a new owned network/volume |
| `df644163e`, build | exit 0; original externalization/chunk warnings retained |
| `df644163e`, final CLI/gate/Compose | 63 collected/passed, 0 failed/skipped, exit 0; actual old seven-line gate/new CLI, not full old controller success |
| `df644163e`, boundary / contract / selfhost / docs | all exit 0; 3509 boundary matches, no unallowlisted/stale/growth/mismatch; docs uses an explicit owned PG receipt |
| `0a88f831b` plus source-test WIP, 00:03:00, controlled recovery | 3 files, 42 collected/passed, 0 failed/skipped, 217.28s, exit 0; both bootstrap identities, source MinIO version, AOF and package-only restore; recovery code blobs unchanged through final code |
| `273e0b26e` plus parent integration WIP, 00:21:57, management/controller journals | 4 files, 67 collected/passed, 0 failed/skipped, 2.75s, exit 0; included in `4f3f1485c`, not relabeled as execution at that commit |
| `aa47072bc`, 00:23:32, PG16 matrix before system-privilege extension | 9 files, 89 collected/passed, 0 failed/skipped, 68.13s, exit 0 |
| `aa47072bc` plus 3 new privilege counterexamples, 00:25:48 | 3 failed, 20 selector-filtered, exit 1: parameter SET, builtin EXECUTE and privileged settings did not change the receipt |
| Same working change after fix, 00:26:11, committed as `a77e0ea6a` | 23 collected/passed, 0 failed/skipped, 1.04s, exit 0; real PostgreSQL, unchanged thresholds |
| `27946d016` plus parent P4 WIP, 00:20:06 | 1 failed, 6 selector-filtered, exit 1: expired P4 admitted resume |
| Same P4 test, cloned-input fix temporarily omitted, 00:21 | 1 failed, 6 selector-filtered, exit 1: caller mutation affected P4 after an await |
| Same working change after fixes, 00:21 | 7 collected/passed, 0 failed/skipped, exit 0; actual S7/checkpoint/Archive dispatch with an explicitly synthetic receipt port, not a report |
| `f5797479b` plus corrected controller counterexamples, 00:09:01 | original code: 2 failed, 15 selector-filtered; fix: 49 collected/passed, 0 failed/skipped, 2.64s; real journal and host lock, owner spies only |

Failures are retained rather than hidden: the first recovery invocation selected
nonexistent paths and collected zero tests (exit 0 from passWithNoTests), so it is
not a pass; the correct storage paths produced the 42-test result. New controller
tests first failed fixture setup because they requested Binding scope for a
non-Binding harness; corrected tests then reproduced actual replay admission.
The first structure batch had 67 passed/2 failed (one typed-reason integration
mismatch and one earlier controller refusal invalidating an old late-refusal
assertion). The next PG16 batch had 88 passed/1 failed: cloning an absent Archive
key preempted the required typed admission error. `aa47072bc` fixes the input
ordering without weakening the assertion. Typecheck also found two union-spread
errors in managementJournal, fixed before the final build.

Earlier on 2026-09-06, directly routing the pgvector-only fixture to Alpine caused
7 file setup failures, 7 pure tests passed and 60 skipped, not migration failure
or a pass. The extra owned Alpine fixture was then implemented without relaxing
the Catalog lane. Earlier tool-transcript-only executions (lock Red/Green,
partial migration, source projection and recovery evolution) retain their own
identities; missing original log files are not reconstructed as raw logs.

The final matrix uses Docker Desktop with independently verified daemon identity,
fresh owned databases/roles/volumes/networks and `linux/arm64` PG16 image ID
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
Node 22.22.3, npm 10.9.8, Vitest 4.1.5, TypeScript 5.9.3 were used. The full old
126-file migration inventory and 11-file 0129–0139 suffix are checksum checked;
0140 remains outside the candidate. Source/bundle/mapping/receipt pins are
generated by component fixtures and are not production or runtime/public report
pins. Temporary test resources are removed only after ownership checks. Public
delivery logs redact private paths/credentials/host identity and include hashes.

Independent delta reviews closed the original search-path/source-schema findings,
cross-run admission, mutable P4 input and system-privilege continuity findings.
They are bounded Standards/Spec/security observations, not an overall seal.
P4 structural continuity does not replace Release Verification; continued writer
isolation must come from the root-owned real boundary, not a supplied boolean.

Remaining internal work belongs to the parent: complete terminal handoff and
P2/P3 composition, explicit unknown-outcome reconciliation, all consumer-family
conversion/oracles, P12/P13 and fresh full report lineage, real API/worker pool
startup plus browser/business/growth acceptance. No full M2 scripts/server/UI or
Hosted batch ran. Policy #815 still has no accepted authoritative counting or
staged unavailable contract. The separately backed-up 0140 proposal adds two
governance EXECUTE capabilities and is not approved or integrated. Authorized
real backup and enterprise CA/network evidence remain absent. Production
maintenance is not ready; no production upgrade command is supplied.

## M1 continuation, 2026-09-06

Development base remains `67d4a77325b6009b77c2373bd788298a6d022bcf`.
M1 implementation `9453cf442b40fe1e90dc4ffb948e7b31898568eb` removes two
unused legacy imports and the expression that evaluated, but did not call, the
verifier. The imported verification module has no required initialization effect;
the other unused import was already erased by the CLI transform. Both legacy
modules remain available to their actual consumers. Exactly four retired S12-OPS
allowances were removed. The historical 3519-entry fixture, trusted base and all
23 reviewed relocation pairs remain unchanged. Reintroducing any removed
occurrence is a permanent negative test.

`ffc2404986918466c672450d9628834bdf899b18` (tree
`e62f9239f4d1c207d2269951417915d87afce9fb`) adds the corresponding exact
four-ID deletion assertions to the relocation regression. Independent full M1
Standards and Spec reviews passed at `9453cf442`; independent delta review passed
for the later assertion change. This is protective interception, not populated
upgrade support. No PR or Hosted execution has occurred at this recording point.

| Exact execution | Result |
| --- | --- |
| Inherited boundary Red | 1 failed, 23 selector-filtered |
| Retired module load Red | 1 failed, 0 skipped |
| `9453cf442` full focused set | 13 files, 291 passed, 0 failed/skipped, 181.69s |
| `9453cf442` build | exit 0; existing build warnings retained |
| `9453cf442` boundary CLI | 3509 matched; 0 unallowlisted/stale/growth/mismatch; 23 relocations; exit 0 |
| `9453cf442` full scripts | 104 files; 1299 passed, 3 failed, 5 skipped; exit 1; 452.82s |
| `9453cf442` plus exact assertion delta, bounded relocation/source-lock | 37 passed, 0 failed/skipped; exit 0; 69.40s |
| `ffc240498` contract / selfhost | both exit 0 |
| `ffc240498` final full scripts | 104 files; 1301 passed, 1 failed, 5 skipped; exit 1; 356.29s |
| `67d4a7732` then `ffc240498`, same source-lock command, serial comparison | each 4 passed, 0 failed/skipped; 44.76s / 59.27s; no timeout change |

Two full-scripts failures were the old 3513/6 count assertions, fixed by the
explicit four-ID delta. The other was source-lock timeout at the unchanged 60s
limit. The candidate adds only 15 estimated Git subprocesses to about 4865 on
base, so commit growth does not explain a large slowdown. The test itself is
source-locked; neither it nor its timeout was changed. The passing bounded rerun
does not rewrite the full batch. The final full batch still timed out in the
same source-lock case. M1 therefore remains Scratch; no PR is opened over a
failed required command. A separate runner/source-lock performance decision is
needed before another full run; no more identical retries are planned. Five skips
are not passes. Earlier 17 failures below remain their
original execution: 15 target routing failures and two timeouts, including a setup
timeout that filtered later tests. The correctly routed current full batch is
separate evidence, not a relabeling of that run.

The dedicated local PostgreSQL fixture used a newly owned Docker Desktop cluster,
`pgvector/pgvector:pg16`, database `wiseeff_lane_734`, private random credentials
and explicit container identity. It was not the shared Compose application DB.
The original-schema regression separately owns `postgres:16-alpine` containers.
No production host was contacted. The M1 full-file package is now available on
the [delivery backup branch](https://github.com/tzrea1-Q/WiseEff/blob/codex/populated-upgrade-delivery-20260906/m1-full-files.zip).
It contains all 33 changed files at report head
`a9a8858ab713cfca5bc605d35e04fbfd602acaa6`, a diff, manifest and selected logs.
The uploaded package was downloaded again and verified: SHA256
`43d254419c11d1aa0cec79fadbd06ec4ac8cd549aaa4cbba53721515b78d010c`.
This is a source/evidence backup, not a release artifact or PR approval.

## M2 continuation, 2026-09-06

Final code candidate: `21f5aa4a8bdbb7208504396bce62796cf55875da`, tree
`abcaeb43726145608d0a80edd5b5cdc52724fbee`. The later report commit changes only
the six existing bilingual plan/operator/evidence files. Current integration base
is `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`. GitHub PR and Actions queries at
this checkpoint returned no candidate PR and no branch run; there is no CI
checkout, merge-ref or merge SHA. Full M2 scripts/server, API/browser and capacity
acceptance remain not run. The M1 full-scripts failure is recorded separately above.

Parent integration uses the same development base. The following executions keep
their original code identities; cherry-picking or a later documentation commit
does not turn them into tests run at the integration head.

Later origin/main `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74` contains only
documentation PR #823. Parent appended merge `7218a43dcd5402d52b5e57166b746d0c6409642f`;
the original base and all earlier test identities remain unchanged.

| Exact code / boundary | Actual result |
| --- | --- |
| `fa7ee0bc6c7e94e26c9d34663b1f4cc9e8c277d2`, build | exit 0, existing externalization/chunk warnings retained |
| Same head, boundary CLI with unchanged trusted base | exit 0, 3509 matched; 0 unallowlisted/stale/growth/mismatch |
| `6b817a48e41a2ae14355575f7a832e840531a018`, S6 receipt consumer + Archive | parent execution 19:06:43, 2 files, 12 passed, 0 failed/skipped, 2.93s; 5 real isolated PostgreSQL cases |
| `06ef19e2cab84cdfb375b00fe7fe28d286027db3`, handoff | parent execution 19:07:42, 4 passed, 0 failed/skipped, 30.99s; earlier 3 passed/1 timeout batch is retained separately |
| `1173071bd` plus NODE_ENV regression before fix | 1 passed/1 failed: private API env changed effective NODE_ENV to development |
| Same working change after Compose fix, included in `90f555b96` | actual Compose config, 2 passed, 0 failed/skipped; no application startup asserted |
| `90f555b96`, handoff rejects conflicting runtime mode | parent execution 19:13:02, 4 passed, 0 failed/skipped, 37.62s |
| Separate unapproved runtime proposal `cac99fba82ec4f6349afed4d27c7d642fd0064ff` | technical evaluation 8 files, 67 passed, 0 failed/skipped, including 11 real PG cases; later config-only `56a838eaa` was not re-tested as a full batch |
| `cd2598d13`, recovery package v2 + actual three-store recovery | 2 files, 28 passed, 0 failed/skipped, 71.70s; source MinIO version, AOF, separate restore process, explicit role inheritance and three restore faults |
| `7695ace6f`, management CLI regressions | 14 passed, 0 failed/skipped, 749ms; includes real CLI input refusal |
| `9ce8db341`, actual management CLI on fresh owned PG | exit 0; 137 migrations, four checkpoint tables, production mode without runtime secrets |
| `7695ace6f` plus guarded configuration, before `1fda481ea` commit | S6 + Archive 12 passed, 0 failed/skipped; missing-receipt CLI exits 1 before collection |
| `9ce8db341`, test target URI counterexamples | 2 passed, 0 failed/skipped; query host/port/sslkey and hash refused before Docker calls |
| `9ce8db341`, boundary | exit 0, 3509 matched, 0 unallowlisted/stale/growth/mismatch |
| `7218a43dc`, build after narrowed parser type and latest-main integration | exit 0, existing chunk/externalization warnings; resolves the earlier typecheck error |
| `23e7540a7`, recovery non-dump capability regressions | 2 files, 34 passed, 0 failed/skipped, 99.69s; five capability faults preserve source before owned-fixture cleanup |
| `b5c67723c`, database settings recovery refusal | 2 files, 35 passed, 0 failed/skipped, 117.42s; the refused source setting still applies on a new connection |
| `42b906033` plus runner changes committed as `b5c67723c` | 3 files, 25 passed, 0 failed/skipped, 828ms; CLI/receipt/migration and real child termination; no Docker in this batch |
| `e73d48419` plus component runner | 6 files, 42 passed, 4 failed, 0 skipped, 8.78s; four producer cases fail on real restricted source-table permissions |
| `4c60f1bcc`, original build | exit 134, TypeScript 1 GiB heap exhausted |
| Fixed `7218a43dc` and `42b906033` plus runner, serial cold `tsc -b --force` | same 1 GiB limit: base exit 0, candidate exit 134; separate Node checks both exit 0, reported memory 938938K / 941585K |
| `ce9915f23`, build with separate project processes | exit 0; both original TypeScript projects and Vite retained, same per-process heap limits and existing Vite warnings |
| `17647b243`, actual component terminal entry | 6 files, 48 passed, 0 failed/skipped, 8.99s; real producer and restricted import after source-pool separation |
| `198054e1b`, same entry with unknown source rollback | 6 files, 49 passed, 0 failed/skipped, 8.70s; destroys the real connection after response-loss injection |
| `1635060c3`, journal admission counterexample | 49 passed, 1 test timeout, 0 skipped; the test held its sole pool connection while requesting another |
| `21f5aa4a8`, journal admission with separate limited login session | 6 files, 50 passed, 0 failed/skipped, 8.53s; missing journal, pending and unknown stop before phase actions; timeout unchanged |
| `21f5aa4a8`, final code build | exit 0, existing Vite warnings retained |
| `21f5aa4a8`, final CLI/gate/Compose set | 6 files, 63 passed, 0 failed/skipped, 3.05s; includes the exact old gate/new CLI subprocess |
| `21f5aa4a8`, boundary / contract / selfhost | all exit 0; 3509 matched, no unallowlisted/stale/growth/mismatch |

The component runner's first three attempts stopped before collection because
Docker Desktop did not publish its internal-network port. These remain failures.
Its owned bridge now publishes loopback only and disables IP masquerading. Only
PostgreSQL runs there; application egress isolation is unproven. Unknown suites,
including inherited object properties, are refused before Docker use. Execution
has a 15-minute bound, TERM/KILL escalation and an 8 MiB raw output limit. Exact
resource ownership is checked before cleanup.

Independent review found database-level settings outside both the dump and the
role inventory. `42b906033` rejects them, and missing inventory fields, before
export; it does not reset or guess restoration. Recovery remains a declared
PostgreSQL 16/bootstrap `postgres` synthetic profile, not whole-business or
production `wiseeff` role restoration. The separate terminal run at `23e7540a7`
returned source-stopped, AOF, package-only restore and cleanup proof with
`fullBusinessVerification=false` and `releaseReady=false`.

Node typecheck at `9ce8db341` caught one widened checkpoint-mode return type in
the new management parser. `842010159` adds an explicit narrowed return type;
the earlier real CLI execution is retained at its actual SHA, and typecheck
failure is not omitted or called a base failure. Two exploratory invocations used
nonexistent/wrong configuration flags and stopped with usage/configuration errors;
they did not collect tests or access a database.

The S6 test constructs the exact old schema, imports two projects sharing one
Definition, preserves four value IDs/timestamps and independent explicit tips,
and reads revision history through the existing domain reader. JSON null and SQL
null remain distinct in encrypted source Archive evidence. SQL-null project values
are currently refused instead of being guessed. This is canonical conversion at
the management receipt consumer, beyond old-table preservation. Its P0/P8 receipts
were synthetic management fixtures, not a full producer or report approval chain.
The real producer must fix P0 intent before random P7 mapping/Archive IDs exist;
the later receipt must bind those produced IDs without rewriting P0.

The later producer now implements that bounded chain: deterministic full Binding
intent, exact live P7 heads, encrypted Definition evidence, real automatic
registration, generated v2 receipt, then same-transaction S6 import/checkpoint.
Three synthetic Bindings across projects share two Definitions and preserve six
values with independently asserted tips/history. Source reads use a separate
controlled management connection and 21 real SHARE locks; canonical writes retain
the limited management login and unchanged frozen grants. This is beyond merely
preserving public rows. Early P0/P7 setup is still fixture preparation, not a full
root execution or verifier-produced report chain. Other consumer families,
SQL-null value conversion, HTTP/browser and runtime business coverage remain open.

Independent review found and the follow-up code fixed stale phase rollback and
unknown-commit admission at the consumer seam. Pending/unknown controller-journal
attempts now block ordinary execute; a missing journal/boundary adapter blocks
before writes. The concrete root adapter and explicit reconciliation are still
missing. The source rollback-response loss fix destroys the session rather than
returning it to a pool. Reviews and these negatives do not establish a successful
P0–P16 run.

Handoff tests query real PostgreSQL/MinIO/Redis identities and exercise the existing
controller's inspect dispatch, host lock, private file descriptors and drift
refusals. Their application containers are explicitly identity stubs. They do not
prove full old-application controller execution, successful candidate startup or
phase-aware resume after services have stopped.

The runtime proposal is available on
[its separate backup branch](https://github.com/tzrea1-Q/WiseEff/tree/codex/populated-upgrade-runtime-proposal).
It does not grant broad Catalog/audit SELECT to the governance writer. Nevertheless,
its two new writer EXECUTE grants extend the frozen 0138 manifest and remain
unapproved. Migration 0140 is absent from the executable integration candidate.
The production startup callback still lacks a live runtime-pin state producer;
normal business role coverage, isolated API/browser acceptance and capacity remain
unfinished. Parent retains implementation responsibility for these gaps.

### Reconstructed source image

The parent built the exact source SHA `82344044b436a8dafecefbb85dfd724cecb05e3f`
from clean tree `6dd92c36c4eb41bcaaba5a7a756befb9239d9120`, using its original
Dockerfile and existing build-network library with TLS verification. The actual
local Docker image ID is
`sha256:65b300d1a8b80c06b9f7b37ccc21e45973d875492f2ae60f0128937cc934dea1`,
platform `linux/arm64`. BuildKit's image manifest is
`sha256:40ef0227106e6ad85e2c0d286bdeb4dddb472b6e3ff66c6e746a6dc28db93c9c`;
its config digest is
`sha256:2a0d17d6a8c2c7815d1ffe35ff94a4be03fcb2d8e4432c7bd3774f2d9a0fa12b`.
The lockfile SHA256 is
`43adbfe23117426588694bbd209eb96997d3a73287da475a2a2d4dfab29050ea`.
The build exited 0; log SHA256
`220821b090936a637118d9dbddf576c774827d74157c77ec8f3870fda5eca25e`.
This is a retained local reconstruction, not the user's historical image ID,
registry publication, final candidate build or corporate-network trust evidence.

### Execution safety deviations

Three local test invocations violated the explicit target-routing discipline.
Two agents invoked server global setup without the dedicated URL; the setup
reached the default/shared development database and migration-ledger bootstrap
DDL before refusing missing historical ledger entries. No numbered migration loop
ran in those failed calls. Earlier template setup returned; its reuse/create
effects were not fully observed, so zero writes cannot be claimed. The original
complete logs were not preserved and no checksum is invented. A separate bare
docs check queried extension availability on the default database, then skipped
schema generation because vector was unavailable; this call did not run migrations.
No production host was connected. The parent stopped all agent execution authority;
subsequent DB/Docker/tests run centrally with explicit owned target identities.
No repair or cleanup was attempted on the unverified ambient targets. These
deviations are not passing regression evidence and remain in this record.

M2 full root success, complete business restoration, real backup rehearsal,
enterprise-network candidate build, Hosted checkout/jobs and production actions
remain **not run / incomplete**. No production upgrade command or maintenance
readiness is authorized by these component results.

## Prior-round identity and status (historical)

Collected 2026-09-06, local isolated development only. Source deployment remains `82344044b436a8dafecefbb85dfd724cecb05e3f`; supplied historical image ID is `sha256:be121540c40fbb35e774b48cefb29b7ddf27d1bb8aa0c050a17acca3b7dfbf6c`, not a registry manifest or a newly verified image. Initial development base was `1c9fa56e3eaca6e7984f35a097876772a6e4025d`. Final refresh base is `67d4a77325b6009b77c2373bd788298a6d022bcf`; its advancement is documentation-only PR #822.

Code candidate: `b2c150d18bb6d7a8d8d5b45bcbf9f683fdafecbf`, tree `b8eb49d3a074e00196fb89c30ba4d1cae3677b3c`, branch `codex/populated-upgrade-candidate`. All 27 task blobs match the preserved earlier Scratch `d357a5e6538f4bac4d63ba782ce13f75fe1cf194`. This evidence document is a later report-only change, not a relabeling of executions. No CI checkout, merge-ref, final merge SHA, release bundle/pin, mapping/source freeze, or approved real target exists for this candidate.

| Outcome | State |
| --- | --- |
| UPG-01 missing-context refusal | Implemented and real CLI regression demonstrated |
| Complete upgrade code delivery | Incomplete; boundary regression and release integrations remain |
| Synthetic populated | Schema additions preserved old Binding/revision rows; canonical business conversion was not demonstrated |
| Authorized real backup rehearsal | Not run; no backup supplied and intake adapter incomplete |
| Actual recovery | Synthetic three-store sentinel restore executed and verified; full business/real recovery unproven |
| Hosted / PR | Not run / not opened; Scratch is not integration-ready |
| Production maintenance readiness | No |
| Production execution / approval | Not authorized, not executed |

## Regressions and commands

On initial base with a real isolated PostgreSQL fixture, `npm run parameter-definitions:check -- --catalog-only` returned exit 0 with typed `absent/missing`. On `8922b3884573bd5d7c3c3f2efce53f3f51d6b894` it returned exit 2 and `PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE`; explicit `--verify --diagnostic --report-id missing` still returned typed absence with exit 0. The actual seven-line source controller gate fixture matches source Git bytes (SHA256 `29c28f2b5951bf4650984ec1be07ac121b8bb61c07e29388f70b7848e8952232`). Its subprocess regression uses the real npm/CLI and a Docker transport adapter; it is not a full old-controller Compose proof. New ordinary-stack apply/no-op/resume/recover-candidate refuse unsupported canonical targets. A usable production handoff is still missing.

Local tools: Node 22.22.3, npm 10.9.8, Vitest 4.1.5, Docker 29.5.3. New original-schema tests use isolated `postgres:16-alpine`; the dedicated verifier fixture uses pgvector PostgreSQL 16. Migration inventory is 126 original files plus 11 candidate suffix files 0129–0139, complete filename/checksum validation. This does not establish production extension compatibility or application startup readiness.

| Exact code | Check | Result |
| --- | --- | --- |
| 8922b3884 | 11 focused script files, real Docker flags enabled | 266 passed, 0 failed/skipped; exit 0 |
| 8922b3884 | Full scripts | 103 files: 99 passed/4 failed; 1306 tests: 1251 passed/17 failed/38 skipped; exit 1 |
| d357a5e65 | CLI plus boundary after restoring inherited inventory | 42 tests: 41 passed/1 failed; exit 1; prior Scratch parent shrink rejected restoration |
| 1c9fa56e3 and d357a5e65 separately | Serial exactRelocation/source-lock, original timeout limits | Each 37 passed, 0 failed/skipped; exit 0; 53.98s and 60.40s |
| Same two SHAs separately | One real zero-inventory export/import/rollback selector with matched isolated URL/container | Each 1 passed, 80 selector-filtered; exit 0; other failed scenarios not rerun |
| b2c150d18 | 12 focused files, both Docker flags, `--maxWorkers=1` | 290 collected: 289 passed/1 failed/0 skipped; exit 1; 83.94s |
| b2c150d18 | Boundary CLI with trusted base 9b3ba7df7e21f5589684bc92c872da593ad4c246 | 3513 violations: 3512 matched, 1 unallowlisted/1 stale, 0 growth/mismatch; exit 1 |
| b2c150d18 | npm run build | exit 0; existing Node externalization/chunk warnings retained |
| d357a5e65 | contract:check / selfhost:check | Both passed |
| 8922b3884 | docs:check with dedicated PostgreSQL | Governance and schema artifact passed |
| 2e40a8b3d | Report and role server integration files | 31 passed, 0 failed/skipped; not a full server suite |

The remaining boundary failure is this candidate's responsibility: the retained legacy verifier reference moved and no longer binds its frozen occurrence. No assertions, checker limits, or allowance IDs were changed to hide it. Original full-suite failures also include 15 database/container routing failures and two timeouts (33 tests skipped after setup timeout). Bounded same-environment comparisons support routing/load attribution but do not turn that full batch green. Full frontend/server suites, browser business acceptance, growth capacity, complete consumer oracle, enterprise-network image builds and Hosted were not run.

Logs and exact full-file hashes are included in the local delivery archive, under `evidence/` and `manifest.json`. They retain their original execution SHAs; synthetic credentials and host paths are not production evidence. No private backup or business values are included.

## Remaining work and ownership

The [frozen relocation contract](../../docs/agents/catalog-boundary-relocation.md) explicitly forbids padding source to retain identities. Independent Standards review rejected that option. The minimal boundary decision is a separately reviewed exact mapping for this unchanged occurrence (full blobs, spans, raw bytes and adversarial coverage), or debt removal under its owning contract. The existing 23-pair authorization does not approve this new mapping.

Parent implementation owner must resolve the occurrence regression without loosening the frozen boundary. Release integration owner must supply approved P12/P13 ownership, post-retirement full verification, runtime/public-release wiring and fixed-identity handoff. Runtime security owner must implement actual role/pool migration and business acceptance; the new inspector does not change credentials. Recovery owner must implement authorized backup intake, same-boundary snapshots and target-bound full restore. Product owner must resolve #815 authoritative Policy references or explicitly approve unavailable. Build operator must provide enterprise CA and actual trusted image provenance. Data owner must authorize a real backup. Acceptance owner must complete full semantics/browser/capacity. Production authorization remains separate.

Independent Standards review passed the bounded code and verified all 27 refreshed blobs. Independent Spec review accepted only the bounded helpers and explicitly found the complete request unmet. The earlier Docker ambient-target P1 was fixed with pinned local endpoint/daemon identity checks. No overall seal, release approval, or OP-09 closure is claimed. Follow the [terminal guide](populated-upgrade.md); it deliberately provides no production upgrade command.
