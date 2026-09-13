# Catalog authoring and publication control plane

> Chinese: [Chinese](../zh-CN/design-docs/catalog-authoring-and-publication-control-plane.md)

Status: **locked CP-00 contract**. Not implementation, not Hosted evidence, not target-host adoption, and not production authorization.

Normative decision: [ADR-0043](../adr/0043-catalog-authoring-and-online-publication.md). Execution: [2026-09-12 catalog authoring and publication](../exec-plans/active/2026-09-12-catalog-authoring-publication.md). Baseline verification (separate lane): [catalog publication baseline verification](../references/catalog-publication-baseline-verification.md).

Accepted `origin/main` at freeze: `063b12c49dbc134e83103c77b813188e34f09461`. Re-fetch before each later dispatch.

## 1. Goal

Administrators select an existing subject or create a subject, fill a supported parameter contract, preview impact, and publish according to capability and policy. The system builds a complete successor, compiles with the existing compiler, checks authorization, activates atomically, and refreshes reads. Routine in-policy data publication must not require editing Git, typing digests, running an admin CLI, or restarting the application.

M1 vertical loop (must actually work):

> current complete release → add one supported Definition under an existing Subject → page preview and publish → new DTS ingest matches → workbench saves a value → publish another definition → restart rereads → original definition and project history remain.

M2 adds new Driver/NodeType, definition revision, and vendor YAML import coexisting with page increments. D1 bulk vendor coverage does not replace D2 continuous page expansion.

## 2. Current vs target (do not let stale docs win)

| Topic | Current at `063b12c49` | Target |
| --- | --- | --- |
| Authoring | Repository YAML / `scripts/compile-vendor-catalog-release.ts` / install CLI | Page ChangeSet and controlled YAML import into the same pipeline |
| Installer | `installPublishedRelease` already has bootstrap/advance, `expectedCurrent`, exclusive lock, kernel-owned transaction | Same installer plus Authorization + pre-commit projection check + Activation Receipt |
| Proposal accept | Requires `repositoryReference`; writes `catalog_publication_intents` only | Still does not materialize; grows a structured publication reference; forbids fake Git URLs |
| Runtime pin | `readApprovedRuntimePin` still requires exact P13 / writer-retirement fingerprint / pin match | Retain those application-approval checks; combine with Catalog activation facts |
| `new-empty` | Read-only verify of an already-installed Catalog; no reset | Same, plus later online publishes must survive upgrade/restart |
| Kernel interface doc (2026-09-01) | Still says install/verify were `permission-denied` pending S3-INS/S3-VFY | Historical relative to landed installer. Recorded here; #668 nodes are not reopened |

## 3. Frozen relations and writers

Physical schema `catalog_publication` is new. Catalog core tables stay in `parameter_catalog`. CP-02 confirms the next migration number at merge time; do not reserve `0140` in this freeze if main has moved.

| Relation | Responsibility | Writer | Mutability |
| --- | --- | --- | --- |
| `catalog_publication.release_artifacts` | Exact Artifact bytes, source kind, toolchain, predecessor pin, aggregate digest. Id prefix `cart_`. Unique `artifact_digest`. | publication coordinator | Insert-only |
| `catalog_publication.candidates` | Immutable Candidate: `artifact_id`, `artifact_digest`, expected base pin, proposal/revision, frozen identity allocation, impact report digest, capability contract. Id prefix `ccand_`. | publication coordinator | Insert-only |
| `catalog_publication.publication_authorizations` | Append-only approve/revoke facts bound to the Candidate tuple in ADR-0043 §1. Real actor. Id prefix `cauth_`. | publication coordinator | Insert-only |
| `catalog_publication.publication_jobs` | Execution projection, idempotency key, request digest, lease/fencing token, attempt count, failure class. Id prefix `cjob_`. | publication coordinator | Mutable status only |
| `parameter_catalog.catalog_activation_receipts` | Immutable Receipt: job, authorization, release pin, predecessor pin, verification digest, kind `online-publication \| adopted-preexisting \| bootstrap`. Id prefix `crct_`. Unique `publication_job_id`. | **synchronizer only**, same transaction as pointer/heads | Insert-only |
| existing `definition_proposals` / `definition_proposal_revisions` | Draft and review. Extend with a tagged ChangeSet body; do not stuff untyped JSON and call the contract done. Drafts may name unpublished draft subject keys but must not put unpublished IDs in Catalog FKs. | proposal service / application role | Existing state machine plus revision |
| existing `catalog_publication_intents` | Keep. Add a tagged `publication_reference` (`repository` or `candidate`) so acceptance is not forced through a fake `repositoryReference`. | proposal service | Insert-only as today |
| `parameter_catalog.catalog_releases` and all Catalog core tables | Unchanged ownership | synchronizer only | Unchanged |

