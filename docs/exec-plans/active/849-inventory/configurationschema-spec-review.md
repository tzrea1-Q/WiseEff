# Independent adversarial Spec review — `configuration-schema` extension (Issue #849 PU-01)

Reviewer: independent (not the matrix author). Basis: `configurationschema-threat-matrix.md`,
`configurationschema-extension-recon.md`, ADR-0045, and the cited source at worktree
`issue-849-parameter-unification`. Read-only. The matrix's own "independent review has not been
performed" disclaimer is now discharged by this document.

## Verdict

**FAIL — do not seal.** 12 findings: 3 × P0, 6 × P1, 3 × P2. The rows are not wrong, but the matrix
under-specifies the module-kind closure, ignores the half-applied red worktree, and omits the
alias↔subject-kind invariant and the historical-replay regression the change itself creates.

---

## P0-1 — The worktree is half-applied and does not typecheck/gate clean; the matrix has no slice boundary

Invariant at risk: capability admission + frozen-golden integrity (T1/T10/T14/T15) cannot hold
while the closed enums and their consumers disagree.

Evidence:
- `server/modules/parameter-catalog-contract/enums.ts:6-10,61-65` already publish the third kinds.
- `server/modules/contracts/dtoSchemas/parameterCatalog.ts:218` derives `catalogSubjectTypeSchema`
  from `catalogSubjectKinds`, so the API DTO already advertises `configuration-schema`, while
  `docs/generated/openapi.json` still contains only `driver`/`node-type` (0 hits for
  `configuration-schema`). `npm run contract:check` (`package.json:72`) is therefore failing.
- `server/modules/parameter-catalog-api/read/query.ts:38` still builds
  `new Set<CatalogSubjectKind>(["driver","node-type"])`, so the runtime rejects `?type=`
  values the schema now accepts.
- `server/modules/parameter-catalog-contract/__fixtures__/serialization-golden.json` is byte-identical
  to its pin (1563 bytes / `2b6c1ce5…` / `1172d550…`, matching
  `schemas/dts/catalog-release/stable-id-rules.json:6-11`) yet `serialization.test.ts:59-61`
  serializes `catalogSubjectKinds`; that test is already red.
- `schemas/dts/catalog-release/catalog-release.schema.test.ts:206-208` types
  `selectorKindBySubjectKind` as exactly `{driver, "node-type"}`, and `:1815-1822` compares
  `stableIdRules.closedEnums` to the TS enums — so `vue-tsc`/vitest is red on the schema package.
- `server/modules/catalog-kernel/compiler/validation.ts:960-963` maps every non-`driver` subject to
  `node-type-name`; once `selectorKindBySubjectKind` gains `configuration-schema`, existing
  node-type releases fail validation with `owned-selector-kind-mismatch` (see P1-3).

Reproducer: `git status`; `npm run contract:check`; `npx vitest run
server/modules/parameter-catalog-contract/serialization.test.ts`. Minimum correction: revert those
two files to the two-kind baseline and ship the Q5 slices (or land the full closure), else no gate
is trustworthy.

## P0-2 — The placement guard has no third arm, and the module-kind decision is unowned; naive "add the arm" either blocks all ConfigurationSchema registration or commits a wrong-but-accepted module kind

Invariant at risk: T8 placement correctness (and its release gate).

Evidence:
- `server/migrations/0137_…:2934-2941`: `if subject_kind is null or (subject_kind='driver' and
  module_kind <> 'driver-group') or (subject_kind='node-type' and module_kind <> 'node-type')`.
  For `configuration-schema` the join yields a non-null `subject_kind` but the predicate is false,
  so **any** module kind is accepted.
- `server/migrations/0080_attribution_taxonomy.sql:365`: `parameter_modules.kind` is closed to
  `('business','driver-group','node-type','unclassified')`, pinned by
  `server/shared/database/migrationInvariant.test.ts:420-427` (asserts the exact 0080 CHECK text).
  0080 is applied and immutable (`server/shared/database/migrations.test.ts:123-134`), so a new
  module kind requires migration 0144 to drop/re-add that CHECK.
- `server/modules/catalog-kernel/security/catalogRoles.integration.test.ts:1159-1162` and
  `server/modules/catalog-publication/persistence/schema.integration.test.ts:932-937` pin
  `through: ROLES_MIGRATION` / `VERIFICATION_MIGRATION` ordering — an 0144 placement change must not
  be assumed by those partial-apply tests.

