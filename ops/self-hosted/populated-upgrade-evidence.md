# Populated upgrade candidate evidence

> Chinese: [Chinese](populated-upgrade-evidence.zh-CN.md)

## NW continuation, 2026-09-08

### Bootstrap source boundary follow-up

Separate Scratch `1ce73d4c21b7b20b86c5fafa1bfc0fbfaf8d1988`, tree
`e670a5c8961813130c24dc1cfa9b7b0434bfd1a7`, passed independent bounded scheduler
Standards/Spec and 26/26 pure cases. Its selected real old-source capture then
passed in 103.92s under the unchanged 120s test budget: 1 passed, 1 filtered
(reported skipped), exit 0. The internal candidate child read 126 relations,
126 source migrations and 12 pending migrations; no migration/P0 was executed.
Capture cleanup rejected=false and runner cleanup=true. The runner's generic
`verified-by-complete-suite` label does not turn this selector into a full suite.
This clean Scratch is not integrated into the parent candidate. The previous
156s timeout remains historical; differing source setup times prevent attributing
the whole reduction to the scheduler. Log `/tmp/pr824-management-child-1ce73-selected-capture.log`,
SHA256 `09e5e4f86494ed5c2113ec12387dbe7214e1cee0a8eee7cbf6995cd5d9dc554d`.

Code `1eb67491386a22392dafb741ff4a137a6477be87`, tree
`4795bd23de24c417e45998557d3e5ce0680bb686`, follows report `8bf6706b6`.
Independent Spec found that the bootstrap hook did not recheck the issued
runtime source. Two new pre-effect cases reproduced continued execution after
manager loss/configuration drift. A third case reproduced a `credential-step`
acknowledgment after source loss during final inspection. The fix reuses the
existing source verifier in the effect hook and around non-unknown host records;
unknown persistence retains its surviving host-boundary requirement.
Independent Spec re-reviewed this commit and closed the P1; independent Standards
also passed the three-file change and companion manuals. The reviewer reran
74/74 root tests; its docs governance passed but schema verification skipped
without pgvector, which is not complete docs verification.

Root scheduling tests ran on the code WIP subsequently committed unchanged:
83 collected/passed, 0 failed/skipped, exit 0. The preceding three Red cases
failed at the actual continuation/acknowledgment assertions; they do not prove
a real password rotation. Native PG16 ran 20/20, exit 0, cleanup verified on an
earlier WIP with identical source/integration-test blobs, before the additional
host-record checks. It proves real source loss/cleanup and catalog-lock/transaction
compatibility, not complete root execution. Final code build exited 0 with
existing warnings. No new Hosted result or full P13/startup is claimed.

On committed code `1eb674913`, owned scripts then passed 2058/2069, failed 0,
skipped 11, exit 0; source-lock separately passed 4/4. Resource cleanup was
verified. Log `/tmp/pr824-1eb674-scripts-owned.log`, SHA256
`d5541305bacf6bdac060aa90577c8cc9a130fc53b9c574252cbf900659e7f573`.
The unchanged boundary also exited 0. The previous `2ef8cdae3` backend and native
results remain attached to their original execution identities.

| Local raw log | SHA256 |
| --- | --- |
| `/tmp/pr824-bootstrap-source-red.log` | `b2be1f23db240d6e2b513cbd4430dfffb8dfa4bb9115484434c85b990e1048d6` |
| `/tmp/pr824-bootstrap-source-native.log` | `9b23fe383c4c134c81e059293d7cc188056cb26714430ea34fda461567d4e17d` |

The native runner used the already pinned PG16 Alpine image and explicit owned
daemon below, container `faf53b27fc60e24755bb608edb6a06429592a16ddb4d0efb7b72941415fe007b`,
network `0ae2dd75124ac45d05e21a7d2f4a2ae0725f9e475f5984ec08ca90a18a742392`.
Remaining local logs are `pr824-bootstrap-step-red.log`,
`pr824-bootstrap-source-final-green.log` and `pr824-1eb674-build.log` under `/tmp`;
they await the next public full-file package. The earlier public `8bf6706b6`
package does not contain this follow-up.

### Manager session integration

Code `2ef8cdae3ce7e7996656efdb4a7ae9ba2492a618`, tree
`36e41f8a696f98caa7013411a07678ceb1d86459`, integrates source commits
`6d2637196`, `f76a79b65` and `cd377f4d1` without changing their code. The
retirement owner verifies its actual checked-out management session against the
issued source, including endpoint, database and an observed advisory challenge.
An uncertain unlock destroys the caller lease and invalidates the source; a
cleanup failure preserves the earlier admission code without exporting its cause.
Independent Standards closed the final P2 after checking explicit `cause`, hidden
inspection and JSON redaction assertions; parent Spec accepted the bounded unit.

On this exact integrated code, the two focused suites collected/passed 80/80,
failed/skipped 0/0, exit 0. Strict TypeScript, build (existing warnings) and the
unchanged trusted-base boundary exited 0. Native `runtime-role-source-pg16`
collected/passed 19/19, failed/skipped 0/0, exit 0 in 21.25s; cleanup verified.
It used the same explicit owned daemon and PG16 Alpine image recorded below.
Source `f76a79b65`'s earlier 19/19 remains a separate execution; current Hosted is pending.
Logs are local pending the next full-file delivery:

