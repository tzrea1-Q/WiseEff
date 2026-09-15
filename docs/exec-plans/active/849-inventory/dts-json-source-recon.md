# #849 DTS/JSON source-file handling — read-only recon inventory

Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification`
Method: read-only. `rg` is **not installed** on this host (`command not found`); all
searches below used `grep -rn --include=...` + `find` + `read`. No repo file was
modified except this report. "ABSENT" = not found and search terms listed.

---

## 1. `server/modules/parameter-files/` inventory (71 files)

Entry points called out in the task are marked ★.

| File | One-line purpose |
|---|---|
| ★ `service.ts` | Upload/version/rollback service: `detectFormat`, `uploadProjectParameterFile`, `maybeIngestSemanticConfigRevision`. |
| ★ `candidateService.ts` | Staged draft/review: `createCandidate` (staging), impact, abandon, recompute, `activateCandidate`. |
| `parseIndex.ts` | Parser dispatch core: `buildJsonParsedIndex`, `buildDtsParsedIndex`, `derivedParsedIndexFromResolved`. |
| `repository.ts` | `project_parameter_files` / `_versions` SQL (insert, list, current-version pointer). |
| `candidateRepository.ts` | `project_parameter_file_candidates` SQL + candidate lifecycle rows. |
| `types.ts` | Shared DTOs: `ParameterFileFormat = "dts" \| "json"`, `ParsedIndex`, config-set/candidate types. |
| `schemas.ts` | Zod schemas for upload/config-set/baseline/structural/search bodies. |
| `routes.ts` | `registerParameterFileRoutes` — the main 909-line HTTP surface. |
| `configSetService.ts` | ★ `listConfigSets`, config-set create/update, add/remove member files. |
| `configSetRepository.ts` | Config-set + file-membership SQL. |
| `configSetSnapshot.ts` | Assemble config-set snapshot for export/validation. |
| `baselineDiff.ts` | `diffResolvedDts` structural diff between two resolved models. |
| `baselineRepository.ts` | Release baseline + `listConfigSetMemberFiles` SQL. |
| `baselineService.ts` | Baseline create/compare/preview/rollback/release. |
| `conflictService.ts` | File↔UI-draft conflict detect/resolve + bulk preview/resolve. |
| `validationGate.ts` | `runValidationGate` pre-release validation gate. |
| `releaseReadinessService.ts` | `evaluateReleaseReadiness` / `assertReleaseGateAllows`. |
| `dtcValidator.ts` | dtc / dt-schema validator factory + mode env readers. |
| `dtsToolchain.ts` | Pinned dtc toolchain probe/runner (release mode gates). |
| ★ `writebackService.ts` | Writeback: `patchJsonValue`, `patchDtsProperty`, `writebackMergedParameterValue`, `writebackMergedEnablementValue`. |
| `syncService.ts` | `syncFileVersion` — file version → project-value `file_sync` drafts. |
| `syncIdentity.ts` | Binding-by-source-file identity matching for sync. |
| `exportService.ts` | `exportFile` / `exportConfigSet`. |
| `structuralIngest.ts` | `ingestDtsFileVersion` parse→resolve→replace structural rows. |
| `structuralFlag.ts` | `DTS_STRUCTURAL_INGEST` feature flag (default on). |
| `structuralRepository.ts` | Replace `dts_nodes`/`dts_properties`/`dts_phandle_refs` rows. |
| `structuralReadRepository.ts` | Read structural model + `DtsSourceLocatorDto` (offset/line/col). |
| `structuralReadService.ts` | Zod-validated structure read (`getParameterFileVersionStructure`). |
| `dtsSearchRepository.ts` | Project-scoped structured DTS search over `dts_*` tables. |
| `dtsSearchService.ts` | Auth + Zod wrapper for search. |
| `parameterCatalogComparisonContribution.ts` | FIL comparison contribution serialize/checksum. |
| `__fixtures__/dts-teaching-sample.dts` | Shared DTS CST fixture used by parser/writeback/export tests. |

Tests (all under the same dir; purpose + key assertion):
`service.test.ts` (upload/version/format/rollback; **rejects unknown extension** L225-237),
`candidateService.test.ts` (impact/diff/parse-failure L24-84),
`candidate.integration.test.ts` (candidate never mutates active version L68, L195),
`candidateActivation.integration.test.ts` (activate/CAS-stale/blockers L87-364),
`candidateRepository.test.ts`, `routes.test.ts` (upload 201 L126, rollback L280, config-sets L105),
`parseIndex.test.ts` (JSON flatten + invalid-JSON throw; DTS node-path mapping),
`writebackService.test.ts` (patch JSON/DTS/multiline L49-130, writeback v2 L136, skip L221),
`structural.integration.test.ts` (upload→ingest→sync L97/L148, **CST writeback→reparse lossless L213-219**),
`structuralRead*.test.ts`, `dtsSearch*.test.ts`, `integration.test.ts` (upload+sync L109, **submit+review writebacks JSON file version L199**, conflicts L303),
`configSet*.test.ts`, `baseline*.test.ts` (incl. `configSetBaselineRoutes.test.ts`),
`conflictService.test.ts`, `dtcValidator.test.ts`, `dtsToolchain.test.ts`,
`validationGate.test.ts`, `releaseReadinessService.test.ts`, `exportService.test.ts`
(DTS byte-for-byte L109-135, **JSON passthrough L136**, config-set manifest L155),
`parserSafety.integration.test.ts` (no phantom comment keys),
`syncService.test.ts` (JSON 80→85 draft L108, writeback skips sync L183),
`syncAudit.integration.test.ts`, `syncIdentity.test.ts`, `migration.test.ts`,
`structuralFlag.test.ts`, `extractCompatibles.test.ts`, `checkDtsToolchainScript.test.ts`,
`parameterCatalogComparisonContribution.test.ts`, `configSetSnapshot.test.ts`.

---

## 2. Where file format / extension is decided

**Server, extension-only, single choke point** — `server/modules/parameter-files/service.ts:85-97`:
```ts
export function detectFormat(fileName: string): ParameterFileFormat {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".dts" || extension === ".dtsi") return "dts";
  throw new ApiError("VALIDATION_FAILED", "Unsupported parameter file extension.",
    { fileName, supportedExtensions: [".json", ".dts", ".dtsi"] });
}
```
Content type derived from format (not sniffed) — `service.ts:99-101` `contentTypeForFormat`.

**Verdict:** an unsupported extension **produces an error today** (`VALIDATION_FAILED`, HTTP 400),
not a silent fallback and not an accept — but it is a *generic* validation code, with no
dedicated unsupported-format outcome/reason. Called at:
- `service.ts:292` (`uploadProjectParameterFile`) — before size check, before `objectStore.put` (`:314`) and before the DB transaction (`:308`).
- `candidateService.ts:329` (`createCandidate`) — before `objectStore.put` (`:383`).

**Route layer performs NO extension/format check.** `server/modules/parameter-files/routes.ts:104-120`
accepts any `fileName`; `server/modules/parameter-bindings/catalogProjectValueRoutes.ts:74-92`
likewise. A `.yaml` filename reaches the service and is rejected only there. Decoding is
base64-only (`routes.ts:198-209`, `catalogProjectValueRoutes.ts:82-92`).

**Content-only DTS route ignores the name entirely** — `server/modules/parameters/importDtsParse.ts:41-88`:
`sourceName` is accepted but never inspected; it always `resolveDts(parseDts(input.content))`
and returns `{ format: "dts-full", ... }` (`:84`). YAML/TOML/ENV text here fails as a
generic parse error, never as an unsupported-format outcome.

**DB is the last guard** — `server/migrations/0041_project_parameter_files.sql:6` and
`server/migrations/0093_project_parameter_file_candidates.sql:10` both declare
`format text not null check (format in ('dts', 'json'))`. No migration widens this
(searched `format in` / `format text` across `server/migrations/*.sql`).

**Silent skips that already exist for non-DTS:** `service.ts:217-219` drops any config-set
member whose `format !== "dts"` when assembling a semantic config revision; structural ingest
is DTS-only (`service.ts:344-346`, `writebackService.ts:751-753`).

**Frontend has a genuine SILENT FALLBACK** — `src/application/parameters/import/detectImportFormat.ts:52-63`:
```ts
export function detectImportFormat(input: DetectImportFormatInput): ImportSourceFormat {
  if (isXlsxSpreadsheet(input)) return "spreadsheet";
  if (isDtsFull(input)) return "dts-full";
  if (isJson(input)) return "json";
  return "spreadsheet";            // ← YAML/TOML/ENV silently become "spreadsheet"
}
```
`isDtsFull` matches extension `.dts/.dtsi` or text markers `/dts-v1/` `/ {` (`:30-37`);
`isJson` requires leading `[`/`{` + `JSON.parse` (`:39-50`). `parseImportSource` then routes the
fallback to `parseSpreadsheetImport` (`:84-86`). Test locks this in:
`src/application/parameters/import/detectImportFormat.test.ts:57-64` "falls back to spreadsheet
for csv-like text". Wizard hint uses the same extension regex:
`src/components/ParameterImportWizard/steps/StepSourceAndProject.tsx:100-106`
(`sourceName.toLowerCase().match(/\.dtsi?$/)`).

No `fileType` / `mimeType` field exists for project source files (searched `fileType|mimeType|mime`)
— only `contentTypeForFormat` output strings.

---

## 3. DTS parser/CST and JSON parser

**DTS module** `server/modules/dts/` (barrel `index.ts`):
- `index.ts:2` `export { parseDts } from "./parser"` → `parser.ts:321` `parseDts(source): DtsDocument`.
- `index.ts:1` `lexDts` (`lexer.ts:54`); `index.ts:3-9` `resolveDts` (`resolver.ts:260`).
- `index.ts:10` `serializeDts` (`serialize.ts`); `index.ts:11` `parseDtsValue/renderDtsValue` (`valueAst.ts`);
  `:12` `indentDtsRawValueForWriteback`; `:13` `classifyDtsValue` (`valueTyping.ts`).
- CST nodes carry `span: DtsSpan {start,end}` (`dts/types.ts:11-12`, used at `:52,67,77,89,100`).
  `offsetToLineColumn` (`dts/offsetToLineColumn.ts`) converts offsets → line/col.

**Typed occurrences + locators** are produced on ingest, not in the parser:
`structuralRepository.ts:11-16` `replaceDtsStructuralModel(db, fileVersionId, resolved, source)`
writes `dts_nodes` / `dts_properties` / `dts_phandle_refs`, computing locators via
`offsetToLineColumn` (`:3`, `:143-148`). Read side: `structuralReadRepository.ts:4-11`
`DtsSourceLocatorDto {startOffset,endOffset,startLine,startColumn,endLine,endColumn}` and
`readDtsStructuralModel` (`:1-40`+). Orchestration: `structuralIngest.ts:7-16`
`ingestDtsFileVersion` = `parseDts` → `resolveDts` → `replaceDtsStructuralModel` → `derivedParsedIndexFromResolved`.
Topology-level typed occurrences live in `dts_property_occurrences` / `dts_occurrence_effects`
(read in `writebackService.ts:232-240`, `parameter-topology/ingestService.ts:844-855`).

**JSON parser** — `server/modules/parameter-files/parseIndex.ts:24-29`:
```ts
export function buildJsonParsedIndex(source: string): ParsedIndex {
  const root = JSON.parse(source) as unknown;
  const index: ParsedIndex = {}; walkJson(root, [], index); return index;
}
```
Flat `path→{value}` only; `ParsedIndexEntry.line` (`types.ts:6-9`) is never populated and
there is **no** JSON span/locator/typed-occurrence model (searched `line:`/locator in
`parseIndex.ts` — only `{ value }` is set at `:21`). Dispatch is in
`service.ts:119-134` `buildParsedIndex(format, bytes)` → JSON vs `buildDtsParsedIndex` (`parseIndex.ts:43-46`).

**Writeback (patch + reparse + prove semantic delta) ALREADY EXISTS.**
- Entry (legacy/names path): `writebackService.ts:589-777` `writebackMergedParameterValue`,
  patch dispatch `patchByFormat` (`:188-196`), which throws
  `VALIDATION_FAILED "Unsupported parameter file format for writeback."` at `:195`.
- JSON patch: `patchJsonValue` (`:444-453`) re-`JSON.stringify(parsed, null, 2)` (reformatting, not CST-preserving).
- DTS patch: `patchDtsProperty` (`:456-513`) = CST locate (`property.cst.span`) → replace `rawText`
  → `serializeDts`; reparse + reindex at `:725-729`.
- Semantic entry point: `parameter-topology/overlayWriteback.ts:602` `applyLockedOverlayWriteback`
  (patch overlay → `ingestConfigRevisionInTransaction` call `:798` → `loadCandidateSemanticGateCounts`
  call `:826` → `assertCanPromoteCandidateToDraft` gates `:832-860` → `upsertBindingRevisionValues` call `:876`).
  Enablement sibling `:905`. Both are **DTS/config-revision only**; JSON has no semantic-gate path.

---

## 4. YAML / TOML / ENV adapters — project-source: ABSENT

Searched imports of `yaml`, `js-yaml`, `toml`, `@iarna/toml`, `smol-toml`, `dotenv` across
`server/ src/ scripts/ tools/ packages/` and `package.json`.

- `package.json:132` `"dotenv": "^16.5.0"`, `:148` `"xlsx": "^0.18.5"`, `:149` `"yaml": "^2.9.0"`.
  **No TOML/INI dependency at all** (`ls node_modules | grep -iE "toml|ini$"` → nothing).
- **Project-source YAML/TOML/ENV parser or adapter: ABSENT.** No importer, route, candidate, or
  service under `server/modules/parameter-files/`, `server/modules/parameters/`, or
  `server/modules/parameter-bindings/` reads YAML/TOML/ENV. No `.toml` file exists in the repo
  (`find . -name "*.toml"` → none). `.env` usage is server *runtime config* only:
  `server/config/loadDotenv.ts:3-9`, `server/modules/logs/workerRunner.ts:175`.

**Vendor-definition YAML reading (separate publication path — must stay):**
- `server/modules/catalog-publication/import/vendorYaml.ts:11` `import { parse as parseYaml } from "yaml"`;
  `:381-395` `parseVendorYamlFile(absolutePath)` reads file bytes and YAML-parses into
  `VendorYamlDocument`. Input selection is `catalog.json` schemaPaths (`:1-6`).
- Callers: `catalog-publication/import/vendorAdapter.ts:73,564` `importVendorCatalog`,
  `catalog-publication/import/index.ts:3,24,29`; CLI `scripts/compile-vendor-catalog-release.ts:18,178`.
- Compiler: `catalog-kernel/compiler/sourceAuthority.ts:4,50` and `compiler/validation.ts:4,251`
  use `parseAllDocuments` from `yaml` for catalog release documents.
- Schema loading: `server/modules/parameter-specs/schemaLoader.ts:5` `import yaml from "js-yaml"`
  + `loadSchemaRegistry` (`:100`); `parameter-specs/vendorSchemaGenerator.ts:6`; `scripts/enrich-vendor-property-docs.ts:11`.
- Vendor YAML inputs live in `schemas/dts/linux-bindings/*.yaml` and `schemas/dts/vendor/`.
- Logs eval YAML (`yaml` parse): `server/modules/logs/eval/goldenCases.ts:3,152`,
  `logs/eval/judgeCalibration.ts:3,62` — unrelated to parameters.

Distinction: all YAML reads above are **vendor Catalog definition metadata / tech-doc schemas /
eval fixtures**, consumed by `catalog-publication` + `parameter-specs`, not by the
`parameter-files` source-file path. There is no project-source YAML reader to reuse or forbid.

---

## 5. Routes that upload/stage/apply project parameter files

Registered in `server/app.ts`: `:162` `registerCatalogProjectValueConsumerRoutes` (first, wins),
`:167` `registerParameterRoutes`, `:172` `registerParameterFileRoutes`.

| Route | File:line | File bytes? |
|---|---|---|
| `POST /api/v1/projects/:projectId/parameter-files` | `parameter-files/routes.ts:274-301` → `uploadProjectParameterFile:281` | yes (`contentBase64` `:288`) |
| `POST /api/v1/projects/:projectId/parameter-files` (v1 hosted loop) | `catalogProjectValueRoutes.ts:333-364` → `uploadProjectParameterFile:344` | yes (`:351`) |
| `POST /api/v1/projects/:projectId/parameter-files/:fileId/versions` | `parameter-files/routes.ts:303-337` → `:318` | yes (`:325`) |
| `POST /api/v1/projects/:projectId/parameter-file-candidates` (stage) | `parameter-files/routes.ts:783-803` → `createCandidate:790` | yes (`:797`) |
| `POST .../parameter-file-candidates/:candidateId/activate` (apply) | `parameter-files/routes.ts:880-908` → `activateCandidate:887` | no (stored candidate) |
| `POST /api/v1/parameter-import-batches` | `catalogProjectValueRoutes.ts:366-425`; also `parameters/routes.ts:550-557` | no (parsed rows only) |
| `POST /api/v1/parameter-import-batches/:batchId/apply` | `catalogProjectValueRoutes.ts:427-537`; also `parameters/routes.ts:559-567` | no |
| `POST /api/v1/parameter-import/parse-dts` | `parameters/routes.ts:569-575` → `parseDtsImportForAuth` (`parameters/service.ts:517-526`) | text content, DTS-assumed |
| `GET /api/v1/projects/:projectId/config-sets/:configSetId/export` | `parameter-files/routes.ts:756-766` → `exportConfigSet` | no |

`POST /api/v1/parameter-import-batches` accepts **parsed rows** (`createImportBatchBodySchema`,
`parameters/schemas.ts:200`), not bytes — so it cannot itself smuggle YAML; the file-bytes
surface is the four upload/stage routes plus the content-only `parse-dts`.

**Rejection check belongs where bytes first become a format:** `detectFormat` in
`server/modules/parameter-files/service.ts:85` is the only shared pre-staging gate reachable
from all four byte-accepting routes (`routes.ts:281,318,790`; `catalogProjectValueRoutes.ts:344`)
before any `objectStore.put`. A route-level check would have to be duplicated in two files
(`routes.ts:274` and `catalogProjectValueRoutes.ts:333` both own the same path).
The `parse-dts` content route needs a separate explicit refusal (it currently ignores `sourceName`
and attempt-parses anything as DTS). The frontend fallback at
`src/application/parameters/import/detectImportFormat.ts:62` must stop defaulting to `"spreadsheet"`.

---

## 6. Existing tests for parsing / writeback / format detection / refusal

Already listed per-file in §1. Decisive assertions:
- **Refusal (only one, generic code):** `server/modules/parameter-files/service.test.ts:225-237`
  `it("rejects unknown extension")` → `rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Unsupported parameter file extension."))`, `fileName: "config.txt"`, asserts `putCalls` empty + 0 rows.
- **No test asserts an unsupported-format outcome for `.yaml`/`.yml`/`.toml`/`.env`.**
  Searched `\.yaml|\.yml|\.toml` in `server/modules/parameter-files/*.test.ts`,
  `server/modules/parameters/*.test.ts`, `server/modules/parameter-bindings/*.test.ts`
  → only unrelated `process.env` / `*.yaml` vendor-source-path literals
  (`binding.integration.test.ts:134`, `concurrency.integration.test.ts:130`).
- **DTS/JSON parse:** `parseIndex.test.ts` (JSON flatten/invalid throw; DTS node paths);
  `parserSafety.integration.test.ts` (comment phantom keys omitted); `parser.test.ts:105-130` (`/include/` unsupported marker).
- **Writeback:** `writebackService.test.ts:50-130` (JSON nested leaf, DTS block, multiline matrix byte-identical, string-list continuation indent, `@address` node);
  `structural.integration.test.ts:213-219` `expect(serializeDts(parseDts(text))).toBe(text)` (patch→reparse lossless);
  `integration.test.ts:199` submit+review writebacks JSON file version.
- **Format detection (frontend):** `detectImportFormat.test.ts:6-65` — xlsx magic bytes/name, dts extension/markers, json array/object, **and the spreadsheet fallback**.
- **Export:** `exportService.test.ts:109-135` DTS `serializeDts(parseDts(source))` byte-for-byte; `:136` JSON identity passthrough.

---

## 7. The four compatibility seeds

Defined only in `src/config/power-management.json` (no `*.test`-only copies). Confirmations that
no real source file exists today are below each row.

| Seed | `id` | `name` line | Definition block | Shape |
|---|---|---|---|---|
| DTS string-list 3×5 | `dts-fast-charge-profile-matrix` `:357` | `:358` | `:356-384` | `configFormat` `:361` header + 3 rows × 5 quoted cols; `valueKind: "complex"` `:383` |
| DTS cell-array 3×4 | `dts-battery-thermal-derate-curve` `:386` | `:387` | `:385-413` | `configFormat` `:390` `< 0 38 3800 4350 / 1 42 3200 4320 / 2 45 2600 4280 >`; `valueKind: "complex"` `:412` |
| JSON scalar | — | `charge_voltage_limit_mv` `:126` | `:124-152` | `configFormat` `:129` `JSON: { "charger.cv.limitMv": number }`; `valueKind: "scalar"` |
| JSON scalar | — | `battery_temp_target_c` `:155` | `:153-181` | `configFormat` `:158` `JSON: { "battery.thermal.targetTempC": number }`; `valueKind: "scalar"` |

Real source files today — **ABSENT for all four as bound project source**:
- `src/config/dts-seed/*.dts` (`aurora/atlas/nebula-board.dts`, `*-power-overlay.dts`, `base-power-overlay.dts`)
  contain no `fast-charge-profile-matrix` / `battery-thermal-derate-curve` /
  `charge-profile` / `derate` / `cv-limit` / `target-temp` property
  (searched all of `src/config/dts-seed/` → 0 hits).
- The only DTS text carrying those property names is the **doc sample**
  `docs/samples/parameter-import/charging-thermal-fragment.dts:9` and `:20` — and it uses
  4 rows, not the seed's 3 (documented as a manual-paste fragment, not a bound file).
- No JSON project file defines `charger.cv.limitMv` or `battery.thermal.targetTempC`; those
  strings occur only at `src/config/power-management.json:129,158`. No `wiseeff-power-overlay.dts`
  exists as a file (only doc/plan text; the README at `docs/samples/parameter-import/README.md:23`
  *claims* a 170-parameter DTS directory and that overlay, which is not present in the worktree).
- Identifier usage elsewhere is test/UI-only: `src/App.test.tsx`, `src/powerManagementConfig.test.ts`,
  `src/parameterValueKind.test.ts`, `src/components/*.test.tsx`,
  `server/modules/parameters/importBatch.postCutover.integration.test.ts:31` (`charge_voltage_limit_mv`).
  → the seeds are frontend-library/mock fixtures with **no backing source file**.

---

## 8. Insertion point for the unsupported-format refusal

**Single best insertion point: `server/modules/parameter-files/service.ts:85` `detectFormat`**
(reached at `:292` for upload and `candidateService.ts:329` for staging, before any store/DB write).
It must become an explicit unsupported-format outcome (distinct reason/code + `format`/`extension`
in `details`) while keeping `.dts/.dtsi/.json` accepted. Two companions are required for
completeness: (a) `parameters/routes.ts:569` `parse-dts` must refuse by `sourceName`/content
instead of attempt-parsing (`importDtsParse.ts:41-88` currently ignores the name);
(b) `src/application/parameters/import/detectImportFormat.ts:62` must stop collapsing
YAML/TOML/ENV into `"spreadsheet"`. Vendor-definition YAML (`vendorYaml.ts:381`, `schemaLoader.ts:100`)
is untouched.