Reproducer: insert a `configuration-schema` subject + registration, point its
`current_placement_id` at a module with `kind='business'`; the deferred `subject_placement_kind_ck`
passes today. A naive `… or (subject_kind='configuration-schema' and module_kind <> 'business')`
also passes and makes the module kind assert something false; a *new* kind instead drags in every
`parameter_modules.kind` consumer (recon §2.16).
Minimum correction: pin the module kind explicitly, add the third arm to
`assert_subject_placement_kind`, mirror it in `assert_parameter_module_placement_kind`
(0137:2969-2972), extend the 0080 CHECK in 0144 with a round-trip test, and record it in ADR-0045.

## P0-3 — `parseCanonicalConfigurationSchemaId` accepts real filenames, so T4 identity forgery is not closed by the parser or by any planned test

Invariant at risk: T4 (identity never a filename/extension/label) and the ADR-0045 rejection of
inventing an identity.

Evidence: `server/modules/parameter-catalog-contract/normalization.ts:151` accepts
`^[A-Za-z0-9][A-Za-z0-9+._/-]{2,95}$` — with no comma only. `charge.dts`, `model.yaml`,
`config-1.json`, `fw_v1.bin` all match. The matrix's T4 evidence line names only "contract parse
tests; SQL constraint test with an invalid canonical key", i.e. no adversarial fixture. No
deny-list exists anywhere in the delivered parser.
Minimum correction: add an explicit positive fixture set (governed model ids) **and** a negative set
containing a `.dts`/`.json`/`.yaml`/`.toml`/`.env` path, a display label with whitespace/case
folding, a `driver` compatible, and a node-type name; assert the negative set is rejected by the TS
parser, the release JSON schema, the compiler, and the SQL predicate. Note the parser is *less*
restrictive than `is_canonical_compatible_selector`, which contradicts the comment at
`normalization.ts:132-138` and lets any driver compatible also read as a model id.

---

## P1-1 — Leaving the two long projection-completeness functions' two-way predicates in place is a real hole, not "under-validation"

Invariant at risk: alias↔subject-kind ownership (T6/T7) for the third kind.

Evidence: in `assert_catalog_materialization_projection_complete` the alias-kind check is
`(alias.selector_kind='driver-compatible' and subject.kind<>'driver') or
(alias.selector_kind='node-type-name' and subject.kind<>'node-type')`
(`0137:545-560`), byte-identical in `assert_current_release_complete` (`0137:902-917`). Both raise
only when the *first* conjunct matches; a `configuration-schema-id` alias is skipped. The
canonical-collision checks join with
`canonical_owner.kind = case alias.selector_kind when 'driver-compatible' then 'driver' when
'node-type-name' then 'node-type' end` (`0137:562-578` and `0137:919-935`); `case` yields `NULL`, so
`subject.kind = NULL` never matches and the collision check also passes vacuously.
Reproducer: insert a `catalog_subject_aliases` row with `selector_kind='configuration-schema-id'`,
`normalized_selector='tw100'`, whose `subject_id` is a **driver** subject; materialize a release
containing it and point `catalog_state` at it — no function raises.
Minimum correction: extend both predicates with a third arm and replace the duplicated `case`
expressions with one immutable `selector_kind_for_subject_kind(text)` used by all four sites, plus a
release-level trigger asserting `alias.selector_kind = selector_kind_for_subject_kind(subject.kind)`.

## P1-2 — A row-local alias trigger is not sufficient: `reject_cross_root_selector_collision` is table- and kind-dispatched, and depends on two silent-`NULL` `case` arms

Invariant at risk: T5 cross-root namespace uniqueness.

Evidence: `0137:291-300` derives `target_selector_kind` from `new.kind` via a two-arm `case`; for
`configuration-schema` it is `NULL`. `0137:306-331` then tests
`alias.selector_kind = NULL` and `subject.kind = NULL`, both always `NULL` → no exception. So the
trigger is inert for the new kind unless both `case` arms (subject→alias and alias→subject) are
extended. Because the triggers are `before insert` only (`0137:339-345`), the invariant is also
unenforced for any UPDATE that changes `catalog_subjects.kind` or
`catalog_subject_aliases.selector_kind` (no immutability trigger covers those tables; only
`catalog_subject_exact_subtype_from_subject_ck` fires on `update of id, kind`, `0137:754-757`).
Reproducer: insert subject `('s1','r1','configuration-schema','tw100')` then an alias with the same
value — no `catalog_selector_cross_root_unique_ck` unless both arms are fixed.
Minimum correction: extend both `case` arms **and** add `or update of kind` / `or update of
selector_kind` trigger variants (or assert from `assert_current_release_complete`); keep the
advisory lock (`0137:304`) as the sole cross-table serialization point.

