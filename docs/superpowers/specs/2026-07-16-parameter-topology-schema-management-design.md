# Topology- and Schema-Aware Parameter Management — Design Specification

> Chinese: [中文](../../zh-CN/superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)

**Date:** 2026-07-16

**Status:** Design approved in brainstorming; written-spec review pending

**Scope:** Parameter library, project parameter management, DTS configuration sets, schema governance, migration, and compilation validation

**First delivery:** Complete DTS lifecycle; identity-model migration only for JSON and manually maintained parameters

## 1. Summary

WiseEff must stop treating a DTS property path as a parameter name. A path such as:

```text
amba.i2c@FDF5E000.sc8562@6E.gpio_int
```

contains several different concepts:

- `gpio_int` is the property key.
- `sc8562` is the driver/device module.
- `sc8562@6E` is a project-specific device instance.
- `i2c@FDF5E000` and `amba` are topology ancestors.
- `/amba/i2c@FDF5E000/sc8562@6E` is a locator in one effective-tree revision.
- `<&gpio13 29 0>` is the project value.
- Charging → Power IC → Charge Pump is a business-governance classification.

These concepts need independent identities and relations. This specification adopts a four-layer model:

1. Immutable source occurrences and the resolved effective topology.
2. Versioned driver and property specifications.
3. Project instance bindings and effective values.
4. Orthogonal business governance.

The whole DTS configuration set—not an individual file—is the semantic and compilation unit. Production release is fail-closed on deterministic identity resolution, schema validation, reference integrity, and a real `dtc` toolchain pass.

## 2. Evidence and problem statement

The supplied board-level overlay and the current seed implementation were audited. The fixture contains:

- 50 nodes and 170 properties.
- 169 property definitions whose current display name incorrectly includes the full path.
- 24 repeated property keys, including 38 `status`, five `compatible`, four `reg`, and two `gpio_int` occurrences.
- 84 string-list, 61 u32-array, 11 mixed, six phandle-list, five byte, two boolean, and one empty value.
- 28 external overlay targets without a local `compatible`.
- 18 phandle references, of which 12 depend on the base tree.
- 14 candidate string-table references, including nine unresolved in the standalone file.

The structural parser already retains node names and unit addresses. The data loss happens later: seed derivation turns the complete property path into `name` and derives `module` from path keywords. The frontend contract remains a flat `name/module/sourceNodePath` record, so it cannot represent source occurrences, merged topology, driver identity, or schema identity separately.

Correcting labels in the UI would hide the symptom but leave identity, overlay, history, and writeback unsafe.

## 3. Confirmed decisions

| Topic | Decision |
| --- | --- |
| Target | Complete target architecture with a phased delivery route |
| Shared model | One `ParameterSpec` model with DTS, JSON, and manual source subtypes |
| DTS semantic unit | A complete configuration set containing entry DTS, DTSI/includes, base tree, overlays, order, include paths, and compiler profile |
| Schema source | Linux dt-schema first, organization Vendor Schema extensions second, reviewed manual specifications last |
| Unknown properties | Create an inferred draft with evidence; it cannot be used for release until reviewed |
| Technical vs business module | Driver/device module and business category are orthogonal dimensions |
| Identity ambiguity | Only deterministic matches are accepted; ambiguity creates a manual mapping task and blocks release |
| Governance scope | Platform standards plus organization-level Vendor extensions; projects bind values but do not mutate shared specifications |
| “Recommended value” | Rename to “example value”; separate schema default, policy target, and project effective value |
| Initial format scope | Complete DTS import/manage/edit/export/compile lifecycle; migrate JSON/manual identity without new specialized parsers |
| Historical migration | Replace old IDs in one migration; remap all drafts, changes, approvals, audits, and baselines |
| Cutover | Maintenance window, stopped writes, full validation, atomic switch, whole-system rollback on failure |
| Release gate | All production releases require deterministic mapping, schema validation, reference integrity, and real toolchain success |

## 4. Alternatives considered

### 4.1 Patch the flat model

Split the last path segment into the display name and adjust the frontend. This is inexpensive but keeps path-based identity and cannot safely handle overlays, include graphs, repeated keys, address changes, schema versions, or historical remapping.

### 4.2 Effective-path-centered model

