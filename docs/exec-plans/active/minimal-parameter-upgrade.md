# Minimal parameter upgrade

> Chinese: [中文](../../zh-CN/exec-plans/active/minimal-parameter-upgrade.md)

Status: implementation. Accepted user scope: 2026-09-09. Base: `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`.

Preserve all non-parameter records, original keys and relationships, object bytes and task state. Leave legacy parameter tables and shared references intact. Start the new parameter system unpublished and empty; never fabricate a release. Deliver actual create/read/update, basic import, production API/worker startup, restart persistence, and one backup restore through the existing self-hosted upgrade entry.

The selected route is `--parameter-data-mode new-empty`, bound to its plan and run, never a runtime bypass. Historical migrations and ledgers remain immutable. Reject unknown sources and partial conversions before downtime. Management initialization must not recur on restart or repeat execution. Failures after migration retain isolation.

This accepted run profile replaces the full populated certification scope for this branch. PR #824 and Scratch remain separate. Old parameter equivalence, mapping/Archive and P0–P16 certification are not prerequisites for this route. No merge or production execution is authorized.

## Execution and evidence

One implementer, one Docker lane. Reuse the fixed `82344044b436a8dafecefbb85dfd724cecb05e3f` old-source fixture. First run the vertical probe; fix its first observed failure before expanding tests. Preserve original HTTP upload failures as failures even when an explicit synthetic producer proves old worker behavior.

| Step | Acceptance | Current evidence |
| --- | --- | --- |
| Old source to migrations | Full source ledger/schema verified; protected rows retained | Real old semantic cutover, repeat compatibility preparation, then all 0129–0139 applied; 126 original tables / 190 original records retain every original field. Small component probe, not full upgrade acceptance. |
| Empty catalog to first real data | Actual authenticated page/API, legitimate publication, import regression | Production API returns unpublished empty state; compiler/installer creates a real nonempty first release and API reads it after restart. Page editing/import not yet accepted. |
| Upgrade entry and restart | Existing controller, run-bound initialization, readiness and queue/proxy restoration | Mode/plan/run and management initialization integrated, focused shell checks pass. Full terminal run pending on amd64; local daemon is arm64 and the existing platform guard is retained. |
| Preservation and recovery | Every protected original record/relationship, objects and necessary tasks; actual restore | Real PostgreSQL restore preserves original rows and removes the new schema. New HTTP upload returns 201 and the worker completes it. An actual object-store outage leaves the task delayed; recovery completes attempt 2. Redis snapshot/restore now stops the process before copying AOF and loads the recovered BullMQ task after restart. Same-run PG/object/Redis terminal acceptance remains pending. |
| Review and delivery | Stable focused/full gates, three browser viewports, independent Standards/Spec, required CI | Empty Catalog, original node details and published definition inspected in all three viewports. First registration succeeds; hidden first Subject and missing success refresh fixed. Initial demo-project request reproduced and fixed with a delayed-live-project regression. Full edit/import browser acceptance, CI and independent review pending. |

Source copies, trusted target build and maintenance window are production inputs, not reasons to block isolated implementation. Any conflict requiring new privileges or publication semantics must name the specific blocked operation. No broad new controller or checker is in scope.

Current evidence is WIP, not a sealed candidate or target-server build. API/worker business used ARM image `sha256:9bb4554d4e20b34a09f452663630bca2d9c4d8121e0af4a3e70a3076c09e0ae9`; the retry/first-Subject browser build was `sha256:afd02abed466a6afd93056624b700f65f0fcb69b6777cf4e48d915c4ce8de4cc`. Later refresh/hydration and Redis restore edits are not covered by those images. Focused results: 60 backend units, 31 Catalog frontend tests, one live-project hydration regression, three offline Redis restore shell cases. The browser checkpoint expired after partial observations; that process ended nonzero and cleaned its source. Auxiliary browser resources were separately removed. No complete browser acceptance is claimed.

The first terminal probe is `scripts/run-minimal-upgrade-acceptance.ts`, launched by the `minimal-upgrade` workflow-dispatch mode. It creates its own stock Compose deployment and invokes `upgrade.sh`; the local native ARM preflight rejects before deployment creation. Its current successful endpoint would still be only original login/node plus unpublished Catalog, explicitly `complete:false`; first parameter write, record/object oracles and combined rollback must extend this same run before acceptance. The first Hosted failure is recorded below. Do not treat this intermediate driver as a tested production manual.

Hosted run [34306500953](https://github.com/tzrea1-Q/WiseEff/actions/runs/34306500953), code `75a5f88f7849fbb78b7d487a24c5f0e99679378e`, built the fixed old source as actual amd64 image `sha256:f26bb4fc466ff1a65c980503d1ba8afb32460bc8a9fc04017d05a2f0dc7b3fa4`. It stopped at `old-start` / `minimal-terminal-api-not-ready`, before upgrade or migration, and cleaned its deployment. Dependency/command diagnostics have now been added using the existing sanitizer; the source is not patched and the timeout is unchanged. The separate documentation job failed because the Chinese plan used English section headings; those headings are corrected. This run is not a required-CI pass.

The object restore probe reproduced lost S3 metadata despite equal bytes, including with native `mc mirror --preserve`. The local single-node MinIO volume recovery now restores original bytes, `contentType`, `originalFileName`, `retentionClass`, and removes a post-backup object. These are actual stopped-service snapshot/restore observations, not whole-terminal acceptance. Nine focused upgrade shell cases and 143 App regressions pass; the documentation governance check passes, with schema-document verification still pending on the owned database.

Remaining product seam: the Catalog contract publishes reviewed repository bundles; a page proposal is publication intent only. The project parameter workbench still reads the old parameter model and canonical ProjectValue requires an actual binding/source/config revision. Existing publication rules remain in force. Neither a successful proposal nor a manually supplied source ID proves the requested new parameter edit/save workflow. No permission expansion or fabricated source is authorized by this plan.

## Documentation Impact Matrix

| Area | Action | Files |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning | Update | This plan and its Chinese companion |
| Product and architecture | Review | `CONTEXT.md`, `docs/design-docs/domain-model.md` |
| Testing and frontend | Review | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` |
| Reliability and references | Update | `ops/self-hosted/upgrade.md`, `ops/self-hosted/upgrade.zh-CN.md` |
| Security and governance | Review | `docs/SECURITY.md`, `docs/agents/agent-delivery-protocol.md` |
| Generated schema | Review | `docs/generated/db-schema.md` |

## Documentation Update Gate

Keep this plan active until all acceptance rows have candidate-specific evidence and every documentation row is resolved. Before closure run `npm run docs:check`, record actual tested upgrade/recovery commands, exact candidate/image identity, full source/diff and independent review. Separately report code merge readiness and production execution prerequisites.
