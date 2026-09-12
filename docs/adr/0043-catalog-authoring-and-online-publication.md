# ADR-0043: Catalog definitions are authored in-product and activated by one synchronizer

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0043-catalog-authoring-and-online-publication.md)

Date: 2026-09-12

## Status

Accepted as the destination publication-control-plane decision for in-product Catalog authoring. This record is ADR-0043. The next unused ADR number at `origin/main` `063b12c49dbc134e83103c77b813188e34f09461` was 0043; 0040–0042 remain the Wayfinder model, publication-integrity, and registration ADRs.

This ADR does **not** claim that the control plane, migrations, HTTP routes, UI, Hosted evidence, target-host adoption, or production enablement exist. It is a contract freeze for CP-00. Implementation follows [Catalog authoring and publication](../exec-plans/active/2026-09-12-catalog-authoring-publication.md).

Product direction was confirmed on 2026-09-12: administrators may write formal Catalog definitions inside the product; activation still requires a frozen immutable Catalog Release, bound authorization, and the unique Catalog synchronizer. Catalog data publication is decoupled from application code publication.

## Context

[ADR-0040](0040-canonical-parameter-catalog-relational-model.md) established one materializer, stable identities, immutable revisions, complete successors, and the rule that Proposal acceptance does not write Catalog rows. [ADR-0041](0041-platform-schema-catalog-releases-materialize-before-runtime.md) established that the only materialization input is an immutable Catalog Release, that PostgreSQL is a projection, and that product forms, directory scans, and organization data are not Catalog inputs. Those integrity rules remain necessary.

The exclusive reading that followed was: Catalog content can change only when a human edits the application repository, a reviewed bundle ships inside the application artifact, and an upgrade/synchronizer run installs it. That reading made adding one definition an application-release event. After a `new-empty` self-hosted Catalog bootstrap of `crel_acme_1`, operators needed a cheaper, still-authoritative way to extend the instance Catalog without forging Git URLs, writing Catalog tables from the web pool, or re-bootstrapping.

