# WiseEff Complex Debug Node Values Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade debugging-node catalog and runtime read/write workflows from scalar-only node values to scalar and complex values, aligned with the existing complex-parameter experience.

**Architecture:** Keep debugging parameters as the governed business catalog and HDC/ADB bindings as protocol execution metadata. Add an explicit debug value model that describes value kind, format, normalization, validation, and write/readback behavior. The first implementation phase supports single-node complex text/JSON/DTS values end to end; multi-node aggregate values are modeled as an extension point, not implemented as a device-write workflow until a concrete hardware contract exists.

**Tech Stack:** TypeScript, PostgreSQL migrations, Zod, WiseEff modular API router, React/Vite, Vitest, Testing Library, Playwright acceptance, HDC/ADB gateway adapters.

---

## Problem Statement

Debugging-node management currently has the same limitation that parameter management already solved: it assumes one debug parameter is one scalar node value.

Current evidence:

- Parameter management has `valueKind: "scalar" | "complex"` and UI/domain behavior for complex DTS or multiline values in `src/domain/parameters/types.ts`, `src/parameterValueKind.ts`, `src/components/ParameterDraftDialog.tsx`, `src/components/ParameterDetailDialog.tsx`, and admin definition/value dialogs.
- Debugging catalog types in `src/domain/debugging/types.ts` expose `currentValue`, `targetValue`, `nodePath`, and `accessMode`, but no value kind, format, codec, or complex editor metadata.
- Runtime port types in `src/application/ports/DebuggingGateway.ts` and backend gateway types in `server/modules/debugging/gateway.ts` carry `value: string` and operation fields such as `requestedValue`, `previousValue`, `readbackValue` as strings.
- Backend schemas in `server/modules/debugging/schemas.ts` validate `writeNodeBodySchema.value` as a non-empty string and range-check only numeric scalar parameters in `server/modules/debugging/service.ts`.
- HDC/ADB gateways write with remote shell `printf %s '<value>' > '<nodePath>'` and read with `cat`; current read normalization trims stdout, which can corrupt or miscompare multiline and whitespace-sensitive complex values.
- Snapshot rollback entries in `server/modules/debugging/types.ts` store `previousValue` and `targetValue` as strings, so rollback evidence cannot express structured or aggregate value semantics.

The visible user impact is that `/debugging-admin` and `/node-debugging` can manage simple numeric/string nodes, but they cannot safely define, validate, preview, compare, write, audit, or roll back complex node payloads such as DTS fragments, JSON blobs, multiline lists, bitfield maps, or future multi-node grouped values.

## Recommended Approach

Use a staged value-model upgrade.

### Phase 1: Single-Node Complex Values

Add first-class metadata to debugging parameters:

- `valueKind`: `scalar | complex`
- `valueFormat`: `raw | json | dts | line-list | kv-list`
- `normalizationMode`: `exact | trim | line-ending-normalized | json-canonical`
- `maxValueBytes`: optional safety cap for writes and audit storage

In Phase 1, a complex debug parameter still resolves to exactly one enabled HDC or ADB node binding. The UI uses multiline/code editors and diff-style display, while the backend keeps the same authorization, lease, snapshot, write, readback, and audit boundary.

This is the recommended first step because it directly fixes the current user-facing gap while preserving the existing node binding and runtime safety model.

### Phase 2: Codec-Aware Gateway Writes

Teach HDC/ADB adapters to preserve complex payloads correctly:

- Stop trimming raw read values before comparison when the parameter uses exact or line-ending normalization.
- Add a canonicalization helper shared by service tests and gateway tests.
- For multiline values, prefer a robust remote write strategy that does not depend on shell interpolation semantics. Candidate strategies:
  - direct stdin-to-remote command where supported by the protocol;
  - base64 payload decode on device when available;
  - current `printf` path only for safe scalar/raw text with explicit escaping tests.

Phase 2 can ship with Phase 1 if the initial complex formats include multiline writes. If Phase 1 is limited to read-only or single-line JSON/raw values, Phase 2 can follow immediately after.

### Phase 3: Multi-Node Aggregate Values

Introduce aggregate debug values only after a real device contract exists. Model them as a new binding shape rather than squeezing them into one `nodePath`:

- `bindingKind`: `single-node | node-group`
- `groupBindings`: ordered child nodes with key, path, access mode, required flag, and value selector
- `valueFormat`: `json` for the aggregate payload
- service-level transactional semantics: snapshot all child nodes before writing any child node, write in deterministic order, read back all required children, and mark partial failure explicitly

This phase is intentionally not part of the first implementation because partial multi-node writes raise rollback and safety questions that are larger than the current scalar parity gap.

## Target Product Behavior

- Admin users can mark a debug parameter as scalar or complex in `/debugging-admin`.
- Complex debug parameters show format and normalization hints beside the HDC/ADB binding coverage.
- Admin creation/edit dialogs use multiline code-style editors for complex current and target values.
- `/node-debugging` renders complex values in readable code blocks, not narrow table cells.
- Editing a complex write opens a wide modal or sheet with current value, target value, normalization mode, and readback comparison.
- Readback comparison is format-aware:
  - scalar values keep current numeric/range behavior;
  - raw/DTS/list values can preserve line endings or normalize CRLF/LF;
  - JSON values compare canonical JSON when `json-canonical` is selected.
- Operation history and audit records show a redacted/size-capped value preview plus a digest for large complex values.
- Snapshot rollback preserves the exact previous payload required to restore a complex node.
- RO complex values can be read and inspected even when writing is not allowed.
- WO complex values can be written with no readback, but the UI must state that verification is unavailable.

## Non-Goals

- Do not change parameter-management M1 tables or review workflows.
- Do not add arbitrary node-path input to `/node-debugging`.
- Do not let frontend validation become the security boundary; server-side authz, range/format validation, lease, snapshot, readback, and audit remain required.
- Do not implement multi-node aggregate writes until a hardware contract names actual child nodes and rollback expectations.
- Do not expose raw node paths to normal debugging users beyond existing admin/governance surfaces.

## Data Model

### Backend Records

Add columns to `debugging_parameters` in a new migration, likely `0020_complex_debug_node_values.sql`:

- `value_kind text not null default 'scalar' check (value_kind in ('scalar', 'complex'))`
- `value_format text not null default 'raw' check (value_format in ('raw', 'json', 'dts', 'line-list', 'kv-list'))`
- `normalization_mode text not null default 'trim' check (normalization_mode in ('exact', 'trim', 'line-ending-normalized', 'json-canonical'))`
- `max_value_bytes integer`

Optional later columns for Phase 3:

- `binding_kind text not null default 'single-node'`
- `aggregate_schema jsonb`

Do not change `debugging_parameter_node_bindings` for Phase 1 except to document that a complex parameter still has one selected node binding per protocol.

### Operation And Snapshot Records

Phase 1 can preserve existing text columns for compatibility, but should add structured metadata:

- `node_operations.value_kind`
- `node_operations.value_format`
- `node_operations.normalization_mode`
- `node_operations.requested_value_digest`
- `node_operations.previous_value_digest`
- `node_operations.readback_value_digest`
- `node_operations.value_preview`

If migration scope permits, add JSONB value envelopes instead of only digests:

```ts
type DebugValueEnvelope = {
  kind: "scalar" | "complex";
  format: "raw" | "json" | "dts" | "line-list" | "kv-list";
  normalization: "exact" | "trim" | "line-ending-normalized" | "json-canonical";
  raw: string;
  canonical?: string;
  digest: string;
  bytes: number;
  preview: string;
};
```

Snapshots should store enough exact data to roll back:

```ts
type DebugSnapshotEntry = {
  parameterId: string;
  protocol?: DebugConnectionProtocol;
  nodePath: string;
  previousValue: string;
  targetValue: string;
  valueKind?: "scalar" | "complex";
  valueFormat?: "raw" | "json" | "dts" | "line-list" | "kv-list";
  normalizationMode?: "exact" | "trim" | "line-ending-normalized" | "json-canonical";
  previousDigest?: string;
  targetDigest?: string;
};
```

## API Contract

Runtime parameter DTOs should include:

```ts
type DebugParameterDto = {
  // existing fields
  valueKind?: "scalar" | "complex";
  valueFormat?: "raw" | "json" | "dts" | "line-list" | "kv-list";
  normalizationMode?: "exact" | "trim" | "line-ending-normalized" | "json-canonical";
  maxValueBytes?: number | null;
};
```

Admin write DTOs should accept the same fields and validate combinations:

- `valueKind = scalar` defaults to `valueFormat = raw`, `normalizationMode = trim`.
- `valueFormat = json` requires JSON parse validation for non-empty complex target values.
- `normalizationMode = json-canonical` requires `valueFormat = json`.
- `maxValueBytes` must be positive and must cap write payload size server-side.

`POST /api/v1/debugging/nodes/write` can keep `value: string` in Phase 1, but the service must interpret it through the parameter's value metadata after resolving `parameterId`.

## Frontend Design

### Shared Value Helpers

Create a debugging equivalent of `src/parameterValueKind.ts`:

- `src/debugValueKind.ts`
- `isComplexDebugParameter(parameter)`
- `debugValueEditorRows(value, minRows)`
- `getDebugValueFormatLabel(parameter)`
- `normalizeDebugValue(value, metadata)`
- `compareDebugValues(left, right, metadata)`

Where practical, share pure normalization logic between frontend and backend tests by keeping the rules small and deterministic.

### `/debugging-admin`

Update admin dialogs:

- Definition dialog adds value kind and format controls near current/target value fields.
- Scalar mode keeps compact inputs and numeric min/max range validation.
- Complex mode uses multiline monospaced textareas with `wrap="off"`.
- JSON mode validates syntax before save and shows inline parse errors.
- The catalog table gains a compact `值类型` or `格式` column/badge.
- Binding dialog remains focused on HDC/ADB node paths and access modes; it should not own value format metadata.

### `/node-debugging`

Update runtime editing:

- Table cells show a compact preview for complex values and an action to inspect/edit in a wide modal.
- The edit modal mirrors complex parameter draft behavior: current block, target block, reason/status area, and readback comparison.
- Operation history shows a preview and digest for complex values. It should not flood the timeline with full payloads.
- Read-only complex nodes can be inspected in a wide details view.

## Backend Service Rules

- Resolve parameter metadata before validating a write.
- Keep current numeric range validation only for scalar/ranged parameters.
- Validate complex payload size with `maxValueBytes` or a conservative default.
- Validate JSON payloads when `valueFormat = json`.
- Compute canonical value and digest before writing.
- Read pre-write value without destructive trimming for complex/exact parameters.
- Snapshot exact previous payload before write.
- Compare readback using metadata-aware normalization, not raw string equality for every format.
- Update `debugging_parameters.current_value` and `target_value` only after a verified successful write, or after WO writes according to existing write-only semantics.
- Audit should include preview, byte length, digest, format, normalization mode, and verification result. Raw large payloads should be omitted or capped.

## Gateway Rules

HDC and ADB adapters must gain tests for:

- single-line scalar values with the existing path;
- JSON containing quotes and braces;
- multiline values containing LF and trailing newline;
- DTS-like values containing angle brackets, semicolons, tabs, and quotes;
- values containing single quotes;
- readback equality under exact, trim, line-ending-normalized, and JSON-canonical modes.

If current `printf %s '<value>' > '<nodePath>'` cannot preserve the required formats in a target shell, implement a safer write strategy before enabling complex writes for RW/WO parameters.

## File Structure

Create:

- `server/migrations/0020_complex_debug_node_values.sql`: value metadata columns and optional operation metadata columns.
- `server/modules/debugging/valueCodec.ts`: backend normalization, JSON canonicalization, digest, preview, and payload-size helpers.
- `server/modules/debugging/valueCodec.test.ts`: scalar/complex normalization and comparison tests.
- `src/debugValueKind.ts`: frontend value-kind helpers and editor row sizing.
- `src/debugValueKind.test.ts`: frontend helper tests.

Modify:

- `server/modules/debugging/types.ts`: add value metadata to parameter, operation, and snapshot types.
- `server/modules/debugging/schemas.ts`: admin/runtime DTO validation for value metadata and complex payload constraints.
- `server/modules/debugging/repository.ts`: map metadata columns; store operation digests/previews if added.
- `server/modules/debugging/service.ts`: metadata-aware write validation, snapshot, readback comparison, audit metadata, and rollback.
- `server/modules/debugging/hdcGateway.ts`, `server/modules/debugging/adbGateway.ts`: preserve complex values and avoid unsafe trimming/escaping assumptions.
- `server/modules/debugging/simulator.ts`: seed at least one scalar and one complex node.
- `src/domain/debugging/types.ts`: add `valueKind`, `valueFormat`, `normalizationMode`, and `maxValueBytes`.
- `src/application/ports/DebuggingGateway.ts`: expose operation metadata/digests/previews where useful.
- `src/application/debugging/debuggingRuntime.ts`: preserve complex values during refresh, write, and operation hydration.
- `src/infrastructure/http/debuggingDtos.ts`: map runtime metadata.
- `src/infrastructure/http/debuggingAdminDtos.ts`: map admin metadata.
- `src/components/admin/DebugParameterDefinitionDialog.tsx`: value kind/format controls and complex editors.
- `src/components/admin/DebugParameterLibraryTable.tsx`: value type/format badge.
- `src/NodeDebuggingPage.tsx`: complex preview, wide edit/inspect modal, metadata-aware comparison text.
- `src/styles.css`: complex debug value editor, code block, preview, and wide modal styles.
- `e2e/acceptance/debugging-simulator.acceptance.spec.ts`: simulator complex read/write evidence.
- `e2e/acceptance/debugging-admin.acceptance.spec.ts`: admin complex value definition evidence.
- `e2e/acceptance/operationMatrix.ts`: update existing debugging operation descriptions or add a focused complex-value acceptance ID if needed.
- Documentation files listed in the Documentation Impact Matrix.

## Task Breakdown

### Task 1: Value Model Contract

- [x] Add backend value-kind constants and TypeScript types.
- [x] Add frontend domain metadata fields with scalar defaults.
- [x] Write DTO mapper tests proving legacy API responses default to scalar/raw/trim.
- [x] Add migration `0020_complex_debug_node_values.sql`.
- [x] Update `docs/generated/db-schema.md`.

### Task 2: Codec And Comparison Rules

- [x] Write backend tests for scalar trim, exact raw, line-ending normalization, and JSON canonical comparison.
- [x] Implement `server/modules/debugging/valueCodec.ts`.
- [x] Add frontend helper tests for complex editor rows and format labels.
- [x] Implement `src/debugValueKind.ts`.
- [x] Verify invalid JSON fails before gateway writes.

### Task 3: Admin UI And API Metadata

- [x] Update admin schemas and repository mapping for value metadata.
- [x] Add `/debugging-admin` tests for creating/editing a complex JSON or DTS debug parameter.
- [x] Add complex editors and value-format badges to admin UI.
- [x] Verify mock mode preserves value metadata in `power-management.json` serialization.

### Task 4: Runtime Read/Write Semantics

- [x] Update service write validation to use value metadata.
- [x] Add service tests for complex write success, JSON validation failure, readback mismatch after normalization, and high-risk complex confirmation.
- [x] Add snapshot rollback tests for complex previous payload restoration.
- [x] Add audit metadata tests proving digest/preview is recorded and large raw payloads are capped.

### Task 5: Gateway Preservation

- [x] Add HDC gateway tests for quotes, multiline values, and DTS-like payloads.
- [x] Add ADB gateway tests for the same payloads.
- [x] Implement safer write strategy if existing remote `printf` behavior cannot satisfy tests.
- [x] Keep scalar HDC/ADB behavior unchanged.

### Task 6: `/node-debugging` Complex UX

- [x] Add UI tests for complex read-only display.
- [x] Add UI tests for complex writable edit modal and readback comparison.
- [x] Add operation-history preview/digest rendering.
- [x] Verify desktop/tablet/mobile layouts with `playwright-cli`.

### Task 7: Acceptance And Documentation

- [x] Update or add acceptance coverage for complex debug values.
- [x] Run targeted frontend/backend tests.
- [x] Run `npm run build`.
- [x] Run documentation checks.
- [x] Update the Documentation Update Gate Evidence section.
- [ ] Move this plan to completed only after verification and docs gates are satisfied.

## Acceptance Coverage Impact

Existing affected requirement IDs:

- `DEBUG-SIM-001`: simulator read/write/mismatch/rollback path should include one complex value fixture.
- `DEBUG-ADMIN-001`: admin catalog create/edit/bind/archive path should include value metadata editing.
- `HDC-LAB-001`: review whether real HDC lab can safely include a read-only complex value check.
- `ADB-LAB-001`: review whether real ADB lab can safely include a read-only complex value check.

Potential new requirement ID:

- `DEBUG-COMPLEX-001`: complex debug value read/edit/write/readback/rollback path in simulator mode.