| Log | SHA256 |
| --- | --- |
| `pr824-2ef8-source-pure.log` | `c8e91c3a11347af6a575687faf6bdb2d72dc3735dcd781b36a08c82b2cde17e0` |
| `pr824-2ef8-build.log` | `ae94642175174266c03c0c413fd5d74c19a8b8cbcdd81fca5a946b4e958aa23f` |
| `pr824-2ef8-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `pr824-2ef8-boundary.log` | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| `pr824-2ef8-runtime-source-native.log` | `51d5d1b189016bbbf20bd3e82c2e7f26cfc0157280260ef9db24588b3bfda19c` |

The first full scripts invocation used `env -i` without the required owned
PostgreSQL/TMPDIR/container configuration. It exited 1: 1976 passed, 62 failed,
28 skipped (2066), with four additional suite-setup errors. Source-lock passed
4/4 separately. This is a parent invocation error, not evidence of an inherited
code failure. The legacy rehearsal helper selected its default local test target;
its exporter reported temporary-path cleanup failure. This result is retained
(`pr824-2ef8-scripts.log`, SHA256 `f7daf6edcf9fbcc152ce3a68de96418a2a9a3bec2f1ac03250d365b440f59b20`).
The existing `scripts-pgvector` owned runner is the corrective execution path;
its result is separate: 137 files passed, 2055 tests passed/0 failed/11 skipped;
preceding source-lock 4/4. Exit 0 and cleanup verified. The same code's owned
backend passed 4322/4322, no failures/skips, exit 0 and cleanup verified.
Owned docs checked both governance and the actual schema artifact, exit 0 with
cleanup verified (report Markdown was WIP). Contract and selfhost checks exited 0.
No assertions or budgets were relaxed. These results do not cover isolated
startup, full controller, browser business acceptance or growth capacity.

| Additional log | SHA256 |
| --- | --- |
| `pr824-2ef8-scripts-owned.log` | `6aadea7a8d4f0ec84b657e7723c9ad5489e8f5cc2038ebf0366d9378b9cb7e2c` |
| `pr824-2ef8-server-owned.log` | `9d7e5ee66d9e0ac61b1e30c1bd619b11c7e2da8f2d50992069d111df619b3fe1` |
| `pr824-2ef8-docs-owned.log` | `7438f859771d8e0b458ea29622ebc0ebdfedd9bc413a11f3b866aecad5a7586e` |
| `pr824-2ef8-contract.log` | `b360b9bd3abdfe68681a8d267d5287709d4444710f48e2e21afb069a384d9981` |
| `pr824-2ef8-selfhost.log` | `fb3bebbd4a67124cfc37061ec47e862690f238d75a55a572211b4ba5a2701f56` |

The exact same code's `handoff-three-store` suite subsequently passed 9/9 in a
clean detached validation checkout: 70.54s, exit 0, all nested cleanup verified.
Its application containers remain identity fixtures, not the actual old app.
The preceding run from the parent's dirty report worktree correctly refused
`handoff-entry-artifact-changed` (8 passed/1 failed; nested cleanup unknown).
Only the affected suite was rerun after correcting checkout custody. Logs:
`pr824-2ef8-handoff-clean.log` SHA256
`e6dc845e379dffdb33bac03159a3bef83418587b70df02eb3249f9b4cc454268`;
the refused run `pr824-2ef8-handoff-owned.log` SHA256
`7a4bf7bec95c8d56ef89a077931a3e5da37154990fde7974f52d73523edd2058`.

### Handoff batching and native RI trigger reachability

Integrated code `f950e02cea8d67b423b3a3d84677827dc72fe0ab`, tree
`f5b5823ab11500568e95ea06686266334a1d9e8d`, retains the same base. Exact
container/volume batches preserve independent boundary observations. Source
`8d6a49b6c` passed native handoff 9/9; its identical-tree integration is
`71ba53ea1`. These tests do not use a complete old application upgrade.

The RI fix follows a foreign-key action into an installed SECURITY DEFINER
trigger on a non-retired table, then applies the existing scoped write-capability
test. Two real restricted-login cases previously mutated `driver_schemas` while
V13 passed. Both now refuse; the invoker case still cannot mutate that table.
Parent Spec and independent Standards passed this bounded fix. The Standards
reviewer withdrew an initial dispatch-scope restriction after verifying that it
would restore the two demonstrated failures. No permission or phase changed.

On integrated `f950e02ce`, `writer-reachability-pg16` collected/passed 38/38,
failed/skipped 0/0, exit 0, 6.11s; runner and nested-resource cleanup were verified.
The explicit owned daemon was `07ef20c3-7210-41f4-b337-5f617ca84c0d`, PostgreSQL
16 Alpine image `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`,
linux/arm64. Build (retained warnings), strict types including both changed tests,
and original trusted-base boundary exited 0. Log SHA256 values:

| Execution | SHA256 |
| --- | --- |
| Native PostgreSQL | `3968197348ee799a78ef1685e87807ddb39ca4ad477e1a8e7b4e679e9c444237` |
| Build | `1ea63b5bd6104e12597eaa963e5290a7fa5a164f9078bca0347bdaa597fcc26c` |
| Boundary | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| Strict types (empty successful log) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

These results do not cover the separate manager-source assertion or full
multi-head producer. Scratch capture `f6ab3b705` actually returned 126 relations,
126 source migrations and 12 pending migrations but failed its unchanged 120s
budget (155.215s); runner cleanup passed, nested cleanup remained unknown.
Scratch `785acd2d6` changed the positive plan assertion to expect an unsupported
result. Its reported 1/1 green is rejected as acceptance evidence; commit
`fbbd52a2d4cd807960ef3d63d3cbfc8d35d2ae0c` restores the positive requirement.
No subsequent positive execution is established. Neither execution establishes P13, legal startup,
complete controller acceptance or A/B/C completion.

### Ordinary LOGIN successor

Code `bd4ad49c85c5eeaa2e351245f5a4b616af700399`, tree
`22bb45b5aa84c82f79b5480edb037d116a1beb8d`, is integrated without rewriting its
execution identity. Source report `5822d889c` changes only the retirement manuals.
Its [bounded implementation, original counterexamples and execution hashes](../../server/modules/catalog-cutover/retirement/README.md#ordinary-login-sql-successor-implementation-boundary)
record root scheduling 130/130 and native PostgreSQL 21/21 with verified cleanup,
strict types, build and boundary 3509/3509. Parent Spec and independent Standards
passed this scope. The PostgreSQL case uses actual restricted connections and
the existing SQL owner; its fixture P12 references are not approved host-root
evidence. Report `d5aefa28d` Hosted `34219075502` subsequently passed required jobs
at merge `f5acf76cef1fa667620c12c25262420e11282746`: owned 477/477, scripts
2035 passed/27 skipped and backend 4322/4322. Local non-HDC and target synthetic
skipped. [Original logs](https://github.com/tzrea1-Q/WiseEff/tree/06ba6f7c9ae2d66957a24366085b6de9d307031c/owned-d5aefa28d-reviewed/hosted-34219075502)
do not cover the later integration above. Full P13, legal production startup and
full controller are incomplete.

### Retired module-mapping writer integration

Integrated `ce3eee2f27f7e0b3eeec8e163a3cf0196ba47a94` and source report
`e5aa2712f4bce573e1cb5a6eabdcbc5fec78e09c` share tree
`14023ee5c0b769fe4b737ea45afa4fcb06b78966`. The actual executions belong to
source code `cf15075ee7e8170f25d06ea065e6ad9a25f3a975`: V13 35/35, 5.87s;
SQL fence 20/20, 130.10s; zero failed/skipped, both exit 0 and cleanup verified.
Logs `/tmp/pr824-module-mapping-cf150-gate-green.log` and
`/tmp/pr824-module-mapping-cf150-effect-green.log` have SHA256
`5ab4a5d55ca898207c6d524f1050bf387550909a55c2abeda98690e0dc3979df` and
`fc6865db043e928793620dbb65c3fc9b0c35c15be47bd8620ad6002e82a9c7d1`.
The bounded independent reviews and both real failing predecessors are recorded
in the retirement module README. This repairs one existing writer scope, with no
new grant or migration; it does not establish complete P13 or runtime approval.
Hosted `34213839839` completed successfully at report `6d8fbe2bf`, merge
`e3fb8ebe295762237f8696eee4d684187f4093f4`. All sixteen owned suites executed,
476 passed/0 failed/0 skipped, with verified cleanup. Frontend 3374; source-lock
4; scripts 2019 passed/27 skipped; bridge 134 passed/4 skipped; backend 4322.
Boundary, contract, log-eval, smoke, quality and Merge bar passed; local non-HDC
and target synthetic skipped. [Original logs and execution index](https://github.com/tzrea1-Q/WiseEff/tree/5fd8a74f5ea440a67fcb24fde3e01a18db45009e/owned-6d8fbe2bf-reviewed/hosted-34213839839)
retain exact identities. [Full-file package](https://raw.githubusercontent.com/tzrea1-Q/WiseEff/b7b5c531c442f0d8cc2b108a49aeb867d7fbd737/owned-6d8fbe2bf-reviewed/pr824-authorized-full-files.zip)
contains 359 full Git files and excludes Scratch; SHA256
`f40cf3aec5cab1f28966622cda331460fbfb6e031eebaf3ab1efa92b7c68716e`.
Independent byte/material review and parent download checksum verification passed.
Its manifest retains the earlier packaging-time pending-CI state; the linked
subsequent CI index records completion without rewriting that historical artifact.

### Final-boundary fixture follow-up

Hosted `34197132779` completed failed, report `23f3a7e21`, actual merge checkout
`b3e9bfea958fe91f77a97747f70204a3067875eb`. Build/test, smoke and quality passed;
local non-HDC and target synthetic skipped; owned and Merge bar failed. Build/test
executed frontend 3374/3374, source-lock 4/4, scripts 2019 passed/27 skipped,
bridge 134 passed/4 skipped, backend 4322/4322, boundary 3509/3509, contract and
log-eval. Scripts skips were historical rehearsal 16, handoff 1, runtime identity
5 and vendor DT 5; bridge skips were CLI 2 and macOS URL scheme 2.

Owned reached bootstrap 40/41: only `final-boundary` hit the existing 1500ms
independent-child deadline. The former acknowledgment-loss case and native probe
regression passed. The next recovery and handoff suites did not execute. Original
log `/tmp/pr824-ci-23f3-owned.log`, SHA256
`76fe0e229f12e1e0eb01bd683a6ac2df4c4b090dfb303e4ac363120013ae68a0`.
One unchanged local `23f3` control passed 41/41, 18.41s, cleanup verified; it did
not reproduce Hosted. Log `/tmp/pr824-bootstrap-23f3-timeout-control.log`, SHA256
`985d853d98158b3836b3db6fa94bb453a7ee21ff7cd76f704d8b6abe164f7010`.

Test-only source `2747faf47ab46171891a9742dd4fb1d7754ab9f3` and integrated
`de225d63913ae51856b819b39e6061763bd0950d` have identical tree
`b22fa72f940a8b0f17fa4648f9bf3c232d4e2b47`. Four independently named final-boundary
cases replace the aggregate: each retains actual `55P03`, success after lock
release, the 1500ms child deadline and 50ms lock timeout. Restoration now wraps
the blocked phase too. Production code and all other cases are unchanged.
The formal source execution passed 44/44, no failure/skip/filter, 20.97s, cleanup
verified; four case durations were 922/865/905/880ms. Log
`/tmp/pr824-bootstrap-boundary-split-full.log`, SHA256
`96227b31bf3e27ed95d08e0eaba220c5a1080f80030bcb1b4ba1fe3e7c84ed7f`.
Separate independent Standards/Spec reviews passed this single-file change.
Splitting removes three deliberate lock waits from each child window; it does
not prove the original timeout cause or future Hosted stability. No startup or
complete upgrade is inferred.

At integrated `de225d639`, build exited 0 with existing warnings and boundary
remained 3509/3509 against the unchanged trusted base. Logs:
`/tmp/pr824-de225-build.log` SHA256
`abba015b58a21f80519ad0ddc35ebabb5549f28168a8a5f1a5ce7d22e0a51959`;
`/tmp/pr824-de225-boundary.log` SHA256
`6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795`.
Hosted `34200531532` subsequently completed successfully at report `504fd4046`,
actual merge checkout `ed57cadcdc5c599e02635aac2f772c8bd84c95ca`.
Build/test, owned, smoke, quality and Merge bar passed. Local non-HDC and target
synthetic skipped. Frontend passed 3374/3374; scripts passed 2019 with 27 skips
plus the separate 4/4 source-lock; bridge passed 134 with 4 skips; backend passed
4322/4322. Boundary, contract and log-eval ran successfully.
All sixteen owned suites executed: reader 49, writer 34, runtime identity 11,
runtime-role-source 13, SQL privilege 19, read projections 10, report 36,
authority 81, bindings 98, Redis 12, activation 22, retirement 16, bootstrap 44,
three-store recovery 16, controlled recovery 4 and handoff 9: 474 passed,
zero failed/skipped, every suite reported verified cleanup. These remain
component suites, including identity-stub handoff apps, not a full old-app upgrade.
Original owned log `/tmp/pr824-ci-504fd-owned.log`, SHA256
`01bd876306d2cdfea28341ff2deedb9d87e9323e878b789c9576805d8c07ab71`;
build log `/tmp/pr824-ci-504fd-build.log`, SHA256
`9f436137990b5ed997078a1a12e74f484ecbc8cd1e64f6215b1751c390d09697`.
Neither log is retroactively included in the published `23f3a7e21` package.

### Integrated follow-up `0390bd028`

Code `0390bd028219b464e143418cb13155d3819aee0e`, tree
`bdd8c313172648b2fedf58b2790775213fa9ab0f`, retains base `cda6737a8`.
The following checks ran with HEAD and code unchanged; later documentation is
not another code execution. Node 22.22.3 / Vitest 4.1.5, isolated development only.

| Execution | Result | Local log / SHA256 |
| --- | --- | --- |
| Scripts configuration: controller, handoffDataSource, upgrade-component-ci, run-upgrade-component-tests | 97/97, zero failed/skipped, exit 0 | `/tmp/pr824-0390-focused.log` / `f2dc90a596d9be23b362629d937e84c6450b9a51ec2738c44bcab9a5ce6c21bb` |
| `npm run build` | Exit 0; existing warnings retained | `/tmp/pr824-0390-build.log` / `d99411a7e6ba2d37789984e0935a60c1f3dce6efc9c6010441251c48304f130c` |
| Boundary, unchanged CI trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246` | 3509/3509; no extra, stale, mismatch or growth; exit 0 | `/tmp/pr824-0390-boundary.log` / `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| Formal owned runner `--suite docs-check` | Governance and actual pgvector schema artifact verified; cleanup verified; exit 0 | `/tmp/pr824-0390-docs-owned.log` / `38d0d45cc59844a373b03a8adc693fbcd3efdbf4432c553071315a7f25b135d3` |

Separate source executions remain separate: `c2197ae17` ran the formal
`handoff-three-store` route, 9/9, 77.32s, exit 0, cleanup verified. Log
`/tmp/pr824-handoff-data-c219-actual.log`, SHA256
`465c86b2a5b5a19a3a82ad96e9b0f7808a952c33ded7f479752defcd19b631a2`.
This uses real owned stores and private transports but identity-stub application
containers, not the old API/worker. The mandatory owned CI route now collects it.

Bootstrap source `3fa5db71e` passed the unchanged formal full route, 41/41,
zero failed/skipped/filtered, 17.65s, exit 0, cleanup verified. Log
`/tmp/pr824-bootstrap-probe-3fa5-final-green.log`, SHA256
`6e4fd6a31068c45f48222ebb97ae9477830edccae9bea5e487ba8af6bba1e704`.
Its deferred real-PG Red observed the next guard while an owned authentication
PID remained alive; the fix waits for native termination before subsequent guards.
It preserves unknown outcomes and permissions. The original Hosted failure's
exact cause is not proven: two local controls did not reproduce it.

Run `34192523701` is completed and failed on merge
`7affb0894c4d78446efbfaf534ff61561c44e0a4`: bootstrap 39 passed/1 failed.
The child returned `not-applied`; the parent's subsequent fresh-manager inspect
returned `unknown`. Later owned suites did not run. Build/test, smoke and quality
passed; local non-HDC and target synthetic skipped; Merge bar failed. Original
job log `/tmp/pr824-ci-4b-owned.log`, SHA256
`c36cc577c9b303bde9645dcdaee1b5503de29dfef8f575d248d6f656cd5a063c`.
This is distinct from the previous runtimeRoleSource count failure and timeouts.
No current full scripts/backend or new Hosted pass is inferred from these results.

The bootstrap, handoff and mapping/codec units received separate Standards/Spec
reviews. A fresh read-only integration Spec review of `4b346d6ef..0390bd028`
also passed without P1/P2 findings; that reviewer executed no tests. Reviews cover
these bounded changes, not full providers, P13, approved application startup or
the complete upgrade. A/B/C remain incomplete.

Additional execution safety deviation: at `b7c64328f`, the parent selected the
server configuration for two pure tests. Global setup reached the default/shared
development ledger and refused; zero tests ran. No numbered migration loop ran,
but bootstrap DDL effects were not fully observed, so zero writes cannot be
claimed. No repair or cleanup was attempted there. Log
`/tmp/pr824-b7c-comparison-pure.log`, SHA256
`6b18e73e96371936054a33df4c457641d4a6b29101a68b23714a4b5290de2fd3`.
Subsequent pure checks disabled global setup explicitly; subsequent database
checks used the formal owned runner. This new deviation is separate from the
historical incidents below and is not passing evidence.

### Fixed NW-01 integration

Code `25e8aabaee5bedd709aa15d02e6e6d020cc5550c`, tree
`e03802313b64eaf4f33fc04299f06072fe9f9fb5`, adds the independently reviewed
cross-database fixture lifecycle repair. Source `074c49c0b` passed the formal
full 19/19, 114.97s, exit 0, cleanup verified. The second empty database is
prepared in its own existing hook; cleanup drains actual work before removing
cross-database dependencies and shared roles. No test/hook budget or SQL oracle
changed. Its source log SHA256 is
`9cc822fdb13485be96c34089dd399eb8309a81dcf41ed2ac4ab3216c4cae5ee6`.

Subsequent formal owned execution at `25e8` passed read projections 10/10,
report 36/36, authority 81/81, bindings 98/98, real Redis 12/12 and activation
22/22. Retirement then failed in its 10000ms preparation hook (1 passed,
15 skipped). Two parent boundary scans overlapped that failed execution.
An unchanged-code, quiet full control passed 16/16, 23.56s; a separate
diagnostic-only Scratch measured preparation at 6077ms and also passed 16/16.
This does not prove scan contention caused the failure. No retirement code or
budget change was made and the diagnostic Scratch was not integrated. Quiet
control log SHA256: `d6fa9fbc81154331b720ece3305a90688140b9d2d990450b0f4d51ecdd556c07`.

The explicitly resumed remaining suites passed bootstrap 40/40, synthetic
three-store package recovery 16/16 (382.57s), and controlled recovery 4/4
(364.40s), all with verified cleanup. These are separate component executions,
not a retrospectively successful uninterrupted serial run or full upgrade.
Full scripts passed source-lock 4/4 (47.65s), then 2013 passed/11 skipped/0
failed of 2024 (129.07s). Skips are handoff 1, vendor DT generator 5 and the
generic runtime identity file 5; the separate actual runtime-identity suite
above is not relabeled as those five executions. Full backend passed 4311/4311,
zero skipped/failed, 181.43s. Build, contract and selfhost exited 0. CI-base
boundary passed 3509/3509 with no new/stale allowances. Ordinary docs returned
0 but skipped its schema check; a separate strict owned pgvector docs-check
then verified the actual schema artifact and cleanup. During this validation,
only the two boundary-documentation command examples were uncommitted; no code
or HEAD changed. No new Hosted result is claimed.

Log prefix `/tmp/upg824-nw01-25e8-` (local evidence, not download links):

| Suffix | SHA256 |
| --- | --- |
| scripts-pgvector.log | `5b7ee934eeda53c4cf32280af2d2b958784f8b6a93811d551817ce544b29154f` |
| server-pgvector.log | `db5d56ee05072e14109b91491400ddba3497a5553b763c0d13bec2b2c92325f9` |
| build.log | `0e172463482c4fa315f1a761ac704aa70e4059bd739f6ba74388e69085a466cb` |
| docs-owned.log | `0a6dff3e5d48939e0ca60b073b07680de875000ffa6a0d4a7a98b614eedfc3a5` |
| boundary-ci-base.log | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| recovery-three-store.log | `e5b5bcb933b6f39735ae877ee1b02d8d84f4c3812448134d6cf288337e3bb70c` |
| controlled-recovery.log | `a18d0f4dcfb3f8615976bedbbf0a77b0a649e79a08f2cd9f7aea8481b82d6ae1` |

### Earlier NW-01 execution

Local code `2a96d3f31f8ca00559b7fb81ea578632ae9ec165`, tree
`5bfa1d4febe0085ac1d760ac9dce96d9038a7a09`, includes the independently reviewed
NW-01 native client termination fix and authorized D-A audit relocation. Base
remains `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`. This local execution has no
CI merge-ref. Remote report `b5ef257cc` retains failed run `34169931811`;
its manager-session assertion is distinct from the new local failure below.

The unchanged formal component runner executed the original serial suite order
on the independently identified development Docker daemon, PostgreSQL 16 Alpine,
linux/arm64. At this fixed code, reader passed 49/49, writer reachability 34/34,
runtime identity 11/11, and runtime role source 13/13, all exit 0 with no
skips/filters and verified cleanup. The next legacy SQL suite failed: 18 passed,
1 failed of 19, exit 1. Its cross-database case exceeded the unchanged 5000ms
test budget and its fixture reported cleanup failure; the outer owned runner
verified resource cleanup. Later suites did not execute in this batch. Build
exited 0 with retained warnings. This is not a full owned-suite pass or startup.

Logs use `/tmp/upg824-nw01-2a96-<name>.log` on the execution machine (not a
download link). SHA256:

| Name | SHA256 |
| --- | --- |
| reader-pg16 | `62cc1e1a899d84cc45fbe2b7faeaec2daf4d56a9e625d9716f9620cb6158414d` |
| writer-reachability-pg16 | `ac39cb4b824a3433ae78381fad54f38654c994dcb2dc45a478669f16446a89c9` |
| runtime-identity-pg16 | `7643e9c36faa586728407c0204d1f0dfd4199ca1310047f5071b708ade66776d` |
| runtime-role-source-pg16 | `9b7b8305559be3b468ccd9f93d06cc0280eae8d22218ab051f6a0ec7e66f66ce` |
| legacy-sql-privileges-pg16 | `ba7739739f0dbf0638d5c56d5547b4f14cef4391ca143839ab4c25d1aab9860b` |
| build | `b452864ba63d9b5630480de71784d50042724ddb3eeed4d6d7b2fd2d8e37d9fe` |

D-A is now authorized and integrated at `86d590713`; the historical sections
below describe its earlier unapproved status. The exact natural test file is
blob `e019e246ea36a9ced4a70b572bc4c03d22eaad0b`. The three unchanged protected
slices and permission metadata were independently reviewed. Relocation tests
passed 69/69. A separate real-PG execution of that exact test file passed 15/15;
the checkout advanced in unrelated runtime source files during that execution,
so it is file-specific evidence, not a fixed whole-candidate run. D-B remains
in implementation. A/B/C are incomplete; production has not been accessed.

## Historical integrated candidate, 2026-09-08

Bootstrap integration `864bd95f180a297fb0fd3ec04aeeaf930b36718c`, tree
`3174a0505facdf5d4b298c208057024152a490ca`, passed the actual owned
`bootstrap-credential-pg16` selector: 40 collected/passed, zero failed/skipped/
filtered, 13.86s, exit 0, cleanup verified. Original log
`/tmp/upg824-bootstrap-864-owned.log` SHA256:
`0988bfa8f857ba0d42f42e11a71c611c291320b0df2f496cb9dcfd9611b87535`.
The reviewed source was `c4b99f4ba5f2bb6faf3f517ec58a6f4dbfea95cc`;
its separate 40/40 execution took 14.35s (log SHA256
`bb6a58244aa9590a54f5d3581c14c49bed4d1bba0c8ead510e24133d0ada597c`).
Independent Lagrange Standards and Fermat Spec accepted that source increment.
Original child/it/hook budgets remain unchanged. The real same-environment
control measured the original aggregate at 2046ms on `cf494324c` and 4709ms
on `b7bd0e645`; preparation and additional subprocesses now have separate
lifecycles, and outstanding work drains before cleanup. Double preparation/
cleanup failure retains a safe primary phase/code and a separate cleanup cause.
These are fixture/transport results, not approved API startup or full P13.

The separate audit-order failure was reproduced with actual equal timestamps
on both base and CI checkout. A proposed test-only repair is not integrated:
the natural edit changes three frozen occurrence locations. A layout-preserving
alternative is not accepted as boundary authorization. Neither changes production
audit behavior, and neither is recorded as current candidate CI success.

The natural repair is preserved separately at
[`009ce086a3050ce555806394463bb8d179c70fbb`](https://github.com/tzrea1-Q/WiseEff/commit/009ce086a3050ce555806394463bb8d179c70fbb),
not in this candidate. Its exact old/new blobs are
`79c7bdf5cd4535d5d340e546a0037080ebae8c9b` and
`e019e246ea36a9ced4a70b572bc4c03d22eaad0b`. The three unchanged SQL slices
move from lines 365/384/423 to 376/395/434, each by 1017 bytes. Fermat independently
verified raw bytes and unchanged permission metadata; the mapping still requires
the user's separate identity decision. No general relocation rule is proposed.
That fixed natural candidate has not run PG/build. The rejected layout-preserving
alternative's execution cannot be used as its result.

At report `c9dd70008a6bbc5a25941d842bb44dd919e9af07`, full owned scripts
passed source-lock 4/4 (39.22s), then 2001 passed/11 skipped/0 failed of 2012
(86.91s), with verified cleanup. Log SHA256:
`212a0ca7a8b5966b5a0ebc4704402e2d5b69af8f52b966f2ef6f4e51d113fc8b`.
Build exited 0 with retained warnings (Vite 7.85s), SHA256
`2f62cfc00eefdd3d8e3cafb1dcf492dd75548046229ec33cf8cc660f3f87675a`.
Original-base boundary, contract and selfhost exited 0. This does not fix the
pending audit-order counterexample or overwrite the previous Hosted failure.
The same report's full owned backend passed 4310/4310, zero failures/skips,
98.88s, exit 0 with cleanup. Log SHA256:
`a14f197e09030eb8676a88fb11a24fd4c5af603c37df0a7eef6595f0d2513ebd`.
Passing this execution does not eliminate the demonstrated timestamp-tie case.

The later integration `b7bd0e6454e7db5c07435aac290ef77d5c3f151a`, tree
`964de0bb44a4292c8160f7ed5350347448fa7772`, adds independently reviewed
HTTP owner controls and native referential-action detection. Parent real PG
passed 34/34, 6.21s, exit 0 with cleanup; HTTP passed 51/51, 1.73s, zero
failures/skips. Build exited 0 with warnings (Vite 7.93s), original-base boundary
remained 3509/3509 with no growth. Corresponding log SHA256 values are
`e4b8168023ea0ea407f9df891c94fbe277edfbb4441620ff5133f3ea689082d4`,
`1995f029ce884575887abb60dbfcacb4e3b49ab8f0ba4cbaea1a22ddf4973a71`, and
`6be96b6a4e9c34c85fae4d83921179458446125c8a15f8088987c9a01f5bea1c`.
The API test uses actual registration/HTTP with database doubles, not approved
production-mode startup. Native RI detection does not revoke project deletion
or change the original FK. Subsequent database-dispatch analysis was stopped by
the agent tool's automated cybersecurity review; its unfinished work and independent
review are not passes. Complete database fencing and P13 remain unfinished.

The permanent existing `applicationArtifact.build.ts` acceptance was changed
to invoke the real terminal at `3cee9f235534dd5d2f5cfcc9e8ae46b95f6520c4`, tree
`97a9ccffc8dfe84ffb38ebb66731ff9ec097e30f`. It actually built that same source,
independently reopened it, refused missing/wrong source input, then refused
original-package mutation and refused reuse even after restoring its bytes.
The command exited 0; log `/tmp/upg824-terminal-permanent.log` has SHA256
`c2f639f967a490bdcd05512d165c04716d554c487b2fbd3d002581808920e6ec`.
Its package is `sha256:cda7007066579eff3e82ffca6ede81a91d660f87a7f181d827edd9b55a5bbdad`,
loaded image `sha256:db0ccc9915f16f9bcdfd50612c93247e4efb18c4c9dd115ba2fee2a3a086183b`,
and platform manifest `sha256:82717e836965c30246859dc038e60585984872226a3b5f0dc5f0a023b45d9942`.
This deliberately damaged negative-test run is ineligible for reuse. The earlier
successful `73f12a24e` package below is retained separately. Neither is a release.

Hosted run `34167230816` for report `d79b9b23bcf7799613aa4d8265fedf1ab4ac6240`
actually checked out `4817c844a0e4e0d63d117fa9d6e5eea0e49017aa`.
Its owned job `101880674239` failed bootstrap custody: 27 passed/3 failed/0
skipped of 30, 20.62s, exit 1 with cleanup. The first test exceeded 5000ms;
subsequent cases reported lock and independent-process failures. Original job
log SHA256 is `953304e16fbf84c0774aff3bc3fdd7ff3574bd63139f6c542a1581ac01888672`.
This is a new candidate failure, not the historical source-lock timeout. The
run finished failed: smoke and quality passed; both Build/test and owned jobs
failed and Merge bar failed. Frontend passed 3374/3374; scripts passed
source-lock 4/4 then 1985 passed/27 skipped; bridge passed 134/4 skipped.
Backend had 4299 passed/1 failed/0 skipped: the knowledge parameter-reference
audit test received the same two events in reverse timestamp-tie order. That
ordering failure is being investigated separately from bootstrap. Contract and
log-eval did not execute. Owned suites through retirement-existing passed, then
bootstrap failed; subsequent recovery suites did not execute. Local non-HDC and
target synthetic jobs were skipped. Main-job log SHA256:
`7c75d16db519fe3fcafd72acc98f60892e2f3c282b47463f656703c2e7c52bcd`.
No current CI success is claimed.
Strict owned docs at report `d79b9b23b` separately passed including database
schema validation, exit 0 and cleanup; log SHA256
`66089de582a346c6dc8a496c65ee2a704fcc3a9ed4d21ae601a4b5fe73b653a3`.

Terminal code `73f12a24e17f12b9b863b7ebe78790ddd46d722b`, tree
`c02d9512c54c643cb5e85efa0e4d460536c7fb7d`, actually ran the existing
`upgrade.sh` artifact-init, artifact-prepare and a separate-process artifact-inspect
from `/`. Each exited 0. The synthetic private Git tag selected this same source;
the independently observed daemon was local Docker Desktop
`07ef20c3-7210-41f4-b337-5f617ca84c0d`. No services started. Both artifact
observations are byte-identical, SHA256
`2b2dba36e8d64fc86161470f694e5da9c460a493666eca19daf33c4be72c64d4`.
The init log hash is `d7728e0d2100d2b0260f55ed7ae8294b34434ea5dafb1a2ac99a8f26e3d79f44`.
Raw logs are `/tmp/upg824-terminal-73f-{init,prepare,inspect}.log`; these local
paths are execution references, not downloadable attachments. The private package
is retained and excluded from public evidence.

- Loaded image ID: `sha256:173a729b33c1a2509bc233732ee195bc2be41ffa777d5310abedad1a6970e9dd`.
- Platform image manifest: `sha256:a5b82ffedf7a6eb42a2b765fbe7a4cab780d92a7ece1ec7973c5af88a11442d8`.
- Package: `sha256:5017b60822678dc2d55ec58bf30e4527d8ae948302f5ddd8dd6d2e62015fd269`.
- Receipt: `sha256:d43a144fddb390242fca229b3efd62fe356d6ef1dac0ff3c449223bf5bea18ab`.

Cross-run inspect, repeated init and repeated prepare exited 2 without changing
the journal. The first ad hoc negative invocation expected the wrong literal
`ATTEMPT-EXISTS`; actual code correctly returned `EXISTING-SELECTION`. That
assertion failed; a bounded rerun using the existing source contract passed.
Both logs remain: negative SHA256
`38d1ecf74925bf3898ea14ca9b1b512f45e28b59de3a1eed9d326ca90012d2d9`,
corrected duplicate SHA256 `663f45b654a1ba5d4c1619b54ee2857154364138e50b652ae6efaf0cec1baef4`.
No implementation or requirement was changed to correct that test expectation.

Fixed `73f12a24e` checks, all exit 0:

| Check | Actual result | Log SHA256 |
| --- | --- | --- |
| Artifact/terminal focused | 59 passed, 0 failed/skipped, 14.30s | `24d1be45e1b00e651a4faf4ffaa6a6461ae4cae009907a4f8d2e4433a586fcdd` |
| Build | Passed with existing warnings; Vite 7.90s | `733a75b89dfe17c90f3e2620805766afbf3144ab3cef5f52a557f338708d01ea` |
| Owned scripts | Source-lock 4/4, 37.39s; main 2001 passed, 11 skipped, 0 failed (2012), 135 files, 89.02s | `1e8fa2e66f056bd2f917c3d55604dc779192d16bbf77fcbc70805a46b78e119f` |
| Owned backend | 4300 passed, 0 failed/skipped, 528 files, 95.92s | `3dd95f0425816efca7f09a72dd1b11497b5f07c5bfedbb872debb403bc50f8ad` |
| Boundary | Original trusted base, 3509/3509, zero new/stale/growth | `da522bf73a2a7fe5678fa952947c608bbb31908fa9288f45ce246a0f433ee4c5` |
| Contract | Passed | `b360b9bd3abdfe68681a8d267d5287709d4444710f48e2e21afb069a384d9981` |
| Selfhost | Passed | `fb3bebbd4a67124cfc37061ec47e862690f238d75a55a572211b4ba5a2701f56` |

Both owned suites verified cleanup on the recorded local pgvector profile;
they do not replace PostgreSQL 16 Alpine or target deployment acceptance. The
11 skips remain the previously listed handoff/runtime-inspector/vendor-DTS cases.
An earlier five-file selector at `01a25af5c` had 236 passed, four skipped and one
suite precondition failure because its required PG environment was absent (exit 1).
Its SHA256 `899f92814d7835f5a82b6302428c1a6eef5c63c96b6e4e0d56b4a25d655f8c03`
is retained; this is not a functional regression or a full-suite pass.

Journal `a05e79510` separately passed 58/58 in 3.35s (log SHA256
`13496a8bde5c12bcb4fe123c9d7d4381397256985dcbfb558589774d411f6792`).
Its independent Standards/Spec reviews passed. Custody source `2339a92c0` and
terminal `73f12a24e` also have independent Standards/Spec limited PASS; the
custody author's 50 cases explicitly double the build owner, unlike the actual
terminal execution above. Authentication/SQL successor `62090c07e` (30+19 real
PG cases) and trigger source `205dabf26` (31 real PG cases) retain their exact
Red/Green hashes in their existing contracts and are now integrated. No current
Hosted, complete P13, StartupTarget, API/worker positive startup, full controller
or target acceptance follows from this artifact checkpoint. A/B/C remain incomplete.

Artifact integration `a557e688671d11f7752a61b5f28803af39298bcd`, tree
`5ccb025d0bb8fcfb433ffd47d11168717505ca4e`, passed 20/20 focused cases in
348ms, zero failed/skipped, and build exited 0 with retained warnings (8.16s).
Log SHA256 values: `589ccb2a43871e525c349d26096f4790d5d1c5ab9c2443a8f2a20990ab711fda`
and `48b5c431de5c85d2aee93b1fb100c364de1ad700bed45a06f886271547db3428`.
Contract/selfhost exited 0. Boundary retained trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246`:
3509/3509 allowances, zero new/stale/growth. The first invocation used an invalid
argument name and exited 1 before scanning; the corrected invocation exited 0.
Builder `75e182236` separately built source `a321084a5` using actual BuildKit and
OCI bytes; both independent reviews passed. Exact identities, refusal history
and log hashes remain in the [artifact contract](scripts/parameter-catalog-upgrade/applicationArtifact.README.md).
No current Hosted, startup or complete controller result is implied.