## P1-3 — `validation.ts:960-963` will break the two-kind golden path the moment the new selector-kind mapping is added

Invariant at risk: T1/T9 (existing two-kind releases compile/verify identically).

Evidence: `expectedSelectorKind = subject.content.kind === "driver" ? …driver : …["node-type"]`
(`validation.ts:960-963`). Adding `configuration-schema` to `selectorKindBySubjectKind`
(`stableRules.ts:235-240` is `.strict()`, so the artifact must gain the key) makes every node-type
subject expect `configuration-schema-id`. The two identity parsers are equally defaulting:
`validation.ts:501-504` and `:516-521` treat *any* non-`driver-compatible` selector as a node name.
Proof sketch: run `compileCatalogRelease(validCatalogReleaseBundle())` after updating
`stable-id-rules.json` but before rewriting `validation.ts` — the node-type bundle fails with
`owned-selector-kind-mismatch` / wrong parser errors.
Minimum correction: rewrite both sites as explicit three-way switches that read the expected kind
from the rules map keyed by the actual subject kind, and reject unknown selector kinds with a
violation instead of defaulting to the node-name parser.

## P1-4 — `materializeRelease.ts:232-247` sends every non-driver subject to `catalog_node_types`

Invariant at risk: T7 subtype exclusivity at install time.

Evidence: `if (subject.content.kind === "driver") { …catalog_drivers… } else { insert into
catalog_node_types (subject_id) }`. For `configuration-schema` the else branch inserts a node-type
subtype row under a `configuration-schema` subject. Because `assert_subject_has_exact_subtype`
(`0137:742-743`) is a two-way predicate *and* `subject_kind='configuration-schema'` never matches
it, no guard rejects the resulting state. `assert_subject_has_exact_subtype` is the only check that
could catch it and its third arm is not planned in the matrix's T7 row (T7 names "SQL constraint
test" generically).
Minimum correction: explicit three-arm install dispatch writing the correct subtype relation, plus
the third arm in `assert_subject_has_exact_subtype` and in the `catalog-release.schema.json`
`if/then/else` at `:207-254` (the `else` branch currently means "not driver ⇒ node-type subtype",
so a config-schema subject validates against `nodeTypeSubtype`).

## P1-5 — Three independent silent defaults remap unknown kinds

Invariant at risk: T16 fail-closed.

Evidence:
- `server/modules/catalog-kernel/runtime/currentSnapshot.ts:156-159`:
  `selectorKind: matching.selectorKind ?? "driver-compatible"` — a definition whose
  `matching.selectorKind` is a future/unknown token is read back as a driver-compatible.
- `server/modules/catalog-kernel/install/materializeRelease.ts:96-107` and
  `server/modules/catalog-kernel/verification/verifyCurrentMaterialization.ts:231-242`: ternary
  selector-snapshot builders where `else` means node-type.
- `server/modules/catalog-publication/preview.ts:256` hardcodes `capabilityContractRevision:
  "catalog-capability/v2"` instead of `CATALOG_CAPABILITY_CONTRACT_REVISION`
  (`builder/types.ts:27`), while `runtime/capabilities.ts:17-20` and `runtime/readiness.ts:193-198`
  fail closed on the stored revision. A revision bump therefore makes preview advertise v2 while
  readiness demands v3 → `unsupported-catalog-capability`.
Proof sketch: build a release DTO with `matching.selectorKind = "configuration-schema-id"` (already
accepted by the open `revision: z.string()` DTO) and read it back through `mapContent`; the
selector kind is silently coerced. Then call `preview` after bumping the revision constant.
Minimum correction: make every one of these sites an exhaustive switch over
`CatalogSubjectSelectorKind` with a `never` default, and import the capability constant in preview.

## P1-6 — `rebuildCatalogCache` and the runtime matcher cannot represent the new kind, so a published ConfigurationSchema is unreachable or silently dropped

Invariant at risk: "shared Binding, ProjectValue and unique publication writer" (ADR-0045 §1);
T2/T12 lifecycle reachability.

