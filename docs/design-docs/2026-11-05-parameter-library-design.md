# Parameter library: definition-first reading and project comparison

> Chinese: [Design discussion](../zh-CN/design-docs/2026-11-05-parameter-library-design.md)

Date: 2026-11-05

Status: finalized by the user on 2026-11-05. After specification and ticket publication, the user authorized implementation through `implement-spec`, with particular attention to frontend quality. Deployment is outside the request. See the [implementation record](../exec-plans/completed/2026-11-05-parameter-library.md).

## Problem and intended outcome

The project parameter workbench starts with a project and supports inspecting and changing its configured values. A reader instead needs to find a parameter definition, understand its meaning, discover where it is configured, and compare the configurations without first choosing a project that uses it.

The library provides that reading path over the existing canonical definitions, revisions, Bindings and Project values. A definition with no project usage remains a useful and readable library entry.

## Confirmed decisions — round 1

The user accepted all three recommendations on 2026-11-05.

| Decision | Confirmed behavior |
| --- | --- |
| Q1. Library coverage | Include all published Platform parameter definitions, including subjects not registered in the current Organization and definitions unused by projects. Default to current active definitions; offer Organization registration and project-usage filters. Project configurations remain constrained by the reader's authorized scope. |
| Q2. Write boundary | The library supports reading, querying and comparison. An exact project/configuration/instance link hands a value change to the existing project workbench. Definition edits use existing Catalog governance. The library does not introduce inline value editing or another submission flow. |
| Q3. First-version comparison | Focus on one definition across multiple projects and instances. A multi-definition, multi-project matrix is outside the first-version scope. |

## Domain language

- **Parameter library:** the definition-first reading surface described in [the glossary](../../CONTEXT.md).
- **Parameter definition:** the existing stable property contract owned by a Catalog subject; it is not identified by its display name alone.
- **Definition revision:** the immutable content of that contract at a particular revision. The latest published description and an instance's value interpretation can refer to different revisions.
- **Binding:** the existing association of a definition with one particular project source occurrence. One project can contain several Bindings of the same definition.
- **Parameter instance:** the reader-facing use of a definition represented by that exact Binding; it is not a new identifier or a synonym for a project.
- **Project value:** the configured-value fact associated with a Binding and its exact definition revision. It is distinct from a proposed draft and a device debugging result.

Definition, revision, Binding and Project value retain their existing meanings. No new parameter identity, project-independent value, or definition storage is introduced by this design.

## Existing implementation and constraints

Source inspection began at `167361a1e`; this documentation worktree is based on the locally available `origin/main` snapshot `d867166f5`. These are source observations, not deployed behavior or runtime acceptance.

| Existing capability | Design implication |
| --- | --- |
| [Read-only definition route](../../src/app/routes.tsx), `/parameters/definitions`, reuses `CatalogPage` but lacks a primary navigation item. | Extend the existing definition-reading entry and canonical data rather than creating a parallel catalog. |
| [Catalog page](../../src/features/parameter-catalog/CatalogPage.tsx) has search, lifecycle/subject filters, pagination, detail and revision history. | Retain the supported queries and deep-link identities; reorganize the content around reading. |
| Definition DTOs expose usage counts, but the reading page does not expose project instance values. | Add definition-oriented instance discovery; do not require choosing an arbitrary project Binding first. |
| [Project comparison](../../server/modules/parameter-topology/service.ts) starts from `projectId` plus `bindingId` and then matches the exact definition. | Reuse the underlying identity/value semantics while providing a definition-first read seam. |
| [Comparison rows](../../src/domain/parameter-topology/bindingProjectComparison.ts) preserve sibling instances in one project. | Never collapse a project into one arbitrary value or compare definitions by name. |
| DTS details expose comparison; JSON details currently do not expose the same tab. | Explicitly cover both definition families when finalizing supported reading and comparison behavior. |
| Organization module placement does not exist for an unregistered subject. | A global library cannot require Organization module placement to make a definition discoverable. |
| [Usage scope policy](../../server/modules/parameter-kernel/policy.ts) and the existing topology comparison use different project-visibility scopes. | Q4 and ADR-0055 explicitly resolve the intended rule; changing the code and authorization evidence remains implementation work. |
| Usage counts and comparison also apply different current-source availability predicates. | Define one set of current configuration instances before deriving project counts and value rows; report retained unavailable references separately if needed. |
| `/parameters?project=...&binding=...` links can open DTS/JSON detail in the currently loaded config set; the workbench initially selects the default/first set. | Extend handoff to select the target Binding's authoritative config set before loading/focusing it. Existing links do not fully support non-default sets. An explicit return-to-library action restoring comparison state is also new work. |

