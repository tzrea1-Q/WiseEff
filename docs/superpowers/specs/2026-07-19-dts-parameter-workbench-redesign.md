# DTS Parameter Workbench Deep Redesign

> Chinese: [中文](../../zh-CN/superpowers/specs/2026-07-19-dts-parameter-workbench-redesign.md)

Date: 2026-07-19
Status: Design confirmed; implementation planning pending written spec review

## Context

The DTS topology work introduced a real semantic model for source occurrences,
effective topology, parameter specs, project bindings, value shapes, mappings,
candidate revisions, and typed writeback. The API-mode `/parameters` page then
switched almost entirely to `ProjectTopologyWorkspace`, a compact three-pane
topology surface.

That replacement preserved the data flow but discarded the mature parameter
workbench interaction model that users already understand:

- `WorkbenchLayout` and the existing page hierarchy;
- search and module/risk filtering;
- the main parameter table and row focus behavior;
- the “current edits” area;
- draft sheet, detail dialog, batch submit preview, and history actions.

The redesign must therefore combine the two models. The workbench remains the
primary user surface; DTS topology becomes a first-class navigation and
provenance layer inside it. The semantic API and fail-closed workflow remain
unchanged.

## Decisions

1. Keep the original parameter workbench as the page shell and primary mental
   model in both runtime modes.
2. In API mode, render semantic DTS bindings as workbench rows. Do not restore
   the retired flat `parameterId` identity or business `recommendedValue`.
3. Add an embedded, collapsible DTS topology navigator rather than replacing
   the page with a permanent three-column topology layout.
4. Reuse the original table, detail-dialog, draft-sheet, and submission-preview
   interaction patterns. Extend them with DTS-specific content and state.
5. Keep source/effective topology, occurrence spans, provenance, mappings,
   schema/policy diagnostics, candidate revisions, and typed `set|delete` edits
   sourced from the existing semantic repository.
6. Preserve API-mode fail-closed behavior: no teaching-fixture fallback, no
   silent identity conversion, and no client-side business-state bypass.
7. Treat the redesign as a frontend view-model and composition change. No
   database migration or API identity change is required.

## Goals

- Make `/parameters` feel like the existing parameter workbench while exposing
  the full DTS meaning of a row such as `gpio_int`.
- Let users move from a parameter row to its DTS path:
  `amba → i2c@FDF5E000 → sc8562@6E → gpio_int`.
- Keep search, filtering, selection, draft, batch submission, and review handoff
  familiar and keyboard-accessible.
- Show device driver, instance address, mount path, raw value, value shape,
  source occurrence, schema state, policy state, and mapping state without
  making the table unreadably dense.
- Provide a coherent desktop, tablet, and mobile layout without horizontal
  page overflow.
- Keep the real typed edit → candidate → submit → role review → merge flow
  intact.

## Non-goals

- Do not reintroduce a flat parameter identity or infer identity from a path.
- Do not treat an example value as a recommendation or enforced default.
- Do not create a second API or a second submission workflow.
- Do not expose delete authoring if the current product surface does not provide
  a safe delete control; existing delete API/acceptance behavior remains intact.
- Do not redesign `/parameter-admin`, `/parameter-review`, or unrelated pages.
- Do not replace the API topology repository with mock data when API mode has
  empty, loading, or error results.

## User experience model

### Page hierarchy

The page keeps the existing order:

1. Workbench page context and project identity.
2. Permission/initialization notice when applicable.
3. DTS context toolbar and optional topology navigator.
4. Current edits / draft summary, when present.
5. Main parameter workbench list.
6. Detail dialog or mobile detail sheet for the selected binding.
7. Existing submit preview and role assignment flow.

The topology navigator is a context control. It filters and explains the main
list; it is not a second primary workspace competing with the list.

### Semantic workbench row

API-mode rows use a new frontend view model, separate from the legacy
`ParameterRecord`:

```text
DtsParameterWorkbenchRow
- bindingId
- parameterSpecId
- parameterSpecVersionId
- propertyKey
- driverModule
- compatible/display driver label when available
- instanceName
- unitAddress
- topologyPath
- sourceFileName / sourceNodePath
- rawValue
- effectiveValue
- valueShapeSummary
- schemaState / policyState
- mappingState
- source/effective occurrence references
```

The row mapper is pure and deterministic. It combines existing topology nodes,
bindings, effects, and source nodes; it does not invent a spec default or use a
path as identity. Missing optional joins display an explicit em dash or
“unavailable” state.

