# WiseEff 平台概览

> English: [English](../platform-overview.md)

这份概览面向正在评估 WiseEff 或准备参与开发的外部开发者，阅读约需 15 分钟。你可以在这里了解平台能做什么、各部分如何配合，再通过文中的链接查阅接口契约、操作步骤和验证细节。

## 平台解决什么问题

WiseEff 把工程参数变更、设备调试、日志分析和知识积累放在同一套研发流程中，小泽协助处理这些工作。各模块共用组织、权限、审批和审计规则。工程师发现问题后，可以提出修改、验证结果、审阅变更并保存证据；助手修改设备或生产数据前，仍须获得授权和人工批准。

## 能力地图

下表列出了当前界面的中文导航名称和路由。你能看到哪些页面、执行哪些操作，取决于服务端权限、组织成员身份和项目范围。操作步骤见[用户指南](user-guide/README.md)，访问规则见[权限设计](security/user-permission-design.md)。

| 领域 | 可以做什么 | 入口与专题文档 |
| --- | --- | --- |
| 参数 | 管理规范 Definition 和 Catalog 发布版本，查询、对比项目参数值，通过草稿、提交、审阅和合入完成变更。 | 参数修改（`/parameters`）、变更审阅（`/parameter-review`）、参数后台（`/parameter-admin`）；[Catalog 模型与发布](design-docs/catalog-authoring-and-publication-control-plane.md)。 |
| 调试 | 读取设备节点，在授权和安全检查通过后写入；准备 DTS 重载候选，查看部署记录和验证结果，恢复基线或提升为草稿。 | 节点调试（`/node-debugging`）、参数调试（`/dts-reload`）；[设备实验室手册](runbooks/hdc-device-lab.md)与 [DTS 重载模块](../../server/modules/dts-reload/)。 |
| 日志 | 上传日志并跟踪分析任务，让 Agent 结合领域上下文分析，核对结果证据并生成知识草稿。模型不可用时，不能报告为完整 Agent 分析成功。 | 智能分析（`/logs`）、日志后台（`/log-admin`，默认「概览」）；[分析运维手册](runbooks/log-analysis-llm.md)。 |
| 知识 | 在组织内创建和发布知识条目，保留不可变修订，从文件中提取正文，并检查索引健康。检索只返回已发布内容。 | 知识库（`/knowledge`）、知识后台（`/knowledge-admin`）；[知识库设计](design-docs/2026-08-12-knowledge-base-design.md)。 |
| 小泽 | 在 API 模式下结合当前上下文调用读取工具、规划任务并引用来源，提出需要人工批准的操作建议。mock 模式不提供 Agent 界面。 | 各工作流共用的助手，没有独立业务页面；[Agent 架构](root/ARCHITECTURE.md)与 [Agent provider 手册](runbooks/agent-provider.md)。 |
| 治理 | 管理组织成员和角色，审批注册与账号激活，查询审计，检查运行就绪状态。 | 组织管理（`/organization`）、审计中心（`/audit`）；[组织管理设计](design-docs/2026-08-19-organization-administration-design.md)与[安全文档](SECURITY.md)。 |

[操作覆盖矩阵](developer/user-operation-coverage-matrix.md)列出了各工作流的验收用例和证据要求。判断本次验收是否通过，还需查看实际运行结果。

## 架构速览

```mermaid
flowchart TB
  UI[React / Vite / TypeScript 前端] --> Ports[应用层 ports]
  Ports --> Mock[mock 适配器：仅演示和测试]
  Ports --> HTTP[API 运行时：HTTP 适配器]
  HTTP --> API[TypeScript API：模块化单体]
  API --> PG[(PostgreSQL：事实来源)]
  API --> Queue[Redis / BullMQ：持久日志调度]
  Queue --> Worker[日志 worker]
  Worker --> PG
  API --> Store[S3 兼容对象存储]
  Worker --> Store
  API --> Gateway[设备网关 / 本地 bridge]
  Gateway --> Device[设备：HDC 及其他协议适配器]
  API --> Xiaoze[小泽：工具 / 规划 / 审批]
  Xiaoze --> PG
  Xiaoze --> LLM[配置的 LLM provider]
```

图中展示了各部分的逻辑关系，具体部署可能只启用部分适配器。详细拓扑见[架构地图](root/ARCHITECTURE.md)和[技术文档合集](design-docs/full-stack-architecture.md)。前端通过[运行时装配](../../src/app/appRuntime.ts)，为[应用层 ports](../../src/application/ports/)选择 HTTP 或 mock 适配器。[运行时策略](../../src/infrastructure/http/runtimeMode.ts)默认使用 API，生产构建拒绝 mock。

PostgreSQL 是业务数据的事实来源，保存业务状态、审计、审批及任务生命周期记录。Redis/BullMQ 负责持久日志任务调度；worker 先认领数据库中的任务，再更新进度或终态。本地开发和补偿仍可采用数据库轮询。对象存储用于保存文件产物。相关运行机制见[自托管运行时](runbooks/self-hosted-runtime.md)、[队列实现](../../server/modules/jobs/)和[日志 worker](../../server/modules/logs/worker.ts)。

### 后端主要模块组

以下模块组都位于 [`server/modules/`](../../server/modules/)，随同一个 API 部署，无须分别部署为微服务。

| 模块组 | 职责 |
| --- | --- |
| `auth`、`users`、`projects`、`audit` | 管理身份、组织和项目范围、角色，并记录可追踪的审计。 |
| `parameters`、`parameter-*`、`catalog-*`、`dts` | 按规则管理参数值与变更、规范身份、Catalog 发布与切换，并保留 DTS 原始语法。 |
| `debugging`、`deviceBridge`、`dts-reload` | 对接设备协议，处理快照与回读，管理重载记录的生命周期。 |
| `logs`、`jobs` | 解析和分析日志，认领与重试数据库任务，调度队列并检查 worker 健康。 |
| `knowledge` | 管理条目和修订，提取正文、建立索引，并按访问范围检索。 |
| `agent` | 提供小泽工具、任务规划和审批编排，集成会话与 checkpoint。 |
| `operations`、`release-verification` | 检查健康和就绪状态，核对发布证据。 |
| `notifications`、`product-feedback` | 发送工作流通知，收集和分诊内部 beta 反馈。 |

## 下一步读什么

| 目标 | 入口 |
| --- | --- |
| 搭建开发环境或评估部署前提 | [README](root/README.md) |
| 理解端到端架构与一致性 | [技术文档合集](design-docs/full-stack-architecture.md) |
| 对接 API | [API 文档](api/README.md) |
| 理解边界背后的决策 | [ADRs 索引（英文）](../../docs/adr/README.md) |
| 提交范围明确、经过验证的变更 | [贡献指南](root/CONTRIBUTING.md) |
| 按自己的角色完成产品操作 | [用户指南](user-guide/README.md) |
