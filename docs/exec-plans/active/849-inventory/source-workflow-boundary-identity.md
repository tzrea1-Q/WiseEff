# T1.1 exact boundary identity successor

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/source-workflow-boundary-identity.md)

Status: independent Spec and Standards reviewers passed both exact-data designs before activation and both implementations afterwards. The combined implementation passes the formal boundary gate and 128 focused script tests. This bounded identity repair is complete; it is not workflow acceptance, a new allowance, or merge authorization.

## Scope and exact data

The user authorized this separate identity repair after the unchanged boundary gate rejected T1.1's changed historical destination blobs. Original fixture, all allowance shards, five old records and their pinned digests remain unchanged. The seven additional mappings below already have original allowances; none is new debt.

The proposed [successor record](../../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json) has SHA-256 `6ae5ba0609e64987e195e282236a4429fe02b50e9c3a0d3473097d9aa9d12a48` and 82 original-to-current pairs:

| File under `server/modules/parameter-topology/` | Pairs | Exact destination blob |
| --- | ---: | --- |
| `ingestService.ts` | 20 | `12319db0dfd39eb801ddad858f6a3bd4187e87ef` |
| `schemas.ts` | 3 | `fcf2ca2c5530974baf1eda3c9c9f1d103ffc6cc4` |
| `editService.ts` | 26 | `0d87d79a907eedd265cc4c09519d6ea1228f09dd` |
| `editService.test.ts` | 28 | `22cd470949340763c3e5757d1da1b8ae2d8014d2` |
| `overlayWriteback.ts` | 5 | `2c568b87026190f5dfa640dcb83a063cde46c254` |

The two editService files are unchanged and retain all 54 mappings. The other three files retain 28 occurrences: 21 previously relocated and seven previously position-bound. Every pair retains its exact raw slice, metadata, column and stable structural anchor. Repeated same-anchor occurrences pair in byte order. This proves identity only, not surrounding runtime equivalence.

## Proposed composition

1. Keep fixture integrity, trusted-parent ancestry and allowance-growth checks first.
2. Validate the old runtime-topology 16-pair and edit-service-version-index 59-pair records as historical prerequisites using their unchanged fixed digests, original blobs and exact historical destination blobs from Git. Authenticated historical record observations are not represented as a fresh current scan. Missing Git objects or altered records fail closed.
3. Reuse the strict relocation validator for the fixed 82-pair successor against actual current scanner discoveries and current whole-file bytes, with allowance growth forbidden and stable structural anchors required. All 75 historical source endpoints must occur unchanged in the successor. No arbitrary destination override, legacy fallback, automatic hash regeneration, SQL-equivalence matching or runtime policy argument is added.
4. Only the successor supplies active aliases for these five files. The original 23-pair, post-cutover 29-pair and debugging 4-pair records keep their active checks. Final active endpoints must be unique: 138 source IDs, 138 observed IDs, no overlap. The inventory remains 3513 allowed occurrences and six retained removals.

Historical Git provenance is fixed, not supplied at runtime: runtime commit `e31226b6cc06c2278230b810bb1becd8dbc1f32a`, tree `d55df1260ea99a60fa38a3101a5e9f5af7c29fc8`; edit commit `8ef8f25179c4be1f4f64d1cb3dfed953dbd1759f`, tree `38f9040e456dcf87d575b6672161fba004bf8b69`. Verify these trees and each commit-path blob against the unchanged historical records. Historical proof has its own result type, not an active relocation outcome. The successor additionally enforces byte-order ordinal within each stable-anchor group: increasing old offsets must map to increasing new offsets, rejecting same-anchor/same-slice swaps.

## Threat and verification gate

| Threat | Required observation |
| --- | --- |
| Old/new record missing, partial, tampered or self-resigned | Reject before aliasing |
| Source, intermediate historical or current whole-file drift | Reject even outside mapped slices |
| Missing/duplicate/swapped/cross-file pair, source or destination | Reject; no partial aliases |
| Identical slice under another structural anchor | Reject |
| Missing original or allowance, changed permission metadata, growth | Reject |
| Historical endpoint omitted from successor | Reject |
| New unrelated debt or restoration of a removed allowance | Still fails inventory comparison |
| Current bytes revert to an older reviewed destination | Reject; no fallback to old active policy |
| Unchanged editService files | Remain fully checked, not dropped from old record |