### Main list columns

Desktop uses a readable table with progressive disclosure:

| Column | Content |
| --- | --- |
| Property | `gpio_int` plus type badge |
| Device / driver | `sc8562` and compatible when available |
| DTS location | `i2c@FDF5E000 / sc8562@6E`, with `amba` in the path tooltip/detail |
| Effective value | raw DTS value with truncation and copy affordance |
| Shape | `phandle-list · 32 bit · 3 cells` |
| Governance | schema, policy, mapping badges |
| Actions | view/edit, subject to capability and state |

At tablet/mobile widths, the row becomes a stacked card with property, device
path, value, and status first; shape and provenance appear in the detail view.

### Search and filters

The existing workbench search remains the main search control, with these
semantic fields added to its index:

- property key;
- driver/compatible;
- instance and unit address;
- full topology path;
- source file and node path;
- raw value.

The control gains a search icon, clear action, focus-visible state, and a result
count. Module, risk, schema, policy, mapping, and source/effective filters are
represented as compact filter chips or the existing column-filter menus. Clear
all resets every filter without clearing pending drafts.

### Topology navigator

`DtsTopologyNavigator` replaces the current flat `TopologyTree` presentation.
It builds a nested view from source occurrence parent IDs or effective logical
parent IDs, preserving the repository's ordering. Each node can display:

- name and unit address;
- compatible/driver summary;
- binding count;
- open mapping count;
- schema/policy warning markers.

The navigator provides:

- source/effective segmented control;
- expand/collapse all and per-node disclosure;
- path-preserving search highlight;
- selected-node state linked to the main row list;
- a compact breadcrumb for the selected node.

Selecting a node scopes the list. Clearing the node selection returns to the
full filtered list. A row selection never loses the current tree context.

### Detail and editing

The established `ParameterDetailDialog`/sheet interaction remains the entry
point. The DTS detail content is organized into cards:

1. Identity: property, driver, instance, address, binding/spec IDs.
2. Location: complete source path, file/version, occurrence span and line.
3. Provenance: base/overlay/effect chain and source/effective toggle.
4. Value contract: raw value, parsed shape, schema/policy state, diagnostics.
5. Typed edit: raw editor, reason, validation, and draft creation.

Creating a draft returns the real candidate identity and adds a semantic draft
card to the existing “current edits” area. The draft card shows current → target,
reason, action, candidate revision, and stale/validation status. Submission uses
the existing binding-draft wire contract and role candidate API.

### Visual language

The redesign uses the existing blue/indigo design tokens but gives the page a
clearer component hierarchy:

- a bordered workbench context card;
- a compact toolbar with icon-bearing controls;
- a lightly elevated topology navigator card;
- a table card with row hover/selected/draft/error states;
- semantic status badges with text and color, never color alone;
- consistent 8/12/16px spacing, 10/12/16px radii, and existing shadows;
- disabled, loading, empty, error, and blocked states rendered as designed
  panels rather than unstyled paragraphs.

The existing global `.button` contract remains the base. DTS-specific controls
may add icons and semantic modifiers but must not create a second button system.

## Responsive behavior

### Desktop (at least 1200px)

- Workbench table is primary.
- Topology navigator is a 260–300px collapsible side context panel.
- Detail uses the established wide dialog or right-side detail presentation.
- No page-level horizontal overflow.

### Tablet (821–1199px)

- Navigator collapses into a toolbar-triggered panel or top context section.
- Table keeps property, device/path, value, and governance columns.
- Detail opens as a modal drawer.

### Mobile (390px baseline)

- Toolbar stacks: search, filter trigger, view toggle, actions.
- Tree, list, and detail use explicit breadcrumb navigation.
- Rows become cards; long paths and raw values wrap or use a copy affordance.
- Detail opens as a full-height sheet.
- `document.documentElement.scrollWidth === innerWidth` remains an acceptance
  assertion.

## Component and data boundaries

Planned frontend units:

- `src/domain/parameter-topology/workbenchTypes.ts` — semantic row and display
  state types;
- `src/application/parameters/buildDtsWorkbenchRows.ts` — pure topology-to-row
  mapping and semantic search text;
- `src/components/parameter-topology/DtsTopologyNavigator.tsx` — nested tree;
- `src/components/parameter-topology/DtsParameterWorkbench.tsx` — composition
  of toolbar, navigator, list, drafts, and detail entry points;
