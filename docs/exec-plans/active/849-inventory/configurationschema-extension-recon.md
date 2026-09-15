# 849 — `configuration-schema` Subject Kind Extension: Exhaustive Change Inventory

Read-only reconnaissance of `issue-849-parameter-unification`. Scope: every closed
contract enumerating Catalog subject kinds (`"driver"`, `"node-type"`) or selector
kinds (`"driver-compatible"`, `"node-type-name"`) that must gain
`configuration-schema` / `configuration-schema-id`.

Canonical registries:
- `server/modules/parameter-catalog-contract/enums.ts:6` `export const catalogSubjectKinds = freezeRegistry(["driver", "node-type"]);`
- `server/modules/parameter-catalog-contract/enums.ts:57-60` `catalogSubjectSelectorKinds = freezeRegistry(["driver-compatible","node-type-name"]);`

Second, **distinct/legacy** closed set (DTS attribution taxonomy), extended only if
placement gains a module kind: `attribution_subjects.subject_kind in
('driver-registration','node-type-definition')` (0082) and
`parameter_modules.kind in ('business','driver-group','node-type','unclassified')` (0080).

---

## 1. SQL migrations and constraints

**1.1 Latest migration / collision.** Highest prefix in `server/migrations/` is
`0143` — `server/migrations/0143_catalog_publication_runtime.sql`. New file must be
`0144_*.sql`; no `0144` exists and `grep -rn 0144 docs/ server/` is empty. Uniqueness
asserted at `server/shared/database/migrations.test.ts:70-82`
(`expect(prefix).toMatch(/^\d{4}$/)`, duplicates `[]`). Migration pins that may need
updating: `server/modules/catalog-kernel/security/catalogRoleManifest.ts:110-120`
(`SCHEMA_MIGRATION = "0137_canonical_parameter_catalog_schema.sql"`,
`VERIFICATION_MIGRATION`, `PUBLICATION_*_MIGRATION`, `FLOOR_MIGRATION`).

**1.2 Canonical schema — `server/migrations/0137_canonical_parameter_catalog_schema.sql`.**

Subject kind + canonical key:
- `:215` `kind text not null check (kind in ('driver', 'node-type')),`
- `:219-222` `constraint catalog_subject_canonical_key_ck check (` /
  `(kind = 'driver' and parameter_catalog.is_canonical_compatible_selector(canonical_key)) or` /
  `(kind = 'node-type' and parameter_catalog.is_canonical_node_type_name(canonical_key))`
- `:52-58` `is_canonical_compatible_selector(value text)` · `:60-66` `is_canonical_node_type_name(value text)` — a third predicate is required.

Selector kind:
- `:269` `selector_kind text not null check (selector_kind in ('driver-compatible', 'node-type-name')),`
- `:275-278` `constraint catalog_subject_alias_selector_ck check (` with the two
  `selector_kind = ... and is_canonical_...` branches.

Kind↔selector derivation, appearing **twice** (materialization + current-state triggers):
- `:292-295` `target_selector_kind := case new.kind when 'driver' then 'driver-compatible' when 'node-type' then 'node-type-name' end;`
  (`reject_cross_root_selector_collision`, subject path)
- `:321-324` `where subject.kind = case target_selector_kind when 'driver-compatible' then 'driver' when 'node-type-name' then 'node-type' end` (same fn, alias path)
- `:552-553` `(alias.selector_kind = 'driver-compatible' and subject.kind <> 'driver') or` /
  `(alias.selector_kind = 'node-type-name' and subject.kind <> 'node-type')`
- `:568-571` `canonical_owner.kind = case alias.selector_kind when 'driver-compatible' then 'driver' when 'node-type-name' then 'node-type' end`
- `:909-910` and `:925-928` — byte-identical alias checks inside `assert_current_release_complete`.

Subtype exactness + placement:
- `:742-743` `if (subject_kind = 'driver' and (driver_count <> 1 or node_type_count <> 0))` /
  `or (subject_kind = 'node-type' and (driver_count <> 0 or node_type_count <> 1)) then`
  (`catalog_subject_exact_subtype_ck`; subtype tables `:225-233` `catalog_drivers`, `:235-239` `catalog_node_types`)
- `:2935-2936` `or (subject_kind = 'driver' and module_kind <> 'driver-group')` /
  `or (subject_kind = 'node-type' and module_kind <> 'node-type') then` (`assert_subject_placement_kind`)
- `:2970-2971` `(subject.kind = 'driver' and new.kind <> 'driver-group') or` / `(subject.kind = 'node-type' and new.kind <> 'node-type')` (`assert_parameter_module_placement_kind`)
- `:1922` `and link.subject_kind = source_payload ->> 'subjectKind';` (passthrough, no literal).

