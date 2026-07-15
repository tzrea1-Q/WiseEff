# Topology- and Schema-Aware Parameter Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-schema-management.md)
> Design: [Topology- and Schema-Aware Parameter Management](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)

**Goal:** Replace the flat path-derived parameter identity with source occurrences, effective DTS topology, versioned driver/property specifications, stable project bindings, and an atomic migration that preserves every historical reference.

**Architecture:** Extend the existing CST parser and config-set baseline instead of replacing them. Build the semantic model additively in migration `0048`, exercise it on the full 170-property fixture, switch every API/UI/workflow consumer on one feature branch, then use a maintenance command to populate new identities and atomically retire the legacy identity tables. Production release remains fail-closed on deterministic identity, dt-schema, `dtc`, and `fdtoverlay`.

**Tech Stack:** TypeScript 5.9, Node.js/tsx, PostgreSQL 16, Zod, React 19/Vite, Vitest, Playwright, dtc/fdtoverlay 1.8.1, dtschema 2026.6, self-hosted Alpine runtime.

---

## Scope and execution shape

The design contains parser, persistence, schema, UI, and migration work, but these are not independently releasable products: they share one identity contract and the user explicitly selected a single atomic data cutover. Keep one implementation branch and one plan, with independently testable phase commits. Do not deploy an intermediate phase to production.

**Required branch:** `feat/parameter-topology-schema-management`, created from the latest `main` only after commits `32b66e4c` and `b16a2f9c` (or their merged equivalents) are in `main`.

**Production cutover rule:** additive schema and tests may exist before cutover, but production must not dual-write or expose a compatibility projection. Stop writes, migrate, validate, switch the application, or restore the whole snapshot.

## Phase outcomes

| Phase | Working outcome | Production behavior |
| --- | --- | --- |
| A. Semantic DTS core | Multi-file include/base/overlay resolver, provenance, typed values, golden fixture | No runtime switch |
| B. Schema and identity | Versioned schemas, deterministic mapping, stable nodes, project bindings | No runtime switch |
| C. Product workflow | Semantic APIs, editing, release gate, parameter library and topology UI | Feature branch only |
| D. Atomic cutover | Full historical migration, legacy retirement, runbook, acceptance evidence | One maintenance-window switch |

## File responsibility map

| Path | Responsibility |
| --- | --- |
| `server/modules/dts/types.ts` | CST and typed DTS value contracts |
| `server/modules/dts/valueAst.ts` | Raw RHS → lossless typed value AST |
| `server/modules/dts/configSetResolver.ts` | Include graph, base tree, ordered overlays, effective tree, provenance |
| `server/modules/dts/identity.ts` | Deterministic logical-node continuity candidates |
| `server/modules/parameter-specs/*` | Schema registry, matcher, inference review, policy targets, business categories |
| `server/modules/parameter-topology/*` | Config revisions, occurrence persistence, logical nodes, bindings, diagnostics |
| `server/modules/parameter-files/dtsToolchain.ts` | Complete config-set compilation and schema validation port |
| `server/migrations/0048_parameter_topology_schema_shadow.sql` | Additive semantic schema and new workflow FK columns |
| `server/cutovers/2026-07-16-parameter-identity-cutover.sql` | Maintenance-only constraint swap and legacy archival |
| `scripts/migrate-parameter-identities.ts` | Dry-run/apply migration orchestrator and validation report |
| `scripts/check-parameter-identity-cutover.ts` | Read-only preflight/postflight gate |
| `src/domain/parameter-topology/*` | Frontend semantic domain contracts |
| `src/infrastructure/http/parameterTopologyClient.ts` | Semantic API client |
| `src/components/parameter-topology/*` | Library, source/effective tree, properties, details, mapping queues |

## Locked domain contracts

```ts
export type ParameterSourceKind = "dts" | "json" | "manual";

export type DtsValue =
  | { kind: "boolean"; present: true }
  | { kind: "empty" }
  | { kind: "strings"; values: string[] }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; groups: DtsCell[][] }
  | { kind: "bytes"; values: number[] }
  | { kind: "mixed"; segments: DtsValueSegment[] };

export type DtsCell =
  | { kind: "integer"; raw: string; value: string }
  | { kind: "phandle"; label: string };

export type DtsValueSegment =
  | { kind: "string"; raw: string; value: string }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; cells: DtsCell[] };

export type MappingDecision<T> =
  | { kind: "matched"; value: T; evidence: string[] }
  | { kind: "unmatched"; evidence: string[] }
  | { kind: "ambiguous"; candidates: T[]; evidence: string[] };
```

Property identity is `parameter_spec_id + immutable parameter_spec_version_id`. Project identity is `project_parameter_binding_id`. A path is only a locator on `dts_logical_node_revisions`.

---

### Task 1: Lock the golden fixture and correct seed vocabulary

**Files:**
- Modify: `scripts/dts-power-seed.ts`
- Modify: `server/modules/parameters/dtsPowerSeed.test.ts`
- Create: `server/modules/dts/goldenPowerFixture.test.ts`
- Create: `src/config/dts-seed/wiseeff-power-base.dts`
- Modify: `scripts/compile-dts-seed.ts`

- [ ] **Step 1: Write the failing semantic-name test**

```ts
it("keeps property key, driver, instance and locator separate", () => {
  const seed = buildDtsPowerSeed(baseSource);
  const item = bySource(seed.parameterLibrary, "amba/i2c@FDF5E000/sc8562@6E/gpio_int");
  expect(item.name).toBe("gpio_int");
  expect(item.driverModule).toBe("sc8562");
  expect(item.instanceName).toBe("sc8562@6E");
  expect(item.nodeLocator).toBe("amba/i2c@FDF5E000/sc8562@6E");
});
```

- [ ] **Step 2: Run the test and verify the current path-derived name fails**

Run: `npm run test:server -- server/modules/parameters/dtsPowerSeed.test.ts --run`
Expected: FAIL with `expected "gpio_int"` and the current dotted path.

- [ ] **Step 3: Replace `parameterName(sourceNodePath)` and path-keyword “module” with explicit seed fields**

```ts
return {
  id: parameterId(sourceNodePath),
  name: property.name,
  driverModule: node.compatible ?? node.name,
  instanceName: node.unitAddress ? `${node.name}@${node.unitAddress}` : node.name,
  nodeLocator: node.nodePath,
  businessCategory: moduleForPath(node.nodePath, property.name),
  sourceNodePath,
  values
};
```

Do not rename `businessCategory` back to `module` in new semantic types.

- [ ] **Step 4: Add a complete synthetic base fixture for the overlay**