[ADR-0051](../adr/0051-organization-provisioning-and-member-admission.md) makes projects Organization-visible while participation gates edits. However, [Catalog usage integration tests](../../server/modules/parameter-catalog-api/rootUsageScope.integration.test.ts) explicitly retain project-scoped aggregate reads for some roles. The user confirmed Q4, recorded in [ADR-0055](../adr/0055-parameter-configuration-reads-share-organization-scope.md). This is an explicit aggregate-authorization change, not removal of an allegedly obsolete check. Implementation must update the affected contracts and preserve adversarial authorization coverage.

For global classification, subject types are present in the domain model. The HTTP type-filter whitelist still needs `configuration-schema`; it currently accepts only Driver and NodeType. The current subject DTO's `ownerSubjectId` can reflect Organization placement overrides; a globally consistent driver/child tree would need the published Catalog ownership explicitly. Confirmed Q6 requires subject-type grouping, not that additional tree. Lifecycle multi-selection also needs a coherent contract: the current UI emits comma-separated values while the HTTP parser accepts a single lifecycle.

The existing product/frontend documentation also says there is no second Catalog product surface, while code already provides the read-only route. Final documentation must distinguish a shared canonical catalog with reading/governance presentations from a second definition store or independent governance workflow. Preserve historical acceptance contracts.

## Confirmed decisions — round 2

The user accepted Q4–Q8 on 2026-11-05.

| Decision | Confirmed behavior |
| --- | --- |
| Q4. Project configuration visibility | Active authenticated users with `parameter:view` can read current-Organization configurations. Counts, instance detail and comparison share that scope; edits retain project/action authority. See ADR-0055 for the explicit aggregate-policy change and evidence requirements. |
| Q5. Entry and reading workspace | A peer Parameter library navigation item leads to `/parameters/definitions`. Definition detail is an addressable full page with Definition, Project configurations and Compare tabs. Preserve list filters and return position. No project selection is required to enter. |
| Q6. Global classification | Browse Driver / NodeType / ConfigurationSchema groups, then subjects and definitions, with global search. The current Organization's business modules provide an optional additional filter. Unregistered subjects remain discoverable. |
| Q7. Time and value scope | Read values in current project configurations across all configuration sets, not only the default set. Exclude saved drafts, pending changes and device debugging values. These are platform configuration values, not proof of device state. Retain definition revision history; defer historical project snapshots and arbitrary-date comparison. |
| Q8. Multiple instances and comparison | One row per exact parameter instance, grouped by project. Explicitly select a baseline instance, inspect other instances' differences, then open a selected pair's detailed diff. Never infer a representative project value or pair instances by name/path. |

## Reading workspace specification

These concrete details develop the confirmed direction and will be reviewed with the assembled design. They do not assert that the current UI already supports them.

### Library list

- Show the authorized Organization context for registration and project usage. A shell project selection must not silently narrow the library; a project is an explicit, removable usage filter.
- Use the existing PC layout tokens at 1440×900: a collapsible subject navigator beside the main results table. Keep search, active filters, result count and reset above the table.
- Default to active published definitions and subjects, irrespective of this Organization's registration lifecycle. Provide lifecycle, subject type/subject, registration, business-module and project-usage filters. Clearly label Organization-only filters.
- Reuse existing case-insensitive substring search over keys, display names, documentation and subject aliases/identity. Do not promise relevance ranking, fuzzy search or an independently stored description. A short preview can come from the existing documentation.
- Main columns: name/property key; subject/type; documentation preview; value type/unit; configured projects; current value instances. Exceptional lifecycle and registration are compact labels rather than governance controls. Keep technical IDs in secondary details.
- Reuse server pagination and 20/50/100 page sizes, default 50, with deterministic ordering. Apply all filters before pagination. Counts and usage filters require server-owned queries rather than loading all project values into the browser.