**1.3 Legacy taxonomy CHECKs (extend for placement).**
- `server/migrations/0080_attribution_taxonomy.sql:365` `check (kind in ('business', 'driver-group', 'node-type', 'unclassified'));`
- `:372` `check (match_kind in ('compatible', 'node-type'));` · `:17` superseded widening
- `server/migrations/0082_attribution_subjects.sql:11` `check (subject_kind in ('driver-registration', 'node-type-definition')),`
- `:143-153` `parameter_modules_subject_kind_check`: `kind in ('driver-group','node-type')` → `attribution_subject_id is not null` / `('business','unclassified')` → null.
- `server/migrations/0071_relax_enablement_subject_checks.sql:13,17` — `edit_subject_kind in ('binding','node-enablement')`; **unrelated**, leave alone.

**1.4 Capability SQL is not a closed enum.** `server/migrations/0140_catalog_publication_control_plane.sql`
stores it as a free token: `:334` `capability_contract_revision text,`; `:345-351` non-empty/btrim/control-free;
`:633-637`,`:653-657` column CHECKs; `:504-505` `capability_contract jsonb ... jsonb_typeof(...)='object'`;
`:547-548` `capability_contract_digest ... ~ '^sha256:[0-9a-f]{64}$'`; `:934`,`:948` seed `'catalog-capability/v1'`.

**1.5 Roles/privileges.** `server/migrations/0138_canonical_parameter_catalog_roles.sql:239-240`
`parameter_catalog.catalog_drivers,` / `parameter_catalog.catalog_node_types,`; `:287-288`,`:294-295`
execute grants on `is_canonical_compatible_selector(text)` / `is_canonical_node_type_name(text)`.
TS manifest: `server/modules/catalog-kernel/security/catalogRoleManifest.ts:25-30`
`SYNCHRONIZER_EXECUTE_FUNCTION_NAMES`; `:42-57` `CATALOG_RELATIONS` (`catalog_drivers`, `catalog_node_types`,
`catalog_subjects`, `catalog_subject_aliases`); count assertion at
`server/modules/catalog-kernel/security/catalogRoles.integration.test.ts:519-520`.

**1.6 Release-verification SQL gate.** `server/modules/release-verification/gates/postgres/countGates.ts:284-285`
`(subject.kind = 'driver' and module.kind is distinct from 'driver-group')` /
`or (subject.kind = 'node-type' and module.kind is distinct from 'node-type')` (`runV05`, `PCAT-VRF-V05-PLACEMENT-CARDINALITY`).

**1.7 Generated DB doc embeds live CHECK text** (`docs/generated/db-schema.md:695,699,714,720,1744,4215,4254,4259`) — see §5.

---

## 2. TypeScript branches/switches on subject or selector kind

**2.1 Contract.** `enums.ts:6-7`; `enums.ts:57-61`;
`server/modules/parameter-catalog-contract/failures.ts:117-120`
`readonly kind: "invalid-selector";` / `readonly field: "driver-compatible" | "node-type-name" | "property-key";`.
`normalization.ts:9-19` branded `DriverCompatible`/`NormalizedNodeTypeName`,
`:75` `parseCanonicalCompatibleSelector`, `:97` `parseCanonicalNodeName`.

**2.2 Kernel interface.** `server/modules/catalog-kernel/interface.ts:59`
`export type CatalogSubjectKind = "driver" | "node-type";`; `:81` `readonly selectorKind: "driver-compatible" | "node-type-name";`;
`:115-123` `CatalogSubjectSelectorSnapshot` union; `:146-147` alias selector union; `:154` `kind: CatalogSubjectKind`; `:226` `kinds`.

**2.3 Compiler closed rules.** `server/modules/catalog-kernel/compiler/stableRules.ts:57-66`
`closedEnums: { catalogSubjectKinds: stringArray, catalogSubjectSelectorKinds: stringArray, ... }`;
`:235-240` `selectorKindBySubjectKind: {` / `driver: z.literal("driver-compatible"),` /
`"node-type": z.literal("node-type-name"),` / `}.strict(),` — **`.strict()` rejects a third key**.

**2.4 Compiler doc types.** `compiler/types.ts:39` `readonly kind: "driver" | "node-type";`; `:43` selector kind;
`:66` alias `selectorKind`; `:94` revision `matching.selectorKind`.

**2.5 Compiler validation.** `compiler/validation.ts:501-504` `selector.kind === "driver-compatible" ? parseCanonicalCompatibleSelector(...) : parseCanonicalNodeName(...)` (unknown kinds silently treated as node-name);
`:517-521` same for aliases; `:960-963` `const expectedSelectorKind = subject.content.kind === "driver" ? ...selectorKindBySubjectKind.driver : ...["node-type"];`.

