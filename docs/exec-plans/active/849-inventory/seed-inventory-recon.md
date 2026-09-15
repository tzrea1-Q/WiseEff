# 849 Seed Inventory Reconnaissance

Read-only inventory of the three seed input families and their tooling.
Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification` (HEAD `8f03cfa43`).
Method: file reads + `resolveDts` / `missingReferencedLabels` / `isStructuralPropertyKey` executed with `tsx`;
counts marked "measured" were computed, not quoted from prose. `rg` is not installed in this worktree; searches used `grep`/`find`/`git ls-files`.

---

## A. `src/config/power-management.json` (compatibility inventory)

### A.1 Top-level shape

| JSON pointer | Line | Content |
| --- | --- | --- |
| `/projects` | 2 | 3 items: `aurora` (line 4, `AUR-Prod`), `nebula` (9, `NEB-RD`), `atlas` (14, `ATL-Intl`) |
| `/parameterModules` | 19 | 13 module rows (`name`, `description`, `scope`, optional `parent`) |
| `/parameterLibrary` | 94 | **exactly 12 items** (measured), indexes 0–11, closes line 443 |
| `/debugParameters` | 444 | 10 items (`dbg-*`), separate from the catalog |

`parameterLibrary` item field set (no `propertyKey`, no `constraints`, no `examples` fields exist):
`id`, `name`, `description`, `explanation`, `configFormat`, `module`, `range`, `unit`, `risk`,
`values.{aurora,nebula,atlas}.{currentValue,recommendedValue,updatedAt}`, `valueKind`.
Per-project seed value pointer template: `/parameterLibrary/<i>/values/<project>/<currentValue|recommendedValue|updatedAt>`.
`range` is the only constraint field; `values` carries the per-project examples. `valueKind` ∈ `scalar|complex`
(`src/powerManagementConfig.ts:9`).

### A.2 All 12 items, verbatim seed values

`CF` = `configFormat`. Index / line of `"id"` in parentheses.

**0 (95) `fast-charge-current` — `fast_charge_current_limit_ma`**
CF `YAML: power.charge.fast_current_limit_ma: number` | module `Charging Policy` | range `2500 - 4500` | unit `mA` | risk `High` | `scalar`
- aurora (106) current `3850`, recommended `3200`, updated `1 小时前`
- nebula (111) current `4200`, recommended `3900`, updated `今天 09:18`
- atlas (116) current `3000`, recommended `3100`, updated `昨天`

**1 (124) `charge-voltage-limit` — `charge_voltage_limit_mv`  [JSON]**
CF `JSON: { "charger.cv.limitMv": number }` | module `Charging Policy` | range `4200 - 4500` | unit `mV` | risk `High` | `scalar`
- aurora (135) `4350` / `4320` / `今天 08:12`
- nebula (140) `4380` / `4340` / `1 天前`
- atlas (145) `4300` / `4310` / `2 天前`

**2 (153) `battery-temp-target` — `battery_temp_target_c`  [JSON]**
CF `JSON: { "battery.thermal.targetTempC": number }` | module `Battery Safety` | range `30 - 42` | unit `°C` | risk `Medium` | `scalar`
- aurora (164) `38` / `35` / `今天 10:24`
- nebula (169) `40` / `37` / `2 小时前`
- atlas (174) `36` / `35` / `3 天前`

**3 (182) `soc-smoothing` — `soc_estimation_smoothing`**
CF `TOML: [battery.soc] smoothing = decimal` | module `Battery Estimation` | range `0.70 - 0.95` | unit `ratio` | risk `High` | `scalar`
- aurora (193) `0.82` / `0.88` / `昨天`
- nebula (198) `0.76` / `0.84` / `今天 11:05`
- atlas (203) `0.90` / `0.88` / `4 天前`

**4 (211) `battery-health-reserve` — `battery_health_reserve_pct`**
CF `ENV: BATTERY_HEALTH_RESERVE_PCT=number` | module `Battery Health` | range `5 - 18` | unit `%` | risk `Medium` | `scalar`
- aurora (222) `12` / `14` / `今天 09:08`
- nebula (227) `10` / `13` / `1 天前`
- atlas (232) `15` / `14` / `3 天前`

**5 (240) `usb-pd-profile` — `usb_pd_profile_limit_w`**
CF `ENV: POWER_USB_PD_PROFILE_LIMIT_W=number` | module `Charging Protocol` | range `18 - 65` | unit `W` | risk `Low` | `scalar`
- aurora (251) `33` / `33` / `今天 08:40`
- nebula (256) `30` / `33` / `3 天前`
- atlas (261) `25` / `27` / `昨天 17:20`

**6 (269) `wireless-thermal-derate` — `wireless_charge_thermal_derate_pct`**
CF `YAML: power.wireless.thermal_derate_pct: number` | module `Wireless Charging` | range `10 - 35` | unit `%` | risk `Medium` | `scalar`
- aurora (280) `18` / `24` / `45 分钟前`
- nebula (285) `22` / `26` / `今天 13:44`
- atlas (290) `16` / `20` / `2 天前`

**7 (298) `low-battery-shutdown` — `low_battery_shutdown_soc`**
CF `TOML: [battery.protection] shutdown_soc = decimal` | module `Battery Protection` | range `2.0 - 4.5` | unit `%` | risk `High` | `scalar`
- aurora (309) `3.2` / `3.0` / `今天 12:12`
- nebula (314) `2.5` / `3.0` / `2 天前`
- atlas (319) `3.8` / `3.5` / `5 天前`

**8 (327) `pmic-boost-voltage` — `pmic_boost_voltage_mv`**
CF `ENV: PMIC_BOOST_VOLTAGE_MV=number` | module `Power IC` | range `4700 - 5600` | unit `mV` | risk `Medium` | `scalar`
- aurora (338) `5200` / `5100` / `2 天前`
- nebula (343) `5450` / `5300` / `今天 16:20`
- atlas (348) `5000` / `5000` / `6 天前`

**9 (356) `dts-fast-charge-profile-matrix` — `dts_fast_charge_profile_matrix`  [DTS]**
CF (line 361) `DTS: fast-charge-profile-matrix =\n  "profile-id", "vbus-mv", "ibus-ma", "temp-c", "note",\n  "0", "5000", "1500", "40", "entry",\n  "1", "9000", "3000", "43", "balanced",\n  "2", "11000", "4200", "46", "burst";`
module `Charging Policy` | range `0 - 1` | unit `profile` | risk `Low` | `complex`
- aurora (368/369) current == recommended:
  `fast-charge-profile-matrix =\n  "0", "5000", "1500", "40", "entry",\n  "1", "9000", "3000", "43", "balanced",\n  "2", "11000", "4200", "46", "burst";` updated `today 14:05`
- nebula (373/374): identical except last row `"2", "12000", "4300", "48", "boost";` updated `yesterday 16:30`
- atlas (378/379): same as aurora, updated `3d ago`

**10 (385) `dts-battery-thermal-derate-curve` — `battery_thermal_derate_curve`  [DTS]**
CF (line 390) `DTS: battery-thermal-derate-curve = <\n  0 38 3800 4350\n  1 42 3200 4320\n  2 45 2600 4280\n>;`
module `Battery Safety` | range `0 - 1` | unit `curve` | risk `Low` | `complex`
- aurora (397/398): `battery-thermal-derate-curve = <\n  0 38 3800 4350\n  1 42 3200 4320\n  2 45 2600 4280\n>;` updated `today 09:20`
- nebula (402/403): `... 1 42 3000 4300\n  2 45 2400 4260\n>;` updated `today 11:40`
- atlas (407/408): same as aurora, updated `yesterday 18:15`

**11 (414) `standby-drain-limit` — `standby_drain_limit_ma`**
CF `TOML: [power.standby] drain_limit_ma = number` | module `Standby Power` | range `8 - 35` | unit `mA` | risk `Low` | `scalar`
- aurora (425) `18` / `15` / `昨天 18:04`
- nebula (430) `28` / `22` / `4 小时前`
- atlas (435) `14` / `14` / `今天 07:30`

### A.3 Format partition (matches the task packet)

- JSON: indexes **1, 2**.
- DTS: indexes **9, 10**.
- Deferred YAML/TOML/ENV: indexes **0 (YAML), 3 (TOML), 4 (ENV), 5 (ENV), 6 (YAML), 7 (TOML), 8 (ENV), 11 (TOML)** — 8 items.

Runtime consumer/loader: `src/powerManagementConfig.ts:1` (`import powerManagementConfigJson from "./config/power-management.json"`),
`bundledPowerManagementConfig` (line 115, normalised at 170–176), `flattenProjectParameters` (line 361) produces
`${projectId}-${parameter.id}` rows (`src/powerManagementConfig.test.ts:77` locks 12×3 = 36 flat rows).

---

## B. Vendor definition inputs — 113 definitions / 47 documents

### B.1 Location and counts (all measured)

- Directory: **`schemas/dts/vendor/wiseeff/`** — 50 `.yaml` files on disk (`find schemas/dts/vendor -type f | wc -l` = 50).
- Index manifest: **`schemas/dts/catalog.json`** — keys `linuxDtSchemaRevision`, `dtschemaVersion`, `vendorContentHash`
  (`fd4051a43b5d62f050eabd3a57c26e583498c5dda95f1a9c3c701670399042f0`), `importedAt`, `schemaPaths` (**49 entries**).
  `common-status.yaml` is on disk but absent from `schemaPaths`.
- **47 documents** = 49 listed − 2 explicitly excluded fixtures. Exclusions: `EXCLUDED_SCHEMA_BASENAMES`
  (`server/modules/catalog-publication/import/vendorYaml.ts:15-19`) = `common-status.yaml`, `test-ambiguous-a.yaml`, `test-ambiguous-b.yaml`.
- **135 raw property entries** across the 47 docs; **113 canonical definitions** after `parseCanonicalPropertyKey`
  rejects 22 structural keys (`#address-cells`, `#gpio-cells`, `#interrupt-cells`, `#size-cells`, `compatible`, `reg`,
  `ranges`, `gpio-controller`, `interrupt-controller`; `server/modules/parameter-catalog-contract/normalization.ts:121-158`).
  Files with 0 properties: `huawei-fm1230-swi.yaml`, `huawei-soh-core.yaml`, `nodename-hi6xxx-coul.yaml`, `nodename-scharger-v800-coul.yaml`.
