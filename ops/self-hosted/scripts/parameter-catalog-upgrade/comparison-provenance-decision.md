# Comparison provenance decision for the populated upgrade

[中文](comparison-provenance-decision.zh-CN.md)

This is a bounded decision record, not an approved contract change or an
executable upgrade. Its inspected development base is
`1376fbcbe34f140ebe44d6deda121bd7744ff836`; the source deployment remains
`82344044b436a8dafecefbb85dfd724cecb05e3f`. No migration, grant, codec,
allowance, verifier or controller is changed by this document.

## Conflict and responsibility

The [P11 contract](../../../../docs/design-docs/parameter-catalog-cutover-archive-rollback.md#mandatory-p11-semantic-dual-read-comparison)
requires each declared difference to identify its exact source, R class,
mapping version/head digest, actual typed target or Archive, immutable-plan
rule and plan digest. P7 owns one current head **per legacy identity**. The
[release contract](../../../../docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md#fixed-input-and-attempt-identity)
separately pins the complete mapping epoch and mapping-head digest.

The inspected `1376fbcbe` baseline exposed two independent problems:

1. `comparison/corpusContributionSchema.ts` has one context-wide
   `mappingHeadId/version/checksum`. Every contribution must equal that tuple;
   each declared difference must equal its contribution's ID/version, and
   `ruleId` must equal the D01–D09 comparison ID. Its closed v1 evidence shape
   has no exact mapping-version ID or per-identity head digest. The existing
   live-evidence multi-head counterexample demonstrates this representation
   conflict; a global epoch is not a replacement for a per-record head.
2. At that baseline, all eleven providers' `classifyCase` functions turned unequal, queryable
   observations into declared differences using constructed evidence. For
   example, CGH chooses R1/R9 from the comparison ID and uses the shared head ID
   as an Archive/Definition ID; PRJ chooses R9 and uses the protected-reference
   kind/ID as its target. No actual mapping lookup or immutable-plan difference
   rule justifies that classification. The parser accepts a nonempty R class
   and at least one target/Archive; it does not enforce the complete domain
   disposition. A passing aggregate cannot repair those missing facts.

The second problem violated the **existing** P11 contract. Commit `0d71d9949`
now removes inferred dispositions across all eleven providers, retains real query
failures and classifies unproven differences as blocking. Its 36 focused cases
and independent Standards/Spec reviews passed. This safety repair required no new
product decision and does not complete positive populated verification. Actual
PG comparison at `e5c76c9ce` retains the populated inventory and rejects CGH's
unwired readiness; that production-query integration remains internal work.
The first problem requires a limited evolution of the frozen evidence format
and its owned parser/codec/tests. The two previously authorized reader/recovery
contracts do not implicitly authorize changing this third format.

## Recommended minimum old/new interface

| Boundary | Current v1 | Proposed new version; not yet approved |
| --- | --- | --- |
| Whole capture | One head ID/version/checksum shared across all providers | `mappingSnapshot: { epoch, headDigest }` from the real complete mapping inventory; retain all source, Catalog, plan, candidate and phase pins |
| One expected difference | Shared head ID/version, string R class, guessed target, D ID as rule | Exact `sourceIdentity`, `mappingVersionId`, `headVersion`, `headDigest`, actual R class, exactly one typed target or Archive, declared `ruleId`, and `planPin` |
| Rule association | `ruleId === comparisonId` | One rule in the fixed P0 plan whose comparison ID, source identity, disposition and allowed semantic difference match this case |
| Verification | Structural equality with one shared tuple | Per-case membership in the observed snapshot, full source/run/plan association, current head and actual target/Archive lookup, then the existing aggregate and nine adapters |
| Artifact compatibility | UTF-8/LF v1 canonical bytes and checksum | Explicit new contribution/corpus/report version; old bytes remain immutable and cannot be relabelled or reused to approve a new capture |

The proposed names are the finite review surface, not a new public API already
in force. `sourceIdentity` must carry the actual legacy-identity ID and source
tuple (system, kind, owner-scope kind/ID and source ID), rather than only a
consumer's reference ID. `headVersion` is the actual CAS version, not the
mapping-version number; the latter is available in the mapping record.
Define one deterministic digest of the exact returned `MappingHead` and one
complete-set digest at the mapping owner. Register their byte codecs and
ordering explicitly; do not silently equate differently shaped existing hashes.

The proposed closed field sets are:

```text
mappingSnapshot = { epoch, headDigest }
sourceIdentity = { legacyIdentityId, sourceSystem, sourceKind,
                   ownerScopeKind, ownerScopeId, sourceId }
expectedDifference = { sourceIdentity, rClass, mappingVersionId,
                       headVersion, headDigest, typedTarget?, Archive?,
                       ruleId, planPin }
typedTarget = { kind, id }
Archive = { id }
```

All unknown fields refuse; exactly one of `typedTarget`/`Archive` is present.
Do not treat the mapping record's separate `evidenceArchiveId` as a second
disposition. The complete existing `MappingHead.version` remains the source of
`sourceChecksum`, `graphFingerprint`, run and version identity; the head digest
binds these fields rather than accepting duplicate caller-supplied values.
`ruleId` must resolve to a fixed plan declaration, not merely be nonempty.

The independently deliverable safety repair needs no v2 fields: retain the
existing equal-value path; classify any query-failure as the existing blocking
unqueryable result; replace each provider's final constructed-evidence branch
with `{ result: "unexplained-difference", expectedDifference: null }` until a
real declared-rule lookup exists. Do not add a new shared verifier or change
the corpus parser to bless the constructed data. The first Red cases call the
real provider entrypoints with independently known unequal observations and no
rule, then assert the actual aggregate cannot pass. Cover all eleven families,
exact equality, both-side query failures (including unknown failure codes),
and missing references. Existing tests expecting an invented disposition must
be identified as the violated behavior, not silently deleted or skipped.
This repair may block previously fabricated positive fixtures; it does not
authorize a new difference or finish the positive multi-head representation.

Use `mapping/index.ts`'s public `lookupProtectedIdentity` or
`readCurrentMappingHead`, not a new classifier or direct import of private
`persist.ts`. `lookupProtectedIdentity` already resolves a full source tuple
or legacy identity and returns the real mapped/archived/blocked outcome and
head. Each consumer owns its real foreign-key path to that identity. Missing,
ambiguous, inaccessible or blocked data cannot become guessed targets.
Where a protected consumer references several identities, enumerate the
required cases according to the fixed corpus rule; never choose first/latest.

`activation.inspectFacts` already observes the complete mapping inventory,
history digest and prepared mapping epoch under the existing management
boundary. Its epoch must actually have been prepared by the existing domain
command. `runtimeState` uses another selected-row hash; its name alone does not
prove that hash equals the activation `headDigest`. A published mapping-owner
snapshot projection can expose the needed rows/digests using existing tables
and management permissions. This is an internal integration responsibility,
not a request for runtime grants or another migration.

P0's expected-difference rule source also needs an actual producer. The current
classifier's `PCAT-CLASS-*` rule IDs describe classification, not complete P11
semantic-difference declarations. No non-test cutover producer of those P0
declarations was found in the inspected tree. Implement their deterministic
plan-bound production from the accepted corpus/classifier contract; do not
substitute D IDs, a caller JSON claim, or the resulting report. Any new business
classification or newly permitted difference remains a separate product choice.

## Exact consumer scope

Every path below is under `server/modules/` and ends in
`parameterCatalogComparisonContribution.ts`, with its existing companion
tests. The listed D IDs are the current `FAMILY_COMPARISON_IDS` routing, not a
proposal to reduce the frozen semantic coverage.

| Family / path prefix | Existing gates | Objects whose identity/disposition needs real evidence |
| --- | --- | --- |
| CGH / `parameter-specs/` | D01, D03, D06, D09 | Definitions/revisions, registration/placement, Review/Proposal/Observation, legacy operator results |
| TOP / `parameter-topology/` | D02, D03, D04, D06 | Subject, registration/placement, Binding/history, review disposition |
| PRJ / `parameters/` | D04, D05 | Binding/current/history, ProjectValue and exact revision pins |
| FIL / `parameter-files/` | D07, D08 | Files, source occurrences, locators, configuration revisions and writeback references |
| AGT / `agent/` | D07, D08 | Tool/session/draft references, pinned parameter results and source writeback |
| LOG / `logs/` | D07 | Retained analysis/citation parameter references |
| DBG / `debugging/` | D07 | Debug operations/snapshots and referenced Binding/value revisions |
| DTS / `dts-reload/` | D07, D08 | Reload snapshots/candidates, source/configuration and pinned Binding references |
| KNW / `knowledge/` | D07 | Retained Definition/revision references and explicit Archive disposition |
| MOD / `parameter-modules/` | D02, D03 | Subject and registered/observed module placement |
| OPS / `operations/` | D09 | Reconciliation/readiness and typed legacy operator outcomes |

The controller owner coordinates the mapping snapshot, frozen comparison
format, eleven provider adapters, and final integration serially. No provider
owner may authorize its own format change. The format implementation scope is
`comparison/corpusContributionSchema.ts`, `corpusResultSchema.ts`,
`aggregateComparisonCorpus.ts`, `generateComparisonReport.ts`,
`productionProviders.ts`, `liveEvidence.ts`, their public index/types and tests,
plus the eleven provider files/tests above. Update only the directly affected
contract fingerprints through the existing trusted mechanism. Do not reset a
trusted baseline, regenerate legacy occurrence allowances, edit an applied
migration, or redefine the Release Verification core/gate registry.

## R3 acceptance and negative cases

| Threat or success case | Required evidence after implementation |
| --- | --- |
| Two different legitimate identity heads in one populated capture | Real PG mapping commands create both; all eleven live providers run, exact per-case dispositions survive the real corpus/report codecs and nine gate associations |
| Unequal observations with no complete plan rule | `unexplained-difference`; no approved report/P12/queue/proxy effect |
| Wrong R class, source owner, mapping version, CAS head, target, Archive or rule | Typed refusal or blocking case; cannot authorize through counts alone |
| Missing/query-denied/ambiguous protected reference | `unqueryable/protected-reference-missing`; never fresh zero or declared difference |
| SQL NULL / JSON null / absent / empty / default / example / actual project value | Independent semantic oracle preserves each distinction and exact history/revision pins |
| Mapping changes during capture; pending/unknown owner result | Whole capture invalid; no first/latest fallback, journal reset or old-attempt reuse |
| Cross-run/target/source/plan/Catalog/artifact or pre/post-P13 reuse | Current observation and existing verifier applicability/lineage reject; post-P13 performs a new complete capture |
| Duplicate/missing family, protected reference, case, or D gate | Complete expected inventory and canonical ordering reject omissions, duplicates and forged coverage |
| Modified v1/v2 bytes, checksum, envelope, or purpose | Original codec and one-to-one nine-gate evidence association reject; no historical report rewrite |
| Full successful phase chain | Actual domain report generation and independent authenticated approvals, then real P12/P13/startup; comparison success alone is insufficient |

Keep the current multi-head parser counterexample as a historical-v1 test;
add a new-version real positive instead of rewriting its old expectation.
Run each provider's existing tests, full comparison/contract/boundary suites,
real PG complete-consumer oracle, and actual controller acceptance on one fixed
candidate. This document runs none of those implementation tests. Zero Policy
rows do not resolve #815, and an unqueryable protected family remains blocking.

## Separate application-artifact producer gap

The fixed-input contract requires application release/tag identity, package
manifest digest, image manifest **and config** digests, platform and build trust.
The inspected non-test references to `releaseTag`/`packageManifestDigest` are
the core type and `upgrade.sh`'s `v-s11-apl`/empty placeholder. The current build
and handoff inspect local image ID/platform/source labels; they do not produce
an application package manifest or prove an OCI manifest digest. Catalog
`CatalogReleaseBundle.manifest` and the infrastructure base-image bundle are
different artifacts and must not fill those application fields.

Keep the observed local image ID as an opaque loaded-image identity. A real
containerd-store export showed that `image inspect .Id` can identify an OCI
index rather than the config. Determine its role from actual descriptors and
raw blob bytes; retain historical IDs without relabeling them. The inspected normative
contract does not grant a local-image-only exemption from its manifest pin.
First reuse the existing build-network/build entrypoint and capture its actual
application release/package and OCI manifest/config provenance; that missing
producer is internal work and does not require disabling TLS. Do not manufacture
a release tag from Git SHA or relabel an image ID as a registry manifest digest.
If a local-only artifact contract is desired, present that precise separate
change for approval; it is not included in this comparison-format decision.
Enterprise CA/network evidence and real-backup authorization remain separate.

## Decision and documentation impact

Recommended decision: authorize only the versioned comparison representation
and the mapping-owner projection needed to express the already-required P11
tuple, with unchanged gates, dispositions, principals, approval purposes,
zero-difference thresholds and schema/grants. The implementation owner is the
parent coordinator; independent Standards and Spec review remain required.
Until accepted, safe provider bug fixes and unrelated real startup/handoff work
can proceed. Do not add another manager that permanently returns unavailable.

The single decision to present is: **May the comparison contribution/corpus/report
format evolve to the closed per-identity tuple above, with a real mapping-owner
snapshot and plan-rule lookup, while all existing gates, R semantics, permission
and approval boundaries remain unchanged?** This requests representation and
directly related ownership/codec alignment only. It does not request approval
for inferred differences, #815, local-image-only release evidence or production.

| Maintained document | Impact after a decision |
| --- | --- |
| This English/Chinese pair | Record exact choice and reviewed implementation commits; currently proposal only |
| Comparison README pair | New/old version and mapping projection contract |
| Cutover/release design companions | Clarify representation of existing semantic requirements, without relaxing them |
| Main populated plan/manual/evidence | Parent records exact new execution, remaining inputs and production stop boundary |

Validation for this documentation-only record is path/link and whitespace
checking. Full `docs:check` with its owned database, TypeScript/build, Hosted,
real comparison, startup, controller and production remain **not run here**.
