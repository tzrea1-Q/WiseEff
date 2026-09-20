# T2.1 规范数据上的完整参数 UI — 本地实现回执

> English: [English](../../../../exec-plans/active/849-inventory/t21-parameter-ui-acceptance.md)

状态：**T2.1 本地候选完成。** 设计 Spec PASS with P2；实现 Standards PASS with P2；实现 Spec 先 FAIL，topology 暂存修复后 PASS with P2（grok-4.6；要求的 gpt-5.6-luna 不可用）。不执行正式 SEALED、commit、PR、合并、Hosted、目标环境或 Issue 更新。

契约：[威胁矩阵](t21-parameter-ui-threat-matrix.md)、[设计](t21-parameter-ui-design.md)、[设计 Spec 评审](t21-parameter-ui-spec-review.md)、[实现复审](t21-parameter-ui-impl-review.md)、#849/#853 T2.1、已关闭 #847。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未改）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.4 仍是同一树上的未提交脏工作。无 commit。

## 已交付行为

1. 未匹配导入行为 `status: "unmatched"`，可见，徽章「不会应用」，仅跳过（无预填并创建/通过）。`toSourceItems` 排除。解析报告：未匹配（不会应用）。
2. FRONTEND.md / 中文托盘删除改为 `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`。
3. PARAM-DRAFT-REMOVE-001 改瞄准 canonical v2 列表/删除；重载后断言 `reason` 与 `updatedAt`。
4. B5 GET/DELETE 在 C4 为空时联合 topology `parameter_drafts`（类型化 DTS 保存仍是 `writeTarget.role=base`）。托盘重载仍在；v2 DELETE 删 topology 行。
5. 导入预览：唯一 topology `propertyKey` 匹配为 **更新**，不铸定义/`added`。未绑定名仍为 **冲突**。应用在无 C4 钉时暂存 topology 类型化草稿（`createBindingDraft`）；catalog 行仍走 C4 `createCanonicalValueDraft`。
6. #847 CatalogPage 是 `/parameter-admin` 工作区。导入是顶栏「打开批量参数导入」。PARAM-ADMIN-001 / PARAM-REASON-001 已离开退役的「参数定义库」区域。

## 验证（不要加总）

Helper PG：`postgres://wiseeff:wiseeff@127.0.0.1:55438/…`。不是 `wiseeff_lane_849`，不是 compose `5432/wiseeff`。Playwright webServer 在 15173/18787（不复用其他 worktree 的 5173/8787）。视口 1440x900。

| 命令 | 结果 |
| --- | --- |
| `test:server` `catalogProjectValueRoutes.test.ts` | **20 passed** |
| PARAM-DRAFT-REMOVE-001 | **passed**（10.9s） |
| 未匹配导入 Playwright | **passed** |
| PARAM-ADMIN-002 五步 + 未匹配 | **3 passed**（warmup + 应用暂存 `parameter_drafts` + 未匹配不合格） |
| PARAM-ADMIN-001、PARAM-REASON-001 | #847 改瞄准后 **passed** |
| PARAM-REJECT-001 | **passed** |
| parameter-files 上传/列表/同步 + 草稿冲突 | **passed**；rollback 跳过 |
| PARAM-DRAFT-EDIT | **409** missing-logical-node-revision |
| Catalog lane 847 Playwright | 无 owned Gate0 HMAC 时 **401** |
| `git diff --check`（T2.1 文件） | passed |

Mock ≠ 验收。未把 T1.3 的 124×3 当 UI 夹具。

## 剩余限制

- Topology 暂存证明是合成的（`sourcePinId` 用 overlay/draft id；重放只查 `parameter_drafts` 是否仍在）。C4-else-topology 分支没有独立 `importService` 单测。
- v2 DELETE topology 回退无审计、未按项目收口（Standards P2）。
- `parameterRuntime.refresh` 仍 GET `/api/v1/parameter-drafts/mine`。
- 撤回/再提交无 Playwright 属主。PARAM-INIT-* 仍是 `future`（T2.2-PRJ / T3.2）。
- Catalog 归档/404（#876）本轮未再证（lane HMAC）。
- 完整 `parameter-topology` PARAM-HAPPY 本轮未重跑（只跑了托盘移除）。
- 去掉「预填并创建」后仍留 `new-confirmed` 资格。

无 commit/PR/seal。未开始下一 todo T2.2。