[#826](https://github.com/tzrea1-Q/WiseEff/pull/826) added a repository compiler and `advance` CLI for a vendor `catalog.json` successor. That is a valid D1 (bulk vendor coverage) path. It is not D2 (continuous in-product authoring) and must not become a second writer with different rules once the control plane exists.

The rejected extremes remain rejected:

- Web or SQL `INSERT` into `parameter_catalog` tables.
- Organization-private definitions, runtime overlays, or source-precedence.
- Fake `repositoryReference` values to satisfy the current Proposal-acceptance column.
- Reopening #824, forging P13 retirement, or treating `new-empty` as populated-data cutover.
- A general workflow platform, a second microservice repository, Kafka/Temporal as the first-version queue, or a second `active_catalog_pointer`.

## Decision

### 1. One pipeline, two authoring entries, one writer

```text
typed page ChangeSet ─┐
                      ├→ complete-successor Builder → existing Compiler
controlled YAML import┘                              ↓
                                            frozen Artifact + Candidate
                                                     ↓
                                      Candidate-bound Authorization
                                                     ↓
                                      durable Publication Job
                                                     ↓
                         independent manager process → unique Kernel installer
                                                     ↓
                    pre-commit projection check + Activation Receipt + pointer/heads
```

- A **ChangeSet** is typed intent. It is not a Catalog Release.
- An **Artifact** is the exact immutable compiled bundle bytes plus toolchain and input evidence. Projection rows cannot reconstruct it.
- A **Candidate** pins one Artifact, predecessor pin, frozen identity allocation, impact report, and capability contract. After freeze it is immutable. Draft edits require a new Candidate.
- An **Authorization** binds `candidateId + artifactDigest + expectedBaseRelease + proposalRevision + impactReportDigest + capabilityContract + policyRevision` to a real actor. Digest is integrity, not permission. The manager identity is never the approver.
- A **Publication Job** is an execution projection (`queued → running → active`, with `needs-rebase | blocked | failed-retryable | failed-terminal | cancelled`). `accepted` on a Proposal is not `active`.
- An **Activation Receipt** is written by the synchronizer in the same transaction as Catalog projection and `catalog_state` / definition heads. The UI may show “in effect” only after a Receipt exists.

The unique Catalog Release synchronizer remains the only steady-state writer of `CatalogSubject`, release membership, `ParameterDefinition`, `DefinitionRevision`, definition heads, `catalog_state.current_catalog_release_id`, and Activation Receipts. Ordinary API and business workers do not hold synchronizer credentials.

### 2. What ADR-0043 supersedes, retains, and leaves untouched

| Prior clause | Disposition |
| --- | --- |
| ADR-0040 “repository-reviewed publication” as the exclusive authoring source | **Superseded as exclusive source.** A Catalog Release remains the only materialization input; authoring may be a typed ChangeSet or controlled YAML import compiled into that Release. |
| ADR-0040 diagram edge `PUBLICATION_INTENT` fulfilled only by repository publication | **Replaced.** Fulfillment is Candidate + Authorization + synchronizer install. Historical `repositoryReference` remains one source kind. |
| ADR-0040 Proposal acceptance does not materialize Catalog rows | **Retained.** Acceptance writes intent/authorization facts only. |
| ADR-0040 unique synchronizer, complete successor, omission ≠ retirement, immutable revisions, no organization overlay, stable IDs | **Retained.** |
| ADR-0041 §1 “bundle shipped inside the target application artifact” as the only publication input | **Superseded.** Artifacts live in `catalog_publication.release_artifacts` (physical names in the control-plane doc). An application image may still carry a vendor bundle for explicit bootstrap; ordinary startup is verify-only and must not auto-install it over the database current Catalog. |
| ADR-0041 §1 “product forms are not catalog inputs” | **Superseded as a ban on typed authoring.** Forms emit ChangeSets. They do not write Catalog tables and do not invent a second digest algorithm. |
| ADR-0041 §5 synchronization as one-shot upgrade-only maintenance | **Partially superseded.** Online `advance` through the same installer is allowed when authorization, predecessor, capability, and pre-commit verification pass. Bootstrap remains explicit. Replay of the current digest remains a verified no-op. |
| ADR-0041 §6 “upgrade synchronization precedes application startup” for every Catalog content change | **Superseded for data publication.** Application upgrades still migrate, verify, and freeze in-flight publication. Catalog content may advance later without a new application SHA, provided every running API/worker image satisfies the capability contract. |
| ADR-0041 considered option “PostgreSQL or Admin UI authors the catalog” (rejected) | **Split.** UI as an authoring entry is now allowed. UI/PostgreSQL as a second structural truth, or UI writing Catalog tables, remains rejected. |
| ADR-0041 fail-closed compilation, exact digest contract, historical replay, no overlay, no pointer-only rollback after traffic | **Retained.** |
| ADR-0041 / verification-gates exact `readApprovedRuntimePin` / P13 / writer-retirement fingerprint comparison | **Retained for application approval.** Readiness is the conjunction of an approved application pin **and** a true current Catalog with Activation Receipt (or explicit `adopted-preexisting` proof). An old report does not approve later Catalog successors. `new-empty` must not claim P13 is retired and must not bundle #824. |
| ADR-0042 registration and placement | **Untouched.** Registration is not Catalog publication. A later registration failure must not present a successful Catalog publish as rolled back. |
| Frozen Wayfinder #668 53-node graph | **Untouched.** This program does not relabel or hide those nodes. |
| #824 populated old-value migration | **Out of scope.** Do not restore or merge that work as part of this program. |
| PR #825 Option 1 “web never publishes definitions” as standing product policy | **Superseded.** Option 1 remains historically true of #825’s code. This ADR is the replacement policy. |

### 3. Scope, sharing, and permission

Formal definitions are **instance-scoped**. Every organization on the instance reads the same official Catalog. Web publication is not an upstream WiseEff endorsement.

This program does **not** introduce organization-private Definitions, restore runtime overlays, or invent source precedence. Two organizations may draft independently; they cannot publish two official identities for the same natural key. Identical content may reuse an existing definition; different content is a conflict, not “web wins” or “vendor wins”.

Capabilities (frozen names):

| Capability | Meaning |
| --- | --- |
| `catalog:author` | Create and edit drafts / ChangeSets and request a Candidate preview. |
| `catalog:publish` | Request execution of an already-authorized Candidate, or approve within policy. |
| `catalog:review-high-risk` | Independently approve a high-risk Candidate. The authoring actor cannot satisfy this with a second synthetic identity. |

Organization Admin is **not** automatically `catalog:publish`. Request-body role, organization, risk class, and approval flags are untrusted. The server computes actor, scope, risk, and policy from trusted context.

Self-hosted single-actor publish is allowed only when:

1. the instance policy `catalog_publication.low_risk_single_actor_publish` is explicitly enabled;
2. the Candidate is classified **low-risk** by the server;
3. the actor holds a real `catalog:publish` grant.

High-risk changes always require an independent `catalog:review-high-risk` principal. Adding a Definition is not automatically low-risk. New Driver, selector change, tighter constraints, unit/semantic change, or matcher/fallback impact is high-risk.

Disabling the publication feature stops new authoring/publish. It does not hide or delete already published definitions.

### 4. Identity, completeness, and conflict

The Builder starts from a verifiable predecessor **Artifact**, applies the frozen ChangeSet, and emits a complete successor. It never scans the runtime projection to legalize extra rows. Unchanged definitions keep their revision IDs. Each persisted content change mints exactly one new revision. Retirement is explicit. Omission is invalid.

Retry of the same frozen Candidate must produce the same bytes, digest, and allocated IDs. Release ID, revision IDs, and publication time are frozen on the Candidate; install retries must not regenerate them.

Two Candidates on the same predecessor: the first legal commit wins; the other returns `needs-rebase`. The losing input is retained. The old Candidate’s predecessor is not patched. Last-write-wins is forbidden.

### 5. Online activation

`installPublishedRelease` remains the only transaction owner. Callers still cannot pass an open transaction. The online path adds, inside that boundary:

1. exclusive catalog lock and existing maintenance lock order;
2. predecessor, Authorization, capability, and freeze checks (re-checked at execute time, not only at enqueue);
3. materialization;
4. independent (from the writer algorithm) projection recompute over the **same uncommitted transaction**;
5. Activation Receipt + audit;
6. heads / `catalog_state` switch;
7. constraint checks;
8. commit.

There is no second current pointer. A window where the pointer has moved and verification has not finished is not an accepted design. A second connection must not be assumed to observe uncommitted staged rows.

Job recovery: if R2 installed successfully, the success response was lost, and R3 later became current, recovering R2 must observe its Receipt and report `active-superseded`. It must not advance R2 again. The existing `already-current` branch is not sufficient for that case.

### 6. Adoption of a preexisting install

Online publication requires an Activation Receipt. A Catalog already installed before this control plane (reported, not host-verified in CP-00: `crel_acme_1`) cannot receive forged historical Candidates, approvers, or jobs.

CP-01/02/06 define a one-time `adopted-preexisting` proof that binds the exact current ID/digest, exact source bundle, independent projection verification, data mode, collection time, and operator approval time. It proves “we verified and adopted this already-installed release today.” It does not prove “the new approval flow ran in the past.”

Adoption is not a general activation backdoor. Unknown or drifted history blocks online publication while leaving current reads in place. A new empty database still uses explicit bootstrap. Absence and partial state are distinct.

### 7. Dual versioning

Application approval facts: code SHA, migration inventory, permission boundary, capability contract, deploy mode, and the corresponding approved runtime pin.

Catalog activation facts: exact Catalog ID/digest, Artifact, predecessor, Candidate Authorization, projection verification, and Receipt (or `adopted-preexisting` proof).

Readiness is both. An approved application report that pins an older Catalog does not approve later successors. Do not delete digest comparison, rewrite old reports, or treat `new-empty` as P13 retirement.

First enablement requires a compatible application upgrade **before** online Catalog publication is turned on. Every API and worker replica must satisfy the capability whitelist; an old image joining later must stay not-ready.

## Consequences

- New deep module `server/modules/catalog-publication/` owns ChangeSet validation, Builder, Candidate/Artifact persistence, Authorization, and jobs. It does not own Catalog tables.
- Kernel installer grows Authorization and Receipt checks; it does not become the approval service.
- Proposal acceptance grows a structured publication reference. The `repositoryReference` column remains valid for historical repository-sourced intents and must not be filled with a fake Git URL.
- D1 vendor compile/`advance` (#826) remains usable until the new channel is ready. After CP-07, vendor import is an adapter into the same pipeline.
- Tests T01–T28 in the active plan are permanent. High-risk negatives exist before implementation, not after a green UI.

## Required verification owners

The executable matrix lives in the active plan section 9. ADR-level invariants that must remain true:

- Proposal/HTTP/Agent/SQL cannot write Catalog tables or Receipts.
- Frozen Candidate recompile is byte-identical.
- Concurrent same-predecessor publishes produce one winner and `needs-rebase`.
- Tampered Artifact/Authorization fails closed.
- Revocation after enqueue is linearized before activation.
- Staging/verify/head/receipt/commit faults roll back all Catalog writes.
- R2-success-then-R3-current recovery does not reinstall R2.
- `new-empty` upgrade after later publishes does not reset current or seed.
- Adoption of a wrong bundle or missing history is blocked.
