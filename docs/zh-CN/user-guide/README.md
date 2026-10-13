# WiseEff 用户指南

> English: [English](../../user-guide/README.md)

## 谁可以使用

本指南面向准备申请账号的用户，以及访客、硬件开发、软件开发、硬件MDE、软件MDE、管理员（`admin`）和平台超级管理员（`platform-admin`）。每篇操作指南会说明所需角色或权限；阅读指南并不会获得操作权限。

WiseEff 将参数变更、设备调试、日志分析和工程知识连接在同一组织的研发流程中。工程师可以提出修改、核对证据，并保留可追溯的处理记录；小泽在权限和人工确认的边界内提供辅助。组织代表一家公司或一个部署客户，不是硬件部、软件部等部门。当前仓库适合受控 staging 和试点证据采集，不能据此宣称已全面生产就绪。

## 按角色开始

先阅读[账号与访问](account-and-access.md)完成登录，再按任务选择下方七篇操作指南。以下路径基于默认角色权限；各篇指南会说明组织、项目和具体操作的附加要求。

| 你的角色 | 从这里开始 |
| --- | --- |
| 访客（`guest`） | 查询和对比[参数](parameter-management.md)、检索[工程知识](knowledge.md)，以及向[小泽](xiaoze.md)提出只读问题。 |
| 硬件开发（`hardware-user`） | 提交[参数变更](parameter-management.md)、在[设备调试](device-debugging.md)中读取节点、分析[日志](log-analysis.md)、编写[工程知识](knowledge.md)，并使用[小泽](xiaoze.md)。 |
| 软件开发（`software-user`） | 使用上述硬件开发工作流，并在获授权时处理分配给自己的[参数合入任务](parameter-management.md#推进分阶段请求)。 |
| 硬件MDE（`hardware-committer`） | [申请获批](account-and-access.md#等待-mde-申请获批)后，使用硬件开发工作流、处理分配给自己的[硬件检视](parameter-management.md#推进分阶段请求)，并在[设备调试](device-debugging.md)中执行获授权的节点写入、重载和恢复。 |
| 软件MDE（`software-committer`） | [申请获批](account-and-access.md#等待-mde-申请获批)后，使用硬件开发工作流、处理分配给自己的[软件审阅与合入](parameter-management.md)，并在[设备调试](device-debugging.md)中执行获授权的节点写入、重载和恢复。 |
| 管理员（`admin`） | 通过[组织管理与业务治理](organization-and-governance.md)管理成员、审批注册申请、查询审计和维护业务模块；管理[参数与配置](parameter-management.md)、[工程知识](knowledge.md)，并在授权范围内使用上述工程工作流。 |
| 平台超级管理员（`platform-admin`） | 在各篇指南说明的范围内使用上述管理员工作流；[组织管理与业务治理](organization-and-governance.md)说明受保护角色及注册申请队列的跨组织注意事项。 |

## 操作指南

- [账号与访问](account-and-access.md)：本地注册、MDE 审批、改密与重置密码，以及部署方提供的 OIDC 登录方式。
- [参数管理](parameter-management.md)：查询与对比、草稿、提交与审阅、项目初始化、导入及配置发布。
- [设备调试](device-debugging.md)：连接 HDC/ADB 设备、读取和安全写入节点、测试 DTS 重载、恢复基线并查看证据。
- [日志分析](log-analysis.md)：上传日志、跟踪阶段、识别降级结果、核对证据、反馈质量，并生成知识草稿。
- [工程知识](knowledge.md)：检索与询问小泽、创建和发布条目、上传文件、管理修订与归档，以及检查索引健康。
- [小泽](xiaoze.md)：围绕当前工作提问、核对来源、调整建议，并批准或拒绝 Agent 操作。
- [组织管理与业务治理](organization-and-governance.md)：管理成员与 MDE 注册申请、查询审计、维护业务模块，并提交产品反馈。

## 查找其它资料

- [文档知识库](../README.md)：开发者与运维人员的阅读入口。
- [身份认证参考](../api/authentication.md)：身份与本地账号契约的维护文档。