### Definition detail

The header contains the readable name, property key, subject and lifecycle, followed by the three confirmed tabs. The initial tab is Definition. A return action restores the list's search, filters and position.

| Area | Content and behavior |
| --- | --- |
| Definition | Documentation first; then value type, unit, meaningful schema constraints and examples. Examples are labelled as examples, never recommended project values. Missing content stays visibly unspecified. |
| Revision context | Show the currently published definition; allow existing revision history on demand. An instance's value is always interpreted with its own pinned revision, not the latest head. Historical definition content must not imply historical project usage. |
| Source/provenance | Fold technical identity, release and detailed schema into secondary inspection. Render documentation safely using the existing Markdown capabilities; do not claim unsupported tables/images or invent missing content. |
| Governance handoff | An authorized user may open existing definition governance. Opening or reading never creates a registration, draft or publication intent. |

### Project configurations and comparison

- Cover both DTS and software-configuration instances, with project, config set, instance/source location, current value, unit and pinned definition revision. No default-config-set-only shortcut.
- Group rows by project while retaining each Binding. A project that continues across a paginated boundary remains labelled as a continuation; counts distinguish projects from instances.
- Project/config-set/search filters are visible and removable. Current rows, counts and comparison derive from one authorized instance selection and the existing canonical current-source availability rules. An unset/placeholder is not a configured value; typed empty strings and boolean presence are not missing merely because their raw display is blank.
- Before choosing a baseline, show neutral configuration values. Baseline selection is explicit; retain its identity visibly when target filters change. Do not auto-select the first project or instance.
- Compare tab shows the baseline identity/value and the instance list, then a focused pair diff for the chosen target. Compatibility behavior is Q9 below.
- An exact instance action extends `/parameters?project=...&binding=...` with config-set selection. Resolve the target Binding's project/config-set ownership on the server, validate any supplied configSet hint, then select and load that set before opening DTS/JSON detail. Preserve existing permission checks and unsaved-edit guards before changing project/set. A valid non-default-set instance must not be reported unavailable merely because the default set was loaded. Provide an allowlisted local return anchor back to this definition/tab/list context. An actually unreadable or removed Binding produces an explicit unavailable state, never a name-based fallback.

### Load, refresh and access behavior

Keep loading, failure/retry and empty states local to each tab. A failed configuration read does not erase readable definition content. Permission denial does not become zero usage. Filter changes cancel or ignore superseded responses, especially after an Organization change.

A current query is a read at a stated time, not a historical snapshot. Resolve a comparison's baseline and target values together, returning their exact Binding, ProjectValue and DefinitionRevision identities. Refresh may update their values but must preserve selection by Binding and flag removed/unavailable selections. Do not silently replace a missing baseline or mix an old baseline value with a newly fetched target while presenting both as one current result.

## Confirmed decisions — round 3

The user accepted Q9–Q11 on 2026-11-05.

| Decision | Confirmed behavior |
| --- | --- |
| Q9. Different revisions and value shapes | Compare typed values when both pinned revisions have identical semantic content under the existing content-classification rule; documentation-only differences are labelled. Different/unknown semantics remain side-by-side without numeric deltas. Unsupported complex values receive a representation/structural diff without claiming semantic equivalence. No automatic unit conversion or schema compatibility inference. |
| Q10. Projects with no current configuration | Default to projects with current configured instances, with a Show projects without current configuration option. Use a neutral No current configuration state, not Missing required parameter. Retired/unavailable/history-only states remain distinct. No current row is not proof that a project should configure the parameter or never used it. |
| Q11. Taking results away | Support copying a current-view link and an explicitly selected value. The recipient reauthorizes and reads current data. Defer Excel/PDF export, stored comparison reports and shared saved views. A link is not a frozen result. |

