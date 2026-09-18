# T2.2-MOD implementation review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-mod-module-consumers-impl-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Independent Standards and Spec of the uncommitted T2.2-MOD subject/locator pin and overlay picker retarget. Reviewers did not write the code. No production edits, no commit, no T2.2-OPS, no SEAL from this review.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`. Scope: `repository.ts`, `service.test.ts`, `recomputeDryRun.integration.test.ts`, `OrganizationModuleGovernancePanel.tsx` + `.test.tsx`, `ParameterAdminNextPage.tsx`.

Standards `01a0b071-c8e4-7b29-9d5a-4f6e1a82b7c3`. Spec `01a0b069-719c-7a0f-a969-8e4b1edf977c`.

## Standards

Verdict: **PASS with P2**

No hard documented-standard breaches. Overlay adapter on the port and honest-zero ratchet not flagged (design freeze). Tooling-enforced issues skipped.

**(a) Documented standards.** Tenant isolation kept (`asub.organization_id is null or asub.organization_id = b.organization_id`; `b.organization_id = $1`) — AGENTS.md non-negotiables / [docs/SECURITY.md](../../../SECURITY.md) data isolation. Catalog is `runtime.parameterCatalogRepository` from `PageProps.runtime`, not a second Catalog HTTP client — [docs/FRONTEND.md](../../../FRONTEND.md) `createAppRuntime` adapters / `src/app/` pages receive `runtime`. Picker helper stays in-family with nearby `OrganizationSpecGovernancePanel` mapping. SQL pin shape matches existing parameter-modules inline queries and T2.2-DTS `br` + `config_revision_id = br.config_revision_id`.

**(b) Baseline smells (judgement).** **Duplicated Code** — the binding-tip + locator laterals are copied in `listBindingsForModuleRecompute`, `listObservedCompatiblesForDiscovery`, and `listDismissedCompatiblesForDiscovery`:

```
left join lateral (
  select id, config_revision_id
  from project_parameter_binding_revisions
  where binding_id = b.id
  order by created_at desc
  limit 1
) br on true
left join lateral (
  ...
    and config_revision_id = br.config_revision_id
  order by id desc
```

Family SQL is already inline-per-query, so this is P2 not FAIL.

Do not mark T2.2-MOD complete from this review.

## Spec

Verdict: **PASS with P2**

Checked design A–C / §4 and matrix T22M-02–07 / 10 against the named production files and tests.

P1: none. Live leaks are gone.

- **A / T22M-02.** `listBindingsForModuleRecompute` projects `asub.source_key as driver_module`, join `asub.id = ps.attribution_subject_id`. Remap identity remains `ps.attribution_subject_id`. Production SQL has no `string_to_array` / `split_part` / `specification_key` CASE and no `display_name` join.
- **B / T22M-03–04.** All three queries take binding tip `br` (`binding_id = b.id order by created_at desc limit 1`) then `config_revision_id = br.config_revision_id`. The three `order by config_revision_id desc limit 1` fallbacks are gone. Missing `lnr` leaves compatible/locator null; discovery omits via `lnr.compatible is not null`.
- **C / T22M-06.** `listModuleOverlayLibrarySpecs` uses `listDefinitions()` when the catalog port is present (definition id / `propertyKey`; no `specificationKey` tail). Else default `listSpecs()` with no view. `ParameterAdminNextPage` passes `runtime?.parameterCatalogRepository`. Never `listSpecs({ view: "governance" })`.
- **T22M-07.** Overlay `/api/v2/organization-driver-schemas*` stays 2xx. Governance list handler not 410'd. Remaining `OrganizationSpecGovernancePanel` governance list is CGH leftover, out of family.
- **T22M-10.** 51 groups / 283; archived-notice 0; delta 0. Leaks gone; checker blocked on T2.2-TOP `editService.ts`. Honest zero allowed.

P2: design D fail-closed case (newer LNR on another config does not win) is SQL-shape only; dry-run seed has no competing LNR. Overlay picker 1440x900 (T22M-11) not observed.

Local candidate may be reported. Do not mark T2.2-MOD SEALED/committed.