Do not create a parallel task-history, approval-history, and event-bus triad in v1. Trusted audit remains the history store. Mutable job status must not erase history.

### Source kind

`typed-changeset | vendor-yaml | repository-bundle | adopted-preexisting`

### Job states

`queued → running → active`

Exceptions: `needs-rebase`, `blocked`, `failed-retryable`, `failed-terminal`, `cancelled`.

UI may project `active-superseded` when a Receipt exists and a later legal successor is current.

`accepted` ≠ `active`. Queue success returns a job resource, not a fake published definition.

## 4. ChangeSet contract

Closed tagged union. Unknown tags fail closed.

### M1 open

```ts
type CreateDefinitionChange = {
  readonly op: "create-definition";
  readonly subjectId: string; // already published opaque id
  readonly propertyKey: string; // S0-ID constructor, no client normalization
  readonly content: SupportedDefinitionContent; // capability whitelist
};
```

### M2 core (tests may exist in CP-03; product entry in CP-10)

```ts
type CreateSubjectWithDefinitionsChange = {
  readonly op: "create-subject-with-definitions";
  readonly kind: "driver" | "node-type";
  readonly canonicalKey: string;
  readonly selector: DriverSelector | NodeTypeSelector;
  readonly definitions: readonly CreateDefinitionChange[]; // subjectId omitted; allocated together
};

type ReviseDefinitionChange = {
  readonly op: "revise-definition";
  readonly definitionId: string;
  readonly class: "documentation" | "semantic";
  readonly content: SupportedDefinitionContent;
};
```

A Candidate is a frozen list of these ops plus frozen opaque IDs for every new entity. Rebuild after rebase allocates IDs only for entities that were never published; published natural keys cannot change.

Unsupported: property rename / identity reuse, executing arbitrary custom constraints, org-private definitions, batch incompatible Binding migration, first UI bootstrap of an empty Catalog.

### Supported content whitelist (M1)

M1 allows only types and constraints the current runtime already interprets. The exact whitelist is owned by CP-03 against `parameter-catalog-contract` and must start as a fail-closed allow-list, not “JSON that looks like schema.” CP-03 rejects unknown `valueShape`, units, or constraint tags. Mixed vendor shapes that already compile through the existing compiler remain compiler problems for D1; the page whitelist is narrower than the vendor compiler.

## 5. Risk and policy

Server-side classifier (clients cannot lower it):

| Class | Examples |
| --- | --- |
| `low` | Add a supported Definition to an existing Subject with no matcher/selector/fallback change and no tighter constraint on an already-used contract |
| `high` | New Driver or NodeType; selector/alias change; unit or semantic change; tighter constraints; matcher/fallback impact; retirement |

Policy row `catalog_publication.publication_policies` (singleton or versioned):

- `low_risk_single_actor_publish`: boolean, default false.
- `publication_enabled`: boolean, default false until CP-12.
- `capability_contract_revision`: text.

High-risk always needs `catalog:review-high-risk` by a different real principal than the author. The worker/manager identity cannot be that principal.

## 6. API freeze

Do not hand-write a parallel OpenAPI. CP-07 extends the existing generated `/api/v2/catalog/*` contract (S8-CON mechanism). Names below are the CP-00 freeze.

| Method and path | Contract |
| --- | --- |
| Existing proposal create/submit/withdraw/accept/reject | Retained. Accept still does not materialize. Accept of a structured publication reference records Authorization intent, not Catalog rows. Self-accept remains `proposal-self-approval-forbidden` unless the self-hosted low-risk policy applies to a **low-risk** Candidate and the actor has `catalog:publish`. |
| `POST /api/v2/catalog/publication-candidates` | Build-and-freeze preview. Input: proposal revision and/or tagged ChangeSet, plus `X-WiseEff-Catalog-Release`. Output: Candidate id, impact summary, risk class, capability contract, **no** requirement that the user type digest/version/Git URL. |
| `GET /api/v2/catalog/publication-candidates/{candidateId}` | Immutable Candidate projection for the caller’s scope. |
| `POST /api/v2/catalog/publication-candidates/{candidateId}/publish` | Policy-gated approve-and/or-enqueue. Body: `{ "idempotencyKey": "…" }`. Returns a job, not a definition. |
| `GET /api/v2/catalog/publications/{jobId}` | Job state, failure reason, rebase instructions. `effective` is true only when a Receipt is readable. |