Recommendation: add `DEBUG-COMPLEX-001` only if the implementation adds a distinct browser flow or wide complex editor that is not sufficiently covered by `DEBUG-SIM-001` and `DEBUG-ADMIN-001`.

Affected specs:

- `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- `e2e/acceptance/debugging-admin.acceptance.spec.ts`
- conditional review for `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`
- conditional review for `e2e/acceptance/adb-device-lab.acceptance.spec.ts`

Operation evidence impact:

- `npm run acceptance:evidence` must preserve existing debugging evidence and include complex value shape metadata without leaking full large payloads, raw node paths beyond allowed admin evidence, device serials, session ids, operation ids, or request ids.

## Verification Plan

Targeted backend:

```bash
npm run test:server -- server/modules/debugging/valueCodec.test.ts
npm run test:server -- server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
npm run test:server -- server/modules/debugging/hdcGateway.test.ts server/modules/debugging/adbGateway.test.ts server/modules/debugging/simulator.test.ts
```

Targeted frontend:

```bash
npm test -- src/debugValueKind.test.ts src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingAdminDtos.test.ts
npm test -- src/DebuggingAdminPage.test.tsx src/components/admin/DebugParameterDefinitionDialog.test.tsx src/NodeDebuggingPage.test.tsx
```

Build and docs:

```bash
npm run build
npm run docs:check
```

Browser verification for frontend-visible work:

```bash
npm run dev
playwright-cli -s=complex-debug open http://127.0.0.1:5173/debugging-admin
playwright-cli -s=complex-debug resize 1440 900
playwright-cli -s=complex-debug snapshot
playwright-cli -s=complex-debug screenshot --filename=work/ui-checks/complex-debug-admin-desktop.png
playwright-cli -s=complex-debug resize 768 1024
playwright-cli -s=complex-debug snapshot
playwright-cli -s=complex-debug screenshot --filename=work/ui-checks/complex-debug-admin-tablet.png
playwright-cli -s=complex-debug resize 390 844
playwright-cli -s=complex-debug snapshot
playwright-cli -s=complex-debug screenshot --filename=work/ui-checks/complex-debug-admin-mobile.png
playwright-cli -s=complex-debug open http://127.0.0.1:5173/node-debugging?project=aurora
playwright-cli -s=complex-debug resize 1440 900
playwright-cli -s=complex-debug snapshot
playwright-cli -s=complex-debug screenshot --filename=work/ui-checks/complex-node-debugging-desktop.png
playwright-cli -s=complex-debug resize 390 844
playwright-cli -s=complex-debug snapshot
playwright-cli -s=complex-debug screenshot --filename=work/ui-checks/complex-node-debugging-mobile.png
playwright-cli -s=complex-debug console error
playwright-cli -s=complex-debug close
```

Acceptance:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/debugging-admin.acceptance.spec.ts
```

## Open Decisions

- Whether Phase 1 should support complex writes immediately, or ship complex read/admin modeling first and gate writes behind gateway preservation tests.
- Whether complex value metadata should be shared with parameter-management `ParameterValueKind`, or stay debugging-specific to avoid coupling two domains with different safety rules.
- Whether operation records should add JSONB value envelopes now, or add digest/preview metadata while retaining text columns for the exact rollback payload.
- Whether real HDC/ADB device-lab checks should exercise complex read-only fixtures, complex writes, or no complex fixtures until hardware owners nominate safe nodes.

Recommended defaults:

- Support complex writes only after HDC/ADB preservation tests pass.
- Keep debugging-specific value metadata, while reusing UI patterns from complex parameters.
- Add digest/preview metadata in Phase 1; consider JSONB envelopes if migration risk is acceptable.
- Keep real device labs read-only for complex values until a safe writable node is approved.

## Documentation Impact Matrix

