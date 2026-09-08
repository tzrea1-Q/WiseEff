# Management-time runtime LOGIN source

[Chinese](runtimeRoleSource.README.zh-CN.md)

## NW-01: native client completion

Run `34169931811` at merge `829f8b49d` failed the manager-termination test:
12 passed/1 failed, server session count 1 instead of 0. This was not evidence
of a permanent leak. Exact-PID instrumentation on `499cb44ce` reproduced four
native-end failures (9 passed/4 failed); one remaining idle API session matched
this module's acquired PID. Locked pg-pool removes a released client from its
local list before asynchronous client termination, so `pool.end()` alone can
resolve too early. The fix awaits the owned native `Client.end()`, then releases
in `finally` and awaits the pool. All resources still settle, close is shared,
and admission failures retain their existing safe reason.

Fixed source `b5763c6042dcc18f301be32c297a0bd726c4ddf8` passed real PG 13/13,
15.46s, cleanup verified, plus types and nine pure tests. At close return all
observed native clients had ended; subsequent independent session queries were
empty, before fallback cleanup. No polling, fixed sleep, extra termination,
retry, grant or timeout change was used. Independent Standards/Spec passed this
bounded increment. Log SHA256:
`64e7e867406e705f6b3bf880b452dd5e97f958b2ca531ae189775422e50d389f`.
The source/transport evidence below is historical and does not prove startup.

`openRuntimeRoleSource` observes the actual LOGIN selected by the handoff-pinned API and worker `DATABASE_URL`, plus the API's separate `CATALOG_GOVERNANCE_DATABASE_URL` when present. It returns an opaque handle; `observeRuntimeRoles` accepts only a handle issued by this module and rechecks its live resources. No connection, password, environment contents, startup pin, or approval is returned.

The control root supplies its fixed `HandoffPlan`, authoritative expected digest, and actual same-directory `HostOperationLock`. The new handoff FD lease checks the four original private files, including device/inode, current path, owner, 0600, single link and content hash, and keeps them open until close. It does not replace `verifyStoppedHandoff`, capture, current mapping, report verification or any phase decision. A fixture with a scoped plan is not evidence that the full handoff producer ran.

The management credential comes only from the pinned management file. The module opens its own connection using that restricted management LOGIN, checks the existing `assertBindingManagementLogin`, actual socket and Docker-published PostgreSQL endpoint, and observes system/database identity. It opens each runtime credential in a separate read-only session and binds it to that database through a random session advisory-lock challenge observed by the independent manager. It reuses the production runtime identity precondition; the application startup path still requires Catalog presence and its existing real startup adapter. Management, bootstrap and governance credentials cannot substitute for an application LOGIN.

The supported transport is the actual loopback published endpoint, or the existing `observeLegacySourceEndpoint` proof for its supported stopped-source resolver profile. This only proves the management-period mapping. Unknown candidate DNS/config profiles are refused; observing the old stopped source's resolver does not prove a future candidate container's DNS or successful startup. There is no ambient database fallback, transport callback, role-name input, new grant or schema change.

| Threat | Required boundary |
| --- | --- |
| Forged lock/handle or changed plan | Refuse before connection/observation |
| Replaced, linked, changed or non-private config | Original FD and named file must still match all pins |
| Same role name on another target | Actual published endpoint, socket, physical identity and random session lock must agree |
| Bootstrap/manager used as application | Existing runtime identity check plus actual OID separation refuses |
| Optional governance omitted | Configured API governance connection is separately authenticated and identified |
| Privilege/config change, connection loss or close | Every opaque-handle observation revalidates; no cached success |

All opened pools and FDs belong to this module and close on failure; explicit close is shared and idempotent. The host-lock owner must await close before releasing the lock. Sessions retain read-only mode and do not start services or execute DDL/DML.

Checkout registers the actual client and its continuous error/end observers in the synchronous pool callback, before resolving the awaiting initialization. Two permanent EventEmitter counterexamples deliver error/end immediately after that callback; the old await-based checkout failed both. The fixed suite passes nine source tests plus ten unchanged runtime compatibility tests (19/19), including the actual missing-database API child. These two checkout cases use explicit client/daemon substitutes and do not count as real PG connection proof. Strict targeted types pass.