Define all external labels used by `base-power-overlay.dts`, including `amba`, `spmi`, `spmi1`, GPIO controllers, charger/battery targets, and `gic`. Give target nodes stable test-only `compatible = "wiseeff,<label>"` values; GPIO nodes must declare `gpio-controller` and `#gpio-cells = <2>`.

- [ ] **Step 5: Add the base fixture to the seed manifest and preserve its compile inputs**

```ts
expect(seed.projectFiles.every((file) => file.fileName === DTS_POWER_SEED_FILE_NAME)).toBe(true);
expect(await readFile(path.join(root, "src/config/dts-seed/wiseeff-power-base.dts"), "utf8"))
  .toContain("gpio-controller");
```

- [ ] **Step 6: Add golden assertions**

Assert 50 overlay nodes, 170 properties, 18 phandle references, 24 repeated property keys, and two distinct `gpio_int` occurrences. Assert the three project overlays still differ in at least 15 properties.

- [ ] **Step 7: Run tests and real compilation**

Run: `npm run test:server -- server/modules/parameters/dtsPowerSeed.test.ts server/modules/dts/goldenPowerFixture.test.ts --run`
Expected: PASS.
Run: `npm run dtc:seed:compile`
Expected: the existing seed overlays continue to compile without errors; applied effective-DTB compilation is added and gated in Task 8.

- [ ] **Step 8: Commit**

```bash
git add scripts/dts-power-seed.ts scripts/compile-dts-seed.ts server/modules/parameters/dtsPowerSeed.test.ts server/modules/dts/goldenPowerFixture.test.ts src/config/dts-seed
git commit -m "test(dts): lock semantic power fixture"
```

### Task 2: Introduce a lossless typed DTS value AST

**Files:**
- Modify: `server/modules/dts/types.ts`
- Create: `server/modules/dts/valueAst.ts`
- Create: `server/modules/dts/valueAst.test.ts`
- Modify: `server/modules/dts/parser.ts`
- Modify: `server/modules/dts/serialize.ts`

- [ ] **Step 1: Write table-driven failing tests**

```ts
it.each([
  ["weak_source_sleep_enabled", "", { kind: "boolean", present: true }],
  ["ranges", "", { kind: "empty" }],
  ["sc_err_tx", "/bits/ 8 <2>", { kind: "cells", bits: 8 }],
  ["gpio_int", "<&gpio13 29 0>", { kind: "cells", bits: 32 }],
  ["vbat_comp_ic_para", '"sc8565", "2", "0.5", "3"', { kind: "strings" }]
])("parses %s without losing raw text", (name, raw, expected) => {
  const value = parseDtsValue(name, raw);
  expect(value).toMatchObject(expected);
  expect(renderDtsValue(value, raw)).toBe(raw);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/dts/valueAst.test.ts --run`
Expected: FAIL because `valueAst.ts` does not exist.

- [ ] **Step 3: Add the discriminated AST**

Use the locked `DtsValue`/`DtsCell` contract above. Add raw spans to strings, groups, cells, and phandles so a changed segment can be patched without reformatting siblings.

- [ ] **Step 4: Parse exact widths and mixed segments**

```ts
export function parseDtsValue(propertyName: string, rawText: string): DtsValueParseResult {
  if (rawText.trim() === "") {
    return { value: EMPTY_PROPERTY_NAMES.has(propertyName) ? { kind: "empty" } : { kind: "boolean", present: true }, rawText };
  }
  return parseSegments(tokenizeValue(rawText), rawText);
}
```

Reject integer overflow for the selected width; retain decimal, hex, negative, and floating-looking string tokens exactly.

- [ ] **Step 5: Store AST on `DtsPropertyCst` and render only changed spans**

```ts
export interface DtsPropertyCst {
  kind: "property";
  name: string;
  value: DtsValue;
  rawText: string;
  normalizedValue: string;
  span: DtsSpan;
}
```

- [ ] **Step 6: Run parser/serializer regression tests**

Run: `npm run test:server -- server/modules/dts --run`
Expected: PASS, including byte-identical serialization of unchanged fixtures.

- [ ] **Step 7: Commit**

```bash
git add server/modules/dts
git commit -m "feat(dts): add lossless typed value AST"
```

### Task 3: Resolve complete configuration sets

**Files:**
- Create: `server/modules/dts/configSetResolver.ts`
- Create: `server/modules/dts/configSetResolver.test.ts`
- Create: `server/modules/dts/__fixtures__/config-set/*`
- Modify: `server/modules/dts/types.ts`
- Modify: `server/modules/dts/parser.ts`
- Modify: `server/modules/parameter-files/unsupported.ts`

- [ ] **Step 1: Write failing include/base/overlay tests**

```ts
const result = resolveDtsConfigSet({
  entryFile: "board.dts",
  includeSearchPaths: ["include"],
  overlayOrder: ["power.dtso"],
  files: fixtureFiles
});
expect(result.diagnostics).toEqual([]);
expect(result.effective.nodesByLocator.get("/amba/i2c@FDF5E000/sc8562@6E")?.properties.get("gpio_int")?.sourceChain)
  .toEqual([
    expect.objectContaining({ fileName: "power.dtso", propertyName: "gpio_int", effect: "set" })
  ]);
```

Add tests for include cycles, path traversal, duplicate labels, unresolved overlay targets, `/delete-property/`, `/delete-node/`, and overlay ordering.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/dts/configSetResolver.test.ts --run`
Expected: FAIL because `resolveDtsConfigSet` does not exist.

- [ ] **Step 3: Add manifest and diagnostic contracts**

```ts
export type DtsConfigSetInput = {
  entryFile: string;
  includeSearchPaths: string[];
  overlayOrder: string[];
  files: ReadonlyMap<string, { fileVersionId: string; content: string }>;
};

