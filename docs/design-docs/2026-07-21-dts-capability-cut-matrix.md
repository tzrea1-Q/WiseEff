# DTS Capability Cut Matrix

> Chinese: [Chinese](../zh-CN/design-docs/2026-07-21-dts-capability-cut-matrix.md)

- Date: 2026-07-21
- Status: Planning input for [`2026-07-21-dts-parameter-surface-mvp.md`](../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md)
- Bound by: [`2026-07-21-dts-parameter-surface-boundary-rfc.md`](2026-07-21-dts-parameter-surface-boundary-rfc.md)

Legend:

| Action | Meaning |
| --- | --- |
| **Keep** | Remains a product-facing or required backend capability |
| **Keep-internal** | Remains in code as engine detail; hide from default UX / hot-path gates |
| **Demote** | Still available, but secondary (Admin, tech view, export/publish only) |
| **Remove-from-hot-path** | Must stop blocking everyday browse/edit/draft/submit |
| **Defer** | No work this MVP; revisit later |
| **Retire** | Plan to delete or stop investing after migration |

## 1. Ingest, resolve, identity

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| Multi-file `resolveDtsConfigSet` | Required for semantic ingest | **Keep-internal** | Needed for correct overlays; not user vocabulary |
| `dts_config_revisions` chain | Every ingest | **Keep-internal** | May thin later; MVP keeps |
| Node/property occurrences + effects | Full tree | **Keep-internal** | Feed writeback provenance; filter before UI |
| Logical nodes + continuity matching | Cross-revision | **Keep-internal** | Soften `needs_mapping` browse block |
| Identity mapping tasks | Can block validate/edit | **Remove-from-hot-path** | Admin tech queue only; surface params remain editable with warnings |
| Structural ingest (parallel) | Optional on upload | **Demote** | Keep for search/debug; not dual product story |
| Require complete Config Set (base+) before bindings | Hard empty-state | **Demote** → MVP target: ingest surface from project primary DTS when possible | See MVP Task A |

## 2. Schema, specs, matcher

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| Vendor/linux schema registry (`schemas/dts`) | Matcher source of truth | **Demote** | Assist types/docs; not gate for surface inclusion |
| `matchProperty` / `matchDriver` | Binding creation | **Keep-internal** | Prefer match when present |
| Unmatched → review queue → no binding | Blocks editing | **Remove-from-hot-path** | Surface params get **provisional ledger rows** without reviewed spec |
| Spec review / activate global specs | Admin | **Keep** (Admin) | Remains governance for shared specs |
| Inferred draft specs | Cutover-era | **Defer** / thin | Do not expand |

## 3. Bindings & modules

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| `project_parameter_bindings` | Core ledger | **Keep** | Filter to surface for default list APIs |
| Binding key includes `module_id` | Phase 2 | **Keep-internal** | No new user-visible identity layers |
| Module registry + mappings | Admin | **Keep** | Primary classification input |
| Module-first navigator | Default UI | **Keep** | Drop required driver tier in nav (MVP Task C) |
| Driver / device column on main table | Prominent | **Demote** | Detail drawer / optional column |
| Driver-derived fallback module names | Unmapped | **Keep** | Still 「未分类」 queue |
| Cross-project compare / binding history | Phase 2 APIs | **Keep** | Scope to surface rows |

## 4. Edit, writeback, toolchain

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| Typed binding drafts + workflow submit | Mature path | **Keep** | Core product |
| Overlay-only writeback; base immutable | Hard rule | **Demote** | Prefer write to **project primary DTS**; base immutability becomes internal when multi-file |
| Re-ingest full config revision on every draft | Always | **Keep-internal** short-term; **Defer** thinning | MVP may keep re-ingest but without L2 gate |
| `dtc` + `fdtoverlay` + `dt-validate` on draft create | Fail-closed | **Remove-from-hot-path** | Move to L2 export/publish / Admin validate |
| Merge/writeback `dtc` toolchain fail-closed | Fail-closed on `applyLockedOverlayWriteback` | **Remove-from-hot-path** | Semantic merge completes on L0; toolchain is L2 Admin/baseline only |
| Admin `validateConfigRevision` | Sets `validated` | **Demote** | Rename copy to “release check”; not “publish to Git” |
| Legacy `writebackService` pre-cutover paths | Dual | **Retire** (follow-up) | After primary-DTS path stable |
| Export DTS / config set | Exists | **Keep** | Default export = maintained project DTS text |

## 5. Frontend surfaces

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| Module tree workbench | Default | **Keep** | Parameters under module only |
| DTS topology tech view | Toggle | **Demote** | Power users / Admin; label as diagnostics |
| Provenance / path / type on main table | Mostly in detail | **Keep** detail-only | Do not bring back to main grid |
| Mock flat `ParametersTable` dual track | Still present | **Defer** retire | Document API-mode as source of truth |
| Empty state “upload complete Config Set” | Blocking copy | **Remove-from-hot-path** | Replace with “upload project DTS” |

## 6. Seeds & demo

| Capability | Today | Action | Notes |
| --- | --- | --- | --- |
| `wiseeff-power-base.dts` synthetic base | Required for overlay seed | **Retire** | Product contract: one **project-primary DTS** per project; admins never maintain platform base. See [`2026-07-21-project-primary-dts-contract-rfc.md`](2026-07-21-project-primary-dts-contract-rfc.md). Transitional fixture retired from seed gate on `feat/parameter-maintenance-retire-dtc`; kept only for unit tests needing a minimal stub. |
| Project overlays aurora/nebula/atlas | Diff demo | **Keep** | Surface filter must hide scaffolding noise |
| Vendor schema regen from seed | Coupled | **Demote** | Still useful for L2; not for surface membership |
| Locked golden counts (176 ingest / 684 structural) | Tests | **Keep** | Update only when seed intentionally changes |

## 7. Documentation & product specs

| Document | Action |
| --- | --- |
| `docs/product-specs/prototype-functional-spec.md` (fail-closed toolchain on publish) | **Review** → align with L2 optional on edit; publish/export language |
| `docs/FRONTEND.md` validate/publish fail-closed | **Update** in MVP plan |
| `docs/design-docs/2026-07-14-dts-parameter-management-assessment.md` locks | **Review** → pointer to RFC §6 revisions (do not rewrite history; mark superseded decisions) |
| Topology round* exec plans | **Defer** closeout; new MVP is the steering plan |

## 8. Priority order for MVP implementation

1. **Surface filter** (P1) — stop showing scaffolding as parameters  
2. **Module-only default UX** (P5/P4) — hide driver as required nav tier  
3. **Toolchain off edit hot path** (P2) — L0 only on draft  
4. **Primary project DTS writeback contract** (P3/P6) — product copy + write target  
5. **Provisional rows without schema** (P4/P12) — unmatched still editable on surface  

Items marked **Retire** / large Config Set UX simplification land after the above closed loop works.