Q9 uses an existing conservative rule: unit, complete value schema, matching and lifecycle must agree. It is currently implemented in publication's `contentClassOf`, not a general comparison endpoint. The server must inspect complete pinned revision content; the public revision DTO lacks some fields. Reuse or minimally extract the existing pure rule, without adding a compatibility engine. A schema-internal description change is conservatively semantic under that rule; do not promise that every textual edit is compatible.

For proven comparable scalars, compare typed normalized values; numeric deltas require the same unit and safe numeric representation. For arrays/JSON retain type and ordering semantics. For complex DTS expressions or cross-project references, equal text does not prove equal meaning: offer raw/structural inspection and explicitly withhold an unsupported semantic conclusion.

## Read model and count contract

All sets below belong to one server-authorized Organization and one exact definition. They span all configuration sets unless the reader explicitly filters projects/config sets. A config-set filter only concerns its owning project; it must not fabricate absent rows in unrelated projects.

| Set / count | Meaning |
| --- | --- |
| Current instance candidates, B | Canonical current Bindings eligible under the shared managed-source rule, with proven identity and applicable occurrence evidence. Replaced, suspended and removed occurrences are not current. A recognized identity placeholder validates only evidence it actually owns; it cannot invent a value/source pin or a live source locator. Integrity failures are unavailable, not silently removed from this set. |
| Configured instances, C | The subset of B with a present, non-placeholder current ProjectValue and its valid owned source pin. A present typed empty string, boolean presence or valid JSON null remains a value. Proven deletion or a recognized identity placeholder is not configured. A dangling/missing value or required pin is an integrity failure, not evidence of an unset value. |
| Configured project count | Distinct project IDs in C, not all registrations or projects with a retained Binding. |
| Configured instance count | Number of distinct Binding IDs in C. Multiple source-pin joins must not multiply it. |
| Unset instance | A Binding with an explicitly recognized placeholder/unset state and valid evidence for that state. It shows No current value and only proven identity/source information; it is not zero or an inferred schema default. Do not classify every member of B outside C as unset. |
| Project with no current configuration | A readable project in the selected project/config-set scope with no instance in C. This is not a finding that configuration is required. |

By default, show project groups containing at least one configured instance, and keep their other current, unset sibling instances visible. Enabling Show projects without current configuration adds projects with only unset instances and projects with no current instances. The latter get one project-status row with no invented Binding. Retained unavailable records are never counted as current values.

Honor existing typed integrity failures such as missing-current-value. If a claimed current value or required source pin cannot be verified, return an unavailable/typed error rather than filtering the record into a successful zero result. Exact totals are unavailable when the selected set's integrity cannot be established. Known deletion/retirement is an explained lifecycle state; a failed read is a different state. Source inspection during implementation must prove legitimate placeholder states without bypassing the stricter checks for configured values.

Main library counts reflect the explicit Organization/project usage scope shown above the list. Detail scope counts describe the complete project/config-set selection before row-text/difference filters; filtered-result counts describe matching rows before pagination. Label these distinctly, so a narrowed result is not mistaken for Organization-wide usage. Row search cannot turn a project with nonmatching configured instances into No current configuration. Pagination totals count returned rows, including explicit project-status rows, while configured-instance counts exclude them.

Compute rows, their totals and comparison baselines in the same database read transaction for a response, using the existing read-transaction facility and a consistent snapshot. Separate page requests are current reads, not a persistent snapshot. Refresh/restart invalid or stale cursors explicitly. Definition revision history and current usage carry separate context. A missing usage result is unavailable, never zero; `policyCount: null` remains unknown and does not enter this feature's configuration totals.

Existing `usageSummary.projectCount` counts retained current-view Bindings more broadly than C. Do not silently relabel that field as Configured projects. Introduce an explicit current-configuration summary at the shared query owner (or a deliberately versioned DTO replacement), keep older field semantics explicit during migration, and move every new library count/filter to the new summary. ADR-0055 changes the read scope, not unrelated destructive-governance counting rules.

