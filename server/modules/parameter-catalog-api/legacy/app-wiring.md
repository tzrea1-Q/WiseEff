# Retired Catalog routes in the application composition root

Chinese: [中文](app-wiring.zh-CN.md)

The candidate already registers the #677 retirement adapter unconditionally.
Its frozen `parameterCatalogLegacyWriteRouteIds` includes structural mutations
and retired administrative GET operations. These routes return 410 without
executing the former service, regardless of supplied release or replay headers.

`buildWiseEffRouter` previously registered the original parameter modules first
and the retirement adapter afterwards. The HTTP router selects the first of
equal method/path matches. Consequently the real application could execute the
original route even though the retirement adapter's own tests returned 410.

The composition root now filters those exact method/path registrations while
registering the original parameter modules. The existing Catalog adapter remains
their single route owner. The global router precedence, non-retired business
operations and bounded legacy reads remain unchanged. The filter is derived
from the existing frozen route manifest; it is not another retirement list.

The adapter also matches that same frozen retirement manifest before resolving
the current Catalog release. A database outage or missing query permission must
not turn an unconditional retired-write response into a 500. Bounded reads still
resolve their required Catalog state through the existing path.

## Scope and threat cases

| Case | Required observation |
| --- | --- |
| Retired route also registered by an older module | Exactly one registered handler; HTTP 410; no former service/database work |
| Retired administrative GET or mutation | Same typed 410 and successor header |
| Replay/release headers or a claimed administrator in the body | Still 410 on both requests; no mutation |
| Non-retired business route or bounded legacy read | Original registration and behavior retained |
| Candidate without an approved startup boundary | This routing filter grants no startup permission; runtime admission remains separate |

`server/app.catalogRetirement.test.ts` exercises `createWiseEffServer` over real
local HTTP and enumerates the frozen retirement routes. The matrix constructs a
real branded `createPostgresDatabase` root, intercepts its pool's query/connect
boundary with failures, checks zero access on both requests and closes every
pool. This covers the production composition branch without opening a database
connection. The initial regression uses the real old service path to detect
access to the old source. This is application route composition
evidence, not real database authorization, startup, P13 grant retirement or full
controller evidence. The original source deployment checkout/image is not changed.

The parent owns startup/controller integration and independent Standards/Spec
review. This change adds no migration, grant, environment flag or approval.

## Documentation impact

This English file and its Chinese companion describe the changed app composition
boundary. Existing #677 route contracts and generated API paths do not change;
route parity must still pass. The overall upgrade plan and exact execution
evidence remain owned by the parent coordinator.