Ordinary handlers must not run the synchronizer in the request transaction.

### Error `details.reason` additions

Existing reasons in `parameter-catalog-api-transition.md` stay. Add:

| `details.reason` | HTTP | When |
| --- | --- | --- |
| `publication-not-authorized` | 403 | Missing Authorization or capability |
| `publication-capability-missing` | 403 | No `catalog:author` / `catalog:publish` / `catalog:review-high-risk` |
| `publication-self-approval-forbidden` | 403 | High-risk self-approve, or low-risk self-approve while policy is off |
| `publication-policy-disabled` | 403 | Feature flag/policy off |
| `publication-frozen` | 409 | Application upgrade/maintenance freeze |
| `candidate-stale` | 409 | Draft moved or base drifted; rebuild required |
| `candidate-tampered` | 409 | Artifact/digest/authorization tuple mismatch |
| `needs-rebase` | 409 | Predecessor no longer current |
| `unsupported-catalog-capability` | 422 | Content outside whitelist or running images cannot interpret it |
| `publication-authorization-revoked` | 409 | Revoked after enqueue; not linearized into activation |
| `idempotency-key-conflict` | 409 | Same key, different request digest |
| `artifact-missing` | 409 | Predecessor Artifact bytes unavailable; do not reconstruct from DB |
| `predecessor-incomplete` | 409 | Successor omits required membership |
| `activation-receipt-mismatch` | 409 | Job/release/receipt disagree on recovery |
| `adoption-evidence-invalid` | 409 | `adopted-preexisting` bundle/history/projection fails |
| `registration-followup-failed` | 200 + nested failure | Catalog publish succeeded; organization registration did not. Never rewrite publish as rolled back. |

`needs-rebase` is a domain reason, not a silent retry.

## 7. Roles and grants

| Identity | May write | Must not write |
| --- | --- | --- |
| Web / governance API (`application_role`) | Drafts, proposals, publish *requests* | Catalog core, Receipts, self-grant |
| Publication coordinator (`catalog_publication_coordinator_role`) | Artifact/Candidate/Authorization/jobs | Catalog core, heads, Receipts |
| Synchronizer (`catalog_synchronizer_role`) | Catalog core + Receipts; column-level heads/`catalog_state` | HTTP-asserted authorization; rewriting immutable history |
| Runtime read | Current/pinned snapshots | Compile-time writes, backfill, publish |
| Migration owner | New schema/roles; one-time adoption DDL | Daily Catalog content |
| Baseline reader (CP-01 collector) | nothing | everything except SELECT on named relations |

CP-02 proves this with real PostgreSQL roles, not superuser tests. Direct Catalog SQL, Artifact mutation, and forged Receipts must fail.

The manager process reuses the application image with a distinct process entry and database role. PostgreSQL `SKIP LOCKED` is only for job claim, never for reading the Catalog.

## 8. Kernel activation sequence

Normative order inside `installPublishedRelease` for `mode: "advance"` online publication:

1. Take the existing catalog exclusive lock; honor maintenance lock order.
2. Re-validate Artifact digest, Candidate freeze, Authorization not revoked, actor still capable, policy still allows, expected current pin, capability contract, not frozen.
3. Stage materialization as today.
4. Recompute the candidate projection with verifier logic that does not trust the writer fingerprint, reading staged rows in **this** transaction.
5. Write Receipt + audit.
6. Switch heads and `catalog_state`.
7. Force deferred constraints.
8. Commit.

Failure before commit leaves the previous pointer and heads visible. Callers never pass a transaction. Do not add a second pointer. Do not “cut then verify.”

`adopted-preexisting` and explicit bootstrap are separate command kinds with the same lock and verifier, not a looser installer.

## 9. Application / Catalog combination rule

| Fact | Owner |
| --- | --- |
| Application approved to run | Release Verification `readApprovedRuntimePin` and its P13 / fingerprint / pin rules |
| Catalog true and complete | Receipt or `adopted-preexisting` proof plus independent projection check |

Ready = both. Forbidden:

- delete digest comparison to go green;
- rewrite an old report so it matches a new Catalog;
- treat a report that pinned Catalog A as approval of Catalog B;
- claim `new-empty` retired P13;
- auto-install the image’s vendor bundle on ordinary start;
- call a downtime CLI publish an “online” update.