SQL integration `64d478f37875e43aea468fa3ff2f7902a3ac7bae`, tree
`addec035553353cde8eab0fed19e79e34287d933`, ran full owned scripts: source-lock
4/4 in 36.94s, then 1940 passed/11 skipped/0 failed (1951) in 85.79s. Owned
backend passed 4300/4300, zero failures/skips, in 97.31s. Both exited 0 with
verified resource cleanup. Log SHA256 values are
`de356585385f98f9f457a15c0c11951a2f69833dd7457419e854f61c9a377819`
and `88233681b848909f657ce2f179517154aeebfce0c9485f6af9bfd5c7fdd3c3d4`.
The 11 skips remain the same handoff/runtime-inspector/vendor-DTS cases listed
below. This is not Hosted or complete controller acceptance.

The SQL source `2a9b22e2b28e9254f7635e56e7feb897b40bdb99`, tree
`11018998b52e927564b64e8fbc506ee815e98759`, independently ran 19/19 real PG cases,
104.13s, zero failed/skipped, exit 0 and cleanup verified. Log SHA256:
`fb454b14d7ea1f34ec0729978d411dde41a3bc00ef6de19231a32d508887a58b`.
Independent Standards/Spec and separate parent routing reviews passed. The
[retirement contract](../../server/modules/catalog-cutover/retirement/README.md)
retains the three actual pre-fix failures, the earlier trigger-fixture failures,
and the exact cluster-level locks used to close the observed race windows.
This establishes a SQL permission step; standalone authentication inspection
still needs to recognize the legitimate SQL successor without weakening its
original metadata baseline. That separate integration is in Scratch.