**2.6 Compiler fingerprint/golden.** `compiler/contractArtifacts.ts:33-49` reads the three
`schemas/dts/catalog-release/*.json`; `:68-72` `s1BundleContractArtifactDigest`.
`compiler/contract.ts:19-42` `catalogCompilerContract` + `catalogCompilerContractFingerprint`.
Pinned in `compiler/__fixtures__/compiledReleaseGolden.ts:1-11`; asserted at
`compiler/compileCatalogRelease.test.ts:98-103,289-294`.

**2.7 Installer.** `server/modules/catalog-kernel/install/materializeRelease.ts:96-107`
`selector.kind === "driver-compatible" ? {kind,values} : {kind:"node-type-name",value}` (writes `selector_snapshot`);
`:232-247` `if (subject.content.kind === "driver") { ...catalog_drivers... } else { ...catalog_node_types... }`.

**2.8 Runtime matching / alias checks.**
- `runtime/subjectMatch.ts:22-25` `const aliasSelectorKind = (kind: CatalogSubjectKind): "driver-compatible" | "node-type-name" => kind === "driver" ? "driver-compatible" : "node-type-name";`
- `:27-37` `canonicalSelectorValues` binary branch; `:179-196` `resolveCatalogSubject` is hardcoded two-phase
  (`collectHits(subjects,"driver",...)` then `collectHits(subjects,"node-type",[nodeTypeName])`).
- `runtime/currentSnapshot.ts:70-90` row types; `:129-134` `selectorKind?: "driver-compatible" | "node-type-name"`;
  `:156-159` `selectorKind: matching.selectorKind ?? "driver-compatible",` (**defaults unknown kinds to driver-compatible**);
  `:850-875` binary snapshot/alias selector construction.
- `cache/rebuildCatalogCache.ts:117-120` `kinds: ["driver", "node-type"],` (cache listing excludes a third kind).
- `verification/verifyCurrentMaterialization.ts:231-242` `expectedSelectorSnapshot` binary branch.

**2.9 Publication builder (authoring).** `server/modules/catalog-publication/builder/types.ts:111-122`
`CreateSubjectWithDefinitionsChange = { op; kind: "driver" | "node-type"; selector: { kind: "driver-compatible" | "node-type-name"; value }; ... }`;
`:265` `selectorKind: "driver-compatible" | "node-type-name"`; `:27` `CATALOG_CAPABILITY_CONTRACT_REVISION = "catalog-capability/v2"`.
`builder/completeSuccessor.ts:342-349` `newNodeType` impact heuristic (`kind === "node-type"`);
`:753-755` `if (subjectChange.kind !== "driver" && subjectChange.kind !== "node-type") { return fail({ kind:"invalid-input", reason:"subject kind must be driver or node-type" }); }` — **primary authoring rejection**;
`:763-765` `const expectedSelectorKind = subjectChange.kind === "driver" ? "driver-compatible" : "node-type-name";`;
`:787-792` ternary selector parse with `{ok:false,error:"invalid-syntax"}` fallback; `:844-862` `subtype: kind === "driver" ? {nature,cardinality} : {}`.

**2.10 Preview parser.** `server/modules/catalog-publication/preview.ts:86-96`
`if (value.kind !== "driver-compatible" && value.kind !== "node-type-name") return null;`;
`:139-148` `(entry.kind !== "driver" && entry.kind !== "node-type") || ... → {kind:"invalid-input",reason:"changeSet"}`;
`:55-62` `unsupported-catalog-capability` error arm; `:377-408` maps failures to it; `:256` `capabilityContractRevision: "catalog-capability/v2",` (hardcoded duplicate).

**2.11 Vendor import.** `import/vendorAdapter.ts:366-367` `readonly kind: "driver" | "node-type";` / selector kind;
`:660-661` `canonicalKey = isDriver ? \`driver:${...}\` : \`node-type:${...}\`` + `selectorKind = isDriver ? ("driver-compatible" as const) : ("node-type-name" as const)`;
`:1065` `kind: isDriver ? "driver" : "node-type",`; `:1106` `subject.kind === "driver" && ...`.

**2.12 Read API.** `parameter-catalog-api/read/query.ts:38` `const SUBJECT_KINDS = new Set<CatalogSubjectKind>(["driver", "node-type"]);`;
`:140` rejects unknown `?type=`; `:219-221` `subjectKinds(type)`. `read/handlers.ts:285` `kinds: subjectKinds(parsed.query.type),`.
`read/types.ts:189-198` `readonly type?: "driver" | "node-type";`.