Store an effective node tree and identify parameters by full effective path. This improves navigation and merging, but identity still changes when a node moves, a unit address changes, or an overlay is reorganized. Source-preserving writeback and cross-project specification reuse remain difficult.

### 4.3 Four-layer semantic model

Store source occurrences, effective logical nodes, versioned specifications, project bindings, and business governance separately. This has the largest migration cost but is the only approach that satisfies stable identity, full DTS semantics, precise governance, audit preservation, and compilation validation together.

**Decision:** adopt the four-layer semantic model.

## 5. Goals and non-goals

### 5.1 Goals

- Model full DTS projects, including `/include/`, base DTS/DTSI files, external targets, labels, phandles, and ordered overlays.
- Distinguish property specifications, driver types, device instances, topology locations, source declarations, and business categories.
- Preserve original source for audit and minimal writeback while exposing a resolved effective-tree view.
- Bind known properties to versioned Linux or Vendor Schema definitions.
- Give every project value an explicit source, override chain, validation state, and audit history.
- Integrate reproducible `dtc`, `fdtoverlay`, and dt-schema deployment and release gates.
- Migrate all existing and historical parameter records to the new identity model without a long-lived compatibility projection.

### 5.2 Non-goals for the first delivery

- New specialized parsers or editors for JSON and manually maintained parameters.
- Automatic Git commits, pull requests, or repository webhooks.
- Automatic approval of inferred property specifications.
- Silent repair of invalid values or unresolved references.
- Partial production cutover or permanent dual-write support.

## 6. Architecture

### 6.1 Source and effective-topology layer

`DtsConfigSet` is the smallest buildable and publishable unit. It records:

- project and board variant;
- entry files and member roles;
- include search paths;
- base-tree relation;
- overlay application order;
- optional deterministic preprocessing profile;
- compiler arguments and toolchain profile;
- immutable configuration revisions and release baselines.

Every import creates immutable `SourceFileVersion` records. A lossless parser produces:

- `NodeOccurrence` for each source node or target fragment;
- `PropertyOccurrence` for each declaration, boolean property, override, deletion, or reference;
- source file, line/column span, token range, raw value, parsed AST, and content hash.

The resolver applies includes and overlays to create `LogicalNodeInstance` and effective property values. It retains a provenance chain from every effective node/property to all source occurrences that created, replaced, or deleted it.

Source occurrence IDs are revision-local. Logical node IDs are stable across configuration revisions when deterministic identity evidence proves continuity.

### 6.2 Driver and property specification layer

`ParameterSpec` is the common specification root. Source-specific subtypes provide additional structure:

- DTS: `DriverSchema` and `PropertySpec`.
- JSON: key/path/value-shape metadata.
- Manual: explicitly governed type and constraints.

`DriverSchema` represents a versioned driver or device contract and records its `compatible` patterns, parent/bus constraints, source, ownership, and lifecycle status.

`PropertySpec` is identified by schema namespace, schema version, and property key. It records value shape, units, constraints, references, schema default, example value, documentation, and deprecation status. A property key alone is never a global identity: `SC8562/gpio_int` and `MT5788/gpio_int` are different specifications.

Specification precedence is:

1. Pinned Linux dt-schema version.
2. Pinned organization Vendor Schema extension.
3. Reviewed manual specification.
4. Unreviewed inferred draft, which is non-releasable.

Organization extensions may add vendor properties or narrow permitted policy but cannot silently rewrite a pinned platform schema version. Schema upgrades create new immutable versions and require explicit impact analysis.

### 6.3 Project instance and value-binding layer

`ProjectPropertyBinding` joins:

- a project and configuration revision;
- one `LogicalNodeInstance`;
- one concrete `PropertySpec` version;
- the effective typed value;
- its provenance and override chain;
- schema, policy, and compilation states;
- baseline difference and history.

The full node path is a revision locator, not a primary key. Project-specific facts such as `sc8562@6E`, I²C bus address, GPIO reference, status, and board value live on the instance or binding rather than the shared specification.

The former “recommended value” is removed:

- `exampleValue` illustrates syntax only and is never enforced.
- `schemaDefault` comes from the pinned schema.
- `policyTarget` is organization/product policy and may participate in compliance checks.
- `effectiveValue` is the resolved value in a project configuration revision.