export type DtsResolutionDiagnostic = {
  code: "include-missing" | "include-cycle" | "path-escape" | "target-unresolved" | "label-duplicate";
  severity: "error";
  fileName: string;
  message: string;
};
```

- [ ] **Step 4: Resolve includes before overlays**

Resolve paths against the including file followed by declared include roots. Normalize to POSIX logical paths and reject any result outside the manifest. Preserve an occurrence per original file.

- [ ] **Step 5: Apply overlays and deletions with provenance**

Do not overwrite the source occurrence. Produce an effective property with an ordered `sourceChain` of `set`, `override`, or `delete` effects.

- [ ] **Step 6: Remove the old blanket `/include/` rejection**

`unsupported.ts` must report only constructs still outside the parser contract. Missing includes are resolver diagnostics, not parser “unsupported” errors.

- [ ] **Step 7: Run focused and golden tests**

Run: `npm run test:server -- server/modules/dts server/modules/parameter-files/parserSafety.integration.test.ts --run`
Expected: PASS with deterministic effective locators and diagnostics.

- [ ] **Step 8: Commit**

```bash
git add server/modules/dts server/modules/parameter-files/unsupported.ts server/modules/parameter-files/unsupported.test.ts
git commit -m "feat(dts): resolve multi-file config sets"
```

### Task 4: Add the semantic shadow schema

**Files:**
- Create: `server/migrations/0048_parameter_topology_schema_shadow.sql`
- Create: `server/modules/parameter-topology/schemaMigration.test.ts`
- Modify: `docs/generated/db-schema.md`

- [ ] **Step 1: Write a failing migration integration test**

The test applies migrations twice and asserts the following tables and constraints exist:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  "parameter_specs", "parameter_spec_versions", "driver_schemas", "driver_schema_versions",
  "dts_property_specs", "parameter_policy_targets", "business_categories",
  "dts_config_revisions", "dts_config_revision_members", "dts_node_occurrences",
  "dts_property_occurrences", "dts_logical_nodes", "dts_logical_node_revisions",
  "dts_occurrence_effects", "project_parameter_bindings", "project_parameter_binding_revisions",
  "identity_mapping_tasks", "parameter_spec_review_tasks", "dts_validation_runs",
  "dts_validation_diagnostics", "audit_subject_links", "legacy_parameter_migration_evidence"
]));
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/schemaMigration.test.ts --run`
Expected: FAIL with missing relation `parameter_specs`.

- [ ] **Step 3: Create stable/versioned specification tables**

```sql
create table parameter_specs (
  id text primary key,
  organization_id text references organizations(id),
  source_kind text not null check (source_kind in ('dts','json','manual')),
  specification_key text not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, source_kind, specification_key)
);

create table parameter_spec_versions (
  id text primary key,
  parameter_spec_id text not null references parameter_specs(id),
  version integer not null,
  display_name text not null,
  description text not null,
  value_shape jsonb not null,
  schema_default jsonb,
  example_value jsonb,
  lifecycle text not null check (lifecycle in ('draft','active','deprecated')),
  created_at timestamptz not null default now(),
  unique (parameter_spec_id, version)
);
```

Add immutable driver/property subtype tables and organization policy targets. `example_value` must never be used by a database constraint or release policy.

- [ ] **Step 4: Create occurrence/effective topology tables**

`dts_node_occurrences` and `dts_property_occurrences` store file version, spans, raw text, AST JSON, and source order. `dts_logical_nodes` stores stable UUIDs; revision locators live only in `dts_logical_node_revisions`. `dts_occurrence_effects` links provenance.

- [ ] **Step 5: Create binding, mapping, validation, and migration-evidence tables**

Add nullable semantic FK columns to every legacy workflow table but do not drop old columns:

```sql
alter table parameter_history_entries add column if not exists parameter_spec_id text references parameter_specs(id);
alter table parameter_history_entries add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);
alter table parameter_drafts add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);
alter table parameter_change_requests add column if not exists parameter_spec_id text references parameter_specs(id);
alter table parameter_change_requests add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);
alter table parameter_submission_items add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);
alter table parameter_file_sync_conflicts add column if not exists parameter_spec_id text references parameter_specs(id);
alter table parameter_file_sync_conflicts add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

create table audit_subject_links (
  audit_event_id text not null references audit_events(id) on delete cascade,
  subject_kind text not null,
  legacy_id text,
  semantic_id text not null,
  evidence_id text references legacy_parameter_migration_evidence(id),
  primary key (audit_event_id, subject_kind, semantic_id)
);
```

Also add semantic references to debugging tables that currently point to `parameter_definitions`.

- [ ] **Step 6: Run migration and schema tests**

Run: `npm run test:server -- server/modules/parameter-topology/schemaMigration.test.ts server/shared/database/migrations.test.ts --run`
Expected: PASS on a fresh database and on a database already at `0047`.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/0048_parameter_topology_schema_shadow.sql server/modules/parameter-topology/schemaMigration.test.ts docs/generated/db-schema.md
git commit -m "feat(parameters): add semantic identity schema"
```

### Task 5: Persist source occurrences and effective topology

**Files:**
- Create: `server/modules/parameter-topology/types.ts`
- Create: `server/modules/parameter-topology/repository.ts`
- Create: `server/modules/parameter-topology/ingestService.ts`
- Create: `server/modules/parameter-topology/ingestService.test.ts`
- Modify: `server/modules/parameter-files/service.ts`

- [ ] **Step 1: Write the failing transactional ingest test**

```ts
const revision = await ingestConfigRevision(db, manifest, auth);
expect(revision.status).toBe("resolved");
expect(await count("dts_property_occurrences", revision.id)).toBe(170);
expect(await effectiveProperty(revision.id, "/amba/i2c@FDF5E000/sc8562@6E", "gpio_int"))
  .toMatchObject({ propertyName: "gpio_int", rawText: "<&gpio13 29 0>" });
```

Also assert a failed include leaves no partial occurrence rows.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/ingestService.test.ts --run`
Expected: FAIL because `ingestConfigRevision` does not exist.

- [ ] **Step 3: Implement one-transaction revision persistence**

Create the revision as `resolving`, store manifest members, occurrences, logical-node revisions, provenance effects, and diagnostics, then set `resolved` or `invalid`. Never mutate a previous revision.

- [ ] **Step 4: Derive line/column from offsets**

Persist both byte offsets and one-based line/column so API diagnostics do not rescan source objects.

- [ ] **Step 5: Call semantic ingest after a complete config-set revision is frozen**

Do not invoke semantic ingest for an isolated DTS member without its config-set manifest.

- [ ] **Step 6: Run focused integration tests**

Run: `npm run test:server -- server/modules/parameter-topology server/modules/parameter-files/structural.integration.test.ts --run`
Expected: PASS; existing per-file structural reads remain available only until final cutover.

- [ ] **Step 7: Commit**

```bash
git add server/modules/parameter-topology server/modules/parameter-files/service.ts
git commit -m "feat(parameters): persist effective DTS topology"
```

### Task 6: Build the versioned schema registry and matcher

**Files:**
- Create: `server/modules/parameter-specs/types.ts`
- Create: `server/modules/parameter-specs/repository.ts`
- Create: `server/modules/parameter-specs/schemaLoader.ts`
- Create: `server/modules/parameter-specs/matcher.ts`
- Create: `server/modules/parameter-specs/matcher.test.ts`
- Create: `schemas/dts/vendor/wiseeff/*.yaml`
- Create: `schemas/dts/catalog.json`

- [ ] **Step 1: Write precedence and ambiguity tests**