Runtime-source integration `c3f5a49092b761ad2b6806ad515849ff4ece1878`, tree
`2841d3d3ebfa756f508c585cc97cb8b390f32d67`, passed its route/source selector
32/32, zero failed/skipped, exit 0. Log SHA256:
`fa0e48d06bb1a00856ba53ae46b5aa8facb928c5df8efee3fd40c141bc183447`.
The real PG source execution remains test commit `a550e8a7f`, not this cherry-pick:
13/13, 14.01s, zero failed/skipped, cleanup verified. Its wrong-password,
post-issuance loss and initialization termination cases use actual LOGIN sessions.
The [source contract](scripts/parameter-catalog-upgrade/runtimeRoleSource.README.md)
retains the original 2-pass/5-fail discovery, schema-array Red/Green, exact hashes
and independent Standards/Spec scope. Parent mandatory routing also has separate
Standards/Spec PASS. No actual API/worker startup is established by these results.

SQL-effect integration `e41dd4e8225dd6aa216bbd32904edad91b16a082`, tree
`bec6af8d4953222379bfb96c4f961562a3ef2f38`, passed its four-file root/route selector
147/147, zero failed/skipped, 5.38s, exit 0, and build exit 0 with retained warnings.
Log SHA256 values are `c1841efa56872a69895a0316bf862b363350064eda3a13d82bb9cb733afc4eab`
and `73d0f588942879bd16bb008cefa849709aabc2696ef5064450ad715ded7ef8ae`.
Its route Red was 23 passed/1 unknown-suite failure; no tests were skipped.
Independent Spec review identified a missing low-level management search-path
precondition. The fix and real PG effects are pending; this candidate is not
sealed or covered by delivered Hosted, and its root selector mocks SQL effects.