- Independent corroboration: `scripts/compile-vendor-catalog-release.test.ts:48-55` asserts compiled successor counts
  `subjects: 48, aliases: 1, definitions: 114`. The `crel_acme_1` predecessor kept in the successor snapshot contributes
  exactly 1 subject (`csub_acme_power`) and 1 definition (`pdef_acme_power_iin_max`)
  (`server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle.ts:81,106`) ⇒ **114 − 1 = 113 vendor definitions**.

### B.2 Format and discovery

- Format: YAML authored "vendor Catalog definition metadata". Document keys (`vendorYaml.ts:35-48`):
  `$id`, `title`, `source`, `lifecycle`, `version`, `schemaNamespace`, `compatible[]` **or** `nodename[]` (never both),
  `documentation`, `childNodes`, `properties{}`. Property keys (`vendorYaml.ts:25-33`): `valueShape`, `units`,
  `documentation`, `constraints`, `exampleValue`, `default`.
- Discovery is **manifest-driven, not a directory walk**: `inventoryVendorCatalog` (`vendorYaml.ts:209-378`) reads
  `schemas/dts/catalog.json#schemaPaths`; `readCatalogManifest` (174-200) requires `vendorContentHash` + string `schemaPaths`.
  Files on disk not in `schemaPaths` become `forbidden-extra` unless excluded (288-303); listed-but-absent become
  `listed-missing`; `power-management.json` listed is rejected as `power-management-excluded` (227-251). Integrity gate:
  `vendorDirectoryHash` (SHA-256 over sorted `*.yaml`/`*.yml` name+bytes, 117-128) must equal `catalog.json#vendorContentHash` (367-377).
