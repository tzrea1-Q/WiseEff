# 有效驱动参数存量升级修复

> English: [English](../../../exec-plans/completed/2026-08-29-effective-driver-populated-upgrade-repair.md)

## 目标

修复 Issue #649 的真实存量数据库升级路径，使 API 模式参数库只展示每个 canonical
driver property 唯一、已启用且已有组织模块归属的有效定义。无法确认驱动身份的旧数据
只保留为治理历史，禁止按同名属性键强行合并。

2026-08-29 自托管数据库证据为：4 个 canonical driver 下有 23 条 active 属性，另有
59 条无 subject 的 active DTS surface、19 条无 subject 的 driver schema root，12 个
“组织 × driver registration”目标均无 driver-group placement。已应用的 `0118` 至
`0126` 保持不可变。

## 架构与边界

- 新增追加式 `0127` 修复迁移：修正 canonical root identity，将无法识别的 active
  staging surface 退回仅治理的 draft，并确定性创建顶层 driver-group 模块及 placement。
  不删除历史、不猜业务分类、不以 property key 单独推断驱动。
- NodeType taxonomy 与有效 driver catalog 分离。已有 node-type module 继续权威；缺失
  node-type placement 的数据留在 taxonomy 治理范围，不冒充驱动定义。
- 普通参数库使用 effective projection；只有显式 governance 请求才显示历史数据。
- 自托管升级在迁移后执行独立 catalog readiness gate；基础健康检查不能代表参数库可用。

## 已确认的公共测试 seam

操作者已在实现前确认：真实 PostgreSQL populated upgrade、升级后的 CLI gate、参数库
effective/governance 投影，以及 self-hosted upgrade fail-closed 四个 seam。

## 工作拆分

1. 增加 populated PostgreSQL 红测，复现空 effective catalog 与 blocked gate。
2. 增加 `0127` 确定性、幂等且符合 owner 边界的修复迁移并转绿。
   同一事务内继续覆盖后续新增组织与延迟物化平台目录的顺序。
3. 增加 API/application 红测，修正默认 effective，保留显式 governance。
4. 增加 upgrade script 红测，覆盖 catalog gate 成功与失败。
5. 运行 PostgreSQL、前端/application、脚本、迁移不变量、文档、schema、构建与浏览器门禁。

## 预期结果

- populated fixture 升级后 active subjectless DTS surface 与 driver root owner mismatch 均为零。
- 每个“组织 × canonical registration”只有一个顶层 driver-group module 和 placement；
  没有权威业务分类时 category 保持空。
- effective 只包含 active、已版本化、唯一 placement 的 canonical driver property；
  governance 保留旧 draft 证据。
- 参数定义独立门禁 blocked 时，自托管升级不得报告 completed。

## 结果与证据

- `0127` 在不删除历史行的前提下修复服务器存量形态，并安装确定性维护触发器，防止后续新增组织或平台属性时复发。
- 真实 PostgreSQL 目录与 populated upgrade 测试 18/18，通过迁移前 blocked、迁移后 ready、幂等重放、binding rehome 及两种后续写入顺序；另一次全新库演练先迁移至 `0127`、再执行 M0/M1 seed，无需重放迁移即得到 `--catalog-only` ready 且七项检查全为零；迁移历史/不变量测试 77/77。
- 修正旧 seed fallback 后，backend 全量 2,860/2,860：名称冲突时保持确定性 driver group 为顶层，不再尝试把 `unclassified` 模块写成业务默认分类。
- 前端投影测试 45/45，自托管升级测试 183/183；文档/schema、acceptance coverage/operations、OpenAPI、self-hosted 配置、UI standards 与生产构建全部通过。
- 浏览器在 `/parameter-admin/specs` 完成 `1440x900`、`768x1024`、`390x844` 验收：默认 effective 返回 53 条 active 且有 placement 的行，显式 `?catalogView=governance` 返回 114 条历史行，详情/编辑沿用同一投影；相关网络请求均为 200，console error 为 0。截图位于 `work/ui-checks/issue-649-populated-upgrade/`。
- 原自托管服务器已应用 `0127`，候选门禁在流量切换前正确停止；通过 `0128` 再次执行成功的
  `upgrade.sh` 与目标机 `--catalog-only` 输出仍是外部验收边界，不计作本地通过。
- 目标服务器应用 `0127` 后，除 `active-driver-placement-missing=22` 外其余目录检查均归零。只读证据确认
  三个唯一自动驱动组对应 `4 + 9 + 9` 条属性，持有准确 canonical compatible source key，但仍引用旧组织主体。
  追加式 `0128` 保留模块 id、名称、父级与 binding，把模块及可选 placement 原位切换到完整平台
  DriverSchema 主体，并重新执行无碰撞 binding 归位；目标服务器再次升级仍属于外部验收证据。

## Git 与 PR 工作流

功能分支为 `codex/issue-649-populated-upgrade-fix`，从最新 `origin/main` 创建。实现和提交
均留在该分支；PR 创建、合并与本地 main 同步由父级会话负责。

## 文档影响矩阵

| 范围 | 状态 | 路径 / 理由 |
| --- | --- | --- |
| 仓库导航 / 入门 | 无变更 | `ARCHITECTURE.md`、`CONTEXT.md` 仍准确；模块地图未变化。 |
| 计划 / 跟踪 | 已更新 | 本计划及英文配对；原完成计划保留为历史证据。 |
| 产品规格 | 无变更 | 现有 effective catalog 承诺已覆盖用户可见结果。 |
| 架构 / 领域 / ADR | 已更新 | ADR-0039 中英文配对记录存量修复和稳态 placement 不变量；领域实体未变化。 |
| 质量 / 测试 | 已更新 | testing strategy、verification matrix 及中英文配对。 |
| 可靠性 / runbook | 已更新 | 参数对账与自托管升级 runbook 及中英文配对。 |
| 安全 / 治理 | 无变更 | 未改变鉴权面，继续保持“不猜业务归属”不变量。 |
| 前端 / 设计 | 已更新 | FRONTEND、API contract、acceptance/operation coverage。 |
| 生成物 | 已更新 | 从 126 个迁移（截至 `0128`）重新生成数据库 schema 文档。 |
| 引用 / 双语 | 已更新 | 所有有配对的已改开发者文档均同步中英文。 |

## 文档更新门禁

完成前必须关闭矩阵各项，运行 `npm run docs:check` 与 `npm run db:schema-doc:check`，
将中英文计划一起移动到 `completed/`。服务器再次升级验收属于外部目标证据。