**2.13 Registration/placement.** `parameter-catalog-api/governance/types.ts:57` `defaultSubjectKind: "driver" | "node-type";`;
`:131-137` `resolveSubjectKind?: (...) => Promise<"driver" | "node-type" | null>` + `readonly subjectKind: "driver" | "node-type";`.
`governance/handlers.ts:213-222` `resolveSubjectKind(...): Promise<CatalogSubjectKind | null>` defaulting to `scope.defaultSubjectKind`.
`productionWire.ts:303-304` `const expectedModuleKind = (subjectKind) => subjectKind === "driver" ? "driver-group" : "node-type";`;
`:449-478` port wiring (`resolveSubjectKind`, `resolveDestinationModuleId`).
`parameter-governance/registration/command.ts:36-48` `subjectKind: CatalogSubjectKind`;
`registration/internalGuardedRegistrationWriter.ts:46-47` same `expectedModuleKind`, enforced at `:109`.
`parameter-governance/resolveReviewItem/command.ts:182-186` `if (command.subjectKind !== "driver" && command.subjectKind !== "node-type") return invalid("subjectKind");`.
`parameter-modules/attributionSubjects.ts:3` `AttributionSubjectKind = "driver-registration" | "node-type-definition";`, `:35-37` parent rules.

**2.14 Legacy cutover classifier.** `server/modules/catalog-cutover/classifier/types.ts:71-75`
`readonly subjectKind: "driver-registration" | "node-type-definition";`;
`classifier/classify.ts:338,346` `expectedSubjectKind` equality; `:355-364` `if (expectedSubjectKind === "driver-registration")` … `module.kind === "node-type"`.

**2.15 Evidence harness default.** `server/modules/release-verification/evidence/api/driver.ts:103` `defaultSubjectKind: "driver",`.