Run focused relocation/checker script tests, the formal checker with accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`, TypeScript/build, docs and diff checks. Historical unit evidence is labeled historical; the new end-to-end checker must observe the actual working tree. Independent design approval precedes implementation, and independent implementation review precedes claiming this bounded repair complete. T1.1's whole-candidate/native/browser/Hosted obligations remain separate.

## Newly exposed consumer identities — separately approved design

After the 82-pair successor ran, the unchanged full inventory comparison exposed 210 unallowlisted and 210 stale identities in ten other files: 2 parameter-files acceptance, 2 import-wizard acceptance, 83 topology acceptance, 21 file writeback, 1 topology repository, 16 import-batch repository, 29 parameter service, 1 topology port, 22 topology client tests and 33 topology client. The formal gate remains failed (3303/3513 allowed); the four-file focused run passed 109/110, with only the full inventory assertion failing. This is newly visible debt identity drift, not evidence that the 82-pair design passes the full gate.

The separate [210-pair proposed record](../../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json), SHA-256 `ab82be7c29d061c27131b07badce45112c7881630f03ad248db8613b78f69240`, pairs only existing original allowances with current observations, preserving exact slice, anchor and all permission/evidence metadata. No old record, 82-pair digest, fixture or allowance is rewritten. The proposal uses the existing strict runner after the 82-pair step, yielding 348 active aliases only if both independent design reviewers approve these exact bytes. It has no historical predecessor record and must not use the historical proof path.

Some import-batch observations share an anchor and byte range but have different scanner evidence (literal versus resolved-template detection). Group ordinal validation by **anchor plus the already-required unchanged token, evidence and column**; never pair different evidence merely because offsets tie. Within each such identity group, old/new offsets preserve strict order. The existing exact metadata comparison independently rejects swaps across groups. Keep an executable same-anchor/same-evidence swap refusal and add a case proving distinct evidence at the same source range is not conflated. No SQL normalization or evidence-field exception is permitted.

## Current implementation receipt

Both reviewers approved the exact 210-pair bytes above before implementation. The fixed consumer configuration now reuses the strict runner after all 138 prior aliases, with the required evidence-aware ordinal grouping. Final composition is **348 aliases / 696 distinct endpoints**, not the 138-alias intermediate checkpoint above.

- `npm run test:scripts -- scripts/parameter-catalog-allowlist/sourceWorkflowRelocation.test.ts scripts/parameter-catalog-allowlist/runtimeTopologyRelocation.test.ts scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts`: **4 files / 128 passed / 0 failed / 0 skipped**. The missing-Git-object negative test deliberately emits an unknown-revision diagnostic from its empty disposable repository.
- `npx tsx scripts/check-parameter-catalog-boundaries.ts --trusted-base-sha 46b6068693942b95f7cba28ee5de6748a97170fa`: **exit 0; 3513 allowed / 0 unallowed / 0 stale / 0 metadata mismatch / 0 growth; 348 aliases**. CLI JSON was captured and summarized without changing the command or verdict.
- `npm run build`: passed, with existing browser-externalization and large-chunk warnings. `git diff --check`: passed. Both new record digests remain exactly as reviewed; no tracked historical fixture or allowance file changed.

Standards: **PASS**, no P1/P2 or reportable smell; independently checked all ten source/destination blobs, endpoint disjointness and 195 ordinal groups, including five shared-range distinct-evidence groups. Spec: **PASS**, no P1/P2; fixed policy, composition and negative-test coverage match the separately approved design. Neither reviewer reran the slow scanner; the executable results above are parent-observed.

`npm run docs:check` passed against a freshly migrated helper-owned disposable pgvector database, including the schema artifact with no skip. Node TypeScript compilation passed. Whole-candidate T1.1 review remains pending. No commit, PR, Hosted claim, merge, production operation or next todo is authorized by this receipt.

## Documentation Impact Matrix

| Area | Disposition |
| --- | --- |
| Identity policy | Update this bilingual decision; preserve historical decisions |
| Status/evidence | Update bilingual T1.1 threat matrix and todo status with actual results |
| Runtime/API/schema | No change in this repair |
| Generated baseline/allowances | No change |

## Documentation Update Gate

Maintain the Chinese companion and run documentation checks before reporting this repair complete. Do not tick T1.1 solely because the boundary checker passes.
