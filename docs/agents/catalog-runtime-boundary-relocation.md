# Runtime topology occurrence identity repair

> Chinese: [Chinese](../zh-CN/agents/catalog-runtime-boundary-relocation.md)

This bounded prerequisite belongs to [EFF Issue #828](https://github.com/tzrea1-Q/WiseEff/issues/828) and the [active efficiency plan](../exec-plans/active/2026-09-13-agent-delivery-efficiency.md). The user authorized continuing EFF and resolving its blockers. Independent Standards and Spec design review accepted these exact 16 existing occurrence identities before implementation. This decision does not approve Catalog runtime behavior, readiness, frozen milestones or target operations.

At accepted main `9dc751690a615b162bb41feef6392289b2ca7f6a`, the boundary checker found 3513 occurrences but recognized only 3497: PR #832 moved 15 existing legacy identifier occurrences in `server/modules/parameter-topology/ingestService.ts` and one effective-view literal in `server/modules/parameter-topology/schemas.ts`. Their raw slices and allowance metadata are unchanged. Surrounding error-handling behavior did change; this record makes no SQL or runtime equivalence claim. Production source stays byte-for-byte unchanged by this repair.

The original S0-ID fixture remains 3519 entries at `9b3ba7df7e21f5589684bc92c872da593ad4c246`; allowances remain 3513 with all six removals retained. The [separate fixed record](../../scripts/fixtures/parameter-catalog-allowlist/runtime-topology-relocation.json), SHA256 `7c99527e2473aac06b64fc3e3db892d1b866843a8092bf39c058bdc5e81afaa2`, binds complete occurrence pairs, original fixture digest, exact raw slices and complete source blobs:

| File | Historical blob | Current blob |
| --- | --- | --- |
| `ingestService.ts` | `30e4e8107a7dbf11a0a4c81e9aab355f303e43f1` | `1f28235a496dfc57b649966b714588155eae982b` |
| `schemas.ts` | `4e10ae4b663012ac0fec7b611db828c508569555` | `d6669310903a9d00a8ce9b923e4fa9ec63f80ef2` |

The existing fixture-integrity, explicit-base ancestry and trusted-parent growth checks run first. The [previous 23-pair record](catalog-boundary-relocation.md) stays unchanged. The new validator checks all 16 pairs, complete blobs, positions, raw bytes, actual scanner discoveries and original allowance metadata before binding any identity. Source and destination IDs must each be unique across both records. The report exposes one `relocations` list containing exactly 23 previous plus 16 new mappings. No inventory regeneration, generalized relocation search, allowance growth, padding, exclusion or trusted-base substitution is introduced.

Missing, partial, self-edited or corrupt records; swapped/duplicate identities; altered allowances; wrong files, blobs or positions; and dirty/future edits anywhere in either source file fail closed. New debt remains unallowlisted. A subsequent source change must remove debt or obtain another independently reviewed exact identity decision; editing the record cannot authorize itself. Draft PR #824 has a different Knowledge Audit proposal and may overlap the checker's integration/assertion files later. This repair does not modify or integrate that work.

Local Red on main reported 16 new and 16 stale identities. The same checker on implementation `e31226b6cc06c2278230b810bb1becd8dbc1f32a` accepted 3513/3513 with no new/stale/growth/metadata errors and 39 relocations. The three focused files passed 82 tests. Commands were `npm run test:scripts -- scripts/parameter-catalog-allowlist/runtimeTopologyRelocation.test.ts scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts` and `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9dc751690a615b162bb41feef6392289b2ca7f6a`. Original build and direct documentation governance passed; local schema verification was not run. Final review and Hosted evidence belong to the next plan checkpoint.

The same prerequisite isolates M1 browser evidence loading inside its existing suite's `beforeAll`. Native collection now lists 196 tests in 39 files without M1 evidence; the isolated M1 test still fails with missing evidence. All 57 assertions and its existing test, timeout and runtime requirements remain. This restores collection without making M1 or full browser acceptance pass. Rollback is a reviewed revert of the repair commits, which restores the known checker/collection failures without changing product source.