### 6.4 Business-governance layer

`BusinessCategory` is an independent hierarchy. Driver schemas and logical instances can have multiple category associations. Governance metadata includes:

- responsible team and owners;
- risk and sensitivity;
- approval policy;
- permissions;
- applicable validation policies;
- test suites.

This keeps “SC8562 driver” separate from “Charging → Power IC → Charge Pump” while allowing both to drive search and governance.

## 7. Identity resolution

### 7.1 Specification identity

The schema matcher uses, in order:

1. effective `compatible` values;
2. parent bus and schema constraints;
3. node shape and required/allowed properties;
4. pinned schema namespace and version;
5. reviewed explicit organization mapping.

One unique valid result creates a specification binding. Zero results create an inferred specification draft. Multiple valid results create a blocking mapping task.

External overlay targets are never assigned a fabricated driver identity. The resolver waits for the base tree. A configuration set missing the referenced base is incomplete and non-releasable.

### 7.2 Logical instance continuity

Across revisions, the identity engine considers only deterministic evidence:

- reviewed explicit continuity mapping;
- stable parent logical identity;
- unique driver/schema identity;
- `reg` or other schema-declared unique key;
- unit address and topology relation;
- stable explicit identifiers when the schema declares them identity-bearing.

A path, label, display name, or fuzzy score alone cannot establish continuity. If more than one candidate remains, the system creates `IdentityMappingTask` and blocks release until an authorized reviewer selects or creates the correct identity.

Every manual decision stores candidates, evidence, reviewer, reason, time, and affected revisions.

## 8. DTS value model

A DTS value cannot be reduced to an untyped string. `DtsValue` covers:

- boolean presence properties;
- strings and string lists;
- cell arrays with default or explicit `/bits/` width;
- byte arrays;
- phandle references with argument cells;
- multi-segment and mixed expressions;
- string references to named tables;
- empty values;
- property/node deletion and overlay actions.

Each property occurrence stores:

1. **Raw representation:** exact tokens and trivia for audit and unchanged-byte preservation.
2. **Typed AST:** editing, type checking, reference resolution, and rendering.
3. **Canonical representation:** semantic comparison, indexing, policy evaluation, and stable diffs.

Unchanged regions must remain byte-identical during writeback. Changed values are rendered with the existing local style where possible. Semantic equality after reparse is mandatory even when changed text is not byte-identical.

## 9. Component boundaries

| Component | Responsibility | Primary dependencies |
| --- | --- | --- |
| Configuration Set Repository | Files, immutable revisions, member roles, build profiles, baselines | Database, object store |
| Lossless DTS Parser | Source occurrences, token spans, typed AST | Source bytes |
| Effective Tree Resolver | Includes, labels, phandles, overlay/delete semantics, provenance | Parser, configuration manifest |
| Schema Registry | Linux schemas, Vendor extensions, versions, review states | Schema storage |
| Schema Matcher | Driver/property candidate resolution | Effective tree, registry |
| Identity Engine | Cross-revision logical instance continuity and mapping tasks | Effective tree, reviewed mappings |
| Parameter Management Service | Specs, bindings, categories, editing, approvals, search | Domain repositories |
| Validation and Compilation Service | Reference, schema, policy, `dtc`, overlay compilation | Toolchain runner |
| Audit and Release Service | Immutable events, baselines, atomic publication, rollback evidence | All domain services |

Each service exposes typed results and structured diagnostics. Parsers do not approve schemas, UI code does not infer identities, and compilers do not mutate domain state.

## 10. End-to-end data flows

### 10.1 Import and resolution

1. Freeze the configuration manifest and all source bytes into a new immutable revision.
2. Parse every file losslessly into node and property occurrences.
3. Resolve includes, labels, phandles, base targets, overlays, and deletions.
4. Construct the effective logical tree and complete provenance chains.
5. Match driver schemas and property specifications.
6. Resolve logical identities or create blocking mapping tasks.
7. Create project bindings and typed effective values.
8. Run reference, schema, organization-policy, and internal consistency checks.
9. Independently compile the pinned configuration with the real toolchain.
10. Compare internal resolution with compiler-derived results and persist diagnostics and artifact hashes.