Execution `b8fbae437107194c19393651180b397ef7b2ae42`, tree
`c3068db7f9a2e56eede19e22cf74ee5b14c5129a`, includes reviewed bootstrap durable
steps, seven-table V13 capability fixes and mandatory controlled adapter routing.
The seven-file selector passed 274/274, zero failed/skipped, 13.59s, exit 0
(`upg824-b8fbae-focused-single.log`, SHA256
`e7bc1d355a3450ea0a31c8508404653b5c7be171a714766e0414560f4d6995e2`).
This single execution replaces a log path used by two concurrent selectors;
their counts are not added. Build exited 0 with existing warnings, SHA256
`054ef17679960b73505a99231f63a5accfadc7be56d4267aa082f5b5119a7836`.
Boundary with unchanged trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246`
passed 3509/3509 allowances, zero new/stale/growth. An initial invocation omitted
the required base argument and exited 1 before scanning. Contract/selfhost exited
0. Report-only successor `e225a450e68c0cb867e0174d93940fcb6dca2902`
(tree `51af229ae4f4036efcc30eb34ce217fb18dec990`) then ran full owned scripts:
source-lock 4/4, main 1925 passed/11 skipped/0 failed (1936), exit 0;
owned backend 4300/4300, zero failed/skipped, 89.03s; strict docs/schema exit 0
with a real pgvector database and no database skip. All verified resource cleanup.
The 11 script skips are handoff (1), runtime inspector (5), vendor DTS generator
(5); they are not passes. Original scripts/backend/docs log SHA256 values are
`357f5b00f1ca096c704749b815146d7d2bdaa6f653f0114a8967639b4013e448`,
`27e785fadcd6ca3cbe28f20a0dd81f9ffd8609cf1b08b99ef597deae8062a1a1`,
`bf5f32b3199b827362c05d6bbe0b377ee5d98a2df54f1782334fc91551d0fdd2`.
These are new executions at the report SHA, not relabelled earlier runs. Hosted
on this candidate is not yet run.

The owned `controlled-recovery` route executed all four existing bootstrap and
stopped-source package/target-refusal scenarios: 4/4, zero failed/skipped, 262.44s,
exit 0, nested and runner cleanup verified, private evidence retained. Log
`upg824-controlled-owned.log` SHA256
`e96878cad31b599bbc623f69dce00b1cdce6c6dfb696b1d5befb4fcf3f76dc85`.
It used the local PG16 Alpine image listed below. This matrix does not itself
prove actual BullMQ business consumption, complete controller upgrade, or a real
backup copy. Exact mandatory routing and missing-receipt refusal replace opt-in;
Lagrange Standards and Raman Spec independently passed the routing increment.

Bootstrap source `6ff7d984` has independent Standards/Spec PASS; its 232/232 run
was same-byte pre-seal WIP, not a fixed-SHA PG execution. V13 source `d28546fad`
has both independent reviews and its own 24/24 real PG execution documented in
the gate module. Neither establishes complete P13 or working StartupTarget.

Local continuation `2d907209fb1f78aba6798270cc654fba187e36bf`, tree
`3f3eb2074d0a4db1ddeb49dd12cb49a242127721`, adds the separately reviewed
partial-restore observation and typed host publication storage. Its six-file
root/journal selector passed 223/223, zero failed/skipped, 14.61s, exit 0; build
passed with existing warnings. Original log hashes are
`97d680621540902827985f77ba64af37c3f923b274aeba967fad0c5f0e3e7f0d` and
`dee0193b680cfed77da96d2eacb5c65056e3977f777370a1aec3f31e14c60d30`.
Lagrange Spec/Fermat Standards reviewed the integration separately; implementation
authors' self-review is not counted. Publication is storage only, not P13 or a
working StartupTarget. This local increment is not covered by the following CI.

The real partial-restore source execution was `9959dc42e327bf375d6fc24e7e594fecc324835d`:
16/16, zero failed/skipped, 259.10s, exit 0, cleanup verified and private evidence
retained. Actual object PUT 403 followed committed PostgreSQL restoration; the
same attempt retained started/postgres-committed/unknown, Redis never started,
business effect rows stayed zero, and capture/approval/package were verified again
after cleanup. Log SHA256 `9f8b6e4503191cec349008c4c8ac3bf27af42c7c7b3558217e58c9eb05a3c1fd`.
Its Red `1f249b598` was 15 passed/1 failed (missing observed partial evidence), not
a package setup failure. These executions do not prove complete business recovery.

Delivered report `cf494324cec093343b418001f620a248d861fce6` completed CI
`34153386496` successfully at actual checkout `f4a900722c36a6aabe9a948a7bfeb92b6f4fa8ba`.
Frontend 3374 passed; scripts source-lock 4/4, then 1856 passed/31 skipped (1887);
backend 4300 passed; bridge 134 passed/4 skipped. Boundary, contract and log-eval
executed. Eleven owned suites passed with zero failures/skips and verified cleanup:
reader 49, runtime identity 11, projections 10, report 36, authority 81, bindings 98,
Redis 12, activation 22, endpoints 16, bootstrap 28, recovery 15. Build/test, owned
PostgreSQL, smoke, quality and Merge bar succeeded; local non-HDC and target
synthetic jobs skipped. Main/owned original log hashes are
`2a0a69d4ce0e522852cedbcba06919e5553b91f893e4d9dc9076f9df25f3145e` and
`37a0b8efefc7434537e9351d3959ce4256ecb663592821c40ddec7920281db42`.

Code `2b5d5ed4446a1aca56dd3d929fd15691172ba29d`, tree
`d97681435e034b7ee604efbe21295d7b434baa82`, integrates four independently reviewed
increments on unchanged base `cda6737a8`: formal recovery/actual queue composition,
private bootstrap inspection transport and root dispatch, verified organization
Archive identity, and initialization signal ownership. No migration/grant/trusted
baseline/timeout changed. PR #824 remains Draft/open/unmerged; its completed Hosted
is recorded above. The source deployment remains `82344044b436a8dafecefbb85dfd724cecb05e3f`.

| Exact execution | Result | Original log SHA256 |
| --- | --- | --- |
| `6e519a3b4`, complete bootstrap route | 240/240, zero failed/skipped, 1.09s, exit 0 | `7b9e33887191dcc514775263a42ae5219005530fba0c03c646cd81da91bfda05` |
| Same code, owned backend | 4300/4300, zero failed/skipped, 94.65s, exit 0, cleanup verified | `2dacc625d79b7c7d5822acf7af8ba410bcafac4f14d3972628d90330c4c8165c` |
| Same code, build | Exit 0, existing bundle warnings | `7249d28fbc96147ea3fadaa0c30793bfb4dc456769eb3b948e6e166e6d9b03fb` |
| Same code, strict owned documentation/schema checks | Exit 0, actual pgvector schema comparison, no database skip, cleanup verified | `f32ede11b5587ca1a00bcfd282ac48db936a90b5dc9ed53742127337c1527bfd` |
| `2b5d5ed44`, mandatory owned recovery route | 15/15, zero failed/skipped/filtered, 220.43s, exit 0, cleanup verified; private evidence retained | `e34bf2bca5dbd410897860a4f8fe8870f5d4a3fb75f6d439327c71d11bf7f876` |
| Integrated predecessor `d0fba71ca`, full owned scripts | Source-lock 4/4, then 1852 passed/15 skipped, zero failed, 1867 collected, exit 0; S11-RP 13/13 actually ran | `67a2a3693f2076f54371ce1a030950aff6493e1899f5a0cf1f92ba19a3da596c` |

The only code difference from `6e519a3b4` is six lines of recovery-test evidence
output, independently reviewed by Lagrange (Standards) and Fermat (Spec). The
server/build executions retain their original SHA. Two operator Markdown files
were edited during those server runs; eight Markdown files were uncommitted
during the later recovery run. Recovery service identities were actual linux/arm64
images: PostgreSQL `16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`,
Redis `ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`,
MinIO `1dce27c494a16bae114774f1cec295493f3613142713130c2d22dd5696be6ad3`,
and mc `993e8c454a7ec632923f7e3e61adf1d473261da6354cefd641aedd33a2cfe112`
(all SHA256 image IDs, not registry manifest digests). The package manifest digest
was `f5eaf9e8917b7b3d856d0df9344c1e49acecee25feec61a494442dcbce654797`.
At predecessor `4091d2e28`, bootstrap was 239 passed/1 failed and backend 4299
passed/1 failed: the new wrapper replaced the existing static missing-DATABASE_URL
diagnostic. The fix retains the exact safe message, without changing the original
test or exposing arbitrary driver errors. Original failure logs have SHA256
`63f921011a57e83a2f18c294f6925628f7c3b80399773ffbe6019abbe348e019` and
`7e19e61d45d5a3b9c25a153b2406cfa6dc775f0ebe35255c9733a031fd70498d`.

Independent component/integration reviews are scope-specific: authors did not
self-review their own implementation. Latest static diagnostic fix `fc241712e`
has separate Lagrange Standards/Raman Spec PASS. Root `44d63de87` has independent
review of actual socket-to-observed-source endpoint binding; root tests use real
filesystem and synthetic PG/domain dependencies, not a whole approved deployment.
Actual custody 28/28, Archive 98/98, and Redis lifecycle 12/12 retain their source
execution identities in the module evidence; none is relabeled as this SHA's run.

A/B/C remain incomplete. API and worker still lack the complete independent
StartupTarget adapter; legal approved production-mode startup and the complete
nonempty old-controller path are unproved. Startup publication/P13/Archive pins
and report integration remain internal work. Real backups, enterprise network/CA,
S6/Policy decisions and production approval are distinct outstanding inputs.
No production upgrade command or traffic authorization is supplied.

## Recovery composition continuation, 2026-09-08

Scratch code `06dcc6ca52ba030e46b232f573d229b2dd530476`, tree
`2296304b0f369d8909b2285bbfab650a93eddb02`, passed all 15 actual recovery tests,
zero failed/skipped, 218.64s, exit 0. Original log
`upg824-real-queue-06dc-actual-full.log` SHA256
`92aff22e60683f175d701ab752fd773b58c0192bfbc0952778040ccd747adc1b`.
The formal capture, four-principal approval and package-only separate restore
now compose successfully; actual BullMQ paused jobs, payloads, failure-after-effect
retry and database uniqueness are checked. Exact create-unknown volume/container
cleanup and missing-payload/wrong-run/nonempty-AOF refusals passed. Private evidence
is retained separately from Docker cleanup. This remains representative synthetic
queue behavior, not all consumers or complete old-application conversion.

Standards and Spec reviews of that two-file increment passed independently after
fixing evidence deletion, unregistered create outcomes and ambiguous child failures.
The authority helper has its own independent reviews at `bc85eb3df`. These reviews
do not cover the subsequent owned-route increment `2bfd4b2b4`. Its initial review
found an incomplete nested-cleanup claim; `be1f38964` corrected it and passed
independent Standards/Spec review. Forced child termination still records nested
cleanup as unknown; automatic recovery of all such resources remains unimplemented.
The original `2bfd4b2b4` code ran through the existing owned runner:
15 collected/passed, zero failed/skipped, 228.35s, exit 0; Docker cleanup verified
and private evidence retained. Original `upg824-recovery-owned-current.log` SHA256
`b42d1a794676b5f9621971dc120038170a55adb40e70a4c561cf47b168cfd868`.
The command was `node --import tsx scripts/run-upgrade-component-tests.ts
--expected-daemon-id <independently verified development daemon> --suite recovery-three-store`.
The actual PG16 Alpine image was
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`,
linux/arm64. Code remained unchanged while six report/operator Markdown files were
edited. Build also exited 0 with existing warnings (log SHA256
`4973963707d3b06d0527c5bb8de3246df525d1ab58aa090af5124d98efc73fc7`).
A prior focused invocation without the required pgvector environment
failed the S11-RP suite setup (16 passed, 7 not executed); it is not a test pass or
an external blocker. The owned scripts lane must supply that dependency.