- `valueShape` → JSON-Schema mapping: `vendorValueSchemaFor` (`vendorYaml.ts:147-169`): `bool`→boolean, `empty`→null,
  `string-list`→array/string, `u32-array`→array/integer min 0, `phandle-list`→array, `bytes`→string, `mixed`/`unknown`→`{description}`;
  anything else throws `catalog-vendor-unsupported-value-shape:<shape>`.

### B.3 Code entry points

- **Production vendor importer:** `importVendorCatalog` — `server/modules/catalog-publication/import/vendorAdapter.ts:564`
  (re-exported from `.../import/index.ts:1-5`). Input type `ImportVendorCatalogInput` at `vendorAdapter.ts:193-212`
  (`predecessorArtifact`, `schemasRoot`, `identity?`, `claimedIdentities?`, `authorPrincipalId` required, `authorOrganizationId`, `persist?`).
  Returns `VendorImportValue` (`successor` | `unchanged`) or `VendorImportError` (`import-blocked` | inventory errors | artifact errors | …).
- **D1 compile script (npm `catalog:compile-vendor`):** `compileVendorCatalogSuccessor` — `scripts/compile-vendor-catalog-release.ts:314`
  (`vendorDocuments` at 152-312). Writes the successor source as `schemas/dts/catalog-release/vendor-catalog-1.yaml`
  embedded in the bundle (`VENDOR_SUCCESSOR_SOURCE_PATH`, line 47); CLI accepts `--out` (377-383).