```ts
expect(matchDriver(sc8562Node, registry)).toEqual({
  kind: "matched",
  value: expect.objectContaining({ compatible: "sc8562", source: "vendor" }),
  evidence: expect.arrayContaining(["compatible=sc8562"])
});
expect(matchDriver(ambiguousNode, registry).kind).toBe("ambiguous");
expect(matchDriver(unknownNode).kind).toBe("unmatched");
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-specs/matcher.test.ts --run`
Expected: FAIL because the registry and matcher do not exist.

- [ ] **Step 3: Load pinned schema packages**

`catalog.json` records Linux dt-schema revision, dtschema `2026.6`, Vendor Schema content hash, and import time. Load only schemas reachable from compatible values in the imported project, plus their referenced common schemas.

- [ ] **Step 4: Implement strict precedence**

Return one of the locked `MappingDecision` variants. Linux schema is the base, organization Vendor Schema may add/narrow, reviewed manual specs may fill a gap, and inferred drafts never count as a releasable match.

- [ ] **Step 5: Curate Vendor Schemas for the golden fixture**

Every one of the 170 properties must resolve to a property spec in the synthetic complete config set. Preserve units and constraints where the property name and table shape support them; use an example value for illustration only. Do not invent schema defaults or policy targets.

- [ ] **Step 6: Add inference-review behavior**

Unknown properties create `parameter_spec_review_tasks` with source evidence, candidate schemas, project count, and `open` state. Multiple candidates create a blocking task instead of selecting the highest score.

- [ ] **Step 7: Run schema and golden coverage tests**

Run: `npm run test:server -- server/modules/parameter-specs server/modules/dts/goldenPowerFixture.test.ts --run`
Expected: PASS with 170/170 reviewed spec bindings and two distinct `gpio_int` specs.

- [ ] **Step 8: Commit**

```bash
git add server/modules/parameter-specs schemas/dts
git commit -m "feat(parameters): add schema registry and strict matcher"
```

### Task 7: Resolve stable logical identities and project bindings

**Files:**
- Create: `server/modules/dts/identity.ts`
- Create: `server/modules/dts/identity.test.ts`
- Create: `server/modules/parameter-topology/bindingService.ts`
- Create: `server/modules/parameter-topology/bindingService.test.ts`

- [ ] **Step 1: Write deterministic/ambiguous continuity tests**

```ts
expect(matchLogicalNode(previousSc8562, movedButUniqueSc8562)).toMatchObject({ kind: "matched" });
expect(matchLogicalNode(previousSc8562, twoEquivalentCandidates)).toMatchObject({ kind: "ambiguous" });
expect(matchLogicalNode(previousSc8562, [{ ...candidate, locatorOnlyMatch: true }])).toMatchObject({ kind: "unmatched" });
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/dts/identity.test.ts --run`
Expected: FAIL because `matchLogicalNode` does not exist.

- [ ] **Step 3: Implement deterministic evidence keys**

Use explicit reviewed mapping, stable parent logical ID, driver schema version, schema-declared unique keys, `reg`, unit address, and topology relation. Do not use fuzzy scoring, label alone, or locator alone.

- [ ] **Step 4: Persist ambiguous mapping tasks**

Each task stores previous node, candidate nodes, evidence JSON, affected revision, status, reviewer, reason, and timestamps. An open task sets the config revision state to `needs_mapping`.

- [ ] **Step 5: Create stable bindings and revision values**

```ts
export type ProjectPropertyBindingKey = {
  projectId: string;
  logicalNodeId: string | null;
  parameterSpecId: string;
};
```

Store effective typed/canonical/raw values on `project_parameter_binding_revisions`. Store schema default on the spec version, organization/product target in `parameter_policy_targets`, and no “recommended value” field.

- [ ] **Step 6: Verify continuity and blocking**

Run: `npm run test:server -- server/modules/dts/identity.test.ts server/modules/parameter-topology/bindingService.test.ts --run`
Expected: PASS; address/path changes with unique evidence preserve binding ID, ambiguity blocks the revision.

- [ ] **Step 7: Commit**

```bash
git add server/modules/dts/identity.ts server/modules/dts/identity.test.ts server/modules/parameter-topology
git commit -m "feat(parameters): bind stable logical identities"
```

### Task 8: Replace the file-by-file validator with a complete toolchain runner

**Files:**
- Create: `server/modules/parameter-files/dtsToolchain.ts`
- Create: `server/modules/parameter-files/dtsToolchain.test.ts`
- Create: `scripts/validate-dts-config-set.ts`
- Modify: `server/modules/parameter-files/dtcValidator.ts`
- Modify: `server/modules/parameter-files/validationGate.ts`
- Modify: `scripts/check-dtc.ts`
- Modify: `scripts/bootstrap-dtc.ts`
- Create: `scripts/check-dts-toolchain.ts`
- Create: `tools/dts-toolchain/versions.json`
- Create: `tools/dts-toolchain/requirements.txt`
- Modify: `ops/self-hosted/Dockerfile`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

- [ ] **Step 1: Write failing base+overlay toolchain tests**

```ts
const result = await runner.validate(configSet, { mode: "release" });
expect(result).toMatchObject({
  ok: true,
  compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" }
});
expect(result.artifacts.effectiveDtbSha256).toMatch(/^[a-f0-9]{64}$/);
```