**2.16 Other legacy closed sets (verify, don't blanket-edit).**
`server/modules/parameter-specs/schemas.ts:10`; `parameters/types.ts:12` and `parameter-modules/types.ts:5`
`ModuleKind = "business" | "driver-group" | "node-type" | "unclassified"`; `parameters/schemas.ts:64,92`;
`parameter-modules/schemas.ts:3`; `parameter-specs/definitionVerification.ts:94,184,338,451,484,544,611,842,867-921,1005`
(`'node-type-definition'` gates; `:842` `binding_module.kind not in ('driver-group','node-type')`, `:921` `<> 'node-type'`);
`parameter-modules/resolveAttributionSubject.ts:176-189`; `parameter-specs/service.ts:904-908,1763-1767`;
`parameter-modules/ensureAttributionModuleForBinding.ts:642-646`.

---

## 3. Release capability / admission

Definition-content allow-list (not a kind list): `server/modules/catalog-publication/builder/capabilities.ts:27-46`
`CATALOG_CAPABILITY_ALLOW_LIST`; `:87-88` `capabilityAllowListIdentity()`.
`builder/types.ts:216-244` `CapabilityAllowListIdentity`/`CapabilityContract`; `:27` revision constant;
`:301,328,336` `readonly capabilityContractRevision: typeof CATALOG_CAPABILITY_CONTRACT_REVISION;`.

Consumer admission (fails closed):
- `server/modules/catalog-publication/runtime/capabilities.ts:8-20` `SUPPORTED_CATALOG_CONSUMER_CAPABILITIES`
  (`compiler: "catalog-kernel/compileCatalogRelease"`, `matcher: "catalog-kernel/subjectMatch"`, …);
  `:17-19` `SUPPORTED_CATALOG_CONSUMER_REVISIONS = new Set(["catalog-capability/v1", CATALOG_CAPABILITY_CONTRACT_REVISION])`;
  `:22-23` `catalogConsumerSupportsRevision`.
- `runtime/readiness.ts:18,193-198` `const capabilityRevision = policy.ok ? policy.value.capabilityContractRevision : "";`
  `if (!catalogConsumerSupportsRevision(capabilityRevision)) reasons.push("unsupported-catalog-capability");`
- `runtime/index.ts:2-3` re-exports.

Classifier/policy/digest gates:
- `authorization/classify.ts:20-74` (`:23-31` `unsupported-catalog-capability`; `:44-52` only create-definition/documentation;
  `:59-67` `facts.introducesNewSubject` → high risk).
- `authorization/policy.ts:91-105,187-210` `capabilityContractRevision: string` passed to `revise_publication_policy` (`:99`), failure → `publication-capability-missing` (`:105`).
- `authorization/authorize.ts:97-121` digest + `capabilityDigest === tuple.capabilityContractDigest`; `:274-276` `candidate-tampered`;
  `:430-440` recompute/compare; `:462-466` `unsupported-catalog-capability`.
- `persistence/store.ts:559-567` `if (digest.rows[0]?.digest !== input.capabilityContractDigest) ... "capability_contract_digest does not match candidate"`.
- `enqueue.ts:105-125` `select catalog_publication.digest_jsonb(capability_contract) as digest` → `capabilityContractDigest`.
- `jobs/execute.ts:259,417` handles `publication-capability-missing`.
- `server/migrations/0140_catalog_publication_control_plane.sql:934,948` seed `'catalog-capability/v1'`.
- Frontend revision literals: `src/application/parameter-catalog/fixtures.ts:209` `revision: "catalog-capability/v2"`,
  `src/infrastructure/http/parameterCatalogClient.test.ts:115`.

Net: the compiler/schema closed enums reject the kind first (§2.3–2.5); even if admitted, the consumer set fails
closed for any revision other than v1/v2, so the revision must be bumped **and** added to
`runtime/capabilities.ts:17-19`.

---

## 4. API / DTO / generated artifacts

**4.1 DTO schemas (source of truth).** `server/modules/contracts/dtoSchemas/parameterCatalog.ts`
`:4` imports `catalogSubjectKinds`; `:218` `export const catalogSubjectTypeSchema = closedEnum(catalogSubjectKinds);`;
`:291-293` `catalogSubjectDtoSchema` → `type: catalogSubjectTypeSchema,`; `:330-336` `catalogDefinitionDtoSchema.subject.type`;
`:634-645` `catalogCreateSubjectWithDefinitionsChangeSchema` — `:636` `kind: z.enum(["driver", "node-type"]),`,
`:639` `kind: z.enum(["driver-compatible", "node-type-name"]),`; `:654-658` union;
`:677-680` capability-contract DTO (`revision: z.string()`, open);
`:1418-1450` registry, `:1437` `schema: { type: "string", enum: [...catalogSubjectKinds] }`.
Related module-taxonomy DTO: `dtoSchemas/parameterModules.ts:8-9,36`.

**4.2 OpenAPI.** `package.json:71` `"contract:openapi": "tsx scripts/generate-openapi-contract.ts"`.
`scripts/generate-openapi-contract.ts:3,5-9` imports `buildOpenApiDocument` from `../server/modules/contracts/openapi`
and writes `docs/generated/openapi.json` (`JSON.stringify(document, null, 2)`).
Source of truth: `server/modules/contracts/openapi.ts` + `schemaRegistry.ts` + the `*SchemaRegistry` maps in
`dtoSchemas/parameterCatalog.ts:1418`. Check: `package.json:72` `contract:check` → `scripts/check-openapi-contract.ts:4-21` (in-memory rebuild, byte compare).
Generated occurrences: `docs/generated/openapi.json:5913-5919` (`catalog.listSubjects` `type` enum `["driver","node-type"]`),
also `:14367,14438,20791,20978,21152,21415,23787,23800`.

**4.3 Frontend DTO mirror.** `src/infrastructure/http/parameterCatalogDtos.ts:105-115` `type?: "driver" | "node-type";`;
`parameterCatalogClient.ts:119` `if (query.type) params.set("type", query.type);`, `:220-223`, `:629`.

**4.4 `docs/generated/parameter-catalog-bundle.schema.json`** mirrors the bundle schema; closed kinds at
`:49,480,558,629,633,956,1015,1068`. **ABSENT:** no generator in `scripts/`, no `package.json` entry, no code
reference anywhere (searched `scripts/`, `server/`, `package.json`, repo-wide grep). Only named by the plan
`docs/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md:601,746`. Flag as unresolved.

**4.5 S0-ID golden artifacts.** `schemas/dts/catalog-release/stable-id-rules.json:28-36`
`"closedEnums": { "catalogSubjectKinds": ["driver","node-type"], "catalogSubjectSelectorKinds": [...] }`;
`:310-312` `"selectorKindBySubjectKind": { "driver": "driver-compatible", "node-type": "node-type-name" }`;
`:3-11` `s0IdContract.serializationGolden` pins `server/modules/parameter-catalog-contract/__fixtures__/serialization-golden.json`
(`gitBlobOid`, `byteLength: 1563`, `rawSha256`) — the golden fixture changes, so these pins change.
`schemas/dts/catalog-release/catalog-release.schema.json:92-97` selector enum; `:157-161` subject kind enum;
`:207-255` if/then/else `kind === "driver"` → `selector.kind const "driver-compatible"` + `$ref driverSubtype`,
`else` → `const "node-type-name"` + `$ref nodeTypeSubtype`; `:137-140` `nodeTypeSubtype` (`additionalProperties:false`);
`:276-281` alias selector enum; `:336-341` matching selector enum.
Test-local mirrors: `schemas/dts/catalog-release/catalog-release.schema.test.ts:72,206-208,963,1816`.

---

## 5. Generated DB schema documentation

- `package.json:76` `"db:schema-doc": "tsx scripts/generate-db-schema-doc.ts"`;
  `:77` `"db:schema-doc:check": "tsx scripts/check-db-schema-doc.ts"`;
  `:73` `"docs:check": "... && tsx scripts/check-db-schema-doc.ts"`.
- `scripts/generate-db-schema-doc.ts:8-19` requires a reachable PostgreSQL **and** `pgvector`, then
  `renderDbSchemaDoc()` → `writeFile(DB_SCHEMA_DOC_PATH, ...)`.
- `scripts/dbSchemaDoc.ts:14` `DB_SCHEMA_DOC_PATH = docs/generated/db-schema.md`; `:14-17` applies all of
  `server/migrations` into a fresh DB then introspects catalogs — the doc is a pure function of the migrations.
- `scripts/check-db-schema-doc.ts:4-35` skips (exit 0, warning) without DB/pgvector, else byte-compares and
  tells the user to run `npm run db:schema-doc`.
- Committed kind CHECK lines: `docs/generated/db-schema.md:695,699,714,720,1744,4215,4254,4259`.

---

## 6. Frontend UI branches

**6.1 Authoring.** `src/features/parameter-catalog-governance/publicationState.ts:34-35`
`export const publicationSubjectKinds = ["driver", "node-type"] as const;` + `PublicationSubjectKind`;
`:46-65` `PublicationDraft.subjectKind`; `:67-86` `emptyPublicationDraft()` → `subjectKind: "driver",`;
`:98,120` copy keys; `:369-395` `buildPublicationChangeSet` — `:373` `const selectorKind = draft.subjectKind === "driver" ? "driver-compatible" : "node-type-name";`,
`:377` `` `${draft.subjectKind === "driver" ? "driver" : "node-type"}:${selectorValue}` ``,
`:381-386` `kind: draft.subjectKind, selector: { kind: selectorKind, value }, ...(draft.subjectKind === "driver" ? { nature, cardinality } : {})`.
`src/features/parameter-catalog-governance/PublicationDialog.tsx:565-574` `<select aria-label={publicationCopy.subjectKindPick} ...>`
with `<option value="driver">` / `<option value="node-type">`; `:584` `{draft.subjectKind === "driver" ? (`; `:703-704` summary label.

**6.2 Display.** `src/features/parameter-catalog/copy.ts:69-72`
`catalogSubjectTypeLabels = { driver: "驱动", "node-type": "节点类型" } as const;`;
`catalogPresentation.ts:81-86` `catalogSubjectTypeLabel(type: string)` with
`if (type === "driver" || type === "node-type") { return catalogSubjectTypeLabels[type]; } return "主体";`.
Callers `src/features/parameter-catalog/CatalogPage.tsx:604,751` (+ `:238` `catalog.listSubjects(query)`).

**6.3 Mocks/tests.** `src/application/parameter-catalog/fixtures.ts:68,79,101` `type: "driver",`, `:209` revision;
`src/infrastructure/http/parameterCatalogDtos.test.ts:34`; `publicationState.test.ts:102,117`;
`PublicationDialog.test.tsx:230-252`.

**6.4 Module/attribution taxonomy UI (separate closed set).** `src/domain/parameter-topology/types.ts:47`;
`moduleRegistry.ts:10,13,22,105`; `moduleAttributionTreeUtils.ts:8,108,175,195-197,218,234,336-350,505`;
`src/components/admin/ModuleCreateDialog.tsx:28,96,128,258,301`, `ModuleEditDialog.tsx:32,132-133,168,186,263`,
`ModuleDefinitionForm.tsx:12-14,41-44,75`; `src/components/parameter-topology/SpecCreateDialog.tsx:25,44,51,64,81`;
`src/application/ports/ParameterModuleRegistryRepository.ts:15,28,128,162`;
`src/infrastructure/mock/mockParameterModuleRegistryRepository.ts:154`.

---

## 7. Tests that break or need extension

Contract/golden:
- `server/modules/parameter-catalog-contract/enums.test.ts:36-42,58-92,73,177-179,197-224`
  (`expect(catalogSubjectKinds).toEqual(["driver","node-type"])`, exhaustive `switch`, immutability)
- `serialization.test.ts:28-63` vs `__fixtures__/serialization-golden.json:56-58`
- `failures.test.ts:85-110,281` (exact `catalogReleaseViolationCodes`)
- `server/modules/catalog-kernel/compiler/compileCatalogRelease.test.ts:98-103,289-294`;
  `__fixtures__/compiledReleaseGolden.ts:1-11`; `__fixtures__/catalogReleaseBundle.ts:47,82-99,721-725`
- `schemas/dts/catalog-release/catalog-release.schema.test.ts:72,206-208,963,1816` (+ node-type mutation cases `:1609-1622,2699-2747,2917-2996,3078-3090,3204-3216`)

Kernel/runtime/schema:
- `catalog-kernel/runtime/subjectMatch.test.ts:107,153-156`; `runtime/currentSnapshot.test.ts`
- `catalog-kernel/verification/verifyCurrentMaterialization.test.ts:190,387`
- `catalog-kernel/cache/rebuildCatalogCache.test.ts`
- `catalog-kernel/install/materializeRelease.test.ts`; `install/onlinePublication.integration.test.ts:137,148,254,299`
- `catalog-kernel/schema/catalogSchema.integration.test.ts:84-103,189-191,345,905-964,1035-1042,1113-1151`
- `catalog-kernel/schema/catalogSchemaConcurrency.integration.test.ts:128,286,319,130-133,287,430,478,679`
- `catalog-kernel/schema/catalogSchemaRollback.integration.test.ts:304-343,431,451,475,505,607-681,798,897`
- `catalog-kernel/security/catalogRoles.integration.test.ts:519-520,745`

Publication/authoring/admission:
- `catalog-publication/builder/completeSuccessor.test.ts:89,197,310-312,520-522,552,558-635,647,689-736`
  (incl. “rejects a driver without a closed nature/cardinality and a node-type with a new family”)
- `catalog-publication/builder/capabilities.test.ts:10,71,157,221-225`
- `catalog-publication/preview.test.ts:21,30-123`; `import/vendorAdapter.test.ts:199-212,268`
- `catalog-publication/revision.integration.test.ts:331-347,459-545`
- `catalog-publication/authorization/{policy.test.ts:78-98,policy.managed.test.ts:22,policy.managed.integration.test.ts:70-234,authorization.integration.test.ts:66,454,471,testHarness.ts:151,169}`
- `catalog-publication/persistence/{schema.integration.test.ts:98-215,378-420,store.integration.test.ts:92-99,531,roles.integration.test.ts:130-291,486-493}`

API/governance/bindings:
- `contracts/dtoSchemas/parameterCatalog.test.ts:143-170,236,337`
- `parameter-catalog-api/read/{handlers.test.ts:74,routes.test.ts,http.integration.test.ts}`
- `parameter-catalog-api/governance/{handlers.test.ts:49,http.integration.test.ts:159}`
- `parameter-governance/resolveReviewItem/{coordinator.test.ts:76,coordinator.integration.test.ts:317,concurrency.integration.test.ts:159}`
- `parameter-governance/registration/{service.test.ts:72,integration.test.ts:223,replay.integration.test.ts:81,concurrency.integration.test.ts:84}`
- `parameter-catalog-api/rootUsageScope.integration.test.ts:90`, `rootBatchQueries.integration.test.ts:128`,
  `parameter-catalog-api/publication/publications.m2.integration.test.ts:228,252`
- `parameter-bindings/**/*.integration.test.ts` (`subjectKind:"driver"` fixtures, e.g. `adapters/adapter.integration.test.ts:109`, `binding/binding.integration.test.ts:202`)
- `release-verification/evidence/api/capture.integration.test.ts:110`; `gates/postgres/violations.integration.test.ts:168,275,291`

Migration invariants:
- `server/shared/database/migrations.test.ts:69-82`; `migrationInvariant.test.ts:412-433` (template; `:420-427` asserts the 0080 CHECK text), `:435-458,460+`
- `server/testing/parameterCatalog/fixtureLoader.ts:19-36` (checksum-locked `scripts/wayfinder/sql/*`), `:38-49` (`formal-platform-node-type-definition`, `organization-manual-node-type-draft`)
- `scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts:1691-1745,2682`; `scripts/wayfinder/sql/{invariant-counts,row-classes,synthetic-fixture-verify}.sql` (checksum-locked)

Frontend:
- `src/features/parameter-catalog-governance/{publicationState.test.ts:102-117,PublicationDialog.test.tsx:230-252}`
- `src/features/parameter-catalog/CatalogPage.test.tsx:43,188,530`
- `src/infrastructure/http/{parameterCatalogDtos.test.ts:34,parameterCatalogClient.test.ts:115}`
- `src/application/parameter-catalog/{adapterParity,states,proposalContract}.test.ts` (mock↔API parity; new kind must be mirrored in `mockAdapter.ts:310` and `apiAdapter.ts:16`)
- Taxonomy tests if module kind changes: `src/domain/parameter-topology/{moduleRegistry,modulePlacement}.test.ts`,
  `src/components/parameter-topology/moduleAttributionTreeUtils.test.ts:123-164,345`, `ModuleAttributionTree.test.tsx:41-48`,
  `SpecCreateDialog.test.tsx:57-81`, `ParameterSpecLibrary.test.tsx:411`, `ParameterSpecDetailDialog.test.tsx:53`,
  `DtsParameterWorkbench.test.tsx:533`, `src/components/admin/ModuleEditDialog.test.tsx:38`

---

## 8. ADR numbering

- `docs/adr/` holds `0001`–`0043` plus `README.md`. Highest:
  `docs/adr/0043-catalog-authoring-and-online-publication.md`.
- **ADR-0045 is free**: no `0044*` file in `docs/adr/`, and repo-wide `grep -rn "ADR-0045"` is empty.
- Numbering convention/practice recorded in `docs/adr/0043-...md:9-11` (“The next unused ADR number at
  `origin/main` `063b12c4…` was 0043”); re-check at merge time per `docs/agents/fleet-coordination.md`.
- Language-parity rule (AGENTS.md) implies a `docs/zh-CN/design-docs/adr-0044-*.md` companion + a
  `docs/adr/README.md` table row.
- Drifting kind-set docs: `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md:326,349,353,378-379,735`;
  `docs/design-docs/catalog-authoring-and-publication-control-plane.md:83`;
  `docs/adr/0040-canonical-parameter-catalog-relational-model.md:159,381,454-456,485`;
  `docs/adr/0042-organizations-register-canonical-subjects-once.md:28,51`; plus `docs/zh-CN/**` mirrors.

---

## 9. Minimum must-change set

1. **New** `server/migrations/0144_*.sql`: alter `catalog_subjects_kind_check`,
   `catalog_subject_canonical_key_ck`, `catalog_subject_aliases_selector_kind_check`,
   `catalog_subject_alias_selector_ck`; recreate `assert_subject_has_exact_subtype`,
   `reject_cross_root_selector_collision`, `assert_catalog_materialization_projection_complete`,
   `assert_current_release_complete`, `assert_subject_placement_kind`,
   `assert_parameter_module_placement_kind`; add the third canonical predicate (+ role grants,
   `catalogRoleManifest.ts:25-30,42-57`); extend `parameter_modules_kind_check` /
   `attribution_subjects_subject_kind_check` if placement adds a module kind.
2. `server/modules/parameter-catalog-contract/enums.ts:6,57-61`; `failures.ts:117-120`; `normalization.ts:9-19,75-118`
3. `server/modules/catalog-kernel/interface.ts:59,81,115-123,146-147`
4. `schemas/dts/catalog-release/stable-id-rules.json:6-11,28-36,310-312`;
   `schemas/dts/catalog-release/catalog-release.schema.json:92-97,157-161,207-255,276-281,336-341`;
   `server/modules/parameter-catalog-contract/__fixtures__/serialization-golden.json`
5. `server/modules/catalog-kernel/compiler/{stableRules.ts:57-66,235-240,types.ts:39,43,66,94,validation.ts:501-521,960-963}`
   + regenerate `compiler/__fixtures__/compiledReleaseGolden.ts`
6. `server/modules/catalog-kernel/install/materializeRelease.ts:96-107,232-247`
7. `server/modules/catalog-kernel/runtime/{subjectMatch.ts:22-37,179-199,currentSnapshot.ts:70-90,129-134,156-159,850-875}`
8. `server/modules/catalog-kernel/cache/rebuildCatalogCache.ts:117-120`; `verification/verifyCurrentMaterialization.ts:231-242`
9. `server/modules/catalog-publication/builder/{types.ts:27,111-122,265,completeSuccessor.ts:753-792,844-862}`
10. `server/modules/catalog-publication/runtime/capabilities.ts:8-23` (+ revision bump consequences)
11. `server/modules/catalog-publication/preview.ts:86-96,139-148,256`; `import/vendorAdapter.ts:366-367,660-661,1065`
12. `server/modules/contracts/dtoSchemas/parameterCatalog.ts:218,293,334,636,639,1437`
13. `server/modules/parameter-catalog-api/read/{query.ts:38,219-221,types.ts:192}`;
    `governance/{types.ts:57,131-137,handlers.ts:213-222}`; `productionWire.ts:303-304,449-478`
14. `server/modules/parameter-governance/registration/internalGuardedRegistrationWriter.ts:46-47` (+ `:109`);
    `resolveReviewItem/command.ts:182-186`
15. `server/modules/release-verification/gates/postgres/countGates.ts:284-285`
16. Frontend: `src/features/parameter-catalog-governance/publicationState.ts:34-35,369-395`;
    `PublicationDialog.tsx:565-574,584`; `src/features/parameter-catalog/copy.ts:69-72`;
    `catalogPresentation.ts:81-86`; `src/infrastructure/http/parameterCatalogDtos.ts:108`
17. Regenerate `docs/generated/openapi.json` (`npm run contract:openapi`) and
    `docs/generated/db-schema.md` (`npm run db:schema-doc`); resolve
    `docs/generated/parameter-catalog-bundle.schema.json` (generator **ABSENT**)
18. Docs: new `docs/adr/0044-*.md` + `docs/adr/README.md` + zh-CN companion;
    update `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md:326,349,353,378-379,735`,
    `docs/design-docs/catalog-authoring-and-publication-control-plane.md:83`