- Related re-export surface: `server/modules/catalog-publication/import/index.ts`.

### B.4 The two `gpio_int.constraints.cells` blockers

Blocked files (both declare identical `gpio_int` constraints):

| File | Line | Body |
| --- | --- | --- |
| `schemas/dts/vendor/wiseeff/mt-mt5788.yaml` | 20-25 | `gpio_int:` `valueShape: mixed`, `exampleValue: <&gpio6 15 0>`, `constraints: {cells: 3, description: phandle pin flags}` |
| `schemas/dts/vendor/wiseeff/sc8562.yaml` | 20-25 | `gpio_int:` `valueShape: mixed`, `exampleValue: <&gpio13 29 0>`, `constraints: {cells: 3, description: phandle pin flags}` |

Exact blocking mechanism:

1. `foldConstraints` — `vendorAdapter.ts:393-440` — accepts only `minimum` and `maximum`
   (`const allowed = new Set(["minimum","maximum"])`, line 410). Any other key is `extras`; when non-empty it returns
   `{ ok:false, detail:"unhandled-constraint:<sorted extras>", path:"<propertyPath>.constraints.<first extra>" }` (411-418).
   For these two files `Object.keys(constraints) = ["cells","description"]`; sorted extras = `cells,description`, so the
   reported path is `…/gpio_int.constraints.cells` and detail `unhandled-constraint:cells,description`.
2. `propertyPath` is built as `` `${file.relativePath}#${propertyKey}` `` (`vendorAdapter.ts:827`), so the blocking
   disposition paths are exactly `vendor/wiseeff/mt-mt5788.yaml#gpio_int.constraints.cells` and
   `vendor/wiseeff/sc8562.yaml#gpio_int.constraints.cells`.
3. The caller pushes kind `"unsupported"` with `sourceFields:["constraints"]` (887-893).
4. `blocking = dispositions.filter(kind === "unsupported" || "conflict" || "listed-missing")` (1078-1080); if
   `blocking.length > 0` the importer returns `{ kind:"import-blocked", reason: blocking[0].detail, report }` (1088-1097).
5. Regression evidence for this rule: `server/modules/catalog-publication/import/vendorAdapter.test.ts:529-546`
   ("refuses unhandled constraints and does not repair input from the predecessor") injects `constraints:\n cells: 3`
   and asserts `error.kind === "import-blocked"` and a blocking row whose detail starts with `unhandled-constraint`.

Note the legacy compile path (`scripts/compile-vendor-catalog-release.ts:260-308`) does **not** call `foldConstraints`;
it maps shape only, so `constraints.cells` never blocks `catalog:compile-vendor`. The block exists only on the
production import path (`importVendorCatalog`).

---

## C. Demo board DTS files

### C.1 Exact paths and measured counts

Committed board artifacts (`git ls-files src/config/dts-seed`), each self-contained `/dts-v1/` overlay-only primary:

| Path | Nodes | Raw property occurrences | Business | Structural | Phandle refs |
| --- | --- | --- | --- | --- | --- |
| `src/config/dts-seed/aurora-board.dts` | 50 | 176 | 120 | 56 | 18 |
| `src/config/dts-seed/nebula-board.dts` | 50 | 176 | 120 | 56 | 18 |
| `src/config/dts-seed/atlas-board.dts` | 50 | 176 | 120 | 56 | 18 |

Sibling non-board sources in the same directory (overlay authoring inputs, not the committed board artifacts):
`aurora-power-overlay.dts`, `nebula-power-overlay.dts`, `atlas-power-overlay.dts`, `base-power-overlay.dts`
(each: 30 overlay-target blocks, 29 distinct labels, 37 missing `&name` references — measured).

