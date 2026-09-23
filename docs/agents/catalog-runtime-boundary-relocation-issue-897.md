# Issue #897 T14 Catalog boundary successor

> Chinese: [中文](../zh-CN/agents/catalog-runtime-boundary-relocation-issue-897.md)

Issue #897 changes `server/modules/parameter-modules/repository.ts` and `service.test.ts`. Their T14 relocation records are historical evidence, not records to refresh. The 265-pair family record keeps SHA256 `6e55b1378acf6f4439392ae53971092a996c12b41fe358fa31622f052e7f4cf2`; the 57-pair rewritten-slice record keeps SHA256 `56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7`. Both are proved in full against accepted commit `097ad35625cc8ca2401f2cd028404f16a18a75ba`, tree `74b3df3635590d34738896e550e31eb9c8db0948`, before any current alias is returned. The original fixture, trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246`, and historical record bytes remain unchanged.

The changed files contained 49 historical source IDs. Exactly 45 are still present and have reviewed successors; four retired IDs are removed from `s12-mod.json` and must not reappear in the current scan:

```text
S12-MOD:legacy-catalog-table-name:860a2404dfe5c6b4:8cd263657607ec3e
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:7d4a0c6f2bb42f1c
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:95f694f205d9301b
S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:0302adf87a58e40f
```

| Current successor | Pairs | Record SHA256 | Constraint retained |
| --- | ---: | --- | --- |
| [Repository unchanged slices](../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-successor-relocation.json) | 13 | `a0f5d0caa2b6e5248441f8843a53c1143ac96d62227221775ae5d471ab308a0b` | Exact metadata, identical source/destination slices, stable anchor and byte order |
| [Repository rewritten slices](../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-rewritten-repo-successor-relocation.json) | 7 | `947ed35426467b1aadd1f7dc634830f20748d0163448a5421e0c4b0ed424a4d4` | Exact source/destination digests, stable anchor and byte order; two pairs change evidence |
| [Service test unchanged slices](../../scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-service-successor-relocation.json) | 25 | `ed511587dcca81969d4ebbefbe8ef043f36daedf8e8de0edf0c02c6ed9fa8077` | Exact metadata, identical slices and stable anchor; three same-anchor groups changed order |

All repository successors bind source blob `317be751e3dc08d55a6ae13bd9d65cd10aab48fb` to current blob `204e51efd0a3fb30a50bb9280d1eae2f72f50e3d`. Service-test successors bind source blob `446feecddef52b95c724121bff44a28f5e82cb8e` to current blob `ff6bd61fc8e9fcca54123066f078fb2eb0cff48a`. A verification scan found exactly one service-test candidate for each fixed `file + line + token`; column, byte span, evidence, reason, and structural anchor match, while only occurrence ID and trusted whole-file blob changed. Every pair is also checked against the fixed old observation and exact current scanner observation. There is no new allowance.

The separate stale-allowance successor record covers 63 exact pairs from 80 old IDs: 33 S12-MOD pairs and 30 S12-PRJ pairs. It preserves the exact source/destination slice, metadata, stable structural anchor, and byte order. The other 17 IDs are retired and removed from their owning shards: 15 from `s12-mod.json` and two from `s12-prj.json`. The deleted `BindingCountRow.parameter_spec_id` at old `repository.ts:66` is retired; the distinct `RecomputeBindingDbRow.parameter_spec_id` at old line 331 maps to its current field at line 386. The two retired S12-PRJ records are the old `project_parameter_bindings` read moved to the Governance current-binding query owner and the removed unresolved legacy table expression. The fixed IDs and partition are listed in [the successor helper](../../scripts/parameter-catalog-allowlist/issue913StaleSuccessorRelocation.ts).

| Successor record | Pairs | Record SHA256 | Constraint retained |
| --- | ---: | --- | --- |
| [Stale allowance successors](../../scripts/fixtures/parameter-catalog-allowlist/issue-913-stale-successor-relocation.json) | 63 | `6051c3bddfe35eae74d38f01c05661a3353bb330bdbe921f02cbfdf7eb95c2d3` | Exact metadata and slices, stable anchor and byte order |

The checker activates 228 unchanged family pairs, 45 unchanged rewritten-slice pairs, and the 45 T14 successors above: 318 T14 aliases. The separate stale-allowance stage adds 63 aliases, for 817 active relocations across the full checker chain. It rejects missing, duplicate, cross-record, or revived endpoints; changed records or whole-file blobs; allowance growth; and any failure of either fixed partition: 49 = 45 + 4 for T14 and 80 = 63 + 17 for stale allowances. Unrelated current observations are not implicitly mapped. These records prove occurrence identity only; module-management behavior and permissions require their separate PostgreSQL and browser tests.
