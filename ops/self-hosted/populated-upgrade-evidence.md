# Populated upgrade candidate evidence

> Chinese: [Chinese](populated-upgrade-evidence.zh-CN.md)

## Current continuation checkpoint, 2026-09-07

This section supersedes earlier current-state statements about exhausted review
resources and unintegrated P12/journal work. Historical execution identities below
remain unchanged. Development base is `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`;
the production source remains `82344044b436a8dafecefbb85dfd724cecb05e3f`.

Hosted run [34104402409](https://github.com/tzrea1-Q/WiseEff/actions/runs/34104402409)
completed successfully on merge checkout `155ffd1692cf4392e11b6d1f705b18cb40c7c149`
for report head `39d5b125d9dd64df44d95e9fb2328a51a0bd3d14`. Scripts were
1657 collected/1616 passed/0 failed/41 skipped; backend 4180/4169/0/11.
Boundary, bridge, contract, log-eval, owned PostgreSQL, Acceptance smoke/quality and
Merge bar ran successfully. Local non-HDC and target-synthetic jobs skipped.
This is not Hosted evidence for the following continuation.

| Actual execution identity | Command/scope and result | Log SHA256 |
| --- | --- | --- |
| Clean `4847025983527893e21e260da55cbf32aeff8a46`, tree `3b7671516daf03d332b02c07534a061be6517b8b` | Owned `scripts-pgvector`: 1716 collected, 1690 passed, 1 failed, 25 skipped; 99.45s, exit 1, cleanup verified. Only failure: source-lock lineage case at unchanged 60000ms | `64b8245f38d2882beeb88ee12b917dad84f0dd4d2516c7090cb283a0162a10af` |
| `484702598` / base `cda6737a8`, independent clean worktrees and identical dependencies | Same source-lock one-case selector: 1 passed/0 failed/3 filtered each, 43.322s / 38.159s, exit 0. Does not overwrite the full-suite failure or establish inherited failure | candidate `28ff39f4800da4f362ac0044b12e392e21ce44ec127cab6398d4757e5b0542b1`; base `3cee9c7de9a3a1898ebf921e1c1d04e8806af119c551d8b987b4cd993d6574a6` |
| `372d1366d` plus exact owned-routing/Markdown WIP | Owned `activation-existing-pg16`: 11 collected/passed, 0 skipped, 14.84s, exit 0, cleanup verified; existing storage/readback and real S6 counterexample, not approved full P12 apply | `cc3f57a4a91ab9019fc0d22d2cddfb5ed3c725a781559baafae891dc7513710a` |
| Clean `801e0a8b31c3c7f00d861c294b0c511889a8da4f`, tree `bf0fe5ec209886b34d957faf6afc7d67f45ce0cf` | Owned `log-redis`: 9 collected/passed, 0 skipped, 2.75s, exit 0, cleanup verified. Prior assertion Red: 8 passed/1 failed, exit 1; only boolean failure output | Green `182278a3c613f5f1d2b08f572cfe3e65e2304382c9474a024a7baaa7ae27013e`; Red `62c9727c18b26a301ceb5f12f152bf284f25d0b3823d3422e8f8c451bc626e2d` |
| Clean `7d8d9567255608948d2ad8b97c68ac3839b1d688` (only operator/evidence Markdown differs from `801e0a8b3`) | Owned `server-pgvector`: 4237 collected, 4226 passed, 0 failed, 11 skipped; 179.56s, exit 0, cleanup verified. The eleven opt-in runtime bootstrap cases remain skipped | `4c5e70c0b4bdebc90d076189cc5b7954da91df365ab37471598bfc37f16fa832` |

Subsequent complete scripts execution on clean `734b10dae3f6901f46108a3b00ea775813a9ba8d`
(tree `09ce523108dcac46268204fa56355feafa235f8e`) ran the unchanged four source-lock
cases first: 4 passed, 45.61s. The ordinary scripts phase then collected 1718,
passed 1693, failed 0 and skipped 25, 102.85s. Combined on this SHA only:
1722 collected/1697 passed/0 failed/25 skipped, exit 0, owned cleanup verified.
Log `upg824-full-scripts-734.log` SHA256:
`989d50e86d4b1a0da6a055e5f91cf1d476465d738b2c19cca7872b78eca980b7`.
The serial route changes scheduling, not source-lock bytes, trusted base or the
60000ms limit; earlier timeout records remain failures on their original trees.

Clean `6be8e08ef9d3d6b1eb50ebafd16e1ef3c5d2396c`, tree
`0efb9c071ad571750798024a3a5d1558ca5fd6cb`, ran owned `docs-check`, executing
`npm run docs:check -- --require-database` against its newly owned pgvector cluster.
Documentation governance and actual generated database schema comparison passed,
exit 0, cleanup verified; no database skip occurred and the tracked artifact did
not change. Log `upg824-owned-docs-6be.log` SHA256:
`6587bcd237a80c084eef04ab08a6f0a51c860a7566e63238a675cbb518a1dd61`.
Strict mode fails on a missing dedicated URL or unavailable vector extension;
ordinary developer mode retains its explicitly reported skip behavior.

These runs use Node 22.22.3/Vitest 4.1.5 on the independently confirmed development
Docker Desktop, linux/arm64 images: Redis `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`,
PG16 Alpine `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`,
pgvector `sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`.
Image IDs are not manifest digests or the user's historical production image.

Durable source `2381aaff1`, parent API `b404b615b`, activation journal `e0ce5aa42`,
Comparison association `d21627c02` and P12 `5b945a645` received independent reviews
within their explicit component scopes. The separate runner/secret-assertion P2
was fixed in `801e0a8b3` and independently re-reviewed. Actual Redis/BullMQ evidence
uses a controlled processor, not the complete log-analysis business pipeline.
The root API/worker still do not consume a complete live startup producer.

P01's management-membership false refusal and P02's passing after role-switch
42501 were reproduced with a real SELECT-only verifier login. A bounded S6 decision
has been requested; no S6/runtime grant or Policy decision was silently changed.
P13, complete producer/report chain, root controller success, full consumer oracle,
business recovery/queue/browser/growth acceptance remain internal work. A/B are not
complete. Real backup, enterprise-network trust, Policy #815 and production approval
remain separate C dependencies; no production operation occurred. Current continuation
Hosted and final integrated review are not yet recorded as passed.

The real old-source Dockerfile was built from immutable source `82344044b`, tree
`6dd92c36c4eb41bcaaba5a7a756befb9239d9120`, using the existing build-network library
with TLS verification. Source archive SHA256 is
`08f183a7efd41c947dc7c42b35c65e06434a4e44e3d6749c3aa06672b21dec9b`;
transport fingerprint is `0d8146b81c294106f716b9aca8f616030a470eceb917803c45b3d565621f1f75`.
The resulting local linux/arm64 image ID is
`sha256:a7c1fd128b60ea545d483b285ab88d349de26a491d1e6a826a413a075cd4737d`.
This is a newly built synthetic source artifact, not the user's old production
image or a registry-published manifest. The build used six cached steps; it does
not prove fresh downloads of every dependency or enterprise-network trust.
Build exited 0; log `upg824-old-source-image-build-attempt2.log` SHA256 is
`9696f468d718952ade63b8a4e2b47ae2ee0a7f4ed9442e48d9e07b4007f7db8b`.
The first attempt stopped before Docker build on an unset optional registry shell
variable; the corrected invocation preserves the existing default registry.
No old API/worker was started by this build, and no controller upgrade was run.

## Authorized contract implementation checkpoint, 2026-09-07

### Worker integration and review environment stop

Lifecycle code is `4a0dfa1465c92e59223d98251baa12ac902f8f24`, tree
`1a598cdeee118a937dae9b22e4a542d32c32463b`; source deployment and development
base remain unchanged. `1b8b5ed24` integrates independently reviewed source
`81727d73c856024a5b5b57e67f471a7621774b69`: the worker owns its database and
listener, waits for in-flight polling work, and attempts all shutdown callbacks
before closing the pool. Admission errors remain distinct from static redacted
initialization/start/shutdown errors. Source Red was 35 passed/8 failed; fixed
source Green was 48/48. These are lifecycle and real HTTP listener tests, not
approved production startup.

`91a897cde` integrates source `321374300779554825a5b205156d456d726ff87e`:
the async durable factory cleans Queue when Worker construction fails, waits for
both close operations even if one throws, and closes once. `4a0dfa146` awaits
that factory in the actual API root; worker already awaits it. Source Red was
53 passed/3 failed. Parent execution on `91a897cde` plus that one-line API WIP
(the code committed as 4a0dfa146) passed **56/56**, 475ms, exit 0; build exited
0, Vite 9.90s with existing warnings. The final durable increment has parent
inspection but its separate independent Standards/Spec reviews are **not complete**:
both review agents hit the account usage limit. It remains Scratch, not sealed.

At `1b8b5ed24` plus Markdown-only WIP, the owned Docker runtime bootstrap selector
passed **11/11**, 7.03s, exit 0. Four cases launch the actual API/worker production
entrypoints with actual PostgreSQL logins: superuser and missing Catalog are
refused before listener/consumer construction; credentials are absent from output.
Other cases cover actual restricted sessions, checkpoint management and checkout
failures. This is real negative-root evidence, **not** legal runtime-pin startup.
The latest whole-backend batch remains the separate d7cdd6473 execution below.

Log SHA256: parent lifecycle
`5f9a66067dd337ac84e015b4269112cb9e94b15e9801c1bbff0be5bd6a849381`;
build `47cd1820b576af495ca925f1d81b905c2ad2267aea9c7408a96cc90661657be7`;
actual runtime roots `9d997d65546a1e251bf25f3747346df84b12666c8628308db87fa846da84597b`.
Boundary again exited 0, matched 3509 with zero unallowlisted/stale/mismatch/growth;
contract and selfhost checks exited 0 on 4a0dfa146 with Markdown-only WIP.

Existing-schema P12 work is preserved separately, **not integrated or verified**:
`codex/pr824-activation-existing-storage` at `b7337f5d11624b287c7615cde36ee38c39b81399`
and `codex/upg-activation-journal` at `2375dad8b458ed60649ce1e082ab3fd30bfd4f9c`.
Both started from d7cdd6473. The quota interruption left domain effects, readback,
root composition and independent review unfinished. No new table/grant is assumed;
the earlier three-table prototype is still excluded. This remaining implementation
is owned by the parent, not attributed to missing production authorization.

`1c279310b62ae1a13466aa99602e0b7575ec4a65` (tree
`49982aab037d1a166ef42291c95bd2d97ef5aae7`) adds the two worker files to the
existing bootstrap test config so the lifecycle command is reproducible without
a temporary config or ambient database. Before that config-only commit, the
same code/config WIP passed **56/56**, 549ms, exit 0. Complete owned scripts at
4a0dfa146 plus Markdown-only WIP started 17:00:51 and finished before the config
edit: **1657 collected, 1631 passed, 1 failed, 25 skipped**, 120 files passed/1
failed/1 skipped, 124.89s, exit 1, owned cleanup verified. The only failure is the
unchanged source-lock 60000ms lineage case; no assertion, timeout or baseline was
relaxed. This is not a passing full suite. Scripts log SHA256
`eeaffb65b36bc4a6659bb307190aa706774624450a55d485da156f131adf92f3`;
repository-config lifecycle log
`390c7811a472f4e5148f6b62a5af3a39f8d7c2ed465ba9b4e82b55fad797e725`.

Complete owned backend at 1c279310b with only the six Markdown delivery files
dirty started 17:04:05: **4180 collected, 4169 passed, 0 failed, 11 skipped**,
517 files passed/1 skipped, 245.30s, exit 0, owned cleanup verified. It uses the
same separately identified linux/arm64 pgvector image as d7cdd6473. The opt-in
runtime bootstrap 11 remain skipped in this batch; the earlier actual 11/11 is
not relabeled. No production startup or full old deployment conversion follows
from this backend result. A new Hosted run has not yet completed at this checkpoint.

### Hosted cancellation and attributed CI repairs

Run [34097926621](https://github.com/tzrea1-Q/WiseEff/actions/runs/34097926621)
used report head `2ce71d683f1cd3e51b657f45aafaabc34d3dd5f2` and actual merge
checkout `41f592f9214549d142daa978df9a6c3d81089315`, against base `cda6737a8`.
Build and test reached its existing 20-minute job deadline and was cancelled;
Merge bar failed. This is a new execution, not the historical S11-RP failure.

| Hosted scope | Observed result |
| --- | --- |
| Build, documentation governance, UI ratchet, lint | Steps passed |
| Frontend | 3374 passed, 438 files |
| Scripts | 1656 collected: 1615 passed, 0 failed, 41 skipped; 121 files passed/1 skipped |
| Boundary / device bridge | Both steps passed |
| Backend | Cancelled without final totals; 516 passing file summaries, runtimeConnection 11 skipped, runtimeState beforeAll failure with 7 skipped; sensitiveNode identity file had no terminal summary |
| Contract / log-eval | Not executed after cancellation |
| Owned PG16 reader / report / authority | 49/49, 36/36, 81/81, each with owned cleanup; linux/amd64 PG16 Alpine image `sha256:75f5a96988cdf694a215073c3e9c001b706b371e2f94df3967f2efdec2787f6b` |
| Acceptance smoke / quality | 4/4 and 100/100; existing fixture acceptance, not production startup or full populated conversion |
| Target synthetic / local non-HDC | Both jobs skipped by workflow conditions |

The 41 script skips are the 16-case environment-dependent rehearsal, four opt-in
Docker recovery cases, one handoff Docker case, five runtime identity cases,
five vendor schema cases and ten recovery rehearsal cases. They remain skips.

An owned local candidate/base control ran the unchanged sensitiveNode 23-case
selector at `2ce71d683` and `cda6737a8`: **23/23 in 22.05s** and **23/23 in
21.12s**. It did not reproduce the Hosted stall. Both used separate pgvector PG16
clusters, linux/arm64, one worker and 768 MiB Node heap. Independent first-case
timings attributed most cost to full migration preparation, not the resolver.
Those results do not establish linux/amd64 equivalence or blame migration 0140.

The receipt failure was independently reproduced: ambient DATABASE_URL without
the required owned target receipt collected seven runtimeState cases, skipped all
seven and failed beforeAll with `upgrade-tests-require-explicit-owned-postgres-receipt`.
Commit `4b32a98f1c9464ed8eb0648ca4aa7b6b18171ad9` moves that exact file from
ambient backend execution to the existing mandatory `bindings-pg16` job. Receipt
validation, real Docker ownership, 20-minute limit and required Merge bar remain.
Routing Red was 4 passed/1 failed; the actual owned bindings lane on precommit WIP
passed **92/92**, including runtimeState 7/7, 78.74s, exit 0 and verified cleanup.

Commit `d7cdd6473c3f37c24c99cb5a1c620c96394ce633` changes only the identity
test's setup to clone the existing migration-fingerprinted template into a fresh
database for each case. All 23 assertions and seed SQL are byte-identical;
single-client FIFO and failure cleanup remain. The clean commit (tree
`80bcf61c8b08d5c178722bde207b854ec498d893`) passed **23/23 in 3.88s**, exit 0,
cleanup verified, with original case timeouts. Routing selectors passed **19/19**
in 1.74s and build exited 0 (Vite 8.95s, existing warnings). Independent Standards
and Spec found no P1/P2 in these changes. New Hosted confirmation is still required;
this preparation improvement alone does not prove the cancellation is resolved.

Log SHA256: exact identity Green
`64bac3a333ae7c21d34064146b44e18d55d64c6eee91076c4d36ca12ea2e0afb`;
owned bindings `738326584f8fe84f613c112eecc7f7056596fb07d29d20c6e09af4b3fe0ee37e`;
routing `d189c9a64ad8a78504e91867a1733a4af2fc433fc75110a78bf8291a49e7cc4a`;
build `05588efb6c1b0bce136f7624ef551bdb9ee9376d3b999fc4b24b95d250ca47c6`.

Full owned `server-pgvector` started on clean `d7cdd6473` at 16:35:50 (the
subsequent working-tree edits were only the four plan/evidence Markdown files):
**4165 collected, 4154 passed, 0 failed, 11 skipped**, 517 files passed/1 skipped,
182.76s, exit 0 and verified cleanup. The seven runtimeState cases now belong to
the independently required bindings lane; this is an explicit routing change, not
seven new passes or a silent test removal. Local linux/arm64 pgvector image:
`sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`.
Log SHA256 `f9074e442d8fd228f8ed000a9de5385448565158249cb8a48acfd1ef07086a63`.

`ee21b3e65` additionally snapshots the release dispatcher's first live observation.
Its Red was **42 passed/1 failed**: reusing one observer object and mutating
isolation to public on the second read previously invoked P12. Green **43/43**
now rejects before every effect. These are invocation tests, not produced passing
release reports. Independent Standards/Spec passed. Green log SHA256
`645e2531982b96ed0f926ca184d42b13ba87af8c23784674b5927635439e75d5`.

### Subsequent integration through 4394ec9cb

The last subsequent code is `3ce597e21496b98b7fc3e0e575396abef46d6ce0`, tree
`6dd110761274923a946a9aca41ec95cdfeb98dfc`. Its only change after 4394 is an
eight-line actual TCP readiness probe in the opt-in recovery test fixture, with
each connection closed. The original four cases, 180-second case timeout and
single migration attempt are unchanged. This does not relabel the 4394 full suite.
At source `25414128c9de400749257dc3e2298668359e9654`, the current-lock four-case
attempt failed **0 passed/4 failed**, 45.42s, before capture/approval: the temporary
initdb socket was ready before the authentication database's actual TCP endpoint.
Owned cleanup passed. Failure log SHA256
`f36c08c3979cf58d662341ee0f238711b23961e66ef40469a41b4f0d7a712cb3`.
The corrected source is `949110778aa2d9b0f0ca72ef380c05a0434a25cb`.

That clean source (tree `7051a8fd896d439339b88848b0af6c7c2d7e2c3e`) ran all four
actual Docker cases at 15:44:09: **4 passed, 0 failed/skipped**, 534.25s, exit 0.
Each case remained below the original 180-second limit (97.957/151.282/138.602/
146.131s). Owned containers, networks and volumes were verified absent afterwards.
Log SHA256 `f94726621fbfcc46d8b4817679309e1e39bbefdc1ebc1a5a0fab3702601663ae`.
The full storage tree, capture/approval/authority/journal/handoff and Docker guard
blobs match parent `3ce597e21`; four other files differ (report-target service,
its two README files and the disposable-runtime test). This is a component source
comparison, not a claim that the parent checkout was executed by that run.
The actual test exercises capture, authenticated approval, source/auth shutdown,
independent restore, owner/ACL, object bytes/metadata and Redis AOF, plus both
nonempty-target matrices with unchanged journal bytes and no started event.
Writer placeholders and Bull-shaped keys still do not prove full application
writer isolation or actual business queue consumer recovery.

Owned `schema-doc` at parent `3ce597e21` exited 0, cleanup verified; regenerating
the pgvector-canonical schema produced no Git difference. The documentation
governance checker also exited 0. This is explicit owned generation plus comparison,
not a claim that a no-database `docs:check` skip verified migrations. Schema log
SHA256 `4575bc715ea031ca98d04223f4fccb3ff0d0c30fc9fa3f69c8f3f68939895a41`.

The independently reviewed contract scopes retain full old/new files in the
delivery archive. Each fingerprint is SHA256 of a sorted canonical JSON list of
path, mode, Git blob and file SHA256; absent old files remain explicit nulls.
These are scoped delivery fingerprints, not a reset of any frozen trusted base.
The archive manifest lists the exact eight files in each scope.

| Contract scope | Old `f00f94435` | New contract blobs through `3ce597e21` |
| --- | --- | --- |
| Reader | `9960d9bf66d09e955bd98b2ae431fb09d3f266b21ab419711df6dd2acbc403d7` | `cf87073abc4367f4debfac2037dadbd8fb17ea15e75e39bde7f1a501f3154df3` |
| Recovery | `d84482d977522e743a2757c3797010f9428050c8344fac9e2a88470eec11cf89` | `92ae6cfc5307583f242fe1e4260a8d786530ec501c65b5a079fb2bb955b63199` |

Independent Standards and Spec each found no P1/P2 in the authorized slices at
4394; the subsequent TCP-fixture change also passed separate review. Neither
review approves complete startup/controller integration or overrides test failures.

Follow-up code `4394ec9cbfd50c6ab55dd5572db8647d15edbf62`, tree
`8266327238c9af164f026067ad4c4811768adfa3`, fixes the two subsequent scripts
integration failures: the controller now consumes the formal public report
approval service (unchanged T6), and the disposable-runtime unit declares a
strict Pool mock. The old `1708e99c8` batch had **1614 passed, 2 failed,
25 skipped plus one collection failure**, exit 1. After repairs, complete
`scripts-pgvector` at 15:30:19 collected 1656: **1630 passed, 1 failed,
25 skipped**, 120 files passed/1 failed/1 skipped, 99.06s, exit 1; owned cleanup
verified. Only the frozen source-lock 60000ms lineage timeout remains. This
does not rewrite the historical Hosted S11-RP failure. No timeout, assertion,
trusted base or allowance was relaxed. Log SHA256:
`1fccb66c6500e5097082d116f7e148ced5a3bbeaf30cc986e4a850a2f676aa66`.

On that same code with only the six report/operator/plan Markdown files dirty,
`npm run build` exited 0 (Vite 10.38s, existing warnings). The real
`authority-pg16` suite at 15:35:10 passed **81/81**, 0 failed/skipped, 36.69s,
exit 0, owned cleanup verified; this also exercises the new public report-service
composition. Boundary again matched **3509**, with zero unallowlisted, stale,
mismatch or growth; contract and selfhost checks exited 0. Build log SHA256
`db03392c3dba6bcaef5e512ecb1d00b75e01c9fece3e477a4831709012ec094b`;
authority log `a051d6b4895c8d31c1575e968d818575ea82e2c901b36f70c6d7bd57ad944c03`.

The corrected actual recovery suite at source `b8378f9f4a09375c23b53093baadcb819c838599`
(integrated `21362c9d0`/`d1c60c16c`) passed **4/4**, 0 skipped, 540.64s at
15:10:05. It uses actual Docker capture, independent restricted PostgreSQL
authentication, the real approval producer, then stops source and authentication
services before a package/journal/private-target-only restore subprocess.
Both bootstrap profiles preserve owner/ACL, object bytes/metadata and Redis AOF;
both six-case nonempty-target matrices reject. Resources were removed and all
four retained private evidence markers say accepted. This is real synthetic
three-storage recovery, not a real backup, full old application controller or
Bull consumer acceptance. Log SHA256:
`70ebd6bcd2c1a791dede24aa58dd3b1c2d64acb6573af06261c24b2ced650b8f`.

`aec10a5a5def311c35616396c016906f8ddf92b9` subsequently tightens execution to
the original issued lock of the journal's exact canonical private parent.
Forged callback/wrong-root Red was **26 passed/2 failed**; ancestor-alias Red
was **1 failed/7 filtered**. Final focused execution was **79 passed/1 opt-in
Docker skipped**, TypeScript exit 0, independent Standards/Spec passed. One
intermediate test revision had a local variable shadowing error (15 failed/64
passed/1 skipped); it is not a behavior result and was repaired. `4394ec9cb`
adds real journal-byte/no-start checks to each nonempty-target refusal. The
earlier 4/4 remains tied to b837; current-lock actual restore is separately run.

Development base is still `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`.
Code `1708e99c80c29efa9cc31c1d128ace69b387d929` has tree
`1f68cbd0167d0fd98cd1878ae501a0cf2e6f8d92`. Source deployment identity remains
82344044, not this checkout. Remote PR head was independently rechecked as
`f00f94435d128ff8706ffadedabbee507f79781b`, Draft/open/unmerged; these local
increments had not yet run on Hosted at this checkpoint.

The unapproved P12 schema is now explicitly reverted from this executable
candidate (`68304f9bf`, `d4640da40`, integration `0edeb24fc`). Full source is
preserved on `codex/pr824-p12-contract-scratch` at `9b7af682cfa33cf60a9d27851dd5518bebf7b171`.
The generator again records 138 tables through 0140. This removes prototype
implementation together with its lane, without deleting a required test while
retaining the feature. S2 manifests and their assertions were not weakened.

| Actual execution identity | Scope and exact result |
| --- | --- |
| Clean `69f1a713128ce8a6614b220bddde591d0b1a213b`, tree `c3efe44e9827d0aefaabaf5c76422f80076eb3b5`, 14:42:04 UTC+8 | Full `server-pgvector`: 4172 collected, **4161 passed, 0 failed, 11 skipped**, 518 files passed/1 skipped; 252.68s; exit 0, owned cleanup verified. The 11 opt-in runtime connection cases are not passes in this batch. |
| `0edeb24fc` plus reader test WIP, then same base plus reader implementation WIP | Actual PG16 reader Red **46 passed/3 failed**, Green **49/49**, no skips; committed as `cb82fcb0a`. Formal Kernel queries retained. |
| Source `09b8f1a4fb6a88b4c5d52429950bd2b822f42db9`, integrated `69f1a7131` | Actual report-reader PG **36/36**; restored old blob with final canaries Red **34 passed/2 failed**. Not a passed startup report. |
| Source `7c200e602af0be47c9ea0c16a95bfeb94912f0a6`, integrated `7aa08586f` | Actual authority/report-target PG **63/63**: reauthentication, private assignment and physical lease checks; missing-report rejection, not a successful report approval. |
| Source `371486626afa85526c4b199f38e7733cbbefec3c`, integrated `0d87cbf20` | Actual authority PG **81/81**, including 18 new recovery-approval cases; 36.60s, exit 0, cleanup verified. Real restricted authentication and actual capture/journal/approval code; store bytes and source boundary remain explicitly synthetic components. |
| `b2c77efa4`, then `35770b7e1` precommit WIP | Typed journal Red **27 passed/11 failed**; initial journal/consumer Green **64/64**. Latest-approval/pending-capture Red **37 passed/2 failed**; final three selectors **101/101**, exit 0. A four-selector attempt without PG had 106 passed/7 skipped and a setup failure; it is not PG evidence. |
| Clean `1708e99c8` | Boundary **3509 matched, 0 unallowlisted/stale/mismatch/growth**, exit 0, same trusted base. An earlier invocation omitted the required base argument and failed usage; it was not a scan. Contract and selfhost checks exit 0. |
| Clean `1708e99c8`, 15:02:12 UTC+8 | Latest four Docker recovery cases **0 passed/4 failed**, 99.76s, exit 1. The evidence marker made the package directory nonempty, so the new capture guard refused before the unchanged active-writer assertion. This is a candidate fixture integration failure, not a successful restore. |

0140 remains the new unsealed additive migration; its pre-seal effective-capability
audit now rejects PUBLIC dangerous builtins and unproven system-schema definers.
Its SHA256 is `9fd18152c0dd25037a2b0b5acb706c95897c8f24bfb7b709cb17ff4312db3aee`.
0138 remains `a575205695852b11a536c7d41293f87634242b3c8d98f2345b3599e144aca8c5`;
0139 remains `36fdd85de86ab09309dd6531594feca16a5bce00b343fa858ac04f4cdbf49f31`.
No historical ledger repair is allowed for earlier Scratch installations.

The typed recovery approval now preserves principal/assignment/trace provenance,
recomputes its exact reference, and rejects hash-only or superseded authorization.
`recordRecoveryExecutionApproval` consumes the real issued authority and host
lock before appending; it never restores or authorizes traffic. Ordinary TypeScript
build coverage now explicitly includes all three approval management modules;
this exposed seven previously unexamined narrowing errors, repaired without
changing refusal policy. Independent Standards/Spec accepted these bounded changes.
Legal production API/worker startup, complete P12/P13/controller execution,
full consumer semantics, real business queue recovery, browser and growth evidence
remain unfinished; neither reader SELECT nor persisted approval substitutes for them.

The separately reviewed retirement Scratch is `cb385e347d8a0fe2fcec057be4876e40fa9bf6e1`
on `codex/pr824-retirement-contract-scratch`, dependent on the separated P12 prototype.
Its latest precommit code passed real PG **10/10** and pure **24/24** after SharedLock
Red **9/1** and checkout-listener Red **20/4**. A first Green attempt had one
cross-database setup timeout; moving owned fixture preparation to beforeAll
preserved the original timeout and assertions. This is LOGIN fencing, not P13;
retiring the old privileged bootstrap LOGIN is still unsupported and unverified.

Selected original log SHA256 values: full server `e50aa9f75c8dacf9912fd77510b607fc5509a3eccec15a4f7fade3ccd116264d`;
authority 81 `bd3065114dbb06c5363d97cd011cf5d6385856ad09a133f373285bcb9fd67687`;
latest journal selectors `708a0e373e794d7cdb4d1f3d9b3ca43228ec25e5b7a1c32b717a6d06061d0603`;
failed four-case restore `c835f760da778b03bbff1d9a6b0ecde2cd3b63dd8937b32870c9d47576c3df6f`.

### Earlier integration failures and separately verified increments

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
