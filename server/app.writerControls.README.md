# Application HTTP writer controls

Chinese: [中文](app.writerControls.README.zh-CN.md).

`buildWiseEffRouter` records the actual registration calls made by the existing
application composition root. `observeCatalogHttpWriterControls(router)` accepts
only that original router through a private WeakMap. It takes no caller route
inventory, handler callback, approval flag, database URL or artifact identity.

The legacy owner directly registers its fixed 410 handler for the existing
retired route contract, retained as a private immutable initialization snapshot.
The exported `legacyWriteRouteManifest` remains a detached compatibility view;
neither registration nor observation uses that mutable public array. A fresh
`readLegacyWriteRouteManifest()` copy supplies the app's private snapshot.
The original retired registration filter remains in
place; other handlers, including canonical/business mutations and bounded reads,
keep their existing behavior. The projection contains the exact retired route
IDs/methods/paths and a digest of the ordered actual registration/control list.
Other entries are marked outside this HTTP retirement scope, never safe writers.

Observation rejects a copied router, changed dispatch/registration methods or
any registration appended after construction. For every retired pattern it
requires a real registration and rejects any intersecting route whose handler
is not the fixed refusal. Intersection follows the router's existing slash
splitting, exact methods and colon-parameter grammar. The router has no catch-all
syntax: `*` is literal. This is deliberately conservative even for a competing
handler that presently has lower precedence. Observation is synchronous and
never calls an unknown handler or accesses a database.

The returned records are detached copies. They are an HTTP-only owner
observation, not an independently importable authorization credential. A future
P13 owner must obtain a fresh observation from the actual application owner and
bind it to the verified candidate artifact and target alongside the database,
identity and other required controls. This module does not claim an artifact
digest, full writer inventory, P13 checkpoint, runtime generation or startup
approval. Database denial cannot replace the frozen user-visible 410 behavior;
conversely this route subset cannot prove database trigger/rule/Agent/job safety.

## Verification

The public seam is the actual `buildWiseEffRouter` result and its observation.
The first fixed Red (`23309920b`, base `73f12a24e`) collected 42 tests: 41 passed
and only the missing owner observation failed. Spec review then found the public
manifest alias could remove the inventory; fixed test-only `0f2c0d2d4` collected
51 tests, 49 passed and the two full/partial deletion cases failed. The owner
snapshot fix preserves all routes and actual 410 after both mutations.
The original 38 real HTTP retired
route checks remain intact. The subsequent 51-test suite includes copied-router,
late registration/dispatch mutation and response-copy isolation negatives.
Early static, renamed-parameter and doubled-slash competitor fixtures actually
dispatch to a live handler; observation refuses without invoking it. These
registration fixtures are explicit test doubles, not production route changes.
The literal-star case follows actual router matching. Existing tests intercept
the external database pool before it can connect and require zero queries and
zero checkouts for retired requests. No PostgreSQL or startup is exercised.

Focused execution uses an explicit temporary Node config containing only
`server/app.catalogRetirement.test.ts`, one worker and `passWithNoTests: false`,
with no global setup or setup files, under `env -i`. The generic server config
must not be used for this resource-free check. Strict targeted TypeScript passes
separately; broader build/Hosted acceptance belongs to parent integration.