Counts are corroborated by committed assertions: `server/modules/dts/goldenPowerFixture.test.ts:19-25`
(50 nodes / 176 properties / 18 phandle refs) and `server/modules/parameters/seedM1DtsFiles.test.ts`
(150 `dts_nodes` = 50×3, 528 `dts_properties` = 176×3, 54 `dts_phandle_refs` = 18×3).

### C.2 How "business" vs "structural" is defined in code

- Single source of truth: `src/domain/parameter-topology/parameterSurface.ts:14-28` — `STRUCTURAL_PROPERTY_KEYS =
  ["compatible","device_type","gpio-controller","interrupt-controller","linux,phandle","phandle","ranges","reg","status",
  "#address-cells","#gpio-cells","#interrupt-cells","#size-cells"]`.
- Predicate: `isStructuralPropertyKey` (`parameterSurface.ts:44-47`) = case-insensitive membership in that list **or**
  any key starting with `#`. Everything else resolving on a node is a business property.
- Consequence in the surface rule: `isParameterSurfaceRow` (`parameterSurface.ts:68-89`) drops structural keys and
  scaffolding-only locators; business keys on non-scaffolding locators (incl. DTS root `board_id`) are surface rows.
- The same list is duplicated in the contract layer at
  `server/modules/parameter-catalog-contract/normalization.ts:121-135` (used for the vendor 113/135 split in §B.1).
- The DTS seed generator itself does not filter structural keys: `buildDtsPowerSeed` (`scripts/dts-power-seed.ts:361-434`)
  emits one `parameterLibrary` row per resolved property, so the aurora seed library has 176 rows
  (`server/modules/parameters/dtsPowerSeed.test.ts:33-52`).

### C.3 Dangling overlay target labels — measured vs "24"

**NOT FOUND as a recorded/detected count of 24.** No code or test asserts 24 dangling labels. Measured values:

- `resolveDtsConfigSet` emits one `"dangling-reference"` **warning** per distinct unresolved `&label` overlay target
  (`server/modules/dts/configSetResolver.ts:28-41` code/type, `380-387` emission). Measured per board: **29 distinct labels**
  (identical set in all three boards): `amba, spmi1, spmi, hisi_vbat_drop_protect, hisi_vbat_drop_protect_v2,
  hisi_bci_battery, battery_ocv, soh_core, huawei_charger, charging_core, charge_mode_test, wireless_charger,
  wireless_sc, direct_charge_ic, direct_charge_comp, direct_charge_turbo, direct_charger, huawei_batt_info, fm1230,
  fm1230_1, fm1230_swi, t91407, huawei_batt_identify, battery_temp_fitting, multi_btb_temp, battery_charge_balance,
  battery_cccv, btb_check, boost_5v`.
- `missingReferencedLabels` (all `&name` refs incl. property phandles, `server/modules/dts/danglingAnchorStub.ts:52-66`)
  returns **37** names per board.
- Closest prose figures on record (both stale/adjacent, neither is "24 dangling labels"):
  `docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md:44-49` says
  "50 nodes and 170 properties", "**24 repeated property keys**", "**28 external overlay targets** without a local
  `compatible`", "18 phandle references", and the plan copy at
  `docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md:143` repeats "170 properties … 24 repeated
  property keys". The live code now asserts **176** properties and **26** repeated keys
  (`server/modules/dts/goldenPowerFixture.test.ts:22,34`). Recommendation: treat "24" as the stale *repeated property
  keys* figure, not a dangling-label count; the dangling-label count to plan against is **29 per board**.

### C.4 How unresolved labels are currently synthesized

Two independent mechanisms, both self-anchoring (never fail-closed at L1):

1. **Single-file resolver (`server/modules/dts/resolver.ts`, `resolveDts` line 260).** When a node has `refTarget`
   (`&label { … }`) and the label is not in `byLabel`, it creates a path node named after the label with
   `isLabelStub: true` and registers the label (lines 82-96). A later real node carrying that label *adopts and repaths*
   the stub (`adopted` branch 99-117, `repath` 164-188). A duplicate label merges nodes (`registerLabel`/`mergeNodes`
   190-212). Result: the fragment's properties stay resolvable/round-trippable; `isLabelStub` marks the synthetic anchor.