## Server and client contract

The concrete endpoint below is the proposed implementation shape of the accepted behavior; native DTO naming can follow nearby conventions. It is not an existing endpoint.

### Existing reads to extend

- Keep Catalog list, subject, definition and revision reads as the definition source. Add the missing ConfigurationSchema type filter and coherent lifecycle selection. The library's default must not apply the governance page's hidden Organization registration filter.
- Batch current-configuration summaries for the definition page through the canonical Binding query owner. Apply has-configuration and selected-project filters before pagination and total-count calculation, not just to the returned page. No per-definition project fan-out or browser-wide value download.
- Keep existing governance, source and project-edit commands. Library navigation is read-only for both humans and Agents; the existing product approval boundary remains in its owning workbench.

### Add one definition-first configuration read

`GET /api/v2/catalog/definitions/:definitionId/project-configurations`

| Aspect | Required behavior |
| --- | --- |
| Scope | Authenticated Organization and `parameter:view` are resolved on the server. Validate definition identity and every supplied project/config-set/Binding ID against that scope. A platform-wide definition ID never widens value scope. |
| Query | Optional project/config-set filters, instance/source text query, includeUnconfigured flag, cursor and limit. Optional baselineBindingId requests per-row comparison; optional targetBindingId requests the focused pair and requires a baseline. |
| Rows | A tagged instance row carries exact Binding/project/config-set/source identities, display locator, value state/preview, ProjectValue ID, value-pinned revision, effective revision, unit and lifecycle evidence, with explicit absence only for proven unset states. Placeholder rows expose only their proven evidence. A project-status row carries project identity and No current configuration, with no synthetic Binding/value. |
| Summary | Scope counts and filtered row counts as defined above, pagination metadata and read time. Baseline/target details are separate from page rows, so a chosen baseline outside target filters is still visible and is not added to filtered counts. |
| Comparison | Server validates same definition identity and complete pinned revision semantics. Return explicit same, different, different-semantics, unsupported or unavailable status and reason. Numeric delta is optional and only justified by the confirmed rule. |
| Payload size | Paginated rows use visibly truncated previews. Retrieve full values for the explicitly selected baseline/target or selected value inspection/copy through the same owner; never copy a truncated preview while claiming it is the whole value. Reuse current input/output bounds. |
| Failures | Invalid/mismatched input fails explicitly. Unauthenticated/no-read-capability responses follow existing auth handling. Cross-Organization or inaccessible identities use the existing non-disclosing response policy. An unavailable baseline does not select a replacement. |

Use one underlying canonical selection for counts, new reads and the existing project-anchored comparison adapter. Preserve the old endpoint's public shape while fixing shared count/read-scope divergence deliberately. Do not introduce a second current-value store, background synchronization service, universal comparison engine or database migration solely for this reading surface. If source inspection during implementation reveals a required schema change, justify it separately rather than implying it is already accepted.

Current rows use the current Catalog and source availability. Opening a historical definition revision changes only the displayed definition content; configuration reads stay explicitly current. Both revisions needed for a value comparison come from its ProjectValue pins, even when the Binding's effective revision or displayed latest head differs.

### Addressability and return flow

Reuse `/parameters/definitions` with the existing definition/list anchors. Add tab, baseline/target Binding IDs, instance filters and showUnconfigured to the addressable state; preserve distinct list search/cursor and instance-search state. Invalid combinations reset only the invalid selection with an explanation. Back/Forward and reload restore the selected definition, tab and comparison identities.

The workbench handoff must extend its context parser and config-set loading for non-default sets. A client-provided project/config-set/Binding tuple is a hint requiring server ownership validation, not authority. Loading the target set precedes Binding selection for both DTS and software configurations; existing dirty-state guards protect the old context.

Copy link includes the selected definition/view and supported identity/filter state, not value payloads, credentials or an Organization-switch command. Opening it reauthorizes in the recipient's current Organization and reads current data. The link label explains that data may have changed. The project-workbench return anchor is normalized and restricted to the local library path; reject external, protocol-relative and nested arbitrary redirect targets. Returning respects existing unsaved-edit guards.