Delivered report `70c1a3ad0` CI `34146381260` succeeded; actual checkout
`80f831e2a9641a93284a867cdf226499f569c656`. Scripts 1826 passed/41 skipped;
backend 4289 passed/zero skipped; bridge 134 passed/4 skipped. All ten owned lanes,
boundary, contract, log-eval, smoke, quality and Merge bar succeeded. Local non-HDC
and target synthetic jobs skipped. The new Scratch is not covered by that CI.
The previously verified 70c1 full-file archive remains immutable and does not
include these new files/logs. A/B/C remain incomplete; no production command.

## Delivered checkpoint ec0 — original execution identity

Code `ec0ee9f3e86c6c3e037bf5485e8d32f322375ca5`, tree
`ba7e906bf6a3d8d40d679bf87eacb3f9b0e8717c`, integrates the reviewed bootstrap
root adapter and mandatory runtime-identity owned route on unchanged base
`cda6737a8`. Lagrange's Standards and Fermat's Spec integration reviews passed
within these increments; neither review claims complete P13 or startup acceptance.
The bootstrap root rechecks the issued host lock, held inventory guard and formal
approved report before authentication effects and commits. Cleanup attempts every
owned resource and preserves an earlier admission or unknown-outcome error.
No migration, grant, timeout, trusted base or release approval changed.

| Exact execution | Result | Original log SHA256 |
| --- | --- | --- |
| Clean `ec0ee9f3e`, focused root/route tests | 92 collected/passed, zero failed/skipped, 2.50s, exit 0 | `1572fa0f212cc148db4356642357bcff0af3839b1a5134d2f09ea88e5fad714f` |
| Same code, owned bootstrap PG16 | 27 collected/passed, zero failed/skipped, 5.62s, exit 0, cleanup verified | `592dee9d0a8ec74756e355a77139dae58559ea0d4370acfe52264faf1483fdb4` |
| Same code, full owned scripts | Source-lock 4/4, 43.54s; ordinary 1842 passed/25 skipped, 1867 collected, 82.20s, exit 0, cleanup verified | `57ec64012c9340362ee5629836e164dca96417c9f7d99b8ea7616106b4b5eae4` |
| Same code, build | Exit 0, existing bundle warnings retained | `6b8e52caa5dc68015a21fd2516700c280f20e84b3468c949db15694d232c0b4d` |
| Same code, owned backend | 4289 collected/passed, zero failed/skipped, 87.76s, exit 0, cleanup verified; report-only Markdown changed during execution | `19bf2d13a3d8fee31847036fe640de656a5069246ddb4044d14d66da516b0269` |
| Predecessor `1595baccf294f0069e0fa512657b9060e4a72284`, owned runtime identity PG16 | 11/11, 6.20s, exit 0, cleanup verified; includes actual process refusals, not valid-pin startup | `7dd223abeb3459294c2369f4a46bbc45368d5e601ffd7154163d767c46cfb6de` |

The 27 tests include actual guard-backend loss, host-lock-holder exit, both COMMIT
boundaries and independent-process low-level inspection. Their prepared run does
not prove a whole root invocation with legitimate P12/report/capture predecessors.
The original Red on `dba3e7f8d` was 25 passed/2 failed; host-lock loss permitted
an authentication effect and a separate ACL fixture assumed the wrong image
default. The corrective fixture observes existing ACLs without granting privileges.
Root report-expiry Red/Green and exact component history remain in the paired
bootstrap adapter note. Runtime identity tests now require the existing owned
receipt and a mandatory Hosted job; exclusion from generic routes is not a skip.

Latest completed Hosted is run `34142368636`, report head
`8f3cf848993c7a55891732840d15f76eee3f4add`, actual merge checkout
`5f87013d39d9026fc1aa972e8cdcec4083960c85`: successful. Main ran frontend
3374/3374, source-lock 4/4, scripts 1810 passed/41 skipped, bridge 134 passed/4
skipped, backend 4289 passed/11 skipped, boundary, contract and log-eval.
Owned lanes passed separately: reader 49, projections 10, report 36, authority
81, Binding 92, Redis 11, activation 22, endpoints 16, bootstrap 22; zero failures
or skips in each. Smoke, quality and Merge bar succeeded. Local non-HDC and
target synthetic jobs skipped. This CI contains neither `1595baccf` nor the new
root increment; new candidate CI is pending, not inherited.