Test missing tools, timeout, path escape, invalid overlay order, dt-schema error, and warning policy.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-files/dtsToolchain.test.ts --run`
Expected: FAIL because `dtsToolchain.ts` does not exist.

- [ ] **Step 3: Implement the complete pipeline**

Write the logical file tree to an isolated directory, compile the base with `dtc -@`, compile overlays to DTBO, apply them in manifest order with `fdtoverlay`, and run `dt-validate` against the effective DTB. Return structured diagnostics and hashes.

- [ ] **Step 4: Make production fail closed**

```ts
if (input.mode === "release" && (!versions.dtc || !versions.fdtoverlay || !versions.dtschema)) {
  return failed("toolchain-unavailable", versions);
}
```

`warn` and `off` may remain local diagnostics but `releaseBaseline` must reject them.

- [ ] **Step 5: Pin production tools**

Set `tools/dts-toolchain/versions.json` to:

```json
{
  "dtc": { "version": "1.8.1", "commit": "8f48565e5cfedc74d3f7512f1e0188e9d85dc1de" },
  "dtschema": "2026.6"
}
```

Set `requirements.txt` to `dtschema==2026.6`. Build dtc/fdtoverlay from the pinned commit in a Docker build stage; copy binaries into the runtime image. Record versions at image build and API health startup.

- [ ] **Step 6: Add repository commands**

```json
"dts:toolchain:check": "tsx scripts/check-dts-toolchain.ts --required",
"dts:config:validate": "tsx scripts/validate-dts-config-set.ts"
```

- [ ] **Step 7: Run real checks**

Run: `npm run dts:toolchain:check && npm run dtc:seed:compile && npm run selfhost:check`
Expected: all three tools reported, seed effective DTBs pass.

- [ ] **Step 8: Commit**

```bash
git add server/modules/parameter-files scripts tools/dts-toolchain ops/self-hosted/Dockerfile .github/workflows/ci.yml package.json package-lock.json
git commit -m "feat(dts): validate complete config sets"
```

### Task 9: Add semantic APIs, authorization, and audit

**Files:**
- Create: `server/modules/parameter-specs/schemas.ts`
- Create: `server/modules/parameter-specs/service.ts`
- Create: `server/modules/parameter-specs/routes.ts`
- Create: `server/modules/parameter-topology/schemas.ts`
- Create: `server/modules/parameter-topology/service.ts`
- Create: `server/modules/parameter-topology/routes.ts`
- Create: `server/modules/parameter-topology/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/modules/contracts/routeManifest.ts`
- Modify: `server/modules/contracts/schemaRegistry.ts`

- [ ] **Step 1: Write failing route-contract tests**

Cover:

```text
GET  /api/v2/parameter-specs
GET  /api/v2/parameter-specs/:specId
POST /api/v2/parameter-spec-review-tasks/:taskId/resolve
GET  /api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology?view=source|effective
GET  /api/v2/projects/:projectId/parameter-bindings
GET  /api/v2/identity-mapping-tasks
POST /api/v2/identity-mapping-tasks/:taskId/resolve
POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate
```

Viewers can read project topology/bindings; only parameter admins can approve specs/mappings or publish. Cross-organization IDs return 404.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/routes.test.ts --run`
Expected: FAIL with no matching route.

- [ ] **Step 3: Define DTOs without path-derived identity**

```ts
export const projectBindingDtoSchema = z.object({
  id: z.string(),
  parameterSpecId: z.string(),
  parameterSpecVersionId: z.string(),
  propertyKey: z.string(),
  driverModule: z.string().nullable(),
  logicalNodeId: z.string().nullable(),
  instanceName: z.string().nullable(),
  locator: z.string().nullable(),
  effectiveValue: dtsValueSchema,
  rawValue: z.string(),
  schemaState: z.enum(["valid", "invalid", "unreviewed"]),
  policyState: z.enum(["pass", "fail", "not_applicable"])
});
```

- [ ] **Step 4: Audit every governance mutation**

Audit spec approval, mapping resolution, edit, validation, baseline, publish, and migration with request/trace correlation. Store IDs and evidence hashes, not full source text.

- [ ] **Step 5: Register OpenAPI contracts**

Run: `npm run contract:openapi && npm run contract:check`
Expected: generated contract includes all semantic routes with no undocumented endpoint.

- [ ] **Step 6: Run route/auth tests**

Run: `npm run test:server -- server/modules/parameter-specs server/modules/parameter-topology server/modules/contracts --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/modules/parameter-specs server/modules/parameter-topology server/app.ts server/modules/contracts docs/generated/openapi.json
git commit -m "feat(parameters): expose semantic topology APIs"
```

### Task 10: Integrate typed editing, writeback, and the review workflow

**Files:**
- Modify: `server/modules/parameter-files/writebackService.ts`
- Modify: `server/modules/parameters/service.ts`
- Modify: `server/modules/parameters/repository.ts`
- Modify: `server/modules/parameters/types.ts`
- Create: `server/modules/parameter-topology/editService.ts`
- Create: `server/modules/parameter-topology/editService.test.ts`
- Modify: `server/modules/parameters/structuredEditSubmit.integration.test.ts`

- [ ] **Step 1: Write failing edit/writeback tests**

```ts
const draft = await createBindingDraft(db, auth, {
  bindingId,
  baseRevisionId,
  targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "3000", value: "3000" }]] },
  reason: "Raise current limit for board variant"
});
expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
expect(await unchangedSourceBytes(draft)).toBe(true);
```

