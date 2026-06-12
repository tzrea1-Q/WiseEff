# WiseEff 新用户上手

> English: [English](../../product-specs/new-user-onboarding.md)

Date: 2026-05-25

## 目标

新的 WiseEff 用户应能理解从哪里开始、自己的角色能做什么，以及 AI 辅助如何嵌入受治理的工程工作流。

## 目标用户

- Guest：查看只读参数和平台视图。
- Hardware User：提交参数变更、上传日志、使用调试工具。
- Software User：提交软件侧参数变更并跟踪 merge 状态。
- Hardware Committer：审阅硬件侧参数请求。
- Software Committer：审阅软件侧请求并协助完成 merge。
- Admin：管理用户、权限、参数治理和审计。

## 首次会话流程

API mode 下，未认证用户会先看到 WiseEff 认证页。本地账号登录和注册已产品化，用于自管理评估流程：注册使用用户名、固定组织选项（`硬件部` / `软件部`）和允许自助选择的平台角色。Admin 不能自助注册；Committer 申请会先创建待 Admin 审批的角色申请，并且在审批通过前只授予对应基础 User 角色。当前暂不支持邮箱验证，因此该路径不能被当作已验证域名 onboarding 或邀请接受流程。

1. 用户进入 WiseEff 首页。
2. 用户进入“我的工作台”，查看可访问工作区和与角色相关的入口。
3. 系统按角色 capability 展示导航。
4. 用户打开具体领域工作区：
   - 参数工作台用于参数查看和草稿变更；
   - 日志分析用于上传和证据查看；
   - 调试工作区用于设备或节点操作。
5. 用户打开 Agent 面板，获取当前页面上下文相关建议。
6. 类写入操作需要确认；产品化路径还必须通过服务端权限校验和审计。

## 上手要求

- 当前角色必须清晰可见、可理解。
- 用户只应看到可达工作区，或看到清晰的 access-denied 页面和返回路径。
- 空状态应说明缺少什么，以及下一步可做什么。
- Agent 建议必须与当前页面上下文相关。
- 会改变状态的 Agent action 不能绕过确认。

## Prototype 状态

当前前端支持角色切换、权限拒绝 fallback、上下文 Agent 建议和 mock workflow actions。M0-M5 API mode 增加了 auth context、参数、日志、调试、Agent approval、审计和 pilot readiness 的后端治理边界。本地账号生命周期现已覆盖注册、登录、退出、`/api/v1/me`、当前用户资料编辑，以及 Committer 注册申请的 Admin 审批。邀请、邮箱验证和外部 SSO onboarding 仍是后续产品化工作。

## 验收检查

- Guest 可以进入只读参数页面，但不能提交变更。
- Hardware User 可以进入参数、日志和调试工作区。
- Committer 可以进入审阅页面。
- Admin 可以进入管理页面。
- Agent 写入动作必须在 UI 中要求确认。
