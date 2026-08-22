# Parameter Home Production Redesign

> Chinese: [Chinese](../zh-CN/design-docs/2026-07-07-parameter-home-production-redesign-design.md)

Date: 2026-07-07

Status: **Implemented; the hotspot scoring contract was superseded by the four-dimension behavioral model on 2026-08-23**

Scope: `/parameter-home` (`ParameterHomePage` and `src/features/parameter-home/`)

This document records the overall production redesign of Parameter Home. For
hotspot scoring, the later
[Project Hotspot Scoring Redesign](../exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md)
and the current [API contract](api-contract.md) are authoritative. The retired
five-dimension model remains historical context only; it is not the current
implementation or audit baseline.

## Historical context and problem

When this design was written, `/parameter-home` was still a prototype in three
important respects:

- **Data integrity:** the update trend was an LCG sequence anchored to a fixed
  reference date, project risk counts had random jitter, and a client-side
  heuristic was presented as an AI score.
- **Backend integration:** the page had no dedicated aggregate API and derived
  everything synchronously from `PrototypeState`; some API-mode workbench
  signals still came from mock-only fields.
- **Frontend quality:** a 591-line page and a global stylesheet of more than
  11,000 lines carried hand-built SVG charts, inconsistent tokens, and no
  complete loading, empty, or error states.

## Goal

Move `/parameter-home` to production-shaped, server-aggregated data and redesign
its visual and interaction model as one staged program.

## Confirmed decisions

| Decision | Choice |
| --- | --- |
| Core outcome | Real backend data plus a full visual and interaction redesign |
| Data architecture | Dedicated dashboard aggregate APIs; server SQL aggregation; render-only client |
| Hotspot scoring | Explainable deterministic server scoring, never labeled AI |
| Design direction | Reframe the information architecture and page narrative |
| Charts | Recharts |
| Primary roles | Guest, User, Committer, and Admin |
| Delivery | One specification with independently verifiable phases |

## Information architecture: an adaptive command surface

Operators (User and Committer) should first see what they need to do. Admin and
Guest should first see the parameter estate. All four roles share the same
components and data sources; only emphasis and default expansion change.

### 1. `SituationStrip`

- A compact KPI row for parameter count, managed projects, recent changes,
  active contributors, and recent high-risk items.
- Server data follows project and window selection.
- Loading, empty, error, and retry states are explicit.

### 2. `WorkbenchPrimary`

- Operators see their next-action queue first and permission-filtered scenario
  entries second.
- Admin sees governance actions and high-priority exceptions.
- Guest sees read-only guidance and only reachable entries.
- Dirty state, account attention, and pending export signals come from the
  backend, not mock residue.
- The view model filters actions by permission before rendering.

### 3. `InsightSection`

- Real update history, real per-project risk counts, and explainable hotspot
  rows backed by server evidence.
- Admin and Guest expand the section by default; operators get progressive
  disclosure so that work remains primary.
- Hotspot grouping switches among project, module, and parameter. The server
  computes both the total and its breakdown.

Window and hotspot grouping controls live together in the page-level analysis
context. The TopBar keeps only the project selector. On mobile, the order is
situation, primary work, then insights; hotspot details remain an accordion.

## Backend aggregate APIs

The `server/modules/parameters/dashboard/` submodule owns routes, service,
repository, and policy. Both endpoints require `parameter:view`; organization
scope comes from authenticated context and optional project scope comes from
`projectId`.

### `GET /api/v1/parameters/dashboard/summary?projectId=&window=`

The response contains dimension-independent data refreshed for project or
window changes:

- situation KPIs;
- real update buckets from parameter history and workflow events;
- per-project high, medium, and low risk counts without scaling or jitter;
- real workbench signals such as pending reviews, drafts, returns, merge waits,
  unapplied imports, and accounts requiring attention.

### `GET /api/v1/parameters/dashboard/hotspots?projectId=&window=&dimension=`

The endpoint refreshes independently when the grouping changes:

- `dimension` is `project`, `module`, or `parameter`;
- SQL aggregates window history, modification scope, change requests,
  open/returned workflow, and contributors for each group;
- the service returns deterministic `score`, exact four-key `scoreBreakdown`,
  `evidence`, trend data, and `suggestedPath`;
- parameter `scope` counts projects that modified the definition, not parameter
  instances;
- the client renders the response and does not reconstruct scoring or ranking.

The API and UI use honest names such as hotspot score composition and evidence,
not AI score. OpenAPI and the bilingual API contract are the public contract.

## Frontend data layer

### Dedicated port and adapters

`ParameterDashboardRepository` is separate from parameter write ports:

- `listDashboardSummary(projectId, window) -> DashboardSummary`
- `listDashboardHotspots(projectId, window, dimension) -> DashboardHotspot[]`

The HTTP adapter calls the two endpoints. The mock adapter derives the same
view-model shape from seeded history for demos and component tests; it does not
restore LCG trends or jitter. API mode uses backend data for every section.

### Runtime and state