Cache keys by digest. Invalidation is acceleration only. A new operation must not keep an old current forever if invalidation is lost. Long transactions must not mix new heads with old content.

Upgrade/recovery freeze: stop new publishes; wait or bound-abort in-flight jobs; then take the recovery point. Hiding the page button is not the freeze.

## 10. Threat matrix and test owners

Rows are Red before the owning package seals. Evidence is real PostgreSQL unless marked browser/Hosted.

| ID | Threat | Expected observation | Owner |
| --- | --- | --- | --- |
| T01 | Add Definition under existing Subject | One new definition and first revision; ingest/value work; prior rows unchanged | CP-03/05/08 |
| T02 | Frozen Candidate recompile / input permutation | Identical bytes/digest/IDs; unchanged items keep revisions | CP-03 |
| T03 | Page/HTTP/Agent/SQL bypass | Server denies; Catalog and Receipt row counts unchanged | CP-02/04 |
| T04 | Idempotency key same/different | Same request → same job; different digest → conflict; no double publish | CP-07 |
| T05 | Two Candidates, one predecessor | One commit, other `needs-rebase`; heads unmixed | CP-05/07 |
| T06 | Same natural key, different identity / alias owner | Compile/activate reject; no org/source precedence | CP-03/05/09 |
| T07 | Tamper Candidate, Artifact, or Authorization | Fail closed, no materialization | CP-02/04/05 |
| T08 | Revoke after enqueue | Execute-time recheck; no activation unless already linearized | CP-04/05/07 |
| T09 | Fault before materialize/verify/head/receipt/commit | Full rollback, no visible candidate | CP-05 |
| T10 | Activate success, response lost | Retry recovers from Receipt; no duplicate definition/revision | CP-05/07 |
| T11 | Recover R2 after R3 current | R2 `active-superseded`; no rewind, no reinstall | CP-07 |
| T12 | Worker crash, lease expiry, old worker returns | Reclaim allowed; stale fencing token cannot overwrite; Catalog side effect ≤ 1 | CP-05/07 |
| T13 | Missed cache invalidation, multi process, rolling restart | New ops see correct current; in-flight ops stay on captured pin | CP-06 |
| T14 | Unsupported schema / old image | Block publish or not-ready; no ignored unknown semantics | CP-03/06 |
| T15 | Documentation revision | New revision/head; Binding pins and values unchanged | CP-03/10 |
| T16 | Semantic revision | Old Binding/values stay on old pin | CP-10 |
| T17 | New Driver vs NodeType fallback | Impact reported; no silent rematch of history | CP-03/10 |
| T18 | Successor omits predecessor / missing Artifact | Reject; no DB backfill; omission ≠ retirement | CP-01/03/05 |
| T19 | Page add → vendor import → page add | All predecessors preserved; conflict visible | CP-08/09 |
| T20 | Ingest unpublished property / reprocess | Evidence/review only; no Definition mint; accepted matches unchanged | CP-08/10 |
| T21 | Publish ok, registration fails | Publish stays successful; registration retries on its aggregate | CP-08/10 |
| T22 | Upgrade/recovery vs in-flight publish | Freeze/lock blocks new activation; recovery point has no crossing publish | CP-06/12 |
| T23 | `new-empty` upgrade after publish + restart | No reset, no seed, no #824, no forged P13 | CP-06/11 |
| T24 | True-bundle adoption vs forged history | Explicit adoption proof vs block | CP-01/02/06 |
| T25 | Disable publish / stop manager | Existing Catalog readable; new publish forbidden or safely queued | CP-06/07/12 |
| T26 | App upgrade/rollback vs local Catalog increment | Legal upgrade does not overwrite local Catalog; incompatible image cannot run by skipping checks | CP-06/12 |
| T27 | Restore from consistent recovery point | Artifact, projection, auth/receipt, business values agree | CP-11/12 |
| T28 | Real page states and refresh | Honest pending/active/blocked/rebase; no fake success or leaked unauthorized data | CP-08/11 |

M1 minimum: T01–T14, T18, T22–T25, T28, plus existing project-value regression. M2 adds T15–T21, T26–T27. Enablement cannot skip recovery, compatibility, authz, or browser gates by pointing at a later matrix.

## 11. Out of scope

Do not rebuild the parameter domain model, restore `parameter_specs` as truth, dual-write, change source property identity, restore overlays, let users type hashes, match unpublished drafts, store arbitrary executable constraints, turn publication into a device-write channel, re-bootstrap the current instance, re-seed Catalog, edit old migrations, bundle #824, or treat current-main green as target evidence.