Also test stale revision conflicts, shared-base protection, delete action, schema failure, and unresolved mapping.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/editService.test.ts --run`
Expected: FAIL because `createBindingDraft` does not exist.

- [ ] **Step 3: Patch a selected occurrence or project overlay**

Use AST spans for an existing project occurrence. When the effective value comes only from shared base, create/update a project overlay target instead of changing the base.

- [ ] **Step 4: Re-resolve and compile before submission**

The draft stores a candidate config revision. Schema/reference/toolchain failure returns diagnostics and never updates the released binding revision.

- [ ] **Step 5: Replace workflow foreign keys**

All new drafts, submission items, change requests, history entries, and file conflicts write `parameter_spec_id` and `project_parameter_binding_id` only. Remove `recommendedValue` from new DTOs; initialization suggestions use `policyTarget ?? schemaDefault` and clearly label `exampleValue` as non-enforced.

- [ ] **Step 6: Run workflow regression tests**

Run: `npm run test:server -- server/modules/parameters server/modules/parameter-topology server/modules/parameter-files/writebackService.test.ts --run`
Expected: PASS with stable binding IDs through draft → review → merge → new config revision.

- [ ] **Step 7: Commit**

```bash
git add server/modules/parameter-topology server/modules/parameter-files/writebackService.ts server/modules/parameters
git commit -m "feat(parameters): edit semantic bindings through review"
```

### Task 11: Add frontend semantic contracts and clients

**Files:**
- Create: `src/domain/parameter-topology/types.ts`
- Create: `src/application/ports/ParameterTopologyRepository.ts`
- Create: `src/infrastructure/http/parameterTopologyClient.ts`
- Create: `src/infrastructure/http/parameterTopologyClient.test.ts`
- Create: `src/application/parameters/parameterTopologyRuntime.ts`
- Modify: `src/domain/parameters/types.ts`

- [ ] **Step 1: Write failing DTO mapping tests**

```ts
expect(bindingFromDto(dto)).toMatchObject({
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  instanceName: "sc8562@6E",
  locator: "/amba/i2c@FDF5E000/sc8562@6E"
});
expect(bindingFromDto(dto)).not.toHaveProperty("recommendedValue");
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- src/infrastructure/http/parameterTopologyClient.test.ts`
Expected: FAIL because the client does not exist.

- [ ] **Step 3: Add exact port methods**

```ts
export interface ParameterTopologyRepository {
  listSpecs(query: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
  listBindings(projectId: string, revisionId: string): Promise<ProjectParameterBinding[]>;
  getTopology(projectId: string, configSetId: string, revisionId: string, view: "source" | "effective"): Promise<TopologyTree>;
  listMappingTasks(projectId?: string): Promise<IdentityMappingTask[]>;
  resolveMapping(taskId: string, input: ResolveMappingInput): Promise<void>;
  validateRevision(projectId: string, revisionId: string): Promise<ValidationRun>;
}
```

- [ ] **Step 4: Implement HTTP error mapping and cancellation**

Map structured diagnostics and `409 stale-revision` responses; do not convert them to generic strings.

- [ ] **Step 5: Run frontend type/client tests**

Run: `npm test -- src/domain/parameter-topology src/infrastructure/http/parameterTopologyClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/parameter-topology src/application/ports/ParameterTopologyRepository.ts src/application/parameters/parameterTopologyRuntime.ts src/infrastructure/http/parameterTopologyClient*
git commit -m "feat(parameters): add semantic frontend contracts"
```

### Task 12: Redesign the parameter library around specifications

**Files:**
- Create: `src/components/parameter-topology/ParameterSpecLibrary.tsx`
- Create: `src/components/parameter-topology/ParameterSpecLibrary.test.tsx`
- Create: `src/components/parameter-topology/SpecReviewQueue.tsx`
- Create: `src/components/parameter-topology/ParameterSpecDetail.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/components/admin/ParameterLibraryTable.tsx`

- [ ] **Step 1: Write failing component tests**

Assert columns for property key, driver module, compatible, value type, schema source/version, example value, business category, review state, and usage count. Assert no full path appears in the name column and example value is not labeled recommended/default.

- [ ] **Step 2: Verify failure**

Run: `npm test -- src/components/parameter-topology/ParameterSpecLibrary.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement specification filters and detail**

Search by property key, driver, compatible, business category, schema source, and lifecycle. The detail view separates schema default, example, policy targets, usage, and schema history.

- [ ] **Step 4: Implement the review queue**

Show inference evidence and all candidates. Approval requires an explicit schema choice and reason; ambiguous items have no “accept first” action.

- [ ] **Step 5: Mount the new library**

Replace the flat API-mode library in `ParameterAdminPage`. Mock mode may use a small semantic mock, but production API mode must not read `state.parameters` as its business source.

- [ ] **Step 6: Run unit, accessibility, and build checks**

Run: `npm test -- src/components/parameter-topology src/ParameterAdminPage.test.tsx src/ParameterAdminPage.a11y.test.tsx`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/parameter-topology src/ParameterAdminPage.tsx src/components/admin/ParameterLibraryTable.tsx
git commit -m "feat(parameters): manage versioned parameter specs"
```

### Task 13: Redesign project parameters around effective/source topology

**Files:**
- Create: `src/components/parameter-topology/ProjectTopologyWorkspace.tsx`
- Create: `src/components/parameter-topology/TopologyTree.tsx`
- Create: `src/components/parameter-topology/BindingPropertyTable.tsx`
- Create: `src/components/parameter-topology/BindingDetailPanel.tsx`
- Create: `src/components/parameter-topology/ProjectTopologyWorkspace.test.tsx`
- Modify: `src/ParametersPage.tsx`
- Retire at cutover: `src/components/parameters/DtsNodeTreeView.tsx`
- Retire at cutover: `src/components/parameters/DtsStructureBrowserPanel.tsx`

- [ ] **Step 1: Write failing workspace tests**

```tsx
expect(screen.getByRole("treeitem", { name: /amba/ })).toBeVisible();
expect(screen.getByRole("treeitem", { name: /i2c@FDF5E000/ })).toBeVisible();
expect(screen.getByRole("treeitem", { name: /sc8562@6E/ })).toBeVisible();
expect(screen.getByRole("cell", { name: "gpio_int" })).toBeVisible();
expect(screen.getByText("<&gpio13 29 0>")).toBeVisible();
```

Test source/effective toggle, repeated `&amba` occurrences, unresolved targets, search returning two `gpio_int` bindings, details, edit diagnostics, and mobile drawer behavior.

- [ ] **Step 2: Verify failure**

Run: `npm test -- src/components/parameter-topology/ProjectTopologyWorkspace.test.tsx`
Expected: FAIL because the workspace does not exist.

- [ ] **Step 3: Build the three-pane desktop workspace**

Tree = topology/identity, table = bindings/effective values, detail = spec/source/governance/history. Use one shared selection ID; do not infer selection from a path string.

- [ ] **Step 4: Add source/effective modes**

Source mode shows file/line and each occurrence effect. Effective mode shows the merged logical node and provenance chain. Missing base shows a blocking incomplete state.

- [ ] **Step 5: Add responsive behavior**

At tablet width collapse detail into a drawer; at mobile width use tree → properties → detail navigation with an explicit breadcrumb and no horizontal overflow.

- [ ] **Step 6: Replace the API-mode project parameter surface**

Keep existing workflow actions but pass stable binding IDs. Remove the old flat `sourceNodePath` presentation from API mode.

- [ ] **Step 7: Run tests and build**

Run: `npm test -- src/components/parameter-topology src/ParametersPage.test.tsx`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/parameter-topology src/ParametersPage.tsx
git commit -m "feat(parameters): add topology-aware project workspace"
```

### Task 14: Build deterministic historical migration and atomic cutover

**Files:**
- Create: `server/modules/parameter-topology/migration.ts`
- Create: `server/modules/parameter-topology/migration.test.ts`
- Create: `scripts/migrate-parameter-identities.ts`
- Create: `scripts/check-parameter-identity-cutover.ts`
- Create: `server/cutovers/2026-07-16-parameter-identity-cutover.sql`
- Modify: `package.json`

- [ ] **Step 1: Write failing migration coverage tests**

Seed definitions, project values, history, drafts, open/closed change requests, decisions, submission items, file conflicts, baselines, debug references, and audit events. Dry-run must report:

```ts
expect(report).toMatchObject({
  legacyDefinitions: expectedDefinitions,
  mappedDefinitions: expectedDefinitions,
  legacyProjectValues: expectedValues,
  mappedProjectValues: expectedValues,
  unmappedRecords: 0,
  ambiguousRecords: 0,
  brokenHistoryChains: 0
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run`
Expected: FAIL because the migrator does not exist.

- [ ] **Step 3: Add deterministic IDs**

```ts
export function stableSemanticId(kind: string, parts: readonly string[]): string {
  const hex = createHash("sha256").update([kind, ...parts].join("\u001f")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
```

Specification IDs use schema namespace/version/property key, never a project path. Binding IDs use project/logical-node/spec.

- [ ] **Step 4: Preserve legacy evidence without promoting “recommended” values**

Every old ID/name/path/current/recommended value and row hash goes to `legacy_parameter_migration_evidence`. Curated schema data provides `example_value`. Old `recommended_value` must not become `schema_default` or `policy_target` automatically.

- [ ] **Step 5: Populate semantic references for all history**

Add semantic IDs to history, drafts, change requests, submission items, decisions through their request, file conflicts, baselines/config revisions, debug references, and `audit_subject_links`. Do not rewrite immutable audit event payloads.

- [ ] **Step 6: Add dry-run and apply commands**

```json
"parameter-identities:migrate": "tsx scripts/migrate-parameter-identities.ts",
"parameter-identities:check": "tsx scripts/check-parameter-identity-cutover.ts"
```

Default is dry-run. `--apply --maintenance-token <token>` requires write lock confirmation, snapshot identifiers, and zero blockers.

- [ ] **Step 7: Write the maintenance-only cutover SQL**

Inside one transaction: verify the migration run, make semantic workflow columns non-null, swap FKs, archive `parameter_definitions` and `project_parameter_values` under `legacy_*` names, remove legacy identity columns from active workflow tables, and record the cutover marker. Do not add this file to automatic `db:migrate` discovery.

- [ ] **Step 8: Run migration tests twice from a restored snapshot**

Run: `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run`
Expected: PASS; two fresh restores produce identical IDs and counts. Injected failure leaves no cutover marker and no partial active schema.

- [ ] **Step 9: Commit**

```bash
git add server/modules/parameter-topology/migration* scripts/migrate-parameter-identities.ts scripts/check-parameter-identity-cutover.ts server/cutovers package.json
git commit -m "feat(parameters): add atomic identity migration"
```

### Task 15: Switch remaining consumers and remove the legacy identity API

**Files:**
- Modify: `server/modules/parameters/routes.ts`
- Modify: `server/modules/parameters/repository.ts`
- Modify: `server/modules/parameters/dashboard/*`
- Modify: `server/modules/agent/tools/perceptionTools.ts`
- Modify: `server/modules/debugging/*`
- Modify: `src/application/ports/ParameterRepository.ts`
- Modify: `src/infrastructure/http/parameterClient.ts`
- Modify: `src/domain/parameters/initialization.ts`
- Modify: `src/application/parameters/exportProjectParametersExcel.ts`
- Remove after replacement: legacy flat DTO and fallback helpers

- [ ] **Step 1: Write a repository-wide failing guard test**

```ts
it("has no production dependency on legacy parameter identity", async () => {
  const forbidden = ["recommended_value", "source_node_path as parameter", "DTS_IDENTITY_FALLBACK_MODE"];
  for (const token of forbidden) expect(await productionSourceContains(token)).toBe(false);
});
```

Allow legacy tokens only in migrations, cutover, migration evidence tests, and archive documentation.

- [ ] **Step 2: Verify failure**

Run: `npm run test:server -- server/modules/parameter-topology/legacyDependencyGuard.test.ts --run`
Expected: FAIL listing current repositories and DTOs.

- [ ] **Step 3: Move dashboards, Agent perception, export, initialization, and debugging references**

All consumers query specs/bindings. Export uses property key, driver module, instance, locator, effective value, and schema version in separate columns. Initialization uses policy target or schema default; example value remains informational.

- [ ] **Step 4: Remove legacy route contracts and fallback identity**

Remove the old flat list payload and `(name,module)` fallback. Requests containing a legacy parameter ID return a stable `410 legacy-parameter-id-retired` diagnostic with the migration evidence lookup ID, not a compatibility projection.

- [ ] **Step 5: Update mocks**

Mock mode may use a small semantic fixture, but production builds and API mode cannot import legacy mock parameter data as a business source.

- [ ] **Step 6: Run all parameter consumers**

Run: `npm run test:server -- server/modules/parameters server/modules/parameter-files server/modules/parameter-topology server/modules/parameter-specs server/modules/agent/tools/perceptionTools.test.ts server/modules/debugging --run`
Expected: PASS.
Run: `npm test`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server src
git commit -m "refactor(parameters): retire flat parameter identity"
```

### Task 16: Add browser acceptance and responsive evidence

**Files:**
- Create: `e2e/acceptance/parameter-topology.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`

- [ ] **Step 1: Register operation IDs**

Add:

```text
PARAM-SPEC-GOVERN-001
PARAM-TOPOLOGY-BROWSE-001
PARAM-TOPOLOGY-EDIT-001
PARAM-IDENTITY-MAP-001
PARAM-CONFIG-PUBLISH-GATE-001
```

- [ ] **Step 2: Write failing acceptance cases**

Cover spec search/review, effective/source toggle, two `gpio_int` results, typed edit, stale edit, unresolved mapping, compiler error, successful approval/publish, API/DB/audit assertions, and semantic persistence after reload.

- [ ] **Step 3: Run focused acceptance**

Run: `npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts`
Expected before final UI wiring: FAIL; after Tasks 12–15: PASS.

- [ ] **Step 4: Run required manual browser verification**

```bash
playwright-cli -s=parameter-topology open http://127.0.0.1:5174/parameters
playwright-cli -s=parameter-topology resize 1440 900
playwright-cli -s=parameter-topology snapshot
playwright-cli -s=parameter-topology screenshot --filename=work/ui-checks/parameter-topology-desktop.png
playwright-cli -s=parameter-topology resize 768 1024
playwright-cli -s=parameter-topology snapshot
playwright-cli -s=parameter-topology screenshot --filename=work/ui-checks/parameter-topology-tablet.png
playwright-cli -s=parameter-topology resize 390 844
playwright-cli -s=parameter-topology snapshot
playwright-cli -s=parameter-topology screenshot --filename=work/ui-checks/parameter-topology-mobile.png
playwright-cli -s=parameter-topology console error
playwright-cli -s=parameter-topology close
```

Exercise real tree selection, mode switch, search, detail, edit, validation, mapping, and publish interactions. Inspect relevant failed network requests.

- [ ] **Step 5: Run coverage/evidence gates**

Run: `npm run acceptance:coverage && npm run acceptance:operations && npm run acceptance:evidence && npm run acceptance:quality`
Expected: PASS with evidence for every new P0/P1 operation ID.

- [ ] **Step 6: Commit**

```bash
git add e2e/acceptance docs/developer/browser-acceptance-coverage-map.md docs/developer/user-operation-coverage-matrix.md
git commit -m "test(parameters): cover semantic topology workflows"
```

### Task 17: Add cutover runbooks, observability, and complete documentation

**Files:**
- Create: `docs/runbooks/parameter-identity-cutover.md`
- Create: `docs/zh-CN/runbooks/parameter-identity-cutover.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `ARCHITECTURE.md` and Chinese companion
- Modify: `docs/design-docs/domain-model.md` and Chinese companion
- Modify: `docs/design-docs/api-contract.md` and Chinese companion
- Modify: `docs/FRONTEND.md` and Chinese companion
- Modify: `docs/SECURITY.md` and Chinese companion
- Modify: `docs/RELIABILITY.md` and Chinese companion
- Modify: `docs/developer/local-development.md` and Chinese companion
- Modify: `docs/developer/environment-variables.md` and Chinese companion
- Modify: `docs/developer/verification-matrix.md` and Chinese companion
- Modify: `docs/product-specs/prototype-functional-spec.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `docs/PLANS.md` and `docs/zh-CN/PLANS.md`
- Modify: observability metric definitions and dashboards

- [ ] **Step 1: Write the operator runbook**

The runbook must contain exact commands for write freeze, DB/object snapshot IDs, toolchain health, dry-run, ambiguity/spec backlog checks, compile-all, `--apply`, postflight, application switch, observation window, and whole-snapshot restore. It must explicitly forbid partial continuation after a failed apply.

- [ ] **Step 2: Add metrics and alerts**

Expose parse/schema/compile latency and failures, open mapping tasks, open spec reviews, toolchain versions, publish result, and migration/cutover status. Alert on toolchain unavailable, persistent mapping backlog, and production publish validation bypass.

- [ ] **Step 3: Update all durable contracts**

Document source vs effective tree, spec/binding IDs, example/default/policy/effective value split, v2 API, production fail-closed mode, retired legacy API, and maintenance rollback.

- [ ] **Step 4: Close or supersede old DTS plans/debt**

Move completed `2026-07-15-dts-hardening-closeout.md` and `2026-07-15-parameter-import-wizard-td035.md` when their gates are truly complete. Record this plan as the replacement for path-derived identity and optional production schema validation debt.

- [ ] **Step 5: Run documentation and operations checks**

Run: `npm run docs:check && npm run observability:check && npm run selfhost:check && git diff --check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md CONTRIBUTING.md ARCHITECTURE.md docs ops
git commit -m "docs(parameters): add semantic cutover operations"
```

### Task 18: Execute the full verification and rehearsal gate

**Files:**
- Update: this plan’s checkboxes and evidence references
- Update: `docs/generated/acceptance-operation-evidence.md` through repository commands
- Update: cutover rehearsal evidence path named by the runbook

- [ ] **Step 1: Run static and unit gates**

```bash
npm run contract:check
npm run test:all
npm run build
npm run docs:check
```

Expected: all PASS.

- [ ] **Step 2: Run DTS and seed gates**

```bash
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run db:seed:m1
npm run db:seed:m1
```

Expected: real tool versions recorded, all three effective DTBs pass, double seed is idempotent, and all 170 bindings are correctly named and schema-bound.

- [ ] **Step 3: Run migration rehearsal**

Restore a production-scale non-customer snapshot, run dry-run, take the maintenance snapshot, run apply/cutover, verify 100% mapping and all config compilations, then restore the maintenance snapshot and prove the old release still starts. Repeat from the same initial snapshot and compare deterministic IDs/checksums.

- [ ] **Step 4: Run browser and acceptance gates**

```bash
npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:evidence
npm run acceptance:a11y
npm run acceptance:responsive
npm run acceptance:visual
```

Expected: PASS with desktop/tablet/mobile screenshots and no unexpected console or network errors.

- [ ] **Step 5: Review the final diff and commit evidence**

Confirm no legacy production query, no `recommendedValue` business field, no unresolved mapping/spec task, no release bypass, no secret/source leakage in logs, and no unrelated worktree changes.

```bash
git add docs/generated docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md
git commit -m "test(parameters): prove semantic identity cutover"
```

---

## Documentation Impact Matrix

| Area | Exact paths | Action |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md`, Chinese companions | Update architecture links; no AGENTS workflow change |
| Planning | this plan, `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, tech-debt tracker | Update |
| Product truth | `docs/product-specs/prototype-functional-spec.md` | Update parameter workflows and terminology |
| Domain/API | `docs/design-docs/domain-model.md`, `api-contract.md` and Chinese companions | Update entities, state machine, v2 routes |
| Frontend | `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` | Update source/effective topology and semantic ports |
| Security | `docs/SECURITY.md` and `docs/zh-CN/SECURITY.md` | Update untrusted compilation, audit, migration |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/parameter-identity-cutover.md` and Chinese companions | Update |
| Developer setup/env | local development, environment variables, verification matrix and Chinese companions | Update pinned toolchain and gates |
| Quality/acceptance | coverage map, operation matrix, acceptance specs | Update |
| Generated artifacts | `docs/generated/db-schema.md`, OpenAPI, acceptance evidence | Regenerate/update |
| References | `docs/references/productization-api-contract-draft.md` | Review and update if it still describes flat identity |
| README/CONTRIBUTING | root setup commands and DTS prerequisites | Update |

## Documentation Update Gate

- [ ] Every `Update` row has matching English/Chinese changes where a human-facing companion exists.
- [ ] `npm run docs:check` passes.
- [ ] OpenAPI and database schema artifacts match implemented code.
- [ ] Acceptance and operation IDs have generated evidence.
- [ ] Any deferred item is recorded in `docs/exec-plans/tech-debt-tracker.md` with owner and acceptance condition.
- [ ] The plan is moved to `docs/exec-plans/completed/` only after target migration rehearsal and all evidence gates pass.

## Spec coverage self-review

| Design requirement | Tasks |
| --- | --- |
| Full config set, include/base/overlay | 1, 3, 5, 8 |
| Source occurrences and effective topology | 2, 3, 4, 5 |
| Versioned driver/property specs | 4, 6 |
| Deterministic identity and mapping queue | 7, 9 |
| Example/default/policy/effective split | 4, 6, 7, 10, 14, 15 |
| Parameter library and project topology UI | 11–13 |
| Typed edit, minimal writeback, review | 2, 10 |
| Fail-closed dtc/fdtoverlay/dt-schema | 8, 9, 10 |
| Full historical migration and evidence | 14, 15 |
| Maintenance window and whole rollback | 14, 17, 18 |
| Golden 170-property acceptance | 1, 6, 18 |
| JSON/manual common identity only | 4, 14, 15 |
| Browser responsiveness and evidence | 12, 13, 16, 18 |

No production feature may be declared complete from unit tests alone. The terminal gate is a successful non-customer maintenance rehearsal, whole-snapshot rollback proof, and real browser/toolchain acceptance.