Evidence: `cache/rebuildCatalogCache.ts:117-123` passes `kinds: ["driver","node-type"]` to
`listSubjects`, so config-schema subjects are absent from the cached payload while the cache key
(`:204-214`) is `(snapshotKind, releaseId, digest, materializationFingerprint)` — unchanged by the
kind set, so the omission is undetectable. `runtime/subjectMatch.ts:22-37` maps
`kind === "driver" ? … : "node-type-name"` and `resolveCatalogSubject`
(`:179-199`) is a hardcoded two-phase driver-then-node-type search with `SubjectSelector` exposing
only `driverCompatibles` and `nodeTypeFallback`; there is no input shape that can request a
configuration-schema match, so `catalogSnapshot.resolveSubject(...)` (`currentSnapshot.ts:343`)
cannot reach one. The matrix's T2 assumes bindings and values work for the new kind without naming
a match path.
Minimum correction: extend the matcher input and cache kind list, or explicitly scope
ConfigurationSchema to definition/registration/placement without binding in this round and record
that scope cut in ADR-0045 and the plan; either way add a test that a published config-schema
subject is observable through the cache after `rebuildCatalogCache`.

---

## P2-1 — V05 under-validates the new kind and its SQL is repinned only by an ID

`server/modules/release-verification/gates/postgres/countGates.ts:284-285` uses the same two-arm
placement predicate, so a misplaced config-schema registration contributes zero violations while
the gate reports `PCAT-DB-V05`/`PCAT-VRF-V05-PLACEMENT-CARDINALITY` (`:297`). The gate ID and
failure code are frozen (`threatMatrix.test.ts:38,63`), and nothing pins the SQL text, so changing
the semantics silently is possible. Correction: extend the predicate in the same commit and add a
gate fixture whose only violation is a config-schema placement mismatch.

## P2-2 — `selector_snapshot` content is unconstrained

`0137:245` only checks `jsonb_typeof(selector_snapshot)='object'`; the installer's snapshot
(`materializeRelease.ts:96-107`) is the sole source of the runtime selector
(`currentSnapshot.ts:852-859`). A wrong-but-parseable snapshot (`{kind:"node-type-name",value:K}`
on a config-schema subject) commits with no constraint and changes interpretation at read time.
Correction: add a CHECK (or a completeness assertion keyed to the subject kind) that the snapshot
kind is the subject-kind-implied selector kind.

## P2-3 — Golden-pin updates are unaudited: the pinned blob metadata is dead evidence

`stable-id-rules.json:6-11` pins `gitBlobOid`/`byteLength`/`rawSha256`, but no code reads them
(`grep -rn gitBlobOid` finds only the artifact); `closedEnums` is merely shadow-checked at
`catalog-release.schema.test.ts:1815-1822`. Both "frozen" artifacts can therefore be regenerated
with no independent comparison. Correction: land the golden change as its own commit recording old
and new size/sha256 and the single expected diff, and add the pin check to the `docs:check` lane.

---

## Answer to Q2 — which frozen artifacts legitimately change

| # | Artifact (generator) | Change? | Minimal defensible update + evidence |
|---|---|---|---|
| 1 | `server/modules/parameter-catalog-contract/__fixtures__/serialization-golden.json` none — byte fixture | **Yes** — `serialization.test.ts:59-61` serializes the enum | Add exactly one entry to `subjectKinds`; re-run the test; record old/new size + sha256 |
| 2 | `schemas/dts/catalog-release/stable-id-rules.json` none — hand-maintained, parsed by `stableRules.ts` | **Yes** — `contractArtifacts.ts:35` fingerprints its raw bytes; `closedEnums` pin at `catalog-release.schema.test.ts:1815` | Update `closedEnums.*`, `selectorKindBySubjectKind`, and the blob pin at `:6-11` in the same commit; no other field may move |
| 3 | `schemas/dts/catalog-release/catalog-release.schema.json` none — hand-maintained | **Yes** | Add the kind to `:157-161`, add a third `if/then`, replace the permissive `else` at `:236-253`, extend `aliasContent.selectorKind` `:276-281` and `matching.selectorKind` `:336-341`; extend `catalog-release.schema.test.ts` types at `:206-208` |
| 4 | `server/testing/parameterCatalog/database.ts:11` `S2_SCH_CONTRACT_FINGERPRINT` (computed by `readCanonicalSchemaFingerprint` (`:235-351`)) | **Yes** — hash covers relations, columns, **constraints, triggers and `pg_get_functiondef` bodies**, which 0144 rewrites | Recompute and paste once, in the same commit as 0144, with a diff listing exactly which constraint/trigger/function changed; `S2_SCH_0137_FINGERPRINT` (`:7-8`) is dead (only used in a `not.toBe` at `database.test.ts:83`) and must **not** change |
| 5 | `server/modules/catalog-kernel/compiler/__fixtures__/compiledReleaseGolden.ts` none — hand-pinned, asserted at `compileCatalogRelease.test.ts:289-294` | **Yes** — `contractArtifacts.ts:68-72` feeds raw artifact bytes into `catalogCompilerContractFingerprint` | Regenerate all five values together; a partial update is a hard test failure, so evidence is the passing golden test plus the artifact diff |
| 6 | `"44 canonical relations"` (`catalogSchema.integration.test.ts:184-240`) (hand-written list) | **Refuted: do not change** — the extension adds no relation; a new subtype relation would make it 45 and must be justified explicitly | If the design adds a subtype table, the count changes and the test must be updated with the new name listed; otherwise leave it |
| 7 | `docs/generated/openapi.json`, `docs/generated/db-schema.md` (`contract:openapi`, `db:schema-doc` (needs live PG + pgvector)) | **Yes** | Regenerate from owners only; `docs:check`/`contract:check` byte-compare is the evidence |

