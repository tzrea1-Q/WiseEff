# 重建已审核的示例参数

> English: [English guide](seed-rebuild.md)。设计与失败边界：[操作器设计](seed-rebuild-design.zh-CN.md)。

本工具适用于已完成 Catalog 接管、仍有旧示例参数且 **新版规范绑定为零** 的自托管实例。它将 Atlas、Aurora、Nebula 的旧参数归档，并用已审核的 DTS、JSON 来源重建。其他项目、用户、角色、设备节点及非参数对象保持不变。工具不授予权限、不修改发布策略、不轮换密码，也不启用 P11–P16。

仓库与运行镜像必须对应同一个已审核版本。先完成普通应用升级，检查升级状态、服务健康和 DTS 工具链。此前的升级备份不能代替本轮恢复点。不要在部署服务器运行旧 M1 seed、本地专用清理 CLI 或旧 Catalog installer。

## 维护前

以下命令均在服务器的 `ops/self-hosted` 目录执行。使用既有私有 `.env` 及升级时使用的一次性管理连接配置；不要将这些配置值复制到诊断输出。

选择目标组织内真实、启用中的用户作为作者。作者必须拥有参数文件管理权限（`admin:access`）、三个项目的参数编辑权限及 `catalog:author`。原生高风险发布策略要求独立审核时，发布者必须是作者之外的授权用户；既有组织管理员例外保持不变。保持 `lowRiskSingleActorPublish=false`。权限缺失、策略不兼容时，依据[发布操作手册](catalog-publication.zh-CN.md)明确处理，本工具不会自动授权。

可在浏览器 Network 中查看应用成功发出的 `GET /api/v1/me` 响应，使用其中的 `user.id` 和 `organization.id`。在地址栏直接打开该 URL 不会带上应用的 bearer token。不要复制请求头或 Token 到终端输出。

```bash
wiseeff_seed_run="seed-$(date -u +%Y%m%dT%H%M%SZ)"
wiseeff_seed_actor='<作者用户ID>'
wiseeff_seed_org='<组织ID>'
./scripts/seed-rebuild.sh plan --run-id "$wiseeff_seed_run" \
  --actor "$wiseeff_seed_actor" --organization-id "$wiseeff_seed_org"
```

核对数据库身份、组织、三个项目、源码与种子摘要、原始数据清单摘要。计划不写数据库或对象存储，会保存私有本地状态目录；完成或恢复前保留该目录。重新规划使用新的 run ID。

## 维护、发布与重建

把计划摘要填入 `wiseeff_seed_plan`。进入维护后，工具停止流量与写入服务、暂停并排空队列、冻结发布，创建并验证本轮全新的 PostgreSQL、对象存储和 Redis 恢复点。任何检查失败都不允许继续重建。

```bash
wiseeff_seed_plan='sha256:<计划输出的摘要>'
./scripts/seed-rebuild.sh begin --run-id "$wiseeff_seed_run" --confirm-plan "$wiseeff_seed_plan"
```

先准备并审核 vendor 候选，再由授权审核人确认其准确的 artifact 摘要并发布。确认对应激活回执后，对 `configuration-schema` 候选重复这一过程，使用它自己的摘要。发布期间仅临时启用 manager 写入，随后重新冻结。

```bash
./scripts/seed-rebuild.sh catalog-prepare --run-id "$wiseeff_seed_run" --stage vendor
wiseeff_seed_reviewer='<授权审核人用户ID>'
wiseeff_seed_artifact='sha256:<已审核的vendor产物摘要>'
./scripts/seed-rebuild.sh catalog-publish --run-id "$wiseeff_seed_run" --stage vendor \
  --actor "$wiseeff_seed_reviewer" --confirm-artifact "$wiseeff_seed_artifact"
./scripts/seed-rebuild.sh catalog-status --run-id "$wiseeff_seed_run" --stage vendor

./scripts/seed-rebuild.sh catalog-prepare --run-id "$wiseeff_seed_run" --stage configuration-schema
wiseeff_seed_artifact='sha256:<已审核的configuration产物摘要>'
./scripts/seed-rebuild.sh catalog-publish --run-id "$wiseeff_seed_run" --stage configuration-schema \
  --actor "$wiseeff_seed_reviewer" --confirm-artifact "$wiseeff_seed_artifact"
./scripts/seed-rebuild.sh catalog-status --run-id "$wiseeff_seed_run" --stage configuration-schema

./scripts/seed-rebuild.sh rebuild --run-id "$wiseeff_seed_run"
./scripts/seed-rebuild.sh verify --run-id "$wiseeff_seed_run"
./scripts/seed-rebuild.sh finish --run-id "$wiseeff_seed_run"
```

控制器先完整归档并验证三个项目，再重建。它逐项比对已审核的参数身份集合、来源固定信息及保留数据，全部通过后才清理已归档的旧残留。目前预期共 372 条绑定，但仅数量相同不能通过验证。完成后的重复验证不会再次重建。

## 失败处理与人工验收

归档、重建或清理中断后，不能直接重跑 seed。保持维护状态并查看结果；发布结果不明确时，应根据准确的任务及回执确认，不能重新提交另一候选来试探。

```bash
printf '\n=== BEGIN WISEEFF SEED STATUS ===\n'
./scripts/seed-rebuild.sh status --run-id "$wiseeff_seed_run"
printf '\n=== END WISEEFF SEED STATUS ===\n'
```

状态要求全量恢复时，只恢复本轮已经验证的恢复点：

```bash
./scripts/seed-rebuild.sh recover --run-id "$wiseeff_seed_run" --confirm "restore-$wiseeff_seed_run"
```

恢复覆盖各存储，并恢复进入维护前记录的服务、队列、发布状态。不要手工清除运行中阶段记录、删锁强制重跑、删除卷或执行全局 prune。恢复本身失败时，保持流量关闭并保留本轮诊断。

如果进入维护后、**备份通过验证之前**失败，不能执行重建。可以运行 `./scripts/seed-rebuild.sh resume-maintenance --run-id "$wiseeff_seed_run"`，保持隔离并重试备份；也可以运行 `./scripts/seed-rebuild.sh abort --run-id "$wiseeff_seed_run"`，恢复原有服务状态，不使用未验证的存储快照。依据状态中的指引操作，并保留诊断。

完成 `finish` 后，由服务器操作者在真实浏览器逐项目验收：参数修改页模块与参数行、后台定义、参数调试绝对目标路径、原有后台节点，以及 DTS/JSON 的真实草稿、审批、写回、导出、重新导入；再检查服务重启后的读取。使用可丢弃的示例编辑。人工验收完成前保留归档和新备份。本地 PostgreSQL 或包装脚本测试不能代替服务器及浏览器验收。