2. **Config-set resolver (`server/modules/dts/configSetResolver.ts`, `resolveDtsConfigSet` line 469).** For an unresolved
   `cst.refTarget` it pushes the `dangling-reference` warning quoted above and calls
   `ensureNode(ctx, cst.refTarget, cst.refTarget, undefined, fileName)` + `registerLabel` (lines 380-387): a virtual
   anchor keyed by the bare label. Comment at 373-379 states the rationale (dropping would lose business parameters;
   failing would make the project unusable; full-tree linkage is deferred to L2).

**Ephemeral L2 compile stub (`server/modules/dts/danglingAnchorStub.ts`, 117 lines).** Module doc (3-23) defines the
L1/L2 split. Functions: `danglingAnchorLabels(diagnostics)` extracts labels from `dangling-reference` messages via
`/Overlay target "&([^"]+)"/` (33-46); `missingReferencedLabels(source)` regex-scans definitions
`/(?:^|[\s;{])([A-Za-z_][A-Za-z0-9_]*):/gm` vs references `/&([A-Za-z_][A-Za-z0-9_]*)/g` (52-66);
`synthesizeDanglingAnchorStub(labels)` emits `/dts-v1/;\n\n<STUB_HEADER>\n/ {\n\t<label>: <label> { };\n};\n`
(99-112); `withEphemeralDanglingAnchorStub` prepends it and `mergeEphemeralStubWithSource` strips `/dts-v1/;`+`/plugin/;`
and concatenates (76-91). The stub is explicitly non-authoritative, never persisted/exported/written back (25-30, 82-86).
Consumers: `scripts/compile-dts-seed.ts:5,29` (`compileDtsSeedFiles`) and the toolchain path used by
`compileDtsSeedEffectiveTrees` (`compile-dts-seed.ts:54-88`, mode `warn`, `failOnSchema:false`).
Focus tests: `server/modules/dts/danglingAnchorStub.test.ts`, `server/modules/dts/configSetResolver.test.ts:108-110`.

---

## D. Existing seed/catalog tooling (candidate hosts for seed manifest + reconciliation report)

npm scripts are declared in `package.json:78-88` and `:90-100`.

| npm script | Entry point | Input | Output / format |
| --- | --- | --- | --- |
| `dts:seed:generate` | `scripts/dts-power-seed.ts:912` `generateDtsPowerSeedArtifacts` | `server/modules/dts/fixtures/synthetic-power-base.dts` + `src/config/dts-seed/aurora-power-overlay.dts` (916-919) | **writes** `src/config/dts-seed/{aurora,nebula,atlas}-board.dts` (922-924); prints `Generated 3 project DTS files from N resolved properties` (931-933). Marked a *legacy optional regenerator*; committed `*-board.dts` are the product source of truth (913-915). In-memory shape `DtsPowerSeed` at 78-83 (`parameterModules`, `parameterLibrary`, `projectFiles`) |
| `dts:linux-bindings:generate` | `scripts/generate-linux-dt-bindings.ts:24` `generateLinuxDtBindings` | `schemas/dts/vendor/wiseeff/` + `src/config/dts-seed/` (20-22, 37-38) via `scripts/lib/vendorDtSchemaGenerator.ts` (`loadVendorSpecs:388`, `collectReleaseCompatibles:399`) | **writes** `schemas/dts/linux-bindings/*.yaml` + `schemas/dts/linux-bindings/manifest.json` (49, 65). Manifest format: `{generatedAt, contentHash, blockerCount, hardBlockerCount, files[]}` (58-64). Current committed manifest: 33 files, `blockerCount 0`, `hardBlockerCount 0`, `contentHash f12145e41c8eda929230f80170ed811f687ca5997ebe36dfd5578182d039891b` |
| `dtc:seed:compile` | `scripts/compile-dts-seed.ts` `compileDtsSeedFiles:22`, `loadCommittedDtsSeedFiles:40`, `compileDtsSeedEffectiveTrees:54` | the 3 committed board files | no repo writes; prints JSON `{ok, compiler, mode, effectiveTrees[{projectId,ok,compiler,effectiveDtbSha256}], diagnostics}` (96-113); applies ephemeral stub (29) |
| `dts:config:validate` | `scripts/validate-dts-config-set.ts:18` `validateDtsConfigSetFromPaths` | `--entry`, `--overlays`, `--file=name=path`, `--mode` | prints `DtsToolchainResult` JSON (84, 92) |
| `db:seed:m0` | `scripts/seed-m0.ts` `seedM0Foundation` | in-code org/users | DB writes |
| `db:seed:m1` | `scripts/seed-m1-parameters.ts` `main():1035` | **`src/config/power-management.json` (1043-1044)** + committed board DTS via `loadCommittedDtsSeedFiles` (1045) + `buildDtsPowerSeed` (1050) | DB writes only; merges `parameterModules` deduped by name and `parameterLibrary = compatibility 12 + dts seed` (1055-1065); then `seedM1Parameters`, `seedM1DtsFiles`, `seedM1SemanticTopology`, `syncVendorPropertyDocs`, `recomputeBindingModules`, `seedM1BindingRevisionHistory` (1073-1081) |
| `db:seed:m2` / `db:seed:m3` | `scripts/seed-m2-logs.ts`, `scripts/seed-m3-debugging.ts` | in-code log/debug fixtures | DB writes |
| `db:seed:all` | `scripts/seed-all.ts:6` `runAllSeedScripts` | — | spawns the four `db:seed:*` scripts sequentially (4-17) |
| `catalog:compile-vendor` | `scripts/compile-vendor-catalog-release.ts:314` `compileVendorCatalogSuccessor` | `schemas/dts/catalog.json#schemaPaths` (152-164) | in-memory `CatalogReleaseBundle` successor `crel_vendor_catalog_1` v1.1.0; embedded source `schemas/dts/catalog-release/vendor-catalog-1.yaml`; `--out` writes bundle JSON (377-383); prints `{releaseId,version,digest,predecessor,counts,excluded,out}` |
| `catalog:install-release` | `scripts/install-catalog-release.ts:81` `installCatalogRelease`, `:109` `installFirstCatalogRelease` | release bundle JSON file | Postgres install |
| `parameter-definitions:reconcile` / `:check` | `scripts/reconcile-parameter-definitions.ts:23` `runReconcileParameterDefinitions` | DB (`DATABASE_URL`, 34-36); CLI `--verify`, `--report-id`, `--run-id`, `--plan-digest`, `--phase`, `--legacy-type/--legacy-id`, `--apply` | JSON body to stdout {inspect / verify report / legacy outcome / apply-gone} (136-144) |

