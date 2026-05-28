# WiseEff 开发路线图

日期：2026-05-25

## 1. 当前状态

当前项目是前端原型，但已经具备正式工程化的入口：

- React/Vite/TypeScript 应用。
- 多页面路由和权限裁剪。
- 参数、日志、调试、Agent、审计领域类型。
- `application/ports` 定义了前端业务依赖边界。
- mock runtime 和 DTO skeleton 已存在。
- 前端测试覆盖较丰富。

主要缺口：

- 无后端服务。
- 无数据库。
- 无真实认证和后端 RBAC。
- 无真实 API。
- 无真实文件上传、任务队列、设备网关和 Agent 编排。
- mock 与生产数据源尚未严格隔离。

## 2. 开发原则

- 先补后端地基，再替换前端数据源。
- 每个业务域都先走端口，再接真实 API。
- 每个里程碑都必须有测试和验收脚本。
- 不把 Agent、设备写入或批量导入作为无审计的快捷路径。
- 保留现有原型页面，逐步把数据来源从 mock 切换到 API。

## 3. 仓库结构建议

短期可以采用单仓库：

```text
apps/
  web/                 # 迁移现有 Vite React 前端，或保持 src 在根目录到 M0 结束
  api/                 # 后端 API
  worker/              # 异步任务 worker
  device-gateway/      # 设备网关
packages/
  contracts/           # OpenAPI、共享 DTO、schema
  config/              # eslint、tsconfig、测试配置
docs/
```

若短期不迁移目录，也可以先在根目录新增 `server/`，等 M1 后再整理 monorepo。不要在 M0 为目录重组消耗过多时间。

## 4. M0 实施顺序

1. 建立后端服务骨架。
2. 建立数据库迁移。
3. 建立用户、角色、权限、审计基础表。
4. 实现 `GET /api/v1/me`。
5. 前端新增真实 API client 基础层。
6. 前端增加 runtime mode：`mock`、`api`。
7. CI 运行前端测试、后端测试和 build。
8. 本地开发文档补充启动方式。

验收：

- 本地可以同时启动 web、api、db。
- 登录上下文来自后端。
- 审计写入接口可用。
- mock 模式仍可用于演示。

## 5. M1 实施顺序

1. 参数数据模型迁移：项目、模块、参数定义、项目参数值。
2. 参数列表 API。
3. 参数详情和历史 API。
4. 参数草稿 API。
5. 提交轮次和变更请求 API。
6. 审阅状态机和合入逻辑。
7. 批量导入预览和应用。
8. 前端 `ParameterRepository` 切换到真实 API。
9. 参数工作台、审阅页、管理后台 E2E。

验收：

- 刷新页面后参数状态保留。
- 合入会生成历史和审计。
- 高风险参数审批规则生效。

## 6. M2 实施顺序

1. 文件上传和对象存储。
2. 日志记录 API。
3. 分析任务和 worker。
4. 文本日志解析。
5. 分析阶段进度接口。
6. 证据和报告生成。
7. 前端 `LogAnalysisRepository` 切换到真实 API。
8. 失败、重试、归档和反馈。

验收：

- 上传支持格式日志能完成分析。
- 不支持格式有失败记录和可解释原因。
- 证据行号可点击定位。

## 7. M3 实施顺序

1. 设备网关 skeleton。
2. 设备模拟器。
3. 目标检测。
4. 节点读取。
5. 节点写入和回读校验。
6. 调试会话和快照。
7. 前端 `DebuggingGateway` 切换到真实网关。
8. 高风险写入确认和审计。

验收：

- 模拟器环境可稳定通过调试 E2E。
- 写入失败有错误原因和审计。
- 回滚只能基于有效快照。

## 8. M3.5 Commercial Readiness 实施顺序

M3.5 插在 M3 和 M4 之间。原因是 Agent 会放大现有系统能力，也会放大数据、权限、审计、设备写入和运维边界的风险；因此先把 M1-M3 从 API-mode MVP 硬化成可控商用试点基线，再进入 M4。

1. 生产健康检查与 readiness：`/health/live`、`/health/ready`、依赖状态和部署 smoke 命令。
2. 环境契约硬化：生产模式必须显式配置数据库、对象存储、runtime mode 和设备网关设置。
3. API contract 防漂移：为 M1-M3 手写 HTTP client/DTO 增加契约覆盖。
4. M2 worker 生产化切片：任务租约、重试/退避元数据、幂等和重复 worker 防护。
5. 对象存储生产 seam：本地 object store 保留，补 readiness 和未来 S3/OSS adapter 边界。
6. M3 设备安全硬化：真实 gateway adapter 边界、设备租约、超时/离线/stderr 归一化、模拟器一致性测试。
7. 可观测性：结构化日志、request/trace id、审计关联和运维文档。
8. M3.5 验收后再启动 M4 Agent。

验收：
- API readiness 能报告数据库、对象存储、worker、gateway 等依赖状态，并给出可行动失败原因。
- 生产配置不能在 mock runtime 或缺少关键依赖时启动。
- M1-M3 API client 有契约漂移检测。
- M2 job 不会被两个 worker 重复处理。
- M3 真实设备写入前具备租约、超时和审计保护。
- `npm run test:all`、`npm run build` 和 M3.5 targeted smoke 通过。

## 9. M4 实施顺序

1. Agent 会话和消息持久化。
2. Tool registry。
3. 读工具接入参数、日志、审计。
4. 写工具审批流。
5. 前端 `AgentGateway` 切换到真实 API。
6. 工具调用审计。
7. Agent 输出引用和置信度展示。

验收：

- Agent 可以总结真实数据。
- Agent 写工具必须审批。
- 审批后执行结果可追溯。

## 10. 工程工作流

每个功能分支要求：

- 先写或更新测试。
- 保持 `npm test` 和 `npm run build` 通过。
- 后端变更包含迁移和集成测试。
- API 合同变更同步更新前端 DTO。
- 涉及权限、审计、Agent、设备的变更必须有负向测试。
