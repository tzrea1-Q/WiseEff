# 组织管理实施计划

> English: [Organization management implementation](../../../exec-plans/active/2026-10-23-organization-management.md)
> 状态：进行中。父规格：[#1368](https://github.com/tzrea1-Q/WiseEff/issues/1368)。

在 `codex/organization-management-1368` 上实施 #1369–#1401，基线为 `e795bd1a70c07391f893e4818cd8b07c138abcb3`。本次明确调用的 implement-spec 工作流采用集成分支与草稿 PR；实施者使用独立工作树、在已确认入口执行 TDD、提交带任务引用的提交，并由合入代理集成。生产变更和部署不在本次任务范围。

## 交付与验证

沿原生依赖图推进，在本分支中阻塞任务实现并集成后启动后继。首个实现合入后建立草稿 PR，保留父规格及全部子任务关闭引用；任务和审查证据完整后才转为待审。不能关闭未完成任务或把本地结果当作 CI 验收。

已确认入口：真实 API、PostgreSQL 持久化/并发、1440×900 API 模式浏览器。实施者运行相关红绿和静态检查，协调者负责选中的昂贵检查、构建、浏览器与 CI。隔离数据库前缀及运行通道，保留既有必需检查与 Agent/设备人类审批。

## 文档影响矩阵

| 文档 | 更新边界 |
| --- | --- |
| 术语表、ADR-0051 与组织设计 | #1369 带入已接受中英文设计，如实维护实施状态。 |
| API 和数据库合同 | 更新公共接口/表结构变更，从当前候选生成数据库文档。 |
| 组织用户指南 | #1401 更新管理与成员流程，维护中英文。 |
| 恢复与运维 | 随功能记录停用、删除重试、OIDC 同步及备份恢复。 |
| 本计划与草稿 PR | 跟踪已集成任务和实际验证，详细证据放在 PR。 |

## 文档更新门禁

每个切片交付前更新受影响的中英文文档，文档变更运行治理检查。任务集成且相关候选检查完成后才在这里标为完成，数据库/浏览器/CI 缺失证据明确保留。整个规格交付后才归档本计划。

## 任务图进度

勾选表示相关实现与检查已集成；整轮 CI 和独立审查仍为单独门禁。首批无阻塞任务：#1369、#1385、#1386。

已集成 #1369–#1401 全部 33 项切片，完成相关 API/PostgreSQL 及 API 模式浏览器检查。四个清理领域按依赖顺序组合，最终回执和保留审计证明不含业务载荷；真实旧 PostgreSQL、文件及独立检查点备份按已删除、失败状态重放后才开放访问，检查点归属不一致时拒绝开放。完整运营场景在来源 3ddfaa9c4 上以真实本地身份 2/2、独立受控签名 OIDC 2/2 通过，零失败和跳过，两种 provider 工件分别保留；真实 API/worker PostgreSQL、文件及本机 HTTP 回调相关检查 9/9 通过。本地密码和 OIDC 浏览器操作明确依赖对应认证模式，默认 HMAC CI 不能建立这两项证据。全新 PostgreSQL 实测覆盖至 0291 的 286 个迁移及新增 Catalog 指纹，历史指纹全部保留，当前 Catalog harness 6/6 通过。

CI 40055219999（f2290ab33）已结束并有失败。原生 pg_restore 参数和紧凑审阅页加载等待缺陷已修复，真实 PostgreSQL 6/6、API 模式浏览器 6/6 通过。有效 PNG/EOCD 与内嵌 ZIP64 回归 39/39 通过；原 CI 被拒绝上传的工件身份仍未知，需要新的完整运行验证。Standards 和 Spec 两路独立审查发现反馈租户隔离、日志失败通知、密码重置与调动并发、停用组织阻塞工件回收、ZIP64 容器识别共五项问题，均由同一实施者修复，原审查者对修复增量复核后无遗留发现；前四项相关检查 153/153、独立 sanitizer 检查 39/39 通过（批次与其他证据可能重叠，不相加）。

CI 40059381846（1c9f65afc）的静态/构建、前端、scripts/bridge、backend2、smoke、无障碍及两路一致性均通过。视觉任务 40 通过、仅当时待批准的四张基线失败，紧凑页浅色/深色均通过，L2 shard1 的 browser 阶段也已通过。backend1 为 3650 通过、一个既有管理器计时测试失败：真实 PostgreSQL 工作合法超过了该用例的 200ms 激活截止时间。受控实际 installer/回执验证复现了该顺序，成功用例现控制 JavaScript 计时器，保留真实 PostgreSQL、全部断言及原超时/错误负例；相关检查 16/16、零跳过，独立增量审查无发现，生产计时逻辑未改。

CI 40061324926（033baad93）的功能检查全部通过，包括后端 7412 项及四个 browser 阶段，仅四张视觉基线比较和对应汇总任务失败。用户已于 2026-10-24 明确批准 organization-members、state-dialog-modal-open、state-table-row-hover、state-table-sort-header-focus 四张替换，已在原失败 head 上应用 CI46 原始二进制补丁，仅提交这四个 PNG。交付候选同时合入 main 068254f9d，保留其侧边栏/保存交互及本轮组织、项目范围和权限行为，受影响浏览器断言改为实际链接与紧凑菜单。用户已授权合并，但仍须等待该组合候选的正常 Linux CI 通过。整栈 MinIO/Redis、部署的外部身份系统和目标主机恢复未执行。

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
