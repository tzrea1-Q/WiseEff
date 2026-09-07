# Management-time runtime LOGIN source

[Chinese](runtimeRoleSource.README.zh-CN.md)

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
