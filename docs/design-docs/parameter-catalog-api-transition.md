# Parameter Catalog API and Legacy-Identifier Transition

> Chinese: [Chinese](../zh-CN/design-docs/parameter-catalog-api-transition.md)

Status: locked product and compatibility decision for [GitHub issue #677](https://github.com/tzrea1-Q/WiseEff/issues/677). S8-CON freezes the generated OpenAPI, route manifest, DTO schemas, stable `details.reason` values, and typed frontend client for this contract. HTTP handlers are still owned by S8-READ, S8-GOV, and S8-LEG and are not claimed here.

## Decision

WiseEff will introduce a canonical `/api/v2/catalog/*` resource namespace instead of changing the meaning of `ParameterSpec` in place or versioning unrelated APIs to `/api/v3`.

The contract separates five concepts that the legacy surface conflates:

1. immutable Platform Catalog releases, subjects, definitions, and definition revisions;
2. Organization-owned subject registrations and their one retained placement;
3. immutable parameter observations and the review work they can create;
4. Organization-authored definition proposals and Platform publication decisions;
5. project bindings and values that refer to canonical definitions and pinned revisions.

The existing project topology and binding paths remain in `/api/v2`; their consumers migrate atomically to canonical IDs and DTO fields. Bounded legacy read adapters exist only where this document says so. No target write is dual-written to the legacy model.

The product owner locked these policy choices on 2026-08-31:

- Authorized users may browse published subjects and definitions before their Organization registers a subject. The response exposes `registration.status = "unregistered"`; registration-dependent mutations fail with `registration-required`.
- An Agent is catalog-read-only in the first contract. It cannot create or submit proposals, register subjects, change placements, or resolve review work.
- An Organization Admin owns registrations, placements, review resolutions, and proposal submission for their home Organization. A Platform Admin reviews publication proposals and may read cross-Organization diagnostics, but does not mutate Organization structure. A person cannot accept their own proposal.
- Legacy structural writes retire when the canonical namespace launches. Eligible legacy reads remain for at least two production releases or 90 days, whichever is later, and retire only after every exit gate in this document passes.

## Decision basis

The contract was reconciled against current `origin/main` at `406c23bcaf0dcfca284de3135e27bfcd19c29c4e` and these accepted Wayfinder inputs. An accepted decision commit is design evidence even when it has not yet been integrated into `main`; this document does not claim otherwise.

| Input | Accepted evidence used here |
| --- | --- |
| [Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) | [`f982c76a`](https://github.com/tzrea1-Q/WiseEff/commit/f982c76a063f3c8bc0a7366d5253243ecba2866f): stable-ID and consumer inventory; old Effective/Governance/overlay surfaces are retirement inputs. |
| [Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) | [`000f617b`](https://github.com/tzrea1-Q/WiseEff/commit/000f617ba9810adda4798b4bc4b2bdfed95b4c39): R0-R10 classification and the prohibition on weak identity inference. |
| [Capture a representative populated-database rehearsal fixture](https://github.com/tzrea1-Q/WiseEff/issues/671) | [`6c3adfc3`](https://github.com/tzrea1-Q/WiseEff/commit/6c3adfc35c0e3be6d5d381013dace9408190380e): strict ten-case PostgreSQL fixture, including distinct same-key R6/R8 rows. |
| [Choose the canonical parameter-catalog relational model](https://github.com/tzrea1-Q/WiseEff/issues/672) | [`542c7a8b`](https://github.com/tzrea1-Q/WiseEff/commit/542c7a8bbce3bd6bb230b0d020d23d10af5182a9): release-scoped subject lifecycle and stable definition/revision/registration/placement identities. |
| [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673) | [`b5bf52cc`](https://github.com/tzrea1-Q/WiseEff/commit/b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb): completed read-only runtime facet, nominal IDs, exact current/pinned snapshots, deterministic Catalog pages, exact revision history, Catalog publication facts, tagged results, and kernel-owned transactions. |
| [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674) and [Choose organization registration and placement semantics](https://github.com/tzrea1-Q/WiseEff/issues/675) | [`9fe269d4`](https://github.com/tzrea1-Q/WiseEff/commit/9fe269d4facc31b49fc1e0535d2d51ba7140644b): integrated ADR-0040/0041/0042 publication, synchronization, registration, placement, observation, and proposal semantics. |
| [Prototype the single-page parameter-definition experience](https://github.com/tzrea1-Q/WiseEff/issues/676) | [`9c803557`](https://github.com/tzrea1-Q/WiseEff/commit/9c803557a55803ccca79c20eadd033f57d4729e0): one-page definitions, Registration/Placement context, Review Queue, timeline, and explicit ready/unregistered/empty/loading/error states. |
| [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678) | [`1839398b`](https://github.com/tzrea1-Q/WiseEff/commit/1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d): unique R0-R10 production dispositions, append-only typed mapping heads, immutable Archive evidence, and mandatory pre-switch semantic comparison. |

The repaired issue #673 read facet closes every canonical Catalog read in this decision without exposing transactions or adding routes to the Kernel. HTTP handlers adapt that interface; they do not duplicate matching, alias/lifecycle interpretation, revision selection, pagination, materialization, or transaction coordination. Issue #678 is the sole owner of production R0-R10 classification and mapping disposition. This API projects its typed mapping head and never reclassifies a legacy row.

## Scope and non-goals

This decision fixes routes, resource ownership, DTO state, authorization, error reasons, ID lookup behavior, consumer disposition, and deprecation rules. S8-CON now owns the generated OpenAPI, DTO, route, error, and client freeze. It does not:

- implement an HTTP handler, database migration, mock adapter, or UI;
- choose the catalog kernel's internal method names or transaction implementation owned by [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673);
- redesign project value editing, DTS text drafting, device debugging, or reload behavior beyond changing the catalog identities they consume;
- create implementation tickets or authorize a production rollout;
- expose raw migrated rows, archive payloads, scoring internals, or relational diagnostics to public clients.

## Contract vocabulary

| Term | API meaning | Owner | Mutability |
| --- | --- | --- | --- |
| `CatalogRelease` | Immutable manifest materialized by the synchronizer; one release is current. | Platform synchronizer | Append-only; current pointer switches atomically. |
| `CatalogSubject` | Stable typed `Driver` or `NodeType` identity. Current membership comes from the current release. | Platform synchronizer | Stable identity; release membership is immutable. |
| `ParameterDefinition` | Formal property contract unique by `(subjectId, propertyKey)`. | Platform synchronizer | Stable identity with one current immutable revision. |
| `DefinitionRevision` | Immutable definition content, including documentation-only changes. | Platform synchronizer | Immutable. |
| `SubjectRegistration` | Organization decision to use one active current-release subject. | Organization | `active` or `retired`; identity is retained. |
| `SubjectPlacement` | The registration's exactly-one retained navigation placement. | Organization | Rename/reparent in place; no hard delete. |
| `ParameterObservation` | Immutable evidence that a property was observed in a source. | Trusted internal ingest | Immutable. |
| `ParameterReviewItem` | Work produced by unknown, ambiguous, retired, or placement-conflicting evidence. | Organization | Explicit resolution state machine. |
| `DefinitionProposal` | Organization publication intent; acceptance does not create catalog rows. | Organization author, Platform reviewer | Draft/submitted/accepted/rejected/withdrawn. |
| `ProjectParameterBinding` | Stable project/logical-node/registration/definition association. | Project workflow | Mutable pointers to effective revision and current value under optimistic concurrency. |
| `ProjectValue` | Immutable value that pins a definition revision. | Project workflow | Immutable. |

IDs are opaque strings. Clients must never construct an ID from a property key, subject name, module, Organization, or source locator.

## Namespace, envelopes, and consistency

### Catalog anchor

`GET /api/v2/catalog` is the discovery and readiness document. A successful canonical catalog read is anchored to one materialized current release:

```json
{
  "item": {
    "catalogReleaseId": "crel_01K...",
    "releaseName": "2026.08.3",
    "releaseSequence": 42,
    "publishedAt": "2026-08-31T02:00:00Z",
    "materializedAt": "2026-08-31T02:01:12Z",
    "status": "ready",
    "links": {
      "subjects": "/api/v2/catalog/subjects",
      "definitions": "/api/v2/catalog/definitions"
    }
  }
}
```

Canonical catalog responses include `X-WiseEff-Catalog-Release: <catalogReleaseId>`. Collection envelopes use `items`, `nextCursor`, and a `catalogReleaseId`; item envelopes use `item`. Pagination is cursor-based with a deterministic `(stable sort key, id)` tie-breaker. The future OpenAPI contract will set bounded page limits without changing these semantics.

A write whose validity depends on current publication state sends `X-WiseEff-Catalog-Release` with the release observed by the client. Mutable Organization resources and proposals also use `If-Match` with their response `ETag`. A stale release returns `release-drift`; a stale resource returns `revision-conflict` or `proposal-stale`. Clients refresh and ask the user to re-confirm rather than silently retrying a governance write.

### Read defaults

- Subject and definition lists default to active membership in the current release.
- Definition lists default to `lifecycle=active`. `deprecated` and `retired` require an explicit filter and remain readable for history.
- An unregistered published subject and its definitions remain readable. `registration` is a distinct projection, never a filter that rewrites Platform truth.
- Historical reads name an exact `catalogReleaseId` or `definitionRevisionId`; they never reinterpret history through the current release.
- Organization scope comes from the path and trusted authorization context. A request body cannot assert a different effective Organization.

## Target resource matrix

Every route below is a target contract, not current implementation evidence.

| Resource | Method and path | Contract |
| --- | --- | --- |
| Catalog document | `GET /api/v2/catalog` | Current release, readiness, and canonical links. |
| Subjects | `GET /api/v2/catalog/subjects` | Filter by type, lifecycle, registration state, placement, or search text. |
| Subject detail | `GET /api/v2/catalog/subjects/{subjectId}` | Stable identity, current membership, aliases, registration projection, placement, and definition counts. |
| Subject definitions | `GET /api/v2/catalog/subjects/{subjectId}/definitions` | Current-release definitions for one subject. |
| Definitions | `GET /api/v2/catalog/definitions` | Current definitions; filters include subject, property key, lifecycle, registration, and search. |
| Definition detail | `GET /api/v2/catalog/definitions/{definitionId}` | Formal owner, current revision, registration/placement projection, constraints, and scoped usage summary. |
| Definition revisions | `GET /api/v2/catalog/definitions/{definitionId}/revisions` | Immutable reverse-chronological revision list. |
| Pinned revision | `GET /api/v2/catalog/definitions/{definitionId}/revisions/{revisionId}` | Exact immutable revision; never substitutes the current revision. |
| Definition timeline | `GET /api/v2/catalog/definitions/{definitionId}/timeline` | Publication and audit references safe for the caller; no raw migration rows. |
| Registrations | `GET, POST /api/v2/organizations/{organizationId}/subject-registrations` | List or explicitly register one active current-release subject. |
| Registration detail | `GET /api/v2/organizations/{organizationId}/subject-registrations/{registrationId}` | Stable status, method, subject, and current placement link. |
| Registration lifecycle | `POST .../{registrationId}/retire`, `POST .../{registrationId}/restore` | Retain the registration, placement, bindings, values, and history. |
| Placement | `GET, PATCH .../{registrationId}/placement` | Read or rename/reparent the retained placement using `If-Match`. |
| Observations | `GET /api/v2/organizations/{organizationId}/parameter-observations` | Read-only evidence list; creation is internal only. |
| Observation detail | `GET /api/v2/organizations/{organizationId}/parameter-observations/{observationId}` | Safe evidence, source reference, recognition outcome, and review link. |
| Review queue | `GET /api/v2/organizations/{organizationId}/parameter-review-items` | Unknown, ambiguous, placement-conflict, and retired-registration work. |
| Review detail | `GET /api/v2/organizations/{organizationId}/parameter-review-items/{reviewItemId}` | Evidence, candidates, status, and allowed resolutions. |
| Review resolution | `POST .../{reviewItemId}/resolve` | One explicit resolution; never creates an Organization definition. |
| Proposals | `GET, POST /api/v2/catalog/definition-proposals` | Role-scoped list or Organization-authored draft. The Organization is derived from trusted context. |
| Proposal detail | `GET /api/v2/catalog/definition-proposals/{proposalId}` | Immutable base release/revision plus mutable draft metadata. |
| Proposal workflow | `POST .../{proposalId}/submit`, `/withdraw`, `/accept`, `/reject` | Org Admin submits/withdraws; a different Platform Admin accepts/rejects. Acceptance records publication intent only. |
| Legacy identifier | `GET /api/v2/catalog/legacy-identifiers/{legacyType}/{legacyId}` | Bounded, authorized exact mapping lookup; no search or candidate disclosure. |
| Project bindings | `GET /api/v2/projects/{projectId}/parameter-bindings` | Existing path, canonical binding DTO and IDs after coordinated consumer cutover. |
| Binding history/compare | Existing `/api/v2/projects/{projectId}/bindings/{bindingId}/history` and `/compare` | Retained paths; entries pin canonical definition revisions and values. |
| Project drafts | Existing binding and node-enablement draft paths | Retained product behavior; inputs resolve through canonical binding/definition identity. |
| Operator diagnostics | `/api/v2/operator/parameter-catalog/*` | Deployment-operator-only reconciliation and migration diagnostics; never linked from public DTOs. |

### Catalog Kernel read closure

Canonical Catalog reads use only `CatalogRuntime` from the repaired issue #673 contract at `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb`. Current reads call `loadCurrentCatalog(expectedPin)`; historical reads call `loadPinnedCatalog(exactPin)`. The HTTP adapter validates wire syntax and maps tagged results. It cannot read Catalog tables, call a raw Catalog repository, interpret aliases or lifecycle, select a current revision, sort or post-filter a Kernel page, or fill a missing result from another Catalog source.

| Canonical Catalog read route | Typed Kernel read and authorized composition |
| --- | --- |
| `GET /api/v2/catalog` | `loadCurrentCatalog(expectedPin)` and `snapshot.release`; the independent readiness seam supplies readiness status. |
| `GET /api/v2/catalog/subjects` | `listSubjects(query)`; an authorized Organization ID selection, when required, is supplied before Kernel pagination. |
| `GET /api/v2/catalog/subjects/{subjectId}` | `getSubject(subjectId)` supplies stable identity, captured membership, aliases, and Definition counts; Registration/Placement projection comes from its owning seam. |
| `GET /api/v2/catalog/subjects/{subjectId}/definitions` | `listDefinitions({ scope: { kind: "subject", subjectId }, ... })`. |
| `GET /api/v2/catalog/definitions` | `listDefinitions({ scope: { kind: "all" }, ... })`; any authorized ID selection is applied by the Kernel before ordering and paging. |
| `GET /api/v2/catalog/definitions/{definitionId}` | `getDefinitionById(definitionId)` supplies the release-selected revision; Registration, Placement, and usage projections come from their owning seams. |
| `GET /api/v2/catalog/definitions/{definitionId}/revisions` | `listDefinitionRevisions({ definitionId, ... })`; the Kernel owns reverse order and the release-bound cursor. |
| `GET /api/v2/catalog/definitions/{definitionId}/revisions/{revisionId}` | `getDefinitionRevision({ definitionId, revisionId })`; `revision-unavailable` never falls back to the selected revision. |
| `GET /api/v2/catalog/definitions/{definitionId}/timeline` | `listDefinitionTimelineFacts({ definitionId, ... })` supplies immutable Catalog publication/revision facts; an authorized application composer merges independent History/Audit events. |

The Definition timeline composition seam is strict. Kernel facts contain release/revision publication facts only. Actor, Proposal/Review, Registration/Placement, Binding/value, usage, and authorization-sensitive events come from the independent History/Audit seam. The application composer merges authorized streams with a composite cursor pinned to the Catalog release and History/Audit high-water marks; HTTP only maps the composed result and performs no Catalog join.

Registration, Placement, usage, Observation, Review Queue, Proposal, legacy-ID, project Binding, and operator-diagnostic resources remain outside the Catalog Kernel. Their owning modules may consume nominal Catalog IDs, a captured snapshot, or tagged Kernel results, but may not expand `CatalogRuntime` with writes or raw repositories.

### Registration command shape

Registration and Review resolution share this discriminated `PlacementIntent`:

- `{ "mode": "use-default" }` is the user's explicit choice of the Organization's reserved unclassified root. It is never a server-side fallback and never permits the service to guess a parent;
- `{ "mode": "choose-parent", "parentPlacementId": "spla_...", "displayName": "..." }` is the user's explicit choice of an existing parent and retained display label.

```json
{
  "subjectId": "csub_01K...",
  "placement": {
    "mode": "choose-parent",
    "parentPlacementId": "spla_root_drivers",
    "displayName": "Charging ICs"
  },
  "reason": "Adopt the published SC8562 schema"
}
```

The command requires the current `X-WiseEff-Catalog-Release` anchor and an `Idempotency-Key`. The server derives `organizationId`, actor, and registration method from trusted context. `choose-parent` validates that the parent is visible in the same Organization, active, valid for the child taxonomy kind, and introduces no cycle or concurrent placement conflict. A Driver placement may use the reserved Driver root or a valid business-category parent. A NodeType placement may use its reserved root, a valid business-category parent, or an active registered Driver/NodeType parent only where the taxonomy rules permit it. A visible same-Organization parent with the wrong kind, retired lifecycle, or a cycle returns `invalid-placement-parent`; an out-of-scope parent is scope-hidden.

One transaction creates the Registration and its exactly one retained Placement and appends the audit record. Any failure rolls back all three writes. An exact replay of the same `Idempotency-Key` and request fingerprint returns the stored success without another Placement or audit event; reuse with a different fingerprint returns `revision-conflict`. An already-active Registration is idempotent only when its retained Placement represents the exact requested intent; otherwise it returns `placement-conflict`. Registration of an unpublished or retired subject fails closed.

### Review resolution shape

`POST /api/v2/organizations/{organizationId}/parameter-review-items/{reviewItemId}/resolve` requires all three preconditions:

```text
X-WiseEff-Catalog-Release: crel_01K42
If-Match: "review-item-prev_01KAMBIG-v7"
Idempotency-Key: resolve-review-prev-01KAMBIG-v7
```

Explicit default-placement selection:

```json
{
  "resolution": {
    "type": "register-subject",
    "subjectId": "csub_01KSC8562",
    "placement": {
      "mode": "use-default"
    }
  },
  "reason": "Authoritative compatible evidence confirms the published driver"
}
```

Explicit parent selection:

```json
{
  "resolution": {
    "type": "register-subject",
    "subjectId": "csub_01KSC8562",
    "placement": {
      "mode": "choose-parent",
      "parentPlacementId": "spla_root_drivers",
      "displayName": "Charging ICs"
    }
  },
  "reason": "Place the selected published driver under the approved category"
}
```

Restore without a new Placement intent:

```json
{
  "resolution": {
    "type": "restore-registration",
    "registrationId": "sreg_01KACME"
  },
  "reason": "Restore the retained Organization registration and placement"
}
```

Allowed `resolution.type` values are:

- `register-subject`: register an active current-release subject and create its exactly one retained Placement from the required discriminated `placement` intent;
- `restore-registration`: restore the retained Registration identified by `registrationId`; this variant rejects a `placement` field, reuses the retained Placement, and never creates a second Placement;
- `mark-out-of-scope`: close the evidence without creating structural truth;
- `open-definition-proposal`: create a linked draft proposal for a missing Platform definition.

For `register-subject`, one transaction creates the Registration, its Placement, the Review Item resolution, and the audit record. No partial Registration or resolved Review Item survives a failure. The Catalog release anchor must still be current or the command returns `release-drift`. The Review Item `If-Match` must identify its unresolved current ETag; a missing/stale tag or an already-resolved item returns `revision-conflict`. An exact replay of the same idempotency key and complete request fingerprint returns the stored result without a second Placement, resolution, or audit event; reuse with a different fingerprint returns `revision-conflict`. An existing exact Registration/Placement may be reused to resolve the item; a conflicting retained Placement returns `placement-conflict` and leaves the item unresolved.

The successful atomic response for the `choose-parent` example emits `ETag: "review-item-prev_01KAMBIG-v8"` and this body:

```json
{
  "item": {
    "reviewItem": {
      "id": "prev_01KAMBIG",
      "status": "resolved"
    },
    "registration": {
      "id": "sreg_01KACME",
      "subjectId": "csub_01KSC8562",
      "placement": {
        "id": "spla_01KCHARGING",
        "parentPlacementId": "spla_root_drivers",
        "displayName": "Charging ICs"
      }
    },
    "catalogReleaseId": "crel_01K42"
  }
}
```

Unknown or ambiguous evidence cannot resolve directly to a new definition. A human selection records the chosen existing published Subject and resolves only the Review Item/evidence decision; it does not create a Definition, DefinitionRevision, or recognized Binding. Any later Binding recognition uses its ordinary independently authorized command. `open-definition-proposal` creates only a proposal; it creates no subject, definition, revision, registration, placement, or binding.

## DTO and product-state examples

### Ready, registered subject

```json
{
  "item": {
    "id": "csub_01KSC8562",
    "type": "Driver",
    "canonicalName": "southchip,sc8562",
    "membership": { "status": "active", "catalogReleaseId": "crel_01K42" },
    "registration": {
      "status": "active",
      "id": "sreg_01KACME",
      "method": "explicit",
      "placement": {
        "id": "spla_01KCHARGING",
        "displayName": "Charging ICs",
        "parentPlacementId": "spla_root_drivers"
      }
    },
    "definitionCounts": { "active": 14, "deprecated": 1, "retired": 0 },
    "reviewCount": 0
  }
}
```

### Published but unregistered subject

```json
{
  "item": {
    "id": "csub_01KSC8562",
    "type": "Driver",
    "canonicalName": "southchip,sc8562",
    "membership": { "status": "active", "catalogReleaseId": "crel_01K42" },
    "registration": { "status": "unregistered" },
    "definitionCounts": { "active": 14, "deprecated": 1, "retired": 0 },
    "availableActions": ["register"]
  }
}
```

The client may show the 14 published definitions, but binding or value commands fail with `registration-required` until registration succeeds. The API never auto-registers because a user viewed a subject.

### Definition detail and pinned revision

```json
{
  "item": {
    "id": "pdef_01KGPIOINT",
    "subject": {
      "id": "csub_01KSC8562",
      "type": "Driver",
      "canonicalName": "southchip,sc8562"
    },
    "propertyKey": "sc,gpio-int",
    "lifecycle": "active",
    "currentRevision": {
      "id": "drev_01K7",
      "revisionNumber": 7,
      "valueShape": { "kind": "phandle-array" },
      "constraints": { "minItems": 1, "maxItems": 1 },
      "documentation": "Interrupt GPIO reference.",
      "publishedInCatalogReleaseId": "crel_01K42"
    },
    "registration": { "status": "active", "id": "sreg_01KACME" },
    "usageSummary": { "policyCount": 2, "projectCount": 6, "currentValueCount": 5 },
    "links": {
      "revisions": "/api/v2/catalog/definitions/pdef_01KGPIOINT/revisions",
      "timeline": "/api/v2/catalog/definitions/pdef_01KGPIOINT/timeline"
    }
  }
}
```

A documentation-only revision changes `currentRevision.id` but does not rewrite a binding's `effectiveRevisionId` or a value's pinned `definitionRevisionId`.

### Review item

```json
{
  "item": {
    "id": "prev_01KAMBIG",
    "organizationId": "org_acme",
    "reason": "observation-ambiguous",
    "status": "open",
    "observation": {
      "id": "pobs_01K9",
      "propertyKey": "interrupt-gpios",
      "sourceRef": { "kind": "project-config-revision", "id": "cfgrev_01K3" }
    },
    "candidates": [
      { "subjectId": "csub_01KA", "evidence": ["compatible-match"] },
      { "subjectId": "csub_01KB", "evidence": ["ancestor-compatible-match"] }
    ],
    "allowedResolutions": ["register-subject", "mark-out-of-scope", "open-definition-proposal"]
  }
}
```

Candidates are published subjects, not provisional definitions. Raw scoring and migrated row payloads stay internal.

### Submitted proposal and canonical binding

```json
{
  "item": {
    "id": "dpro_01KNEWPROP",
    "organizationId": "org_acme",
    "status": "submitted",
    "base": {
      "catalogReleaseId": "crel_01K42",
      "definitionId": "pdef_01KGPIOINT",
      "definitionRevisionId": "drev_01K7"
    },
    "requestedChange": {
      "kind": "revise-definition",
      "documentation": "Clarify the interrupt cell contract."
    },
    "submittedByPersonId": "person_org_admin_1",
    "acceptedByPersonId": null,
    "publicationIntentRef": null,
    "version": 3
  }
}
```

If a different Platform Admin accepts this proposal, `publicationIntentRef` records the repository or publication-workflow reference. It still does not contain a new definition or revision ID; those appear only after a later Catalog release is published and synchronized.

The retained project binding path returns canonical identity rather than a `ParameterSpec` projection:

```json
{
  "id": "pbind_01KPROJECT",
  "projectId": "project_1",
  "logicalNodeId": "lnode_sc8562_1",
  "subjectRegistrationId": "sreg_01KACME",
  "definitionId": "pdef_01KGPIOINT",
  "effectiveRevisionId": "drev_01K6",
  "currentValueId": "pval_01KVALUE",
  "recognizedAgainstCatalogReleaseId": "crel_01K41"
}
```

The release and revision IDs make a deliberately older effective revision visible rather than silently presenting it as the current definition.

### Empty and loading states

An empty collection is successful and states why:

```json
{
  "items": [],
  "nextCursor": null,
  "catalogReleaseId": "crel_01K42",
  "emptyReason": "no-filter-match"
}
```

`emptyReason` is one of `no-registrations`, `no-definitions`, `no-review-work`, or `no-filter-match`. Loading is client state, not a server resource state. A client keeps the prior release visible while loading only if it labels it stale and does not enable writes against it.

## Authorization matrix

Authorization uses trusted server-owned principal and Organization context. Headers or bodies cannot self-assert a role, Organization, Agent identity, or System identity.

| Capability | Ordinary user | Organization Admin | Platform Admin | Agent | Trusted System / synchronizer |
| --- | --- | --- | --- | --- | --- |
| Read active subjects and definitions | In authorized Organization scope | Yes | Yes, cross-Organization read projection | Same read scope as invoking principal | Internal |
| Read scoped definition usage/history | Authorized project/org only | Home Organization | Cross-Organization support read with audit | Same as invoking principal | Internal |
| Register, retire, or restore subject | No | Home Organization only | No | No | Auto-register only from unique authoritative proof; never restore from observation |
| Rename or reparent placement | No | Home Organization only | No | No | No public System route |
| Read observations/review queue | Own authorized work | Home Organization | Cross-Organization support read | Read-only if invoking principal could read it | Internal |
| Resolve review work with an explicit Placement intent | No | Home Organization only | No | No | Deterministic internal recognition may close only a uniquely proven case; it cannot choose `use-default` or `choose-parent` for ambiguous evidence |
| Create/submit/withdraw proposal | No | Home Organization only | No | No | No |
| Accept/reject proposal | No | No | Yes, except own proposal | No | No |
| Materialize/switch Catalog release | No | No | No public API | No | Synchronizer only |
| Read raw migration diagnostics | No | No | Only with separate deployment-operator authority | No | Operator/reconciliation jobs only |

Platform Admin and deployment Operator are not synonyms. An operator-only route returns `404 migration-diagnostics-not-public` on the public router and `403 forbidden` when the operator router is reached without operator authority.

All Organization mutations, proposal transitions, System auto-registration, and release switches require a trusted invocation context and an audit record. Only an Organization Admin may supply the `PlacementIntent` for an ambiguous Review Item; Agent, Platform Admin, and System principals cannot impersonate that human choice. Proposal acceptance requires `acceptedByPersonId != submittedByPersonId`.

## Error contract

The target keeps the existing WiseEff error envelope and generic top-level codes. Domain distinctions live in stable `error.details.reason`; clients must not parse `message`.

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The catalog release changed. Refresh before continuing.",
    "details": {
      "reason": "release-drift",
      "expectedCatalogReleaseId": "crel_01K41",
      "currentCatalogReleaseId": "crel_01K42",
      "retryable": true
    },
    "requestId": "req_01K..."
  }
}
```

| `details.reason` | HTTP / top-level code | Applies to | Client behavior |
| --- | --- | --- | --- |
| `catalog-not-ready` | 503 / `SERVICE_UNAVAILABLE` | Catalog materialization/readiness is incomplete or failed. | Keep writes disabled; honor `Retry-After`; show error, not empty. |
| `release-drift` | 409 / `CONFLICT` | Client release anchor is no longer current. | Refresh and require renewed confirmation. |
| `subject-not-published` | 404 / `NOT_FOUND` | Subject is absent from the named/current release. | Do not infer or create it. |
| `subject-retired` | 409 / `CONFLICT` | Mutation targets a retired current-release membership. | Show lifecycle state; no automatic restore. |
| `definition-not-found` | 404 / `NOT_FOUND` | No scoped canonical or pinned definition exists. | Show not found. |
| `definition-retired` | 409 / `CONFLICT` | New binding/value mutation targets a retired definition. | Historical read remains available; block mutation. |
| `legacy-id-ambiguous` | 409 / `CONFLICT` | Typed mapping has more than one provable disposition. | No candidate disclosure; operator reconciliation required. |
| `legacy-id-archived` | 410 / `GONE` | Row was deliberately archived outside operational reads. | Show historical-unavailable state. |
| `legacy-surface-retired` | 410 / `GONE` | Removed legacy route or mutation is called. | Migrate to the successor link; do not retry. |
| `registration-required` | 409 / `CONFLICT` | Binding/value action needs an active registration. | Offer explicit registration to Org Admin; never auto-write. |
| `placement-conflict` | 409 / `CONFLICT` | Registration or placement intent conflicts with retained identity/current placement. | Refresh placement and require user resolution. |
| `invalid-placement-parent` | 409 / `CONFLICT` | A visible same-Organization parent has the wrong taxonomy kind, is retired, or would create a cycle. | Keep the Review Item unresolved; require another valid explicit choice. |
| `observation-ambiguous` | 409 / `CONFLICT` | Caller tries to bind unresolved ambiguous evidence. | Open linked review item. |
| `proposal-stale` | 409 / `CONFLICT` | Proposal base release/revision is no longer current. | Rebase as a new reviewed proposal revision. |
| `proposal-self-approval-forbidden` | 403 / `FORBIDDEN` | Submitter attempts to accept their own proposal. | Require another Platform Admin. |
| `revision-conflict` | 409 / `CONFLICT` | Review `If-Match` is missing/stale, the item is already resolved, or an idempotency key is reused with another fingerprint. | Refresh; never silently overwrite or repeat governance writes. |
| `forbidden` | 403 / `FORBIDDEN` | Authenticated principal lacks action/scope. | Do not reveal out-of-scope data. |
| `migration-diagnostics-not-public` | 404 / `NOT_FOUND` | Public caller probes an internal diagnostic route. | Treat as nonexistent. |

`SERVICE_UNAVAILABLE` is a required future addition to the shared API error registry; this decision does not add it to production code. Unknown release, subject, definition, or legacy ID responses obey scope-hiding rules before distinguishing the reason.

## Legacy identifier mapping

### Typed resolver

The bounded resolver accepts only these allow-listed `legacyType` values:

- `parameter-spec`;
- `parameter-spec-version`;
- `project-parameter-binding`;
- `project-parameter-binding-revision`;
- `parameter-subject`;
- `parameter-placement`;
- `parameter-module`.

An exact authorized mapping returns:

```json
{
  "item": {
    "legacyType": "parameter-spec",
    "legacyId": "spec-sc8562-gpio-int",
    "disposition": "mapped",
    "target": {
      "kind": "parameter-definition",
      "id": "pdef_01KGPIOINT",
      "href": "/api/v2/catalog/definitions/pdef_01KGPIOINT"
    },
    "historicalOnly": false
  }
}
```

The resolver is lookup-only and classification-free. It reads the current append-only typed mapping head decided by issue #678 at `1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d` and projects that outcome without reinterpreting source shape, property name, or payload. It provides no prefix search, reverse enumeration, raw source fields, candidate list, confidence score, or archive payload. An authorized operational mapping, ReviewEvidence, or DefinitionProposal may return its typed target; an archive-only outcome returns 410, an ambiguous/blocked mapping returns 409, and an unknown or unauthorized identifier returns 404. The resolver never turns ReviewEvidence or a DefinitionProposal into a ParameterObservation, Definition, or Revision. Its responses carry the same deprecation headers and sunset as legacy reads.

### Mapping and archive matrix

| Legacy identity/reference | API projection of issue #678 typed mapping | Prohibited API inference |
| --- | --- | --- |
| R4/R5 `parameter_specs.id` | Map to the exact `ParameterDefinition.id` already materialized by the pinned Catalog Release; preserve the old ID in the typed map. R4/R5 are the only spec rows that may target a Definition. | Never choose a Definition from property/name similarity or from another release. |
| R6 `parameter_specs.id` | Primary production disposition is `ReviewEvidence`, with immutable Archive evidence and a typed mapping retained. | A definition-shaped R6 spec ID never maps directly to `ParameterObservation`. Only a separate occurrence graph with complete project, logical-node, and source-revision provenance may independently create a ParameterObservation under that graph's own source identity. |
| R8 `parameter_specs.id` | Map to `DefinitionProposal`, retaining the necessary immutable Archive and typed mapping evidence. | Never map an R8 spec ID directly to `ParameterObservation`, `ParameterDefinition`, or `DefinitionRevision`. |
| `parameter_spec_versions.id` | Only an R4/R5 version maps to the exact immutable `DefinitionRevision.id` already materialized by the pinned Catalog Release; historical links remain pinned. An R6/R8 version is retained only as immutable Archive/typed-mapping evidence attached to its parent ReviewEvidence/DefinitionProposal outcome. | Never point at the current revision as a substitute, and never promote an R6/R8 version into a Revision. |
| `project_parameter_bindings.id` | Preserve the stable ID when the association is provable, otherwise map one-to-one to the new stable binding ID. | Block if subject/definition identity is ambiguous; no property-key-only inference. |
| Binding revision/workflow references | Map to binding history and pinned definition/value references. | Archive the workflow evidence; do not manufacture a canonical binding. |
| Legacy subject IDs | Map only with authoritative typed Driver/NodeType identity proof. | Unknown/ambiguous roots become ReviewEvidence or Archive, never a Subject. |
| Placement and module IDs | Preserve a placement ID when ownership and registration are exact. Module/category IDs may map to navigation placement only when identity is proven. | Archive grouping-only modules; module equality never proves subject or definition identity. |
| Audit targets | Keep immutable legacy target fields and add a mapped target reference when exact. | Keep legacy audit evidence with archived/ambiguous disposition; never rewrite history. |
| Knowledge references | Rewrite to definition/revision only through exact mapping; keep legacy reference metadata. | Mark unresolved and exclude from current definition picker; do not silently retarget. |
| Debug/reload references | Resolve through exact binding/definition map at cutover and pin the required revision. | Block the operation and surface operator reconciliation; never choose by property key. |
| Export/import identifiers | New exports contain canonical IDs and schema version. Bounded legacy import resolves every row through typed mapping. | Reject the row with a stable reason; partial structural creation is forbidden. |
| Deep links/bookmarks | Redirect only exact authorized mappings to canonical detail. | Ambiguous shows conflict; archived shows gone; unknown/out-of-scope shows not found. |

The cutover decision in issue #678 is the sole owner of every R0-R10 production disposition. `Archive` evidence alongside ReviewEvidence or DefinitionProposal is provenance, not a second operational disposition. Every legacy-ID API projects the typed mapping head; it cannot reclassify a row. The archive ledger is append-only, typed, checksum-protected migration evidence. It is not a public catalog resource. Deletion of legacy tables or mapping records belongs to the later verified retirement decision; this API decision authorizes none.

## Legacy route disposition

| Legacy surface | Launch behavior | Final behavior |
| --- | --- | --- |
| `GET /api/v2/parameter-specs?view=effective` and exact detail | Read adapter backed by canonical definitions plus registration projection. | 410 after all sunset gates. |
| `view=governance`, raw/migration query modes | 410 immediately; governance history moves to definition timeline, raw diagnostics to operator routes. | 410. |
| `POST/PATCH /api/v2/parameter-specs` | 410 immediately. Organization-authored structural truth is not translated. | 410. |
| `activate`, `deprecate`, `restore`, `reattribute`, property-key rename and cutover actions | 410 immediately. Platform publication occurs through manifest synchronization; Org users may submit proposals. | 410. |
| `/api/v2/parameter-spec-review-tasks*` | GET may adapt only exact unresolved tasks during the read window; resolve returns 410 and links to canonical Review Queue. | 410. |
| `/api/v2/identity-mapping-tasks*` | GET may adapt exact review items during the read window; resolve/reopen returns 410. | 410. |
| `/api/v2/organization-driver-schemas*` and Platform promotion/revert routes | 410 immediately, including reads whose shape would imply an Organization schema overlay. | 410. |
| `/api/v2/parameter-modules` read/navigation | Bounded derived read adapter may expose placement navigation without claiming module identity. | 410; use subjects and placements. |
| Parameter-module mappings, registry writes, dismissals, recompute, replay | 410 immediately where they create structural truth; project-only recomputation moves behind internal project workflows. | 410. |
| Existing project topology, binding history/compare, validation, and draft paths | Coordinated first-party DTO/ID cutover; path remains. No legacy `ParameterSpec` field after launch. | Canonical v2 contract. |
| Existing v1 value, debug, reload, and knowledge calls | Public workflow remains unless separately versioned; implementation resolves canonical binding/definition/revision IDs internally. | Canonical identities only. |

Legacy read responses include:

```text
Deprecation: true
Sunset: <earliest announced HTTP-date>
Link: </api/v2/catalog>; rel="successor-version"
Warning: 299 WiseEff "Legacy ParameterSpec contract is deprecated"
X-WiseEff-Legacy-Contract: parameter-spec-v2
```

The announced `Sunset` is no earlier than two production releases or 90 days after canonical launch, whichever is later. It may move later if an exit gate is not satisfied; it never moves earlier. After retirement the same route returns 410 with `details.reason = "legacy-surface-retired"` and the successor link.

## Consumer transition matrix

| Consumer | Canonical dependency | Legacy disposition and required transition |
| --- | --- | --- |
| Parameter definitions page | Subjects, definitions, registrations/placement, Review Queue, definition timeline | Replace Effective/Governance peer views with the one-page contract; preserve URL-backed selection using canonical IDs. |
| `ParameterTopologyRepository` HTTP adapter | Existing project topology/binding routes plus catalog readers | Split catalog reading/governance from project topology; remove `ParameterSpec` create/update/lifecycle methods. |
| Mock parameter topology adapter | Same application ports and DTO states as HTTP | Version/reset mock fixtures; represent ready, unregistered, empty, loading, error, retired, and stale-release cases. No mock-only governance ability. |
| Project parameter workbench and value editing | Canonical binding ID, `definitionId`, `effectiveRevisionId`, `currentValueId` | Remove `parameterSpecId` and module-as-definition identity; preserve product workflow. |
| DTS ingest and recognition | Internal observation command, canonical subject matcher, registration policy | Unknown/ambiguous occurrence evidence may create observation/review only; no provisional spec. A ParameterObservation requires its own complete project/logical-node/source-revision occurrence provenance; R6/R8 legacy spec IDs never supply that identity. |
| File sync/writeback | Canonical binding plus pinned definition revision and source target | Fail closed on unresolved IDs; no property-key-only fallback. |
| Agent tools | Catalog read DTOs in invoking principal scope | Remove/disable structural write tools; no proposal, registration, placement, or review mutation in v1. |
| Log analysis | Safe canonical definition/revision references and immutable observation evidence | Preserve citations through exact mapping; unresolved evidence does not create definitions. |
| Node/device debugging | Canonical binding and pinned revision | Exact map or block; device write approval rules remain unchanged. |
| DTS reload | Canonical binding, value, definition revision, and release anchor | Verify all references before prepare/finalize; release drift blocks. |
| Knowledge definition picker | Active canonical definitions; explicit historical revision reads | Exact-map old references; unresolved legacy references are not selectable. |
| Module/driver registry UI | Subject type, registration, placement navigation | Retire module/Organization-schema structural ownership; keep unrelated device/module runtime concepts separate. |
| Imports and exports | Versioned canonical IDs and typed legacy resolver | New export only; bounded legacy import is all-row validated before any write. |
| Audit/history viewers | Canonical target plus retained legacy target metadata | Never rewrite historical actor, target, or decision evidence. |
| External API clients and bookmarks | Canonical routes or bounded typed resolver | Migrate during published window; resolver outcomes project issue #678's typed mapping head, exact deep links redirect, and other outcomes stay explicit. |
| Operations and migration tooling | Operator-only reconciliation APIs, typed mapping heads, and archive ledger | Never call public raw/governance modes or ask an API adapter to reclassify R6/R8; diagnostics require separate operator authority. |

## UI state coverage

The accepted one-page experience has an API-distinguishable state for every product state:

| UI state | API evidence | Required presentation rule |
| --- | --- | --- |
| Ready | Catalog document `status=ready`, collection 200, active release anchor | Enable only authorized actions and keep release ID with the view. |
| Unregistered | Published subject/definitions 200 with `registration.status=unregistered` | Show definitions and an Org Admin registration action; disable binding/value writes. |
| Empty | Collection 200 with an explicit `emptyReason` | Do not present as an error or infer missing publication. |
| Loading | In-flight client state with no newer successful response | Preserve layout; do not enable writes against an unconfirmed release. |
| Error | Structured error envelope, including 503 readiness or 409 drift | Show retry/refresh according to reason; never convert to an empty list. |
| Retired/deprecated | Explicit membership/definition/registration lifecycle on requested detail/filter | Historical read remains; new matching/binding rules are disabled as specified. |
| Review placement choice | Unresolved Review Item ETag, current release anchor, allowed `register-subject` resolution | An Org Admin must explicitly select `use-default` or `choose-parent`; no preselected or inferred parent. |
| Review resolution conflict | 409 with `placement-conflict`, `invalid-placement-parent`, `release-drift`, or `revision-conflict` | Preserve the user's selection, refresh the release/item/placement evidence, and require reconfirmation; show no partial Registration. |

## OpenAPI and frontend follow-up impact

The later implementation specification must update, in one coordinated cutover:

- the OpenAPI components for every resource, envelope, header, ETag, filter, lifecycle enum, the discriminated `PlacementIntent`, atomic review-resolution response, proposal transition, and error reason in this document;
- the shared error registry with `SERVICE_UNAVAILABLE` / 503 while retaining the current envelope;
- required `X-WiseEff-Catalog-Release`, `If-Match`, `ETag`, and `Idempotency-Key` behavior for Review resolution, including exact replay and conflicting-fingerprint tests;
- the route manifest and authorization tests, including public-versus-operator route separation;
- frontend application ports so catalog reading, Organization governance, proposal review, and project topology are separate interfaces rather than one shallow `ParameterTopologyRepository`;
- HTTP and mock adapters with contract parity and deterministic state fixtures;
- URL state/deep-link translation, knowledge pickers, project binding DTOs, Agent read tools, debug/reload adapters, import/export schemas, audit target rendering, and telemetry;
- consumer contract tests proving that no first-party code reads `parameterSpecId`, Organization overlay DTOs, module-as-definition identity, or Effective/Governance views after launch;
- route-to-Kernel contract tests proving all nine canonical Catalog read routes use the complete typed snapshot facet at `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb`, and that HTTP cannot reach Catalog tables/raw repositories or perform alias, lifecycle, selected-revision, ordering, or pagination policy;
- atomicity tests proving Registration + exactly one Placement + Review resolution + audit commit together, restore reuses the retained Placement, and every declared stable conflict leaves the Review Item unresolved.

This is impact routing, not an implementation plan or ticket list. Internal module methods may satisfy these capabilities under the interface/transaction decision from issue #673; this document does not assume its names.

## Launch, sunset, and rollback gates

Canonical launch requires the later release plan to prove all of the following on the same candidate revision:

1. the canonical schema and current release are ready on fresh and representative populated PostgreSQL paths;
2. every R0-R10 row has the one production disposition owned by issue #678: R6 spec IDs project ReviewEvidence plus immutable Archive/mapping evidence, R8 spec IDs project DefinitionProposal plus required Archive/mapping evidence, and neither is reclassified as a ParameterObservation;
3. all first-party consumers in the matrix use canonical IDs and contract tests pass;
4. no legacy structural write is reachable through HTTP, Agent, scripts, or jobs;
5. OpenAPI, HTTP, mock, authorization, audit, and browser-real one-page state checks pass;
6. a verified recovery point exists and rollback restores the pre-cutover application and data without relying on a reverse dual write.

Legacy reads may retire only when **all** of these are true and the minimum window has elapsed:

- at least two production releases and at least 90 days have passed since canonical launch;
- every first-party consumer, documented external integration, export/import workflow, and deep-link owner has a recorded disposition;
- legacy-read telemetry has been zero for 30 consecutive days in every supported deployment class;
- mapping/archive reconciliation has no unresolved blocking or ambiguous operational reference;
- the rollback window that needs legacy reads has expired;
- a deployment Operator signs the retirement evidence and a Platform owner approves the public sunset.

Failure of any gate extends the read adapter. It does not restore legacy writes or authorize dual write. Rollback before final retirement may restore the previous application against the verified recovery point; it must not project canonical mutations backward into legacy tables.

## Acceptance self-check

| Contract check | Fixed outcome |
| --- | --- |
| Route-to-Kernel closure | All 9 canonical Catalog read routes map to the typed snapshot read facet at `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb`; no HTTP-owned Catalog interpretation or repository fallback remains. |
| Placement intent | `PlacementIntent` is discriminated as explicit `use-default` or validated `choose-parent`; the server never guesses a parent. |
| Atomic Review registration | Registration + exactly one retained Placement + Review resolution + audit are one transaction. |
| Concurrency and replay | Current release anchor, Review Item `If-Match`/ETag, and `Idempotency-Key` are required; exact replay is idempotent. |
| Stable conflicts | `placement-conflict`, `invalid-placement-parent`, `release-drift`, and `revision-conflict` have fixed 409 semantics with no partial write. |
| Restore | `restore-registration` accepts `registrationId`, rejects Placement intent, and reuses the retained Placement. |
| Ambiguity boundary | Human choice may resolve evidence against an existing published Subject; it creates no Definition, Revision, or recognized Binding. |
| R6/R8 cutover truth | R6 is ReviewEvidence with Archive/mapping evidence; R8 is DefinitionProposal with Archive/mapping evidence; only an independently proven occurrence graph may create its own ParameterObservation. |
| Bilingual/OpenAPI parity | English and Chinese DTOs, matrices, reason tokens, headers, and follow-up impact name the same contract. |

## Decision completeness

The API decision has no remaining product-semantic choice:

- namespace and versioning are fixed;
- pre-registration visibility is fixed;
- human, Agent, System, synchronizer, and operator authority are fixed;
- proposal authorship and separation of duties are fixed;
- Review placement intent, validation, atomicity, concurrency, and idempotency are fixed;
- canonical resources, state projections, error reasons, ID outcomes, and legacy route behavior are fixed;
- Catalog read routes are closed through the fixed typed Kernel facet, and R6/R8 classification remains solely owned by issue #678;
- the minimum compatibility duration and evidence-based exit gates are fixed;
- all known frontend, binding/value, ingest, Agent, log, debug, reload, knowledge, import/export, audit, external, and operator consumers have a disposition.

Implementation mechanics that preserve these decisions may be specified later. A later specification may add pagination limits or audit event names, but it may not change ownership, lifecycle, authorization, mapping outcomes, route semantics, or retirement gates without reopening this decision.