Copy value requires an explicit row/detail action and copies the full chosen raw representation with its actual formatting, not the example value or normalized preview. Clipboard success/failure is visible; a failed copy leaves the selection intact. It neither creates a draft nor claims cross-project portability for source-specific references.

## State and comparison matrix

| Condition | Display / available action | Must not imply |
| --- | --- | --- |
| Published, unregistered, unused | Definition readable; Unregistered label; no current configurations | Registration or a project is required to read |
| Active definition with zero C | No current configuration; optional unconfigured-project list | Never used, missing required field, or value zero |
| Same project, several Bindings | Separate config-set/source rows and explicit baseline selection | One project has one value |
| Same definition, same semantics | Typed equality/difference; numeric delta only for safe same-unit scalars | A recommendation, valid device state or automatic approval |
| Documentation-only revision difference | Normal comparison plus revision labels | All different revision IDs are incompatible |
| Different/unknown semantics | Both original values, units and revision context; no numeric delta | Automatic conversion or equivalence |
| Unsupported complex shape/reference | Raw/structural inspection labelled as such | Equal text proves equal cross-project meaning |
| Empty string / boolean presence / JSON null | Preserve typed presence and distinguish each from absent | Blank text always means no value |
| Proven placeholder versus missing value/pin | Placeholder has No current value and only proven evidence; dangling/malformed current data returns unavailable and withholds unproven totals | Missing records or read failures are ordinary unset values |
| Retired definition/registration or suspended source | Explain the known current-unavailability reason; retain definition history/deep links allowed by existing owners | History was deleted or current configuration never existed |
| Deleted/replaced retained Binding | Selected item unavailable; existing exact history link only when supported | A similarly named instance is the replacement |
| History existence unknown | No current configuration; do not assert retained history exists | Zero current count proves or disproves historical usage |
| Permission denied / request failed | Explicit denied/unavailable or retry state; keep readable definition | A successful empty result |
| Baseline removed while reading | Preserve identity context, explain unavailability and ask for a new explicit selection | Automatic first-row fallback |
| Historical definition revision open | Historical definition badge; project section labelled Current configurations | An as-of historical project snapshot |

## Acceptance matrix

These are future implementation gates, not results already obtained in this design task.

| ID | Scenario | Required observation |
| --- | --- | --- |
| LIB-01 | Open library without a selected project | Visible navigation, active published global definitions, unused/unregistered definitions discoverable. |
| LIB-02 | Driver, NodeType and ConfigurationSchema search/filter | All three kinds work end to end; a whole-result search hit beyond page one is reachable; counts precede pagination. |
| LIB-03 | Current-Organization nonparticipant/project-role reader | Authorized counts, rows and comparison agree; modifying another project's value remains rejected. |
| LIB-04 | No `parameter:view`, inactive or cross-Organization identities | No configuration counts/values leak through summaries, cursors, baseline/target, copy links or cached responses. |
| LIB-05 | Two instances in A, one in B, plus another config set | Every Binding is retained; all sets are included; no name/path pairing or project-value deduplication. |
| LIB-06 | One definition differs only in nonsemantic content | Comparable values remain comparable with distinct revision labels. Latest head never overwrites value-pinned interpretation. |
| LIB-07 | Unit/schema/matching/lifecycle change or missing revision evidence | Side-by-side original context, no invented equivalence or numeric delta. |
| LIB-08 | DTS numeric spelling, typed JSON, booleans, empty strings, complex references | Supported canonical values compare correctly; unsupported forms state their limit; no parseFloat-style partial coercion or false missing value. |
| LIB-09 | Saved draft, pending review and device debug value | None changes the displayed current ProjectValue or current counts. |
| LIB-10 | Zero usage, proven placeholders/unset siblings, missing value/pin and includeUnconfigured | Correct project/instance/row counts; no synthetic Binding or source evidence; malformed current data returns unavailable, not unset/zero; row search does not relabel nonmatches as unconfigured. |
| LIB-11 | Retirement, source suspension, replacement and value deletion | Current counts/list/compare agree on availability; retained history is preserved and described honestly. |
| LIB-12 | Filter/pagination/refresh and concurrent value update | Stable identity selection, truthful scope/result counts, no duplicate join counts, no mixed comparison snapshots or stale Organization responses. |
| LIB-13 | Deep-link, Back/Forward, reload and project-edit round trip, including non-default DTS/JSON config sets | Validate Binding/project/set ownership and load the correct set before selection; preserve definition/tab/list return, guard dirty edits, reject mismatched hints and invalid return URLs. |
| LIB-14 | Share link and copy full multiline value | Recipient reauthorizes and sees current data; full selected value is copied or failure reported; no payload in the share link. |
| LIB-15 | 1440×900, keyboard and long documentation/values | Readable columns and stable focus; navigable tabs/tree, announced load/error states, intentional full-value expansion without clipped actions. Add one compact PC window only for demonstrated layout risk. |
| LIB-16 | Definition read succeeds but project read fails | Definition remains readable; local retry recovers; failure/denial is never displayed as zero usage. |