The intended next caller is the management P13 owner: it can hold this handle while deriving a runtime-root set for V13, instead of trusting caller-supplied role names or treating the verifier/bootstrap identity as runtime. That caller/gate integration is not part of this module. Existing V13 `postgres`/current-user exclusions remain an explicit gap until that integration is completed. Configured database logins do not inventory all retired writers, background jobs, triggers, overlays or other P13 surfaces. This module issues neither P13 completion nor startup authority.

Validation: the initial pure Red collected five failures because the new lease/identity entry points were absent. The mandatory `runtime-role-source-pg16` route uses `vitest.runtime-role-source.config.ts`, requires the existing parent-owned PG receipt before collection and refuses zero tests. The actual integration fixture uses migrated isolated PG16, real separate LOGIN passwords, real private files and the real host lock; it does not create Docker resources or invent a valid P12/report. Its scoped handoff fixture is not a whole-root positive. The setup hook has a 60-second migration budget; individual tests retain Vitest's default budget.

The first real parent run at `176d233a4` collected seven cases: two passed and five failed at `RESOLUTION-UNSAFE`. The two broad role-refusal assertions had accepted the wrong preceding refusal. This was an implementation/test defect, not inherited environment failure. A real management LOGIN query proved that the locked driver returns PostgreSQL `name[]` (OID 1003) as a string, while `text[]` (OID 1009) is an array. Diagnostics print only types/OIDs and the `pg_catalog`-first boolean. The query now explicitly casts to `text[]`; the array and first-schema checks are unchanged.

Test-only `8c00cd59a` added exact manager/governance error codes and a real unsafe-search-path case: eight collected, one passed/seven failed, exit 1, cleanup verified. Fixed `9ee5581d95` passed all eight in 10.48 seconds, exit 0, cleanup verified, on isolated `postgres:16-alpine` linux/arm64 image `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`. The retained private logs are `/tmp/upg824-runtime-role-parser-red.log` (SHA256 `bdbd289a105053a339928ba98a17478670780f690dd6683df79a8fa142574929`) and `/tmp/upg824-runtime-role-parser-green.log` (`59389ea534ff2735d443f96cc163a5716a7d6cc08f1d44c17440b3720296ccaa`). The same code also passes 19/19 pure/compatibility tests and strict targeted types. This proves the configured LOGIN-source component, not a whole handoff, P13 gate integration or legitimate production startup.

Five additional real dependency/lifecycle cases were run at test-only `a550e8a7fa8a0a5fc6e74a8aa90c3495660c06b1`, based on parent `a321084a5`. The original eight were retained. Wrong manager and worker passwords first produce independently observed PostgreSQL `28P01`; the source then refuses with its exact static connection-unavailable code. The worker case proves real manager/API acquire events occurred before the failed worker login. Separate cases terminate the actual manager or worker backend after issuance, and terminate the actual manager at initialization checkout. Observation/initialization must reject; errors are checked only through static codes and secret-absence booleans.

The test observer wraps the public `Pool.connect` call and delegates to the original implementation. It records actual pool/acquire events and requests real `pg_terminate_backend`; it never fabricates clients, SQL results, authentication or startup admission. Before any fixture fallback cleanup, tests require every module-owned observed pool to be ended with zero clients/waiters and verify zero corresponding client sessions in actual `pg_stat_activity`. Issued-handle tests also verify repeated close. The fallback remains available to avoid leaving resources when an assertion fails; it cannot satisfy the earlier module-cleanup assertions.

That fixed candidate passed 13/13 on its first real owned run, 14.01 seconds, exit 0, `cleanupVerified=true`, with no unhandled error/rejection. No new production fix, grant or timeout change was needed. The exact command was `node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id <independently verified local daemon> --suite runtime-role-source-pg16`; the actual daemon argument remains in private execution metadata. The raw log `/tmp/upg824-runtime-role-lifecycle-first.log` has SHA256 `2bcbe9ff9c7103d6c44a3b13a81b8b62d5db2da180287afb0507688f554feadd`. The code tree was `f74d460ab43ed35678746bd482f684e5b02b947f`; image/profile remained the isolated PG16 linux/arm64 identity above. Strict targeted types also passed. This adds actual PG authentication and connection-loss evidence to the component; it is not a process-signal test, candidate startup, P13 completion or automatic reconnect/retry authorization.
