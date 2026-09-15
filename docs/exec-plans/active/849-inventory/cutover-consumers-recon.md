# 849 Inventory — Catalog Cutover & Consumer Recon (read-only)

Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification`, branch `feat/849-parameter-unification`.
Method: `rg`/`rg --files` are **not installed** (`bash: rg: command not found`); all searches used
`grep -rn --include=...`, `find`, and `git ls-files`. No repository file was modified except this report.
Latest migration: `server/migrations/0143_catalog_publication_runtime.sql`.

## 1. `interface.ts` + orchestrator / checkpoints / recovery

**1.1 Phases.** `interface.ts:10` `export const MIGRATION_CONTRACT_VERSION = "s7-orc-p0-p10-v1";`
`interface.ts:12-24` executable set = P0–P10 only:
`PRE_ACTIVATION_PHASES = ["P0"…"P10"]`. `interface.ts:28-31` **declared unavailable / not-yet-executable**:
```ts
export const UNAVAILABLE_PHASES = ["P11","P12","P13","P14","P15","P16"] as const;
export type CutoverPhase = PreActivationPhase | UnavailablePhase;
```
Enforced at `checkpoints.ts:32-43` `assertAllowedPhase` → `PCAT-ORC-ACTIVATION-UNAVAILABLE`
("Activation phase ${phase} is unavailable on the pre-activation cutover seam"); `checkpoints.ts:19-20` set membership;
`persistCheckpoint` re-checks `checkpoints.ts:222-223`. The ops controller repeats the refusal
(`ops/.../controller.ts` dispatch: `UNAVAILABLE_PHASES.includes(command.action)` → `PCAT-UPG-ILLEGAL-ACTION`) and
`ops/self-hosted/scripts/upgrade.sh:785` refuses CLI tokens `P11|P12|P13|P14|P15|P16|activate-p12|retire-p13|public-release`.
`P11a` is **not** a cutover phase — only the verification label `verificationPhase: "P11a"` (`upgrade.sh:555`);
`upgrade.sh:34-35`: "Catalog apply is one-shot plan → execute → P11a only. inspect/recover/resume belong to S11-REC.
P11-P16, gate selection, API/startup migration, and unknown-commit guesses are refused."
Other closed vocabularies: run states `interface.ts:33-40` (`planned|running|failed|completed|recovery-required`);
recovery actions `interface.ts:42-43` (`whole-state-restore|forward-recover`); 12 failure codes `interface.ts:45-59`.

**1.2 Operator entry functions (exact signatures).**
`orchestrator.ts:88-90` `export const planCutover = async (input: PlanCutoverInput): Promise<CutoverResult<CutoverPlan>>`
`orchestrator.ts:451-453` `export const executeCutover = async (input: ExecuteCutoverInput): Promise<CutoverResult<CutoverRunSnapshot>>`
`orchestrator.ts:532-534` `inspectCutover(input: InspectCutoverInput): Promise<CutoverResult<CutoverRunSnapshot>>`
`orchestrator.ts:546-548` `recoverCutover(input: RecoverCutoverInput): Promise<CutoverResult<CutoverRunSnapshot>>`
Inputs: `interface.ts:98-103` / `105-114` / `116-120` / `122-128`. Frozen registry:
`parameter-catalog-contract/operations.ts:18-24` `catalogCutoverOperations = ["planCutover","executeCutover","inspectCutover","recoverCutover"]`.
Callers (no production HTTP route): `scripts/wayfinder/{plan,execute,inspect,recover}-parameter-catalog-cutover.ts`
(`:72,:67/:77,:45,:50`); `ops/self-hosted/scripts/upgrade.sh:152` destructures all four then calls at `:333,:354,:382,:383`;
`operations/parameterCatalogComparisonContribution.ts:11` imports `inspectCutover`.

**1.3 `orchestrator.ts` phases (`runPhase` `:168-426`).**
- **P0** `176-189` classify frozen graph + counted inventory (`classifierVersion`, `installer`).
- **P1** `190-204` compile bundle and verify digest == plan digest.
- **P2** `205-210` **attestation only** → `{writersFenced:true,queuesDrained:true,publicProxyStopped:true}` (no real fencing).
- **P3** `211-219` `captureInventoryDump` + `mintRunBoundToken` = the recovery point.
- **P4** `220-233` schema-expansion check, `mode:"verified-noop"`. **P5** `234-248` `installPublishedRelease(pool,{mode:"bootstrap"})`.
- **P6** `249-265` `classifyPopulatedP0Graph` (PG + graph conservation) → `classificationRef`.
- **P7** `266-375` **the archiving phase**: R0 aborts (`:271-276`); dispatch on `DISPOSITION_BY_R_CLASS` (`:288`);
  non-`archived` dispositions append a mapping version to a definition head (`:295-327`); `archived` dispositions call
  `adapter.persistArchive` (`:329-354`) then `appendMappingVersion({kind:"archived",archiveId})` (`:355-366`).
- **P8** `376-391` governance consumption report only. **P9** `392-406` protected-adapter report only
  (`createProtectedWorkflowAdapters`, `stabilizeCanonicalBinding`, `appendProjectValue`).
- **P10** `407-420` `countProducerResidue` must show mappings>0 **and** archives>0 else `PCAT-ORC-NOT-POPULATED`.
- **default** `421-424` `never` exhaustiveness → `PCAT-ORC-UNKNOWN-PHASE`.
P2/P4/P8/P9 are reporting-only stubs. `retainUntil` is hardcoded `orchestrator.ts:350` = `2027-09-03T00:00:00.000Z`.

**1.4 Journaling / resume (`checkpoints.ts`).** Tables `parameter_catalog.parameter_catalog_cutover_runs|_events|_checkpoints`
(`:94,:128,:199,:227`). `insertPlannedRun` `:119-150` is idempotent on
`(source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest, migration_contract_version, plan_digest)`.
`updateRunProgress` `:152-170`; `appendCutoverEvent` `:187-212` with monotonic `sequence_number` (`nextEventSequence` `:172-185`).
`persistCheckpoint` `:214-259` computes `sha256:` over `{phase,payload}` (`checkpointDigestFor` `:49-58`) and uses
`on conflict (cutover_run_id, phase) do nothing`; `loadCheckpoints` `:261-287` returns canonical P0→P10 order;
`snapshotFromRun` `:294-318` surfaces `runBoundToken`/`recoveryPointDump` from the P3 payload.
Resume in `executeCutover` `:458-529`: advisory lock `pg_advisory_lock(hashtext('s7-orc-cutover'), hashtext(planDigest))`
(`:428-449`); reuse-or-insert run by plan digest `:462-463`; `resumed = priorCheckpoints.length>0 || existing!=null` `:465`;
**`recovery-required` cannot resume** `:466-471` (`PCAT-ORC-RESUME-INVALIDATED`); `completed` + all 11 checkpoints is a
pure replay `:472-479`; checkpointed phases skipped `:489`; `failBeforePhase` injects `PCAT-ORC-CRASH` `:490-500`;
`PCAT-ORC-CLASSIFICATION-BLOCKED` moves the run to `recovery-required` `:506`.

**1.5 `recovery.ts`.** `assertRecordedAction` `:28-49` rejects untrimmed/empty (`PCAT-ORC-AD-HOC`), rejects anything
containing `sql`/`ad-hoc`/`adhoc`/`execute-sql` (`:34-41`), accepts only `whole-state-restore|forward-recover`.
`captureInventoryDump` `:53-71` counts the 9 `INVENTORY_RELATIONS` `:13-23` (`public.parameter_specs`,
`public.parameter_spec_versions`, `public.organizations`, `parameter_catalog.legacy_identities`, `legacy_mapping_heads`,
`organization_subject_registrations`, `project_parameter_bindings`, `parameter_definitions`, `project_parameter_values`)
plus the ordered `legacy_identities.id` list; `dumpDigest` `:73-74`. `countPopulatedInventory` `:78-91`;
`countProducerResidue` `:93-117`; `restoreRunMutations` `:119-142` deletes `legacy_mapping_heads` for the run and
returns archive object refs. `recoverCutover` `orchestrator.ts:546-587`: verifies P3 `dump`+`runBoundToken`
(`:559-565` else `PCAT-ORC-INVALID-TOKEN`); `forward-recover` returns the snapshot unchanged (`:566-568`);
`whole-state-restore` runs `restoreRunMutations`, re-captures, requires `dumpsEqual` (`:570-577`) else
`PCAT-ORC-ROLLBACK-DRIFT`, then sets `phase:"P3", state:"recovery-required"` (`:578-582`).

## 2. `classifier/`

**2.1 Vocabulary.** `types.ts:3-16` `R_CLASSES = [R0..R10]`; `:18-25` `PRIMARY_DISPOSITIONS =
["blocked","mapped","archived","review-evidence","definition-proposal"]`; `:27-40` `MAPPING_CLASSES` (11 classes);
`:164-175` `ClassificationAssignment`; `:177-184` `ClassificationBlocker` (R0-only); `:186-201` `ClassificationResult`.

**2.2 R0–R10 classification.** `classify.ts:389-413` `classifySpec` precedence:
```ts
if (contradiction) return { rClass: "R0", invariant: contradiction.invariant };
if (isDisposableScaffoldSpec(index, spec)) return { rClass: "R1", ... };
if (isDriverSchemaRootSpec(index, spec.id)) return isProvableDriverSchemaRoot(...) ? R2 : R3;
if (isCompleteDtsProperty(index, spec, "driver-registration")) return R4;
if (isCompleteDtsProperty(index, spec, "node-type-definition")) return R5;
if (isUnlinkedDtsSurface(index, spec)) return R6;
if (isActiveNonDtsPolicy(index, spec)) return R7;
if (isLegacyDraftProposal(spec)) return R8;
if (isHistoricalSpec(spec)) return R9;
return R10;
```
Predicates: `isDisposableScaffoldSpec` `:299-306`; `isProvableDriverSchemaRoot` `:308-327`;
`isCompleteDtsProperty` `:335-365`; `isUnlinkedDtsSurface` `:367-372`; `isActiveNonDtsPolicy` `:374-380`;
`isLegacyDraftProposal` `:382-384`; `isHistoricalSpec` `:386-387`; `contradictionForSpec` `:205-294`
(invariants `missing-spec-parent`, `binding-revision-owned-by-other-spec`, cross-owner, …).
Per-source-kind `classifyIdentity` `:430-547` (missing parent ⇒ R0). Assembly + conservation `classifyFrozenP0Graph`
`:601-666`, R0 blockers `:640-654`. SQL conservation `classifyPopulated.ts:62-137` (graph must equal
`parameter_catalog.legacy_identities` exactly → `PCAT-CLASS-SOURCE-CONSERVATION`); R0 ledger writes `:38-60` into
`parameter_catalog.parameter_catalog_classification_ledger`. Rule IDs `rules.ts:12-24`; version
`rules.ts:10` `CLASSIFIER_VERSION = "1.0.0"`; `mappingClassForSourceKind` `rules.ts:74-139` is an exhaustive switch
with no `default` (a new source kind fails typecheck).

**2.3 Fixed disposition per class — the single mapping.** `classifier/rules.ts:26-38`
```ts
export const DISPOSITION_BY_R_CLASS = {
  R0: "blocked", R1: "archived", R2: "mapped", R3: "review-evidence", R4: "mapped",
  R5: "mapped", R6: "review-evidence", R7: "archived", R8: "definition-proposal",
  R9: "mapped", R10: "archived",
} as const satisfies { readonly [K in RClass]: PrimaryDisposition };
```

**2.4 Where a NEW reviewed "rebuild disposition contract" plugs in.** All of:
(1) `rules.ts:26-38` — applied at `classify.ts:620` (`disposition: DISPOSITION_BY_R_CLASS[classified.rClass]`), the
single decision point; (2) `types.ts:18-25` `PRIMARY_DISPOSITIONS` closed union if a new kind is added;
(3) independent re-readers `orchestrator.ts:288` (P7 dispatch), `:381-382`, `:396` (P8/P9 counts), and
`archive/adapter.ts:201` (`!== "archived"` → `PCAT-ARC-DISPOSITION-NOT-ARCHIVED`); (4) re-export
`classifier/index.ts:11`; (5) evidence contract `release-verification/comparison/corpusContributionSchema.ts:91-99`
(`ExpectedDifference.rClass`+`ruleId`). No table/config externalizes the map — it is compile-time only.

## 3. `archive/`

**3.1 API.** `types.ts:126-129`
```ts
export type ArchiveAdapter = {
  persistArchive(command: PersistArchiveCommand): Promise<ArchivePersistResult>;
  restoreArchive(command: RestoreArchiveCommand): Promise<ArchiveRestoreResult>;
};
```
Entry `adapter.ts:191` `createArchiveAdapter(options: ArchiveAdapterOptions): ArchiveAdapter`;
`persistArchive` `:196-430`; `restoreArchive` `:432-533`; re-exports `archive/index.ts:1-26`.
Options `types.ts:119-124` (`client`, `objectStore`, `encryptionKey: Buffer`, optional `failAfter`).
`PersistArchiveCommand` `types.ts:35-48`; `ArchiveObjectStore` port `types.ts:111-117`
(`putExclusive|get|remove|exists|listRefs`); failure codes `types.ts:87-96` (`PCAT-ARC-*`: PERMISSION-DENIED,
DISPOSITION-NOT-ARCHIVED, PLAINTEXT-LEAK, ATOMICITY, CHECKSUM-MISMATCH, INTEGRITY, CONFLICT, NOT-FOUND, INVALID-INPUT).

**3.2 Authorization + atomicity.** `adapter.ts:83-101` `authorizeOperator` requires `actor.role === "cutover-operator"`
and a non-empty trimmed audit ref. `:201-215` validates archived disposition, identity/run, reason/release, `retainUntil`.
`:264-404` one transaction with `pg_advisory_xact_lock(hashtext('s7-arc:<legacyIdentityId>'), hashtext(cutoverRunId))`,
owner-scope check against `legacy_identities` (`:288-294`), run existence (`:296-303`), and
`catalog_state.current_catalog_release_id === command.catalogReleaseId` (`:305-311`). Rollback removes the written
object (`:413-417`). Plaintext refusal: `:103-130` collects every string ≥16 chars in `sourcePayload` plus its
serialization and searches the ciphertext **and** all metadata buffers → `PCAT-ARC-PLAINTEXT-LEAK` (`:244-261`).

**3.3 Encryption.** `crypto.ts:9` `const ALGORITHM = "aes-256-gcm";`, key exactly 32 bytes (`assertArchiveKey` `:22-27`).
Envelope `crypto.ts:3-10`: `magic(6) "WEARC1" + version(1) + iv(12) + gcm-tag(16) + ciphertext`. AAD binds content and
identity, `crypto.ts:29-45`: `archiveId \n legacyIdentityId \n cutoverRunId \n sourceChecksum \n graphChecksum`.
`encryptArchiveObject` `:47-59`; `decryptArchiveObject` `:61-89` (truncated ⇒ `"truncated"`, bad magic/version/tag ⇒ `"integrity"`).

**3.4 Checksum.** `checksum.ts:8-9` `sha256Digest` → `"sha256:<hex>"`; `:11-12` `checksumContract` over
`serializeContract`; `:14-24` `archiveGraphChecksum({relationGraph,protectedReferences})`. Re-verified on restore
`adapter.ts:517-524` → `PCAT-ARC-CHECKSUM-MISMATCH`.

**3.5 Storage destination.** Metadata row `parameter_catalog.parameter_catalog_archives` (`adapter.ts:33`, insert `:369-395`);
ciphertext object in `createLocalArchiveObjectStore` `localObjectStore.ts:28` — local FS dir `mode 0700` (`:30`) with a
`0700 .staging` (`:31-32`). Refs are single-segment `^[A-Za-z0-9._-]+$` (`:8`); `resolveInsideRoot` rejects
traversal/absolute/nested (`:17-26`); `putExclusive` writes staging `flag:"wx", mode:0o600` then hard-links (`:35-49`)
so create is atomic and overwrite fails. Object ref `obj_<hex>` from `arc_<hex>` (`adapter.ts:187-189`).
Operator root: `upgrade.sh:316-318` `createLocalArchiveObjectStore(archiveRoot || path.join(path.dirname(journalPath),"archive"))`,
with `--catalog-archive-root` → `WISEEFF_CATALOG_ARCHIVE_ROOT` and `--catalog-archive-key-hex` →
`WISEEFF_CATALOG_ARCHIVE_KEY_HEX` (default `"11".repeat(32)`, `upgrade.sh:69`) → `Buffer.from(hex,"hex")` (`:319`).
There is **no S3/remote adapter** — local FS or mounted volume only.

**3.6 Tests.** `archive/adapter.test.ts:24` freezes the 8-row `THREAT_MATRIX`; `:44` archived R-classes come from the
classifier's production dispositions; `:55` encrypt/decrypt round-trip, source token never in the envelope; `:68`
truncated envelope fails closed; `:84` production-source bans (no S7-MAP import, no retired catalog relation token).
`archive/adapter.integration.test.ts:125` real PG + object store; `:301` every threat-matrix row asserted;
`:357` a `mapped` R class is rejected instead of archived; `:368` public persist/restore refused (no plaintext through
the public seam); `:419` swapped object ⇒ typed checksum failure with no payload; `:489` truncated object fails closed
with no payload; `:512` identical identity+run+checksum replays as a no-op, different checksum conflicts;
`:558` returns an `archiveId` to a later mapping caller without importing S7-MAP.
Rows: `archive/threatMatrix.ts:14-74` (8: metadata+object+checksums; leak/public refusal; atomicity; checksum swap;
permission; integrity; duplicate/conflict; opaque archiveId).

## 4. `mapping/lookup.ts` + HTTP legacy routes

**4.1 Lookup.** `mapping/lookup.ts:16-18`
```ts
export const lookupProtectedIdentity = async (
  input: LookupProtectedIdentityInput,
): Promise<MappingResult<ProtectedLookupResult>> => {
```
Order: (1) identity key → id, `identity.kind === "legacy-identity-id" ? identity.id : await loadIdentityIdBySourceTuple(...)`
(`:19-22`), miss ⇒ `PCAT-MAP-UNKNOWN-IDENTITY` (`:23-25`); (2) existence/owner via `loadStoredIdentity` (`:27-30`);
(3) `countMappingHeads > 1` ⇒ `PCAT-MAP-CONFLICT` (`:32-35`); (4) `loadMappingHead` (`:37`) →
`targetKind!=null && targetId!=null && archiveId==null` ⇒ `{outcome:"mapped",targetKind,targetId}` (`:41-48`);
`targetKind==null && targetId==null && archiveId!=null` ⇒ `{outcome:"archived",archiveId}` (`:49-55`, **the 410 source**);
anything else ⇒ `PCAT-MAP-WRITE-FAILED` (`:56`); (5) `loadBlockedLedger` ⇒ `{outcome:"blocked",rClass:"R0"}` (`:59-65`);
(6) else `PCAT-MAP-UNMAPPED` (`:67`).
`ProtectedIdentityKey` `mapping/types.ts:118-127` = `{kind:"legacy-identity-id",id}` **or**
`{kind:"source-tuple",sourceSystem,sourceKind,ownerScopeKind,ownerScopeId,sourceId}`;
`ProtectedLookupResult` `:134-150`; `MappingOutcome` `:53-64`; failure codes `:35-46`.
Owner/source facts come from `parameter_catalog.legacy_identities` (`classifyPopulated.ts:14-23`, `adapter.ts:271-294`).

**4.2 HTTP projection (source-kind + legacy-id + owner).** `parameter-catalog-api/legacy/lookup.ts:112-118`
`lookupLegacyIdentifier({client, lookup?, legacyType, legacyId, organizationId}): Promise<LegacyLookupOutcome>`.
Allow-list `isAllowListedType` `:49-52` over `legacyLookupIdentifierTypes`, else `not-found` `:119-122`; ID hygiene `:123-126`;
**owner resolution** `:128-145` probes the platform tuple (`sourceSystem:"wiseeff-v1", ownerScopeKind:"platform",
ownerScopeId:"platform"`) and, when the caller has an org, the org tuple (`ownerScopeId: input.organizationId`).
Ambiguity `:156-158`; blocked ⇒ `ambiguous` `:163-165`; `archived` `:166-167`; `not-found` `:159-161`; mapped `:172-175`
(`mappedItem` `:58-73`, hrefs `SINGLE_ID_HREF` `:35-39`). `LEGACY_LOOKUP_SOURCE_SYSTEM = "wiseeff-v1"`, successor
`/api/v2/catalog` — `legacy/types.ts:11-13`.

**4.3 Routes and current behavior.** `dtoSchemas/parameterCatalog.ts`:
`:1228-1233` `catalog.getLegacyIdentifier` → `GET /api/v2/catalog/legacy-identifiers/:legacyType/:legacyId` (mvp);
`:1338-1346` `parameterCatalogBoundedLegacyReadRouteIds` = `parameterSpecs.list|get|listReviewTasks`,
`parameterTopology.listIdentityMappingTasks`, `parameterModules.getRegistry|discoveryHints|listDriverRegistry`;
`:1348-1387` 38 `parameterCatalogLegacyWriteRouteIds`.
`legacy/routes.ts`: `registerCatalogLegacyRoutes` `:408-426`; `handleLegacyCatalogRequest` `:302-406`;
operator prefix `/api/v2/operator/parameter-catalog` hard-404 `migration-diagnostics-not-public` (`:32,:306-317`);
canonical identifier route → `runLookup` (`:326-337`); write routes → always `410 legacy-surface-retired` with
`LEGACY_WRITE_GONE_MESSAGE` (`:339-344`; `gone.ts:7-8`, `catalogLegacyGoneResult` `gone.ts:10-31`);
bounded reads `:346-384` (retired shapes `view=governance|raw` / `mode=raw` ⇒ 410 `:279-283,:349-352`; exact-id →
`runLookup` `:353-358`; `q`/`propertyKey` forced `not-found` `:359-364`; else empty `{items:[]}` 200 `:373-382`).
`outcomeToResult` `:168-215`:
```ts
if (outcome.kind === "archived") {
  return { status: 410, headers, body: serializeApiError(
    new ApiError("GONE", "The legacy identifier was archived and is not available for operational reads.",
      { reason: "legacy-id-archived", retryable: false }), request.requestId) };
}
return { status: 404, headers, body: serializeApiError(new ApiError("NOT_FOUND", "Legacy identifier was not found."), ...) };
```
So **archived ⇒ 410 `GONE`/`legacy-id-archived`**, **unknown id / non-allow-listed type / reverse query ⇒ 404
`NOT_FOUND`**, blocked or >1 owner tuple ⇒ 409 `legacy-id-ambiguous` (`:194-206`), release-header drift ⇒ 409
`release-drift` (`:144-166`), unauthenticated 401 / no `canViewParameters` 403 (`:217-246`).
Old parameter-detail link: `parameterSpecs.get` → `GET /api/v2/parameter-specs/:specId` (`routeManifest.ts:396-400`),
`parameterSpecs.list` → `GET /api/v2/parameter-specs` (`:387`); both in the bounded-legacy-read set, so an archived
spec id ⇒ 410 and an unknown id ⇒ 404. Client path `src/infrastructure/http/parameterTopologyClient.ts:465`.
Wiring: `productionWire.ts:552` (`createLegacyOptions` `:507-533`); alternates `parameter-modules/routes.ts:209`,
`release-verification/evidence/api/driver.ts:260`.
Frontend already owns the vocabulary: `src/application/parameter-catalog/errors.ts:20-21`
(`"legacy-id-archived":"GONE"`, `"legacy-surface-retired":"GONE"`), `states.ts:178-180`
(reason ⇒ `{kind:"retired", target:"legacy-surface", writesEnabled:false}`), `presentError.ts:60`,
`userErrorMessage.ts:22`. But `parameterClient.ts:171-176` special-cases the **different** diagnostic
`legacy-parameter-id-retired` — the `parameter-specs` detail archived-notice path is only partial.

## 5. Self-hosted operator controller (`ops/self-hosted/`)

**5.1 Inventory.** Root 23 files (`compose.yaml`, `Dockerfile`, `Caddyfile*`, `.env*.example`, `upgrade.md`/`.zh-CN.md`,
`setup.md`, `operations.md`, `ip-lab.md`, `catalog-publication.md`, `upgrade-protocol.env`, `PILOT-PREP-EVIDENCE.md`, …).
Subdirs: `scripts/` **56**, `bridge-installer/` 13, `observability/` 10, `bridge-artifacts/` 9,
`bridge-tool-artifacts/` 9, `storage/` 7, `images/` 4, `releases/` 4, `build-network/` 1.
Key scripts: `upgrade.sh` (878 lines, operator launcher + embedded catalog-apply driver), `upgrade-lib.sh`
(real upgrade/rollback implementation), `operation-lock.sh`, `build-network*.sh`, `setup.sh`, `doctor.sh`,
`check-self-hosted-config.ts` (543), `doctor-selfhost.ts`, `setup-selfhost.ts`, `run-self-hosted-smoke.ts`,
`queue-maintenance.ts`, `collect-catalog-publication-status.sh`, `init/preflight/provision-ip-lab.ts`,
`selfhost-answers.ts`, `selfhost-profile.ts`, and the `parameter-catalog-upgrade/` package.

**5.2 Command surface.** `upgrade-lib.sh:14-28` (usage) is authoritative:
`apply (default) | plan | prepare-host | lock-status | unlock | status | resume | recover-candidate | rollback`.
Catalog sub-surface `upgrade.sh:20-42`: `apply --catalog-apply-mode fresh|populated`; `--catalog-apply` alone **fails
closed** ("Fail closed until a single mode is supplied"); options
`--catalog-journal/-graph/-release-json/-run-id/-target-artifact-sha/-target-release-digest/-archive-root/-archive-key-hex/-operator-audit-ref`;
required attestation `WISEEFF_CATALOG_QUIESCED=true` (`:38-42,:98-103`, explicitly "not P2 proof").
Backup/restore are **not** separate scripts: `--backup-root`/`--state-dir`/`--restore-data`/`--confirm` are
`upgrade-lib.sh` options (`:28-29`), and drill/evidence tooling is at repo-root `scripts/` (§5.4).
`ops/self-hosted/scripts/` has **no** `backup*.sh`, `restore*.sh`, or `rollback*.sh` — **ABSENT**
(`find ops/self-hosted -iname "*backup*" -o -iname "*restore*" -o -iname "*rollback*"` → empty).

**5.3 Repository-root resolution.** `upgrade.sh:6` `script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, then
`upgrade.sh:619-621`
```sh
compose_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${compose_dir}/../.." && pwd)"
tsx="${repo_root}/node_modules/.bin/tsx"
```
and the child is launched with `cd "$repo_root"`, `NODE_PATH="${repo_root}/node_modules"`, `WISEEFF_REPO_ROOT="$repo_root"`
(`:634-637`). The embedded TS driver requires it: `upgrade.sh:59` `const root = process.env.WISEEFF_REPO_ROOT ?? "";`
and `:91-93` `fail("PCAT-UPG-ILLEGAL-ACTION","WISEEFF_REPO_ROOT is required")`. Sibling pattern
`collect-catalog-publication-status.sh:40-42` `repo_root="$(cd "${WISEEFF_COLLECT_REPO_ROOT:-${compose_dir}/../..}" && pwd)"`.
Other `ops/self-hosted/scripts/*.ts` resolve from `cwd` (`doctor-selfhost.ts:25`, `preflight-ip-lab.ts:21`).

**5.4 npm scripts (package.json).**
| script | line | target | real vs placeholder |
|---|---|---|---|
| `selfhost:check` | `:57` | `ops/self-hosted/scripts/check-self-hosted-config.ts` (543 lines; required scripts/services/files/compose tokens/env keys) | **real** validator |
| `backup:drill` | `:50` | `scripts/run-backup-drill.ts` (195) | **real**; env-driven evidence builder, exits 1 unless `status==="passed"` |
| `restore:drill` | `:51` | `scripts/run-restore-drill.ts` (177) | **real**; evaluates live-vs-restore target isolation, exits 1 unless passed |
| `rollback:rehearsal` | `:67` | `scripts/run-rollback-rehearsal.ts` (259) | **real**; writes `docs/generated/m6-rollback-rehearsal-evidence.md`, exits 1 on failed/pending |
| `m6:target-plan` | `:68` | `scripts/plan-m6-target-evidence.ts` (697) | **real**; writes `docs/generated/m6-target-evidence-plan.md`, exits 1 unless `status==="ready"` |
Related: `selfhost:smoke` `:58`, `selfhost:setup` `:62`, `selfhost:doctor` `:63`, `selfhost:queue-maintenance` `:64`,
`selfhost:release-gate` `:65`, `backup:check` `:52`, `capacity:gate` `:66`, `m6:target-evidence` `:69`.
No `placeholder`/`not implemented`/`TODO` tokens anywhere in these five bodies; they are gated on operator target env
(`ops/self-hosted/.env` or `--target-env-file`) and fail closed when absent
(`run-backup-drill.ts` falls back to `process.env`; `run-rollback-rehearsal.ts` `isPlaceholderEnvironment` treats
`pending`/`n/a`/`not-configured` as not-a-target).

**5.5 Catalog upgrade controller package** (`ops/self-hosted/scripts/parameter-catalog-upgrade/`, 14 files, 4,276 lines).
`controller.ts:51-53` `CatalogUpgradeController = { dispatch(command: ControllerCommand): Promise<ControllerResult<ControllerSnapshot>> }`,
opened by `openCatalogUpgradeController(deps: ControllerDeps)` `:148` with injected `cutover`/`verification` ports.
`stateMachine.ts:1-10` states `idle|planned|executing|cutover-completed|verification-prepared|verification-ran|recovery-required|failed`;
`:14-22` `LEGAL_ACTIONS = plan|execute|inspect|recover|prepareVerification|runVerification|resume`;
`:26-30` `FORBIDDEN_ACTIONS = selectGates|migrateViaApi|guessUnknownCommit`; `:56-77` per-state transition table.
`journal.ts:22` `UPGRADE_CONTROLLER_SCHEMA_VERSION = "s11-upg-v1"`; `openUpgradeJournal` `:255`,
`commitJournalTransition` `:293`, `loadUpgradeJournal` `:228`, `hasCommittedReplay` `:281` — this is the **resumable
journal** (`WISEEFF_CATALOG_UPGRADE_JOURNAL`, default `ops/self-hosted/.state/upgrades/catalog/<runId>/journal.json`,
`upgrade.sh:626-629`). `recovery.ts:95-96` records auto-resume/auto-activate after `verification-ran` (including
P12–P15) as a refused attack ⇒ "manual-stop; P12-P15 stay unexecuted".

## 6. Consumer families and legacy parameter tables

**6.1 Where the eleven labels are defined.**
1. Authoritative label list — `release-verification/comparison/corpusContributionSchema.ts:9-23`
   ```ts
   export const COMPARISON_FAMILIES = ["CGH","TOP","PRJ","FIL","AGT","LOG","DBG","DTS","KNW","MOD","OPS"] as const;
   ```
   Comparison IDs `:25-35` (`PCAT-CMP-D01…D09`); per-family allowed IDs `FAMILY_COMPARISON_IDS` `:39-61`;
   `assertExactFamilySet` `:271-300` requires exactly these 11, no dupes/unknowns.
2. Family → real module — `release-verification/comparison/productionProviders.ts:45-155`, one entry per family:
   CGH `:47-55`→`parameter-specs/parameterCatalogComparisonContribution`; TOP `:57-65`→`parameter-topology/…`;
   PRJ `:67-74`→`parameters/…`; FIL `:76-84`→`parameter-files/…`; AGT `:86-94`→`agent/…`; LOG `:96-104`→`logs/…`;
   DBG `:106-114`→`debugging/…`; DTS `:116-124`→`dts-reload/…`; KNW `:126-134`→`knowledge/…`;
   MOD `:136-144`→`parameter-modules/…`; OPS `:146-154`→`operations/…`. All 11 contribution files exist
   (`git ls-files 'server/modules/*/parameterCatalogComparisonContribution.ts'` → 11 hits).
3. Scanned-families allow-list — `scripts/parameter-catalog-allowlist/schema.ts:3-15` `consumerFamilyIds`
   (`S12-CGH`…`S12-OPS`); violation-id regex `:49`
   `^S12-(?:CGH|TOP|PRJ|FIL|AGT|LOG|DBG|DTS|KNW|MOD|OPS):[a-z0-9-]+:[a-f0-9]{16}:[a-f0-9]{16}$`; boundary rules `:17-29`.
   `scripts/parameter-catalog-allowlist/index.ts:12-153` `consumerShardDefinitions` maps family → required path globs
   + shard file; shards `scripts/parameter-catalog-allowlist/shards/s12-{cgh,top,prj,fil,agt,log,dbg,dts,knw,mod,ops}.json`.
   Notable: CGH `:14-21` (`server/modules/parameter-specs/**`), TOP `:25-33`, PRJ `:37-48` (adds
   `server/modules/parameter-drafts/**`), FIL `:52-60`, AGT `:64-77`, LOG `:81-91`, DBG `:95-105`, DTS `:109-117`,
   KNW `:121-131`, MOD `:135-143`, OPS `:147-153`.
4. Human-readable S12 table: `docs/references/parameter-catalog-contract-inventory.md:576-590`.

**6.2 Legacy parameter tables and their querying modules.** Created in `server/migrations/*.sql`:
`parameter_specs`, `parameter_spec_versions`, `parameter_definitions`, `project_parameter_values`,
`project_parameter_bindings`, `project_parameter_binding_revisions`, `project_parameter_files` (+`_candidates`,`_versions`),
`project_parameter_initialization_drafts`/`_reviews`, `parameter_modules`, `parameter_module_mappings`,
`parameter_module_dismissed_compatibles`, `parameter_drafts`, `parameter_draft_identity_invalidations`,
`parameter_history_entries`, `parameter_submission_rounds`/`_items`, `parameter_change_requests`,
`parameter_review_decisions`, `parameter_spec_review_tasks`, `parameter_spec_matcher_overrides`,
`parameter_import_batches`, `parameter_file_sync_conflicts`, `parameter_identity_migration_runs`/`_phases`,
`parameter_identity_cutovers`, `parameter_policy_targets`, `parameter_reload_bindings`,
`parameter_definition_reconciliation_runs`/`_items`, `parameter_spec_version_cutover_runs`/`_items`,
`parameter_spec_property_key_cutover_runs`/`_items`. `parameter_bindings` (bare) — **ABSENT**; only
`project_parameter_bindings` (`migrations/0048_parameter_topology_schema_shadow.sql:201`) and its `_revisions` sibling.
Mentions per module (`grep -rhoE` over `server/modules/<m>`, tests included):
CGH `parameter-specs` → `parameter_spec_versions` 131, `parameter_specs` 118, `parameter_spec_review_tasks` 49,
`parameter_modules` 49, `project_parameter_bindings` 37, `parameter_spec_matcher_overrides` 3, `parameter_policy_targets` 1.
TOP `parameter-topology` → `project_parameter_binding_revisions` 89, `parameter_drafts` 67, `project_parameter_bindings` 49,
`parameter_history_entries` 31, `parameter_specs` 30, `parameter_change_requests` 29, `parameter_identity_migration_runs` 28.
PRJ `parameters` → `parameter_change_requests` 84, `parameter_modules` 61, `parameter_history_entries` 48,
`project_parameter_values` 42, `project_parameter_bindings` 31. FIL `parameter-files` → `project_parameter_files` 36,
`project_parameter_values` 18, `parameter_drafts` 15. AGT `agent` → `parameter_change_requests` 11,
`project_parameter_values` 7, `parameter_drafts` 7. LOG `logs` → `project_parameter_bindings` 2,
`parameter_spec_versions` 2, `parameter_specs` 1. DTS `dts-reload` → `project_parameter_bindings` 10,
`parameter_specs` 7, `parameter_spec_versions` 7, `parameter_drafts` 6. KNW `knowledge` → `parameter_specs` 12,
`parameter_spec_versions` 2. MOD `parameter-modules` → `parameter_modules` 64, `project_parameter_bindings` 20,
`parameter_module_mappings` 19.
DBG `debugging` → **zero** legacy parameter tables; uses `debugging_parameters`, `debug_nodes`, `debug_node_bindings`,
`debugging_parameter_node_bindings`, `node_operations`, `debugging_sessions`, `debugging_snapshots`
(`debugging/parameterCatalogComparisonContribution.ts:192,208,229,252,277,296,312`) plus `listProjectBindings` (`:10`).
OPS `operations` → **zero**; uses `projects`, `dts_logical_nodes`, `dts_config_revisions`
(`operations/parameterCatalogComparisonContribution.ts:273,291,308`) and the legacy HTTP lookup (`:5-9`).
Legacy literals are consolidated at `parameter-kernel/legacyParameterIdentityNames.ts:1-9`
(`LEGACY_IDENTITY_SQL = {definitionsTable:"parameter_definitions", valuesTable:"project_parameter_values",
recommendedValueColumn:"recommended_value"}`) — comment: "Literal strings live only here (+ migrations/cutovers/adapters)".

## 7. Catalog-cutover test files and what they prove

| File | Lines | Proof |
|---|---|---|
| `catalog-cutover/checkpoints.test.ts` | 48 | `:11` freezes the 7 threat-matrix rows (plan/execute/inspect/recover); `:37` T3 refuses unknown phases and activation P11–P16 |
| `catalog-cutover/orchestrator.test.ts` | 389 | `:266` 7 R3 rows; `:279` T1 plans+executes P0–P10 into ordered checkpoints with mapping **and** Archive residue; `:319` T2 duplicate plan/execute resumes the same run, no second live run; `:348` T3 unknown/activation typed refusals; `:358` T6 empty catalog is not P0–P10 evidence; `:369` T7 frozen producer types, no `catalog_releases` writer DML/banned literals |
| `catalog-cutover/recovery.integration.test.ts` | 278 | `:183` T3 refuses ad-hoc SQL recovery; `:191` T4 rollback dump equals the pre-execute P3 dump |
| `catalog-cutover/archive/adapter.test.ts` | 96 | see §3.6 |
| `catalog-cutover/archive/adapter.integration.test.ts` | 572 | see §3.6 |
| `catalog-cutover/classifier/classify.test.ts` | 171 | `:26` every R0–R10 class exactly once per identity; `:41` conservation with no duplicate primary dispositions; `:53`/`:83` cross-owner rules; `:104` R0 is a hard blocker, never archived as success; `:116` same-key R6/R8 stay separate; `:134` repeatable by fingerprint; `:145` order-independent; `:158` duplicate identities rejected |
| `catalog-cutover/classifier/classify.integration.test.ts` | 341 | `:270` classifies every seeded identity on real PostgreSQL, ledgers only R0 blockers; `:328` fails closed on a sampled subset graph |
| `catalog-cutover/mapping/map.test.ts` | 50 | `:17` consumes frozen ClassificationResult, R0 = blocked; `:27` T3 refuses in-place UPDATE of a mapping version; `:37` typed operational target union; `:44` keeps the `parameter_definitions` token out of production mapping source |
| `catalog-cutover/mapping/map.integration.test.ts` | 799 | `:423` first mapped append = v1, exact replay no-op, exact lookup; `:544` reclassify appends v(N+1) + CAS head; `:609` in-place UPDATE refused; `:644` concurrent appends ⇒ one winner/one conflict/one head; `:684` CAS mismatch typed conflict; `:733` R0 never stored as a successful head; `:769` **archived disposition lookup returns the caller-supplied archive_id exactly** |

Adjacent proof of the 410 link behavior (`parameter-catalog-api/legacy/`): `routes.test.ts:202-207` (410 + reason
`legacy-id-archived`, no archive payload), `:211-226` (409 blocked / 404 unknown+reverse+invalid type), `:258,:271`
(all bounded reads + replay ⇒ 410), `:289` (governance shape 410), `:311,:318` (writes 410), `:328` (operator prefix 404);
`lookup.test.ts:50,92,112,138,171,186`; `lookup.integration.test.ts:326,348,362,384`.
Fixture graph `classifier/__fixtures__/p0GraphFixture.ts` (referenced `interface.ts:4`).

## 8. Tech-debt IDs in `docs/exec-plans/tech-debt-tracker.md` (English)

File is 138 lines; the `## Open` table starts at line 9 (`| ID | Area | Debt | Impact | Next Action |`).
Existing IDs (`grep -oE "TD-[0-9]{3}" | sort -u`): `TD-000 … TD-034, TD-036 … TD-123`.
- **`TD-035` is absent** — a gap, not a collision risk.
- Highest in use: **TD-123** (`:45`, "Debugging / Audit provenance").
- **`TD-124` does not exist** — `grep -n "TD-124" docs/exec-plans/tech-debt-tracker.md` returns nothing.
Adding TD-124 is collision-free against this file (`docs/zh-CN/exec-plans/tech-debt-tracker.md` is the translation
sibling; it was not swept for TD collisions in this pass).

## ABSENT / negative findings (with the search used)

- `rg`/`rg --files` — not installed (`bash: rg: command not found`); used `grep -rn`, `find`, `git ls-files`.
- `ops/self-hosted/scripts/` `backup*|restore*|rollback*` scripts — **ABSENT** (`find ops/self-hosted -iname "*backup*" -o -iname "*restore*" -o -iname "*rollback*"` → empty).
- `parameter_bindings` bare table — **ABSENT** in `server/migrations/*.sql` (only `project_parameter_bindings`).
- `TD-124` and `TD-035` — **ABSENT**.
- Production HTTP route for `plan/execute/inspect/recoverCutover` — **ABSENT** (only `scripts/wayfinder/*` CLIs and
  `ops/self-hosted/scripts/upgrade.sh`; `parameter-catalog-api` consumes `lookupProtectedIdentity` only —
  `legacy/threatMatrix.ts:113`).
- Any `archive-rebuild` identifier or route under `server/modules/catalog-cutover/` — **ABSENT**.
- Remote/object-storage archive backend — **ABSENT** (only `createLocalArchiveObjectStore`, local FS).
- Frontend notice keyed on `legacy-id-archived` for the `parameter-specs` detail path — **PARTIAL**: vocabulary exists
  (`errors.ts:20-21`, `states.ts:178-180`, `presentError.ts:60`) but `parameterClient.ts:171-176` special-cases the
  different `legacy-parameter-id-retired` diagnostic.
- `docs/exec-plans/active/849-inventory/` — did not exist before this report (created now).