`parameterDashboardRuntime` loads summary data at startup and on project or
window changes, and loads hotspots independently on grouping changes. Dashboard
state is not synchronously derived from `PrototypeState`.

Each section has its own `idle | loading | ready | empty | error` state. A slow
or failed section does not block the rest of the page. `derivePersonalWorkbench`
remains a pure view-model function over real workbench signals and hydrated
requests/drafts. Components render and navigate; they do not rank or score.

## Component and visual architecture

- `ParameterHomePage.tsx`: runtime and section-state orchestration.
- `SituationStrip.tsx`: KPI strip.
- `WorkbenchPrimary.tsx`: `NextActionQueue` plus `ScenarioEntries`.
- `InsightSection.tsx`: update, risk, and hotspot evidence.
- `HotspotLeaderboard.tsx` and `HotspotScorePanel.tsx`: ranking and exact
  four-dimension score presentation.
- `AnalysisContextControls.tsx`: window and hotspot grouping.
- `SectionSkeleton`, `SectionEmpty`, and `SectionError`: shared async states.

Recharts provides responsive trend and stacked-risk charts. Page-level tokens
cover panels, spacing, risk semantics, and score levels. New components prefer
Tailwind utilities and shared primitives; feature-local CSS is used only where
needed, and retired global Parameter Home blocks are removed after migration.

Desktop 1440, tablet 768, and mobile 390 layouts must avoid overlap and
horizontal overflow. Hotspots retain keyboard and ARIA behavior, charts expose
accessible labels and hidden data tables, score dimensions use progressbar
semantics, and async state changes use `aria-live`. On Parameter Home at widths
up to 640px, the Xiaoze launcher follows the page content so it cannot cover the
final hotspot row; larger viewports retain the fixed launcher.

## Delivery phases

1. **Foundation:** add Recharts, feature structure, shared view-models, the
   repository port, and contract stubs.
2. **Backend aggregate APIs:** implement routes, policy, aggregation, scoring,
   OpenAPI, and server tests.
3. **Real frontend data:** add HTTP/mock adapters, runtime orchestration,
   independent section states, and remove LCG/jitter.
4. **Visual and interaction redesign:** split components, add charts and tokens,
   complete async/responsive/accessibility states, and unify analysis controls.
5. **Cleanup and documentation:** remove retired code and styles, update
   frontend/API docs, and pass documentation governance.

## Verification and acceptance

- Server aggregation, deterministic scoring, authorization, and policy tests.
- Pure view-model, adapter-contract, section-state, role, and accessibility tests.
- `npm run contract:openapi` and `npm run contract:check`.
- `npm run build` and `npm run docs:check`.
- API-mode browser verification at 1440x900, 768x1024, and 390x844 with
  snapshot, screenshot, console, network, and meaningful interactions.

Acceptance requires backend-derived charts, hotspots, and workbench signals;
production-quality states for all four roles; documented deterministic scoring;
OpenAPI coverage; removal of synthetic data; and permission-filtered entry
points.

## Out of scope

- Redesigning parameter edit, review, or administration pages.
- Using an LLM or Agent to generate hotspot scores.
- Building separate page implementations per role.
- Adding another frontend framework beyond the chart library.

## Documentation Impact Matrix

| Category | Status | Exact file / evidence |
| --- | --- | --- |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, and generated OpenAPI document the endpoints and exact four-key response |
| Frontend design | Update | This English page and `docs/zh-CN/design-docs/2026-07-07-parameter-home-production-redesign-design.md` record the current scoring successor |
| Bilingual governance | Update | `scripts/bilingual-docs.ts` requires this EN/ZH pair and both pages link to each other |
| Planning | Update | `docs/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md` and its Chinese companion contain the successor details |
| Product specification | Review | No product workflow or role behavior changes in the scoring contract closeout |
| Reliability / security | No change | No write path, permission, runtime mode, or operations behavior changes |

**Documentation Update Gate:** run `npm run docs:check` before completion and
keep the generated OpenAPI artifact current.

## Appendix: auditable scoring and buckets

The current deterministic behavioral scorer uses real aggregate inputs:

- `frequency = historyEventsInWindow * 3 + changeRequestsInWindow * 10 * requestWeight`
- `scope = modifiedParamCount * 2 + modificationRate * 100 * 4`
- `workflow = changeRequestsInWindow * 8 * requestWeight + openRequestCount * 5 + returnedInWindow * 12`
- `collaboration = contributorsInWindow * 15 + contributorsAllTime * 3`
- `modificationRate = modifiedParamCount / max(totalParamCount, 1)`
- `score = round1(frequency + scope + workflow + collaboration)`

`requestWeight` is `1.25` for 7d, `1.00` for 30d, and `0.90` for 180d.
Project and module scope use parameter instances; parameter scope uses projects
that own the definition. `risk`, `impact`, and `drift` are retired historical
breakdown keys and are not accepted by the current DTO.

Trend buckets use daily `date_trunc('day', changed_at)` for 7d/30d and weekly
`date_trunc('week', changed_at)` for 180d. Risk distribution remains an exact
`COUNT(*) GROUP BY project, risk` with no scaling or jitter.