## Answer to Q4 — historical replay

**Partially refuted.** Two paths are safe, two are not, and the matrix does not name any of them.

Safe: (a) `validCatalogReleaseBundle()` compiles byte-identically once `validation.ts:960-963` is
rewritten (P1-3) — artifact bytes only feed `s1BundleContractArtifactDigest`, so old *release* bytes
are not re-fingerprinted; (b) `migrations.test.ts:123-134` rejects edited applied files, so the
`catalog_subjects.kind` CHECK never re-checks old rows.

Not safe:
1. **Compiler re-validation of archived bundles.** `validation.ts:960-963` keys the expected
   selector kind off the *current* rules registry, not the bundle. Any two-kind bundle recompiled
   after the third key is added is judged against the new registry — a plain
   `kind:"node-type"` subject fails unless the selector is `configuration-schema-id`. This is the
   regression the matrix's T1 row does not cover.
2. **The artifact pins.** `contractArtifacts.ts:33-35,47-49` loads `stable-id-rules.json` and
   `catalog-release.schema.json` at process start, so the current closed set becomes the validator
   for old bytes. Materialized releases stay sealed (`reject_sealed_catalog_release_change`,
   `0137:654-702`), but anything re-validated (republish, preview, legacy archive read, V-gate
   rerun, `verifyCurrentMaterialization.ts:231-242`, `rebuildCatalogCache.ts:117-123`) sees the new set.
3. **The two-way predicates.** For a release materialized *before* 0144, 0144's redefinition of
   `assert_current_release_complete`/`assert_catalog_materialization_projection_complete` changes
   what a later `catalog_state` pointer move validates. Old rows cannot be new offenders (their
   alias kinds are only `driver-compatible`/`node-type-name`, both still handled), so a two-kind
   release still validates **identically** — this part of the plan's claim holds.

## Answer to Q5 — smallest defensible delivery

Do not attempt one round. Revert `enums.ts:6-10,61-65` and `normalization.ts:9-20,27-30,132-155`
to the two-kind baseline first, so the repository is green and no half-applied contract ships.

**Slice A (contract + authoring closure), exit evidence = green `contract:check`, `docs:check`,
`serialization.test.ts`, `catalog-release.schema.test.ts`, `compileCatalogRelease.test.ts`:**
TS enums + parser with the P0-3 negative fixtures; `stable-id-rules.json`; `catalog-release.schema.json`
with the third `if/then` and a rejecting `else`; `validation.ts` three-way switches;
`catalogSubjectSelectorKind` mapping; regenerate `docs/generated/openapi.json`. This slice adds no DB
state and no capability revision, so it cannot admit a release on its own.

**Slice B (storage closure), exit evidence = new 0144 + `catalogSchema.integration.test.ts`
additions + recomputed `S2_SCH_CONTRACT_FINGERPRINT` + `catalogRoles.integration.test.ts` green:**
0144 adds the third canonical predicate + role grants, extends every CHECK
(`catalog_subjects.kind`, both selector-kind/selector CHECKs, and the 0080 module-kind CHECK for the
chosen placement kind), and redefines all six trigger functions with the third arm; add the
alias↔subject-kind assertion function (P1-1/P1-2) and the subtype-exclusivity arm (P1-4).

**Slice C (install/runtime/admission), exit evidence = `materializeRelease`,
`verifyCurrentMaterialization`, `rebuildCatalogCache`, `subjectMatch`, `capabilities` and
`preview` tests, plus one end-to-end publish of a config-schema release:** install dispatch,
snapshot builders, `mapContent`, matcher/cache reachability (or the explicit scope cut), capability
revision bump with all `typeof` sites and the preview constant, and the V05 predicate (P2-1).

Each slice is independently revertable and none leaves a closed set half-extended.