- `src/components/parameter-topology/DtsParameterRow.tsx` — responsive row/card;
- `src/components/parameter-topology/DtsBindingDetailDialog.tsx` — existing
  detail shell with semantic sections, or a focused extension of the current
  detail dialog where reuse is safe.

`ApiProjectTopologyWorkspace` becomes a data-loading/coordinator boundary or is
reduced to a thin adapter that supplies this workbench. `ParametersPage` keeps
the legacy mock rendering path and mounts the DTS workbench for API mode.

No new API endpoint is required. The existing topology repository remains the
source of truth for config sets, source/effective trees, bindings, mappings,
validation, candidate drafts, and typed submission.

## State and error behavior

- Loading: show a workbench skeleton with tree/list placeholders.
- Empty Config Set: use the existing empty-state card with a direct admin
  action hint.
- Missing semantic revision: show a clear ingestion/setup card, not an empty
  table.
- Mapping required: show a warning banner and node/row badges; validate remains
  fail-closed.
- Schema/policy failure: show diagnostics in the row and detail; disable only
  the affected action, preserving read access.
- Stale revision: keep the existing 409 diagnostic and require refresh/re-edit.
- Project switch: clear preferred revision, pending draft, assignees, publish
  message, mapping message, and tree/list selection before loading the new
  project.
- API errors: render a retryable error card; never fall back to teaching data.

## Accessibility

- Search remains a labelled `searchbox` with a clear button and result count.
- Tree uses `role=tree`/`treeitem`, `aria-expanded`, `aria-selected`, and
  keyboard navigation where nodes are expandable.
- Table rows/cards expose a single predictable activation target and retain
  visible focus.
- Status badges include text labels and are not color-only.
- Dialog/sheet focus management follows the existing modal conventions.
- All icon-only actions have accessible labels and tooltips.

## Verification plan

### Unit/component tests

- map representative occurrences such as `gpio_int` to the correct semantic
  row fields;
- search across property, device, address, path, and raw value;
- nested source/effective tree expansion and selection;
- node selection scopes rows and clearing restores the list;
- row → detail → typed draft preserves binding/spec/candidate identity;
- draft cards render action, reason, target, and candidate state;
- loading/empty/error/mapping/schema/policy states;
- mobile pane transitions and keyboard/focus behavior.

### Existing regression tests

Keep the mock `ParametersPage` and `ParametersTable` test suite green. Update
API topology tests to assert the new composition without weakening the semantic
repository and fail-closed workflow assertions.

### Browser verification

Use the current local API runtime and `playwright-cli` at:

- `/parameters`
- `/parameter-admin` only where shared navigation/context is affected

Verify at `1440×900`, `768×1024`, and `390×844`:

- search `gpio_int`;
- select `sc8562@6E` through the nested tree;
- inspect path, raw value, shape, and provenance;
- create a typed draft with a reason;
- verify the draft in the original current-edits workflow;
- verify tree/list/detail navigation and clear filters;
- check console errors, focus, no horizontal overflow, and network requests.

Run `npm run build`, targeted frontend tests, `npm run docs:check`, and the
relevant topology acceptance/evidence checks before completion.

## Rollout and compatibility

1. Implement the pure row model and navigator behind component tests.
2. Compose the new API workbench while retaining the mock legacy path.
3. Run browser verification and compare the current API flow against the old
   workbench interaction checklist.
4. Remove only obsolete API-mode topology-only composition after the new flow
   has equivalent or better coverage. Do not remove mock compatibility code in
   this scope.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Table becomes too dense | Progressive disclosure, semantic badges, responsive cards, detail dialog |
| Tree and list selection drift | Single coordinator state and pure binding/node joins |
| Legacy identity leaks back into API mode | New row view model and explicit semantic submit contract |
| Large DTS paths break layout | Wrapping, truncation with full-value detail/copy, mobile card layout |
| Existing workflows regress | Preserve mock path and add real API row/draft/browser tests before cleanup |
| CSS becomes another one-off system | Reuse existing tokens, `.button`, cards, spacing and modal primitives |

## Open implementation constraints

- The current binding DTO does not always carry `compatible` or full spec
  detail. The first implementation must display only fields proven by the API
  and use an explicit unavailable state; adding a new endpoint requires a
  separate API design.
- The current product does not expose a delete-authoring control. Delete
  rendering remains read/acceptance-compatible without inventing a new authoring
  affordance.