**Seed manifest / reconciliation report hosting:** no existing `seedManifest`/`SeedManifest` code symbol exists
(`grep -rn "seed manifest\|seedManifest\|SeedManifest"` across `*.ts`/`*.md` finds only prose in
`docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md:240,382` and the plan steps
`docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md:133`). Existing manifest-shaped artifacts that
could host one: `schemas/dts/catalog.json` (vendor input index + hash pin), `schemas/dts/linux-bindings/manifest.json`
(generated bindings inventory), `schemas/dts/catalog-release/manifest.schema.json` (release manifest schema),
`docs/generated/` (generated evidence docs, no seed rows). The closest existing "reconciliation report" object is
`VendorConversionReport` (`vendorAdapter.ts:148-154`: `inventory`, `dispositions`, `identityMap`, `blocking`,
`appliedDefaults`) returned on both success and `import-blocked`. `server/modules/parameter-catalog-api/` contains only
HTTP layers (`governance/`, `legacy/`, `publication/`, `read/`, `productionWire.ts`) — **no seed tooling there**.

---

## E. Tests covering seed conversion / parity

| Test file | What it asserts |
| --- | --- |
| `server/modules/dts/goldenPowerFixture.test.ts` | `:14-41` locks 50 overlay nodes, **176** properties, 18 phandle refs, **26** repeated property keys, and the two `gpio_int` node paths `amba/i2c@FDF5E000/sc8562@6E` + `amba/i2c@FF24E000/mt5788@2B`; `:43-60` every `aurora-power-overlay.dts` label target is defined in `fixtures/synthetic-power-base.dts` (base has `gpio-controller`, `#gpio-cells = <2>`, `gic`); `:62-71` the 3 projects differ on ≥15 properties |
| `server/modules/parameters/dtsPowerSeed.test.ts` | `:33-52` resolved property count == 176 == `seed.parameterLibrary.length`, unique ids and `sourceNodePath`s, each row has all three project values and `configFormat` contains `DTS`; `:24-31` property key vs driver vs instance vs locator kept separate; `:54+` difficult identities (`matchable`, duplicate `compatible`) preserved |
| `server/modules/parameters/seedM1DtsFiles.test.ts` | 3 object-store puts (`aurora/nebula/atlas-board.dts`), 3 each of `dts_config_set`/`project_parameter_files`/`project_parameter_file_versions`/`dts_release_baseline`(+`_members`), **150** `dts_nodes`, **528** `dts_properties`, **54** `dts_phandle_refs` |
| `server/modules/dts/seedM1DtsIntegrity.test.ts` | `loadCommittedDtsSeedFiles` returns exactly 3 files and all parse (`assertCommittedDtsSeedParses`); malformed source throws `/failed to parse for aurora/` |
| `server/modules/parameters/seedM1Parameters.test.ts` | `:127-134` `parsePowerManagementConfig` throws an actionable error for bad shape; `:135-208` seeding: no flat definitions by default, module catalog + exact DTS source binding, history only when the value version advances |
| `src/powerManagementConfig.test.ts` | `:26-32` 3 projects, **`parameterLibrary` length 12**, non-empty modules, ≥8 debug parameters; `:76-79` 36 flattened project rows / 10 debug rows; `:81-108` the two DTS multiline items render with `\n`, the matrix/curve markers, and per-project divergence; `:197-206` deleting project `atlas` removes only its values |
| `scripts/compile-vendor-catalog-release.test.ts` | `:27-55` successor of `crel_acme_1` compiles: release id/version/digests pinned, `excluded` equals `EXCLUDED_SCHEMA_BASENAMES`, counts `subjects 48 / aliases 1 / definitions 114`; `:57-76` expected ids present, no ambiguous fixture ids, `fast_charge_current_limit_ma`/`shared_prop`/`status` not importable as definitions; `:79-84` deterministic digest; `:87-99` fails closed on `vendorContentHash` mismatch |
| `server/modules/catalog-publication/import/vendorAdapter.test.ts` | vendor conversion/parity dispositions (`mapped`/`structural-non-param`/`excluded`/`unsupported`), `:529-546` blocks `constraints.cells` as `import-blocked` + `unhandled-constraint`; `:102-176` manifest-driven selection + hash mismatch; `:284+` unchanged vendor yields no successor, identity reuse |
| `server/modules/catalog-publication/builder/completeSuccessor.test.ts` | `:14,201-218` successor build keeps every vendor + acme member of the predecessor snapshot |
| `server/modules/catalog-publication/import/vendorCoexistence.integration.test.ts` | `:99+` vendor import coexists with page definitions, hash pin T18 cases, rebase semantics (needs PostgreSQL) |
| `server/modules/dts/configSetResolver.test.ts` / `danglingAnchorStub.test.ts` | `configSetResolver.test.ts:108-110` one `dangling-reference` warning, severity `warning`; `danglingAnchorStub.test.ts:25-38` a dangling overlay resolves cleanly once the synthesized stub is prepended |