The internal parser is the source-mapping and editing engine. `dtc`/`fdtoverlay` are the compilation oracle. Cross-checking prevents the internal implementation from validating itself.

### 10.2 Edit and release

1. A user edits a typed project binding, not a concatenated DTS string.
2. The service validates the value shape and shows target file, occurrence, overlay, and impact.
3. Shared base files are not changed by default; project differences update or create an explicit overlay.
4. A minimal source patch creates a new immutable file/configuration revision.
5. The full resolution and validation pipeline runs again.
6. Successful revisions enter the existing approval workflow.
7. Publication atomically advances the release baseline only after every blocking gate passes.

A failure never overwrites the previous released revision.

## 11. Product information architecture

### 11.1 Parameter library

The parameter library manages specifications. Its primary columns and filters are:

- property key;
- driver/device module;
- `compatible`;
- value type, unit, and constraints;
- schema source and version;
- example value;
- business categories;
- review/deprecation status;
- project and instance usage count.

Unknown or inferred properties appear in a dedicated review queue with evidence, candidate schemas, conflicts, and affected projects.

### 11.2 Project parameters

The project view manages instances and is divided into:

- **Device tree:** real hierarchy such as `amba → i2c@FDF5E000 → sc8562@6E`, with bus, driver, address, status, and validation badges.
- **Property table:** property key, typed effective value, source, schema state, policy state, and baseline difference.
- **Detail panel:** specification, project value, source occurrence, override chain, governance, diagnostics, and history.

Users can switch between:

- **Effective tree:** the final resolved configuration used for management and validation.
- **Source tree:** every DTS/DTSI/overlay occurrence and its line, override, or deletion relation.

Repeated `&amba` fragments remain separate in the source tree and merge into one logical node in the effective tree. Missing base-tree targets show an incomplete-configuration state rather than a guessed hierarchy.

Search covers property key, driver, `compatible`, address, current path, business category, source file, and raw/canonical value. Searching `gpio_int` returns distinct SC8562 and MT5788 bindings.

## 12. Validation state and diagnostics

A configuration revision follows:

```text
draft → resolving → needs-mapping | invalid
      → resolved → validated → compiled → pending-approval → published
```

The following conditions block approval or publication:

- syntax errors or missing include/base members;
- unresolved overlay targets, phandles, or required table references;
- ambiguous driver, property, or logical-instance identity;
- unreviewed inferred specifications;
- type, schema, or blocking organization-policy violations;
- unavailable `dtc`, `fdtoverlay`, or dt-schema tooling;
- compiler errors or policy-configured blocking warnings;
- mismatch between the internal effective tree and toolchain result.

Diagnostics use stable codes and include stage, source file, line/column, logical node, property, severity, original message, and actionable guidance. Warnings are never silently discarded.

Concurrent edits use optimistic revision checks. A stale edit returns a structured conflict and requires a new comparison; last-write-wins is prohibited.

## 13. Toolchain and deployment

The current repository commands remain the public entry points:

- `npm run dtc:bootstrap`
- `npm run dtc:check -- --required`
- `npm run dtc:seed:compile`

The self-hosted Linux runtime image must contain pinned compatible versions of `dtc`, `fdtoverlay`, and dt-schema. Image build and startup health checks report versions. Every validation run records:

- runtime image/build identity;
- compiler and schema tool versions;
- compiler profile and arguments;
- input manifest/content hashes;
- diagnostics and output artifact hash.

Production publication always uses fail-closed `block` behavior. Existing `warn` and `off` modes remain local diagnostic aids only and cannot create a released baseline.

The runner uses an isolated temporary directory, fixed argument construction, a minimal environment, no network assumption, input-size and concurrency limits, a hard timeout, and guaranteed cleanup. Source content is untrusted. Secrets are never inherited by child processes.

Optional deterministic preprocessing is part of the configuration-set compiler profile when a project requires it; its executable, include roots, defines, and version are pinned and audited like `dtc`.

## 14. Migration and cutover

Implementation proceeds in phases, but production data switches once:

1. Build the schema registry, value model, resolver, and mandatory toolchain gates.
2. Build source/effective topology, stable identity, and mapping queues.
3. Build new APIs and product views.
4. Rehearse complete migration in an isolated environment until every ambiguity and compile failure is resolved.
5. Enter a maintenance window, stop writes, migrate, validate, and atomically switch.
6. Monitor the new system; keep legacy tables as restricted audit archives, not active projections.