Current boundary, contract and selfhost checks also exited 0. Boundary retains
3509 allowances with no new/stale/growth findings and the original trusted SHA.
The first invocation used the wrong flag `--trusted-base` and exited 1 before
scanning; the actual check used required `--trusted-base-sha`. This invocation
error is retained, not reported as a boundary failure or silently overwritten.
Owned strict `docs:check` passed with the actual pgvector schema comparison,
exit 0 and verified cleanup; no database skip. Its code is `ec0ee9f3e` with
only these report/plan Markdown edits present during execution.

Actual API/worker still lack the complete StartupTarget producer/callback.
The terminal still needs the real handoff/capture/activation/retirement composition;
authentication retirement alone is not P13 completion. Full comparison, report
lineage, business/browser acceptance and complete controller recovery remain
unproved. These are internal work alongside separately recorded external
decisions and materials. A/B/C remain incomplete; no production command is ready.

## Earlier execution checkpoint, 2026-09-08 (historical)

Code `8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3`, tree
`b1f545978bf06ee8b1e86b158cb8e10d1d5eae61`, retains base `cda6737a8`.
The real CGH router replaces constant readiness and empty query ports. The new
persisted Review reader uses a read-only transaction; the original lazy grouping
command remains separate. Production query composition now consumes this reader.
No migration, grant, timeout, comparison format or trusted boundary base changed.
The increments have independent Standards/Spec review, including the final
bootstrap-fixture correction. This does not establish full integration acceptance.

Clean code passed the mandatory `read-projections-pg16` lane: 10 collected,
10 passed, 0 failed/skipped, 11.62s, exit 0 and verified cleanup. Five cases use
the real Catalog router, including an actual 0140-only LOGIN and GET `/catalog`
200. Five exercise persisted Review projection. The Review positive uses existing
synchronizer/governance capabilities in a read-only transaction; it is not the
final application login. A separate 0140-only login cannot read Review or create
groups. Neither result is `server/index.ts` or worker startup evidence.

The two preceding WIP runs remain failed: first 4 passed/1 failed/5 skipped
(incorrect compiler result access and nonexistent ACL-test relation); second
5 passed/0 assertion failures/5 skipped with a failed setup (successor bundle
used for bootstrap). The final run uses the existing predecessor-free release
and the actual registration relation. No installer or permission assertion was
relaxed. The previous two fresh comparison positives below depended on fake empty
canonical projections; their executed counts remain historical, but they are not
valid fresh-upgrade evidence. Current unknown canonical inventory is rejected.

Clean-code backend passed 4289/4300 with 11 skipped, 99.37s, exit 0 and verified
cleanup. Build, contract, selfhost and boundary passed; boundary used the unchanged
`9b3ba7df7e21f5589684bc92c872da593ad4c246`. Its first invocation omitted the
mandatory trusted-base argument and exited 1 before scanning; this is not a
boundary finding. Complete scripts passed: preceding source-lock 4/4 (41.25s),
then 1826 passed/25 skipped (1851 collected, 82.79s), exit 0 and verified cleanup.
The run began on clean `8ed7ac196`; only this report's Markdown changed during it.
Current-candidate Hosted remains pending.
Owned strict `docs:check` also passed, including the actual pgvector schema
artifact check, exit 0 and verified cleanup; no missing-database skip. Fermat's
final integration Spec review passed outside his authored CGH increment, whose
independent Raman/Lagrange reviews remain separately recorded. This is a limited
code integration review, not the full controller acceptance.
Lagrange's final Standards integration review also passed, excluding his own TCP
increment (independently reviewed by Raman/Fermat). The persisted Review factory
is integrated here; CGH's synthetic inventory authorization, required capabilities
and full per-consumer semantics remain incomplete, not that factory itself.

| Current log | Original SHA256 |
| --- | --- |
| `read-projections-lineage-fixed` | `36731b5a567b4d53018a606d2eebac166f72d39b4c35d112e62f3fedd1d86488` |
| `backend-8ed7` | `a3b084bd4354acd136a7cc0080af23c26b3b5ca05c667bf02a4b23a14e61e0d2` |
| `scripts-8ed7` | `3ccf2abc283345a6b27a051b0c776948f9e8b339995936d530fa7602fcb94453` |
| `build-8ed7` | `e1d55e4d70407e4b5b5f0e7515c12945cce513f94cd3d5b52f8de36222d30266` |

The full-file delivery manifest records redacted delivered bytes separately from
these original local log hashes; the logs contain no production execution.

Latest completed Hosted is `34138417314`, report head `c04d42703188432a2c98026ebfa6c683ae1526c8`,
actual merge `df274d9412a83ec5bb0be53e1b629c112feb25c3`: main job succeeded
(scripts preceding 4/4, ordinary 1806 passed/41 skipped; backend 4260 passed/11
skipped; boundary, bridge, contract and log-eval ran successfully). Owned bootstrap
failed 2 of 22 at the unchanged 2000ms COMMIT-observation deadline. Earlier owned
stages and smoke/quality passed; local non-HDC and target synthetic skipped;
Merge bar failed. This run does not contain the current increments. The actual
Linux TCP proxy experiment isolated Nagle delay; both native sockets now use
`setNoDelay(true)`, preserving bytes, fault ordinals and deadlines. The integrated
local PG bootstrap run passed 22/22 on `ec53a3592` plus root-composition WIP,
not on the later clean code. New Linux Hosted execution is still required.

API/worker startup producer and full controller P12/P13/report/business/restore
integration remain internal work. A/B/C remain incomplete; no production command
or production operation is authorized by these results. See the existing operator
manual and decision records for separate S6, Policy, comparison-format, real-backup
and enterprise-network dependencies.

## Previous execution checkpoint, 2026-09-07 (historical)

Code `e5c76c9ce4f828df8866f2b26888661a75aa9919`, tree
`dd12fd3b8a15f168a05487f7dbf16a3e245b72cd`, base `cda6737a8`, integrates the
reviewed Linux resolver correction, explicit retryable cleanup and redacted I/O
diagnostics, independent-process bootstrap custody checks, and eleven-provider
comparison safety repair. No historical migration, timeout, grant or trusted
boundary base changed. Independent increment reviews passed; Lagrange's final
Standards integration review found no new P1/P2. This is not full integration
Spec approval or A/B completion.