---

## Discrepancies and NOT FOUND

1. **"24 dangling overlay target labels" — NOT FOUND.** No assertion, constant, fixture, or doc records 24 dangling
   labels. Searched: `grep -rn "toHaveLength(24)|toBe(24)|=== 24|24 repeated|24 dangling|24 labels|24 overlay"` over
   all `*.ts` (0 hits); `grep -rni "overlay target|dangling.*label|self-anchor" docs/`; `docs/exec-plans/active/2026-07-16-*`
   and `docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md`. Measured instead: **29** distinct
   `dangling-reference` labels per board, **37** total missing `&name` references. The number **24** appears only as the
   stale "24 repeated property keys" prose (`…-design.md:46`, plan `:143`), now **26** in code.
2. **"constraints" / "examples" fields on `parameterLibrary` — NOT FOUND.** The catalog uses `range` (constraint) and
   `values.*.currentValue/recommendedValue` (examples); `valueKind` is the only kind-like field. There is no
   `propertyKey` field: `name` holds the DTS-style key and `id` is a slug.
3. **A "seed manifest" host — NOT FOUND.** Only manifest-shaped artifacts listed in §D; the plan step that names a
   "seed manifest" (`2026-07-16-parameter-topology-schema-management.md:133`) was never implemented as a file.
4. **Seed tooling under `server/modules/parameter-catalog-api/` — NOT FOUND.** That module is HTTP/API-only;
   all seed generators live under `scripts/`.
