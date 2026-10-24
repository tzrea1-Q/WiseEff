# Organization management implementation

> Chinese: [组织管理实施计划](../../zh-CN/exec-plans/active/2026-10-23-organization-management.md)
> Status: Active. Parent: [#1368](https://github.com/tzrea1-Q/WiseEff/issues/1368).

Implement tickets #1369–#1401 on `codex/organization-management-1368`, based on `e795bd1a70c07391f893e4818cd8b07c138abcb3`. The explicitly invoked implement-spec workflow owns this integration branch and draft PR. Implementers use exclusive worktrees, TDD at confirmed seams, ticket commits and integration through a merger agent. Production mutation and deployment remain outside this task.

## Delivery and verification

Follow native issue dependencies. An implemented-and-integrated blocker unlocks its dependants on this branch. Open a draft PR after the first implementation merge, retain closing references to parent and children, and mark ready only after all ticket and review evidence is complete. Do not close unfinished tickets or present local evidence as CI acceptance.

Confirmed seams: real API behavior, PostgreSQL persistence/concurrency, API-mode browser at 1440×900. Implementers run scoped red/green and related/static checks. Coordinator owns selected expensive gates, build, browser and CI. Isolate database prefixes and runtime lanes. Preserve existing required checks and Agent/device human approval.

## Documentation Impact Matrix

| Documentation | Update boundary |
| --- | --- |
| Glossary, ADR-0051 and organization design | Import accepted English/Chinese design with #1369; retain honest implementation status. |
| API and database contract | Update public/schema changes; generate schema docs against the current candidate. |
| Organization user guide | Update operator/member flows with #1401 in both languages. |
| Recovery and operations | Document suspension, erasure retry, OIDC synchronization and backup-restoration behavior with implementation. |
| This plan and draft PR | Track integrated tasks and observed verification; detailed evidence lives in the PR. |

## Documentation Update Gate

Update affected English/Chinese companions before each integrated slice is handed off. Run docs governance when documentation changes. Mark a ticket complete here only after its integration and required candidate checks; explicitly retain missing database/browser/CI evidence. Archive this plan only when the entire specification is delivered.

## Ticket graph progress

The checklist tracks scoped implementation and integration; whole-candidate CI and independent review remain separate gates. Initial frontier: #1369, #1385, #1386.

All 33 slices, #1369–#1401, are integrated with scoped API/PostgreSQL and API-mode browser checks. All four erasure adapters compose in dependency order; final receipts and retained audit proofs contain no business payload. Applicable deleted and failed states replay against real older PostgreSQL, file and independent checkpoint backups before reopening; inconsistent checkpoint ownership blocks access. The continuous operating workflow passed at source 3ddfaa9c4 with actual local identities (2/2) and a separate controlled signed OIDC lane (2/2), with no failures/skips and independent provider artifacts. Its real API/worker PostgreSQL, actual-file and loopback-callback related checks passed 9/9. Local-password and OIDC browser operations remain explicitly provider-conditional; default HMAC CI cannot establish either result. Fresh PostgreSQL measured 286 migrations through 0291 and the new Catalog fingerprint; historical pins remain intact, and the current Catalog harness passed 6/6.

CI 40055219999 at f2290ab33 completed with failures. The native pg_restore invocation and compact review-inbox readiness defects are repaired with actual PostgreSQL 6/6 and API-mode browser 6/6 checks. Valid PNG/EOCD and embedded ZIP64 regressions passed 39/39; the original refused CI artifact was not uploaded, so its identity remains unknown until a new full run. Independent Standards and Spec reviews identified five issues: feedback tenant isolation, failed-log notification, password-reset/transfer concurrency, suspended-organization artifact GC, and ZIP64 container classification. One implementer fixed all five, the original reviewers found no remaining findings in the bounded repair diffs, and related checks passed 153/153 for the first four plus the separate 39/39 sanitizer suite (these batches overlap other evidence and are not summed).

CI 40059381846 at 1c9f65afc passed static/build, frontend, scripts/bridge, backend2, smoke, accessibility and both consistency lanes. Its visual lane passed 40 and failed only the four then-pending baselines; compact light/dark passed, and L2 shard1's browser phase passed. Backend1 passed 3650 and failed one pre-existing manager timer test: its actual PostgreSQL work legitimately exceeded the test's 200ms activation deadline. A controlled real-installer/Receipt diagnostic reproduced that ordering; the success test now controls JavaScript timers while retaining real PostgreSQL, all assertions and unchanged timeout/error cases. Related checks passed 16/16 with zero skips, and independent bounded review found no findings. Production timing is unchanged.

CI 40061324926 at 033baad93 passed all functional checks, including 7412 backend tests and all four browser phases; only four visual baseline comparisons and their aggregate gates failed. On 2026-10-24 the user explicitly approved organization-members, state-dialog-modal-open, state-table-row-hover and state-table-sort-header-focus. The original CI46 binary patch was applied at its exact failed head, with only those four PNGs committed. The delivery candidate also incorporates main 068254f9d, preserving its sidebar/save changes, organization/project scope and permission behavior; affected browser selectors follow the actual links and compact menu. Normal Linux CI on this combined candidate remains required before the now-authorized merge. Full MinIO/Redis, deployed external IdP and target-host restoration have not been run.

- [x] [#1369](https://github.com/tzrea1-Q/WiseEff/issues/1369) 前置兼容：真实身份与操作范围分离
- [x] [#1370](https://github.com/tzrea1-Q/WiseEff/issues/1370) 组织目录、创建与初始管理员
- [x] [#1371](https://github.com/tzrea1-Q/WiseEff/issues/1371) 管理员交接、最后管理员保护与恢复
- [x] [#1372](https://github.com/tzrea1-Q/WiseEff/issues/1372) 进入目标组织并管理成员与设置
- [x] [#1373](https://github.com/tzrea1-Q/WiseEff/issues/1373) 跨组织项目与参数管理贯通
- [x] [#1374](https://github.com/tzrea1-Q/WiseEff/issues/1374) 跨组织日志分析与回调范围贯通
- [x] [#1375](https://github.com/tzrea1-Q/WiseEff/issues/1375) 跨组织知识与 Agent 工作上下文贯通
- [x] [#1376](https://github.com/tzrea1-Q/WiseEff/issues/1376) 跨组织设备代理与集成凭据管理
- [x] [#1377](https://github.com/tzrea1-Q/WiseEff/issues/1377) 审计、通知与反馈的操作范围收口
- [x] [#1378](https://github.com/tzrea1-Q/WiseEff/issues/1378) 扁平团队与多团队归属
- [x] [#1379](https://github.com/tzrea1-Q/WiseEff/issues/1379) 存量项目参与关系回填与名单展示
- [x] [#1380](https://github.com/tzrea1-Q/WiseEff/issues/1380) 项目参与者授权与编辑规则切换
- [x] [#1381](https://github.com/tzrea1-Q/WiseEff/issues/1381) 团队成员批量配置项目角色
- [x] [#1382](https://github.com/tzrea1-Q/WiseEff/issues/1382) 一次性邀请加入与邀请管理
- [x] [#1383](https://github.com/tzrea1-Q/WiseEff/issues/1383) 邀请预设团队和项目授权
- [x] [#1384](https://github.com/tzrea1-Q/WiseEff/issues/1384) 公开体验注册开关与目标组织
- [x] [#1385](https://github.com/tzrea1-Q/WiseEff/issues/1385) 参数、评审与审计历史署名固化
- [x] [#1386](https://github.com/tzrea1-Q/WiseEff/issues/1386) 知识、日志与 Agent 历史署名固化
- [x] [#1387](https://github.com/tzrea1-Q/WiseEff/issues/1387) 成员离职即时撤销访问
- [x] [#1388](https://github.com/tzrea1-Q/WiseEff/issues/1388) 项目草稿、评审职责与待办交接
- [x] [#1389](https://github.com/tzrea1-Q/WiseEff/issues/1389) 知识草稿与组织业务资产交接
- [x] [#1390](https://github.com/tzrea1-Q/WiseEff/issues/1390) 本地账号跨组织调动
- [x] [#1391](https://github.com/tzrea1-Q/WiseEff/issues/1391) OIDC 账号调动与外部同步检查
- [x] [#1392](https://github.com/tzrea1-Q/WiseEff/issues/1392) 组织停用与恢复全通路
- [x] [#1393](https://github.com/tzrea1-Q/WiseEff/issues/1393) 组织删除影响预览与准入检查
- [x] [#1394](https://github.com/tzrea1-Q/WiseEff/issues/1394) 空组织彻底删除与持久进度
- [x] [#1395](https://github.com/tzrea1-Q/WiseEff/issues/1395) 含项目与组织参数资产的组织删除
- [x] [#1396](https://github.com/tzrea1-Q/WiseEff/issues/1396) 含知识、索引与附件的组织删除
- [x] [#1397](https://github.com/tzrea1-Q/WiseEff/issues/1397) 含日志、分析和 Webhook 的组织删除
- [x] [#1398](https://github.com/tzrea1-Q/WiseEff/issues/1398) Agent、设备及其他组织状态清理
- [x] [#1399](https://github.com/tzrea1-Q/WiseEff/issues/1399) 混合组织删除完成判定、回执与恢复
- [x] [#1400](https://github.com/tzrea1-Q/WiseEff/issues/1400) 组织概览、资源索引与六入口整合
- [x] [#1401](https://github.com/tzrea1-Q/WiseEff/issues/1401) 组织运营闭环与整体验收交付