Implementation verification follows the repository impact selector and verification matrix. Authorization/count/query changes require real PostgreSQL integration coverage and independent review. UI acceptance uses a task-isolated real API lane at 1440×900, with an explicit seeded DTS and software-configuration example. Mock runs do not establish integration acceptance. Retain build/static checks where selected; record exact passes/failures/skips and do not weaken historical Catalog evidence.

## Implementation slices and completion boundaries

| Slice | Owned outcome | Dependencies / completion |
| --- | --- | --- |
| 1. Shared read contract | ADR-0055 scope, B/C selection, explicit new configuration summary, definition-first pagination and compatibility classification; cover type/lifecycle query gaps. | Role-faithful PostgreSQL and shared-helper tests; inspect all usage/compare callers. No UI rollout before its required read contract exists. |
| 2. Reading entry and content | Peer navigation, global list, addressable full-page definition, safe documentation/schema/examples, filters and revision context. | Reuse canonical reads; bind configuration counts to slice 1. Browser verify global/unused definitions and all subject types. |
| 3. Configurations and comparison | Grouped instance rows, explicit baseline, supported typed diffs, empty/unavailable states, full-value inspection/copy. | Uses slice 1; browser verify DTS/software instances, revision mismatch and concurrent changes. |
| 4. Navigation handoff and completion | Exact project/config-set/Binding selection including non-default sets, return anchors, share links, permission/error/a11y states, documentation updates and complete affected regression. | Depends on the integrated reading/compare flow; one focused independent review of authorization seams and current-head evidence. |

These capability areas are implemented through Issues #1514–#1520 under specification #1513. The explicitly invoked implementation workflow uses one integration branch and a draft PR, followed by review readiness; merging and deployment require separate authorization.

| Durable document | Implementation-time update |
| --- | --- |
| This design, glossary and ADR-0055 | Record final agreed behavior and actual implementation status; retain accepted decision history. |
| Product spec and FRONTEND, with Chinese companions | Explain shared Catalog data with distinct reading/governance presentations; add navigation, current values, count and comparison contracts. |
| SECURITY and domain model, with companions | Replace the old current-configuration aggregate policy description after implementation; preserve other domain/governance scopes. |
| DTO/OpenAPI and user guide, with applicable companions | Document definition-first reads, supported filters/states, exact instance handoff and share-link semantics. |

First-version exclusions are inline/bulk writes, multi-parameter matrices, project history snapshots, automatic unit/schema conversion, saved comparison reports, export files, inferred recommended values and cross-Organization configuration browsing. Existing project workflows remain available through explicit handoff.

## Current delivery state

All eleven product decisions, the assembled design, testing seams and vertical-ticket breakdown were confirmed. [Specification #1513](https://github.com/tzrea1-Q/WiseEff/issues/1513) and child Issues #1514–#1520 were published with the approved blocking edges. The initial publication-only boundary was subsequently replaced by explicit authorization to develop the entire specification. Implementation and current acceptance outcomes are tracked in the execution plan; no runtime result is implied by this design.