| Area | Status | Files | Required action |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/zh-CN/README.md` | Review after implementation; update only if new durable architecture or module map entries are needed. |
| Planning docs | Update | `docs/exec-plans/active/2026-06-23-wiseeff-complex-debug-node-values.md`, `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Keep this active plan current; update plan indexes if the active plan list is maintained manually. |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | Review debugging prototype wording for complex values; update if user-visible workflow changes materially. |
| Architecture docs | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `ARCHITECTURE.md`, `docs/zh-CN/root/ARCHITECTURE.md` | Document value metadata, API fields, snapshot/audit semantics, and keep top-level architecture unchanged unless needed. |
| Quality/testing docs | Update | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Add or update complex debug value coverage and operation evidence expectations. |
| Reliability/runbooks | Review | `docs/runbooks/hdc-device-lab.md`, `docs/zh-CN/runbooks/hdc-device-lab.md`, `docs/runbooks/adb-device-lab.md`, `docs/zh-CN/runbooks/adb-device-lab.md` | Review whether complex device-lab fixtures or safe-node guidance are needed. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/README.md`, `docs/zh-CN/security/README.md` | Document complex payload audit redaction, digest evidence, write caps, and preserved device-write approval boundary. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document complex debug value metadata, admin UI, runtime UI, and mock/API parity. |
| Generated artifacts | Update | `docs/generated/db-schema.md` | Update after migration `0020`. |
| References | Review | `docs/references/`, `docs/zh-CN/` indexes | Review after docs update; update only if links or compact references become stale. |
| Environment variables | Review | `.env.example`, `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md` | No new env vars expected unless gateway write strategy needs a feature flag or payload cap override. |

## Documentation Update Gate

This plan cannot move to `docs/exec-plans/completed/` until every `Update` and `Review` row in the matrix is resolved.

Blocking evidence required before completion:

- Domain model docs updated in English and Chinese.
- API contract docs updated in English and Chinese.
- Frontend docs updated in English and Chinese.
- Security docs updated in English and Chinese.
- Testing/acceptance docs updated in English and Chinese.
- Generated DB schema updated after migration.
- Device-lab runbooks reviewed and updated or recorded unchanged.
- Environment-variable docs reviewed and updated or recorded unchanged.
- `npm run docs:check` passes, or direct equivalent doc-check commands pass with any sandbox-specific blocker recorded.

## Documentation Update Gate Evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Repository maps (`AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/zh-CN/README.md`) | Reviewed unchanged | No new top-level module map entries; debugging remains under existing M3 surfaces. |
| Planning docs | Updated | This plan Task 7 evidence; `docs/PLANS.md` and `docs/zh-CN/PLANS.md` unchanged (active plan entry already present). |
| Product specs | Reviewed unchanged | Complex debug values extend existing debugging workflows without changing MVP scope statements. |
| Architecture docs | Updated | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`; `ARCHITECTURE.md` and `docs/zh-CN/root/ARCHITECTURE.md` reviewed unchanged. |
| Quality/testing docs | Updated | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`. |
| Reliability/runbooks (`hdc-device-lab`, `adb-device-lab`) | Reviewed unchanged | No safe writable complex device-lab fixture nominated; labs remain scalar/read-only smoke. |
| Security/governance docs | Updated | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`; `docs/security/README.md` and `docs/zh-CN/security/README.md` reviewed unchanged (parent docs carry the new redaction/digest guidance). |
| Frontend/design docs | Updated | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`. |
| Generated artifacts | Updated | `docs/generated/db-schema.md` after migration `0020`. |
| References | Reviewed unchanged | No stale compact-reference links identified. |
| Environment variables | Reviewed unchanged | No new env vars; payload caps remain service defaults and `maxValueBytes` metadata. |

Acceptance evidence:

- Extended `DEBUG-SIM-001` in `e2e/acceptance/debugging-simulator.acceptance.spec.ts` with complex JSON read/write, `node_operations` digest/preview DB evidence, and audit row for `dbg-config-json`.
- Extended `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts` with complex value kind/format/normalization editing and API/DB verification.

Verification commands run for Task 7:

- `npm run docs:check` — passed (`Documentation governance check passed.`).

## Final Verification Checklist

- [x] Backend value codec tests pass.
- [x] Backend debugging schema/repository/service/routes tests pass.
- [x] HDC/ADB gateway preservation tests pass.
- [x] Frontend DTO/helper/admin/runtime tests pass.
- [x] `npm run build` passes.
- [x] Browser verification captures `/debugging-admin` and `/node-debugging` at desktop, tablet, and mobile sizes.
- [x] Console checks show no frontend errors.
- [x] Acceptance coverage and operation matrix checks pass.
- [x] Relevant acceptance specs pass or conditional hardware blockers are documented.
- [x] Documentation update gate evidence is complete.