| Exact execution | Result | Original log SHA256 |
| --- | --- | --- |
| `e5c76c9ce`, owned PG16 Alpine Binding lane | 9 files, 92/92, 72.10s, exit 0; cleanup verified | `2213a1012638f8d79cee86001109561ed3a45bb8919ba99916c688ab3131b7ca` |
| Same code, owned pgvector backend | 4271 collected, 4260 passed, 0 failed, 11 skipped; 96.38s, exit 0; cleanup verified | `005231cda5ff896efcf4eded3d45b8b809c8bcadccd1f4e1a1a219797bffac46` |
| Same code, focused real comparison | 4/4, 3.70s, exit 0; cleanup verified | `312c8c8ae8d24103d4fbc6b7b02c412e45a5d23a7744f228d11153e109eb0b7a` |
| Same code, full owned scripts | Source-lock 4/4, 40.47s; ordinary 1847 collected, 1822 passed, 0 failed, 25 skipped, 84.07s; exit 0; cleanup verified | `768ec7169c50f4b2f835f24ff5e70ff8ea9040b8ed1016b6b8dd7161d6aa5a10` |
| Same code, real Redis/BullMQ | 11/11, 2.75s, exit 0; cleanup verified; real jobs/drain/deduplication, authentication/readiness failure and connection recovery | `6c31c27afa13dceda627d54d9730474d396bd4545e421810c447bcb98f146333` |
| Same code, build | Exit 0; retained existing warnings | `6172839c231d77fb36a5eab4ca0bcd6cf29adbd784f2b8d6f5230322917dbdef` |
| Same code, boundary / contract / selfhost | All exit 0; 3509 allowances, zero new/stale/growth, unchanged trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246` | See delivery log manifest |

The focused comparison proves two fresh comparison positives and complete
populated inventory checks with a blocking CGH 503, not a passed populated
corpus. D06 now contains two actually related open/dismissed Review records;
all nine comparison IDs remain required. The earlier `0d71d9949` backend failed
once on the real CGH 503; `fd4ea4094` failed twice on missing D06 inventory and
shared-cluster management observations. Those failures remain historical results.
The management-structure test now runs only in its mandatory dedicated Binding
lane, not concurrently with unrelated role mutations; its assertions are intact.

Earlier integrated executions retain their identities: bootstrap `b54241a4f`
22/22 includes actual COMMIT-ack loss, interrupted child and a second process
reopening custody after the parent closes its handle. Endpoint `0c198621d`
passed real Docker/PG 16/16 locally; this is not Linux Hosted evidence. Cleanup
`88521629e` passed full scripts (4/4 then 1818 passed/25 skipped), and `2307f1d06`
passed five pure cleanup/diagnostic cases. Cleanup diagnostics distinguish slow
connect/drop/end without exposing private SQL; they do not establish that the
Hosted timeout is fixed. No frozen deadline increased.

Latest completed Hosted remains `34130699134` on remote report `fa3dbef3f` and
merge `1a6c126e93d1b565b77d3b8baada937374da799f`, failed as detailed below.
No current-candidate Hosted result exists at this checkpoint. Production API and
worker still lack the complete startup producer/callback; full P12/P13/report/
controller success, business/browser/growth and whole-state business restore
remain incomplete. A/B/C remain incomplete. S6, Policy #815 and per-identity
comparison-format decisions remain separate from internal implementation; actual
backup, enterprise network and production authorization remain external inputs.

## Bootstrap checkpoint (historical)

Code `439f79c96794d165a73bf41fdd1697bc552ffffe`, tree
`8b1e7d0510f7d22175d4d586c9565809d9380d2e`, integrates the reviewed bootstrap
credential fence and its mandatory owned PG16 CI route. The two Spec P2 fixes
disable activity tracking on the actual transaction before submitting secret SQL
and snapshot inspection inputs before yielding. The strengthened visibility
baseline passed 18/18 on Scratch `75a88cf06`; the same three code/test blobs are
integrated in `a78cdb24d`. Parent `439f79c96` passed actual owned PG16 18/18,
routing 47/47, build, boundary, contract and selfhost (all exit 0; PG cleanup
verified). These are credential-fence results, not full P13 or approved startup.
Additional COMMIT-ack loss/child-interruption tests remain separately unintegrated
pending actual execution. A new DB connection is not a new process reopening custody.

Latest completed Hosted is [34130699134](https://github.com/tzrea1-Q/WiseEff/actions/runs/34130699134),
head `fa3dbef3f9e44327d6e3797111e260036e05c647`, actual merge checkout
`1a6c126e93d1b565b77d3b8baada937374da799f`. It failed: scripts preceding 4/4,
then 1774 passed/41 skipped (1815), with two failed suites due to **afterAll**
10000ms timeouts in upgrade/recovery disposable-database cleanup. These are not
assertion failures or the historical source-lock timeout. Owned endpoint tests
were 11 passed/5 failed (16): the positive baseline now exposes Linux resolver
options `edns0`, `trust-ad`, `ndots:0` as the refusal stage. No resolver acceptance
change has yet been verified. Later owned stages and main boundary/bridge/backend/
contract/log-eval did not run. Smoke and quality passed; local non-HDC and target
synthetic skipped; Merge bar failed. This run does not execute `439f79c96`.

Actual API/worker startup producer and full populated controller remain internal
implementation gaps. A/B/C are incomplete; no production upgrade command is ready.

## Previous continuation checkpoint, 2026-09-07 (historical)

Latest completed Hosted is [34125753813](https://github.com/tzrea1-Q/WiseEff/actions/runs/34125753813),
head `3c0fe1d66`, merge checkout `e0f9ea2e56582b1dfe5398c5d5f4d9b77b30ea73`.
Scripts: preceding 4/4; ordinary 1734 passed, 2 failed, 41 skipped (1777).
The failures are missing transitive digest registrations, reproduced locally
(1750 passed/2 failed/25 skipped in that ordinary stage). Owned endpoint tests
were 15 passed/1 failed on Linux; subsequent owned stages and main backend,
boundary/bridge/contract/log-eval did not run. Acceptance smoke/quality passed;
local non-HDC and target-synthetic skipped; Merge bar failed. This supersedes
earlier current-CI statements, without changing the historical success below.

`770764871` registers the nine actual digest dependencies and keeps them scanned.
New per-module injection tests also exposed an overbroad execution-root exemption;
only explicitly registered execution modules may now contain restore commands.
The first selector was not green: 9 new assertions failed and the separate restore
suite lacked its required PG setup (7 skipped); it did not access a default DB.
The corrected pure boundary passed 45/45. Independent Standards/Spec passed.
`1376fbcbe` integrates the reviewed P12 controller adapter. Its positive domain
effect/report test ports remain substitutes, not actual approved P12 evidence.

| Clean execution | Result and scope | Log SHA256 |
| --- | --- | --- |
| `1376fbcbe34f140ebe44d6deda121bd7744ff836`, tree `df7069faa182c4194e557ab72ee11fe566de4ba6` | Owned scripts: 4/4 then 1781 passed/0 failed/25 skipped (1806), 46.23s + 87.49s; exit 0, cleanup verified | `10dacb17c6eb346c9f6a1ed3bb23264ea2697dab7eb508e2e29a352e13b94de7` |
| Same `1376fbcbe` | Owned backend: 4241 passed/0 failed/11 skipped (4252), 110.84s; exit 0, cleanup verified | `0227f19dffaac897130c41c95bbcd94bb8ce2d12e0e116159dc5bdd86ef4a3dc` |
| Same `1376fbcbe` | Mandatory owned Binding: 92/92, 75.76s; exit 0, cleanup verified; exact shared-backend exclusion is collected here | `4e5194a9d00991fa09bfdd2891e759edcd7827fda1c03e5bcf3e14062f57ed11` |
| Same `1376fbcbe` | Build exit 0; existing warnings | `723dcb007c326c2ab49ff8754ad4e4ccc30c87415b569eb2f5e1e59c2770be4f` |
| Same `1376fbcbe` | Boundary exit 0; unchanged trusted base | `da522bf73a2a7fe5678fa952947c608bbb31908fa9288f45ce246a0f433ee4c5` |
| `04f6cbdba` | Actual Compose shared-observation Red: 8 passed/1 failed; drift incorrectly accepted | `adb490beab0cc7afed05133c9c978900f446392020e606d2da02a3e0ea8f79c4` |
| `be95a710f51ca73f13c2a6f222682cec816a5296`, tree `33c7a2b6aa160eca6c615581d27241727a12a033` | Actual Compose identity Green: 9/9, 53.37s, exit 0; immediate snapshot fixes drift masking | `d79afc127b790f264a703888d4a81274815232a69ae0a5c33944c0280e02bc18` |
| Same `be95a710f` | Build exit 0 | `3a2d89bdd6f560a962875a23d5b836e7a31870ae976b9ace963b4d9e4d3ee5c5` |

The Compose fixture is explicitly an identity app, not an old application image.
Two preceding 8-pass/1-fail runs rejected its noncanonical journal directory.
Creating it as 0700 alone did not fix the issue; the actual correction used its
already resolved canonical parent. No lock/path check was relaxed. Handoff and
snapshot increments have independent Standards/Spec PASS. Linux endpoint changes
only classify safe refusal stages; 37 pure tests passed on `193cccd73`. Linux
root cause is still awaiting Hosted observation, not declared fixed.

Bootstrap remains unintegrated: the 17-case positive was followed by two Spec P2
findings (activity-statistics secret exposure; inspection argument mutation).
Real Red `29def0df3` collected 18, passed 16, failed 2; fixed combination
`6f5593fa6` passed 18/18, exit 0 and owned cleanup verified. These are low-level
authentication results, not P13. The subsequent statistics-visibility baseline
test has its own pending execution and review. Actual startup producer, accepted
runtime root processes and complete populated controller remain unfinished.

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

Endpoint and supervision fixes are integrated through `097a4a598`, tree
`73095ef503baf41b12c3f7ed67f0b39d548011b9`. Component `cdb0db88d` passed
16/16 real two-PG endpoint tests after the original 14 passed/2 failed resolver
counterexample; independent Standards/Spec passed. Parent pure retirement tests
at `9722cc18e` passed 47/47. Neither result proves complete P13 or runtime startup.

Image fix `df0fa9c56` makes pinned DTS tools/libfdt available in the existing
minimal environment, without relying on `LD_LIBRARY_PATH`. Independent
Standards/Spec passed. The formal login-shell toolchain command exited 1 in the
old image and 0 in the fixed image. Fixed image ID:
`sha256:7148348e0a7db9e9574dcc7ec6dd49b184809f8d9417ec2ecb9d89e3c0c56dd0`
(linux/arm64, verified TLS configuration, cached dependencies). It excludes later
retirement commits and does not prove enterprise-network trust. Log SHA256:
`5b8cfbe336c77c23b89a5a424ba9ebb0d3c1300806a614beede7d9e22b3cdd17`.

The actual old-source image passed API readiness, worker liveness, registration,
login, authenticated reading and anonymous/wrong-password refusal in an owned
internal Compose network without published ports. Only model providers use the
existing deterministic implementations; production mode, authentication, PG,
MinIO and Redis AOF are real. This is old-source preparation, not candidate
startup. Log SHA256: `72a294da16e04abe5a8efcf64f4cff539e97a0c0a21b099b619ce953dcaa09db`.
The following two-upload business experiment failed with HTTP 500 (exit 1);
queue processing is unproven. Exact owned containers were verified stopped and
data retained. Failure log SHA256:
`ea7244096fc7f5484e80a9486dc084f6ef079110271bbea74d21fc20200a24e5`.

An agent mistakenly used the general server configuration twice for a filesystem
bootstrap test. Both runs exited 1 with zero tests. Global setup attempted a
default database before ownership verification; it can perform template and
migration-ledger DDL. No execution log establishes whether writes occurred.
The route was stopped, without investigating or cleaning that unverified target;
no untouched-target or restoration claim is made. These are invalid setup
failures, not Red/Green evidence. Filesystem tests now use the existing no-setup
retirement configuration; PG tests require a separate integration file and
parent-owned cluster receipt. Bootstrap credential fencing remains Scratch.

Queue transport fix `07919b49834c6edb8060fa2612d55ab7892cc3dc` (tree
`4262f0741d17649646897a2abd901e444109ec69`) has independent Standards/Spec PASS.
The formal producer first reproduced BullMQ's rejected ID: 10 collected, 9 passed,
1 failed, exit 1, owned cleanup verified. The fixed pre-commit worktree passed
11/11 real Redis tests, including concurrent identical/distinct log keys,
notification keys and a real unmarked persisted collision. Its controlled
processor is injected: this proves transport/dispatch, not complete business
analysis or notification delivery. Pure focused tests passed 28/28 and typecheck
passed on WIP. Clean `07919b498` build passed (existing bundle warnings), contract,
selfhost and boundary passed; boundary retained 3509/3509 allowances and zero
unallowlisted/stale entries. An initial boundary invocation omitted its required
trusted-base argument and exited 1 before checking; the corrected command used
the unchanged `9b3ba7df7e21f5589684bc92c872da593ad4c246`.

| Queue increment log | SHA256 |
| --- | --- |
| Real producer Red, `c6a57ae41` plus test/Markdown WIP | `9e814a278a3c89f455d4df3b0601e7f6a84138b062c19dc553cd43806eba2116` |
| Real Redis Green, `194fefd97` plus code WIP later committed as `07919b498` | `34df5cfb5654ca2beaea1ae833556b402deb1a68802d9308e6bf0e7d808da8a2` |
| WIP focused 28/28 | `8965a97fb36059090678e9f4b3b31bf56e1804e9305eecdf79203503949a8e45` |
| Clean `07919b498` build | `77ed519befe1abea53820e6017aeb0cd73f23470f880385705e1f1dd35ff886e` |

The complete owned backend at `07919b498` collected 4261: 4249 passed, 1 failed,
11 skipped, 115.39s, exit 1, cleanup verified. The Catalog roles cluster-wide
negative observed a temporary `s7_binding_*` LOGIN created by the simultaneously
collected Binding producer fixture. This candidate routing defect is not called
inherited main failure. `3fc7f7464` excludes that exact file from shared backend;
`df41defd3` permanently requires its existing mandatory owned `bindings-pg16`
collection. Independent Standards/Spec passed; routing Red 1 failed / Green 1
passed. Permission assertions, role grants and timeouts are unchanged. The full
backend failure is retained until a separately attributed execution passes;
neither the routing test nor prior Hosted success substitutes for it.

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