The migration deduplicates by schema identity rather than source occurrence:

- project SC8562 `gpio_int` occurrences reuse one `PropertySpec` version;
- SC8562 and MT5788 `gpio_int` do not share a specification;
- address, path, and effective value remain project-instance data;
- common keys such as `status` are shared only when a schema explicitly gives them the same specification identity.

All values, drafts, change requests, approvals, audit events, and baselines are remapped. `LegacyMigrationEvidence` preserves old ID, old full name, original locator, original value, source record hash, new IDs, and migration run.

Maintenance-window sequence:

1. Stop parameter writes and take a database/object-store consistency snapshot.
2. Run the final deterministic migration.
3. Verify counts, foreign keys, mapping coverage, historical chains, source hashes, effective trees, schemas, and every configuration compilation.
4. Run the golden-fixture acceptance suite.
5. Switch database schema, API, and frontend in one release action.
6. On any failure, restore the snapshot and old application as a whole.

No partial migrated state is opened to users. The old identity API is retired at cutover after client inventory and migration rehearsals prove there are no remaining consumers.

## 15. Testing and acceptance

### 15.1 Unit and contract tests

- Parser coverage for every supported DTS value and overlay construct.
- Include, base-tree, label, phandle, override, and delete resolution.
- Schema precedence and immutable version behavior.
- Deterministic identity, ambiguous candidates, and reviewed mappings.
- Raw/AST/canonical transformations and minimal patch rendering.
- Authorization, approval, audit, optimistic locking, and diagnostic contracts.

### 15.2 Golden fixture

The supplied DTS is a permanent golden fixture. Acceptance requires:

- all 50 nodes and 170 properties retained;
- every property display name is the property key, not the full path;
- SC8562 and MT5788 `gpio_int` bind to distinct specifications;
- repeated `&amba` occurrences merge correctly;
- all 18 phandles, repeated keys, and table references resolve or yield an explicit blocking diagnostic;
- three seeded projects contain intentional, schema-valid differences.

### 15.3 End-to-end and real tooling

The required path is:

```text
import → resolve → bind schema → edit → minimal writeback
       → re-resolve → dt-schema/dtc compile → approve → publish → export
```

Unchanged source remains byte-identical. Changed output must reparse to a semantically equivalent effective tree and compile with the real Linux toolchain. CI uses the deployment toolchain rather than only stubs.

Migration rehearsal requires 100% legacy-record mapping, intact historical and approval chains, deterministic results from the same snapshot, clean injected-failure rollback, and successful old-system recovery.

Frontend-visible work requires real API browser acceptance at 1440×900, 768×1024, and 390×844. It covers the library, source/effective tree switch, search, inferred-spec review, identity mapping, typed editing, compiler errors, approval, and publication blocking, with snapshots, screenshots, console checks, and relevant network checks.

## 16. Observability and security

Operational metrics include:

- parse, schema-validation, and compilation latency;
- stage failure rates and diagnostic codes;
- unresolved identity task count;
- inferred specification backlog;
- toolchain health and version drift;
- publication success and rollback count.

Logs contain diagnostic excerpts and hashes, not complete sensitive source files. All specification approval, mapping, edit, validation, baseline, publication, and migration operations create immutable audit events. Server-side authorization applies to organization schema overrides, project edits, mapping approval, and publication.

## 17. Success criteria

The first delivery is complete only when:

1. The golden 170-property DTS fixture satisfies every structural and identity assertion.
2. Source-tree and effective-tree views agree with resolver provenance.
3. Ambiguity, incomplete configuration, unreviewed specs, and tool unavailability block production publication.
4. Exported project configuration passes the repository-integrated real toolchain.
5. Historical records are fully remapped and retain immutable original-path/value evidence.
6. JSON and manual parameters use the new common identity root without claiming unsupported parsing features.
7. Production no longer reads or writes the legacy flat parameter identity model.

## 18. Resolved scope

There are no unresolved design decisions in this specification. Detailed database columns, API routes, implementation file boundaries, migration command sequencing, and task-level verification commands belong in the implementation plan produced after written-spec approval.
