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

已集成 #1369–#1398 及 #1400 共三十一项切片，完成相关 API/PostgreSQL 及 API 模式浏览器检查。四个清理领域按依赖顺序组合：Agent/设备/反馈、知识、项目/参数、日志。实际文件写入、响应丢失及重试均有精确对象键的持久保管记录；未知或歧义归属仍阻止删除。跨领域完成判定、最小回执收敛及备份恢复重放继续由 #1399 实施，完整运营闭环由 #1401 实施。全新 PostgreSQL 实测覆盖至 0287 的 282 个迁移及新增 Catalog 指纹，历史指纹全部保留。最近完成的 CI 40046004257（46acd5b）有六项后端夹具/扫描器断言、两项过时权限页面断言及四处视觉比较失败；后端和权限相关修复已集成，四张 Linux 基线替换等待明确人工批准。当前候选完整 CI 和独立审查尚未完成。尚未修改视觉基线。

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
- [ ] [#1399](https://github.com/tzrea1-Q/WiseEff/issues/1399) 混合组织删除完成判定、回执与恢复
- [x] [#1400](https://github.com/tzrea1-Q/WiseEff/issues/1400) 组织概览、资源索引与六入口整合
- [ ] [#1401](https://github.com/tzrea1-Q/WiseEff/issues/1401) 组织运营闭环与整体验收交付
