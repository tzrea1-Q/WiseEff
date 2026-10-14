# WiseEff 用户指南

> English: [English](../../user-guide/README.md)

## 谁可以使用

无论你准备申请账号，还是已经以访客、硬件开发、软件开发、硬件MDE、软件MDE、管理员（`admin`）或平台超级管理员（`platform-admin`）身份使用 WiseEff，都可以按本指南查找操作步骤。各篇指南会说明所需角色和权限，实际操作仍以账号获得的授权为准。

在 WiseEff 中，工程师可以围绕同一组织的研发工作提出参数变更、调试设备、分析日志，并整理工程知识。处理过程保留可追溯的记录，小泽在账号权限和人工确认的要求下提供协助。这里的组织指一家公司或一个部署客户，不是硬件部、软件部等部门。当前仓库适合受控 staging 和试点证据采集，全面生产使用所需的验收仍未完成。

## 按角色开始

先按[账号与访问](account-and-access.md)中的步骤登录，再选择与你的任务相关的指南。下表按默认角色权限推荐阅读入口；具体操作还须满足各篇指南中的组织、项目和权限要求。

| 你的角色 | 从这里开始 |
| --- | --- |
| 访客（`guest`） | 查询和对比[参数](parameter-management.md)、检索[工程知识](knowledge.md)，以及向[小泽](xiaoze.md)提出只读问题。 |
| 硬件开发（`hardware-user`） | 提交[参数变更](parameter-management.md)、在[设备调试](device-debugging.md)中读取节点、分析[日志](log-analysis.md)、编写[工程知识](knowledge.md)，并使用[小泽](xiaoze.md)。 |
| 软件开发（`software-user`） | 可进行硬件开发行中列出的操作。获得授权后，还可处理分配给自己的[参数合入任务](parameter-management.md#推进分阶段请求)。 |
| 硬件MDE（`hardware-committer`） | [申请获批](account-and-access.md#等待-mde-申请获批)后，可进行硬件开发行中列出的操作，并处理分配给自己的[硬件检视](parameter-management.md#推进分阶段请求)。获得授权后，还可在[设备调试](device-debugging.md)中写入节点、执行重载和恢复。 |
| 软件MDE（`software-committer`） | [申请获批](account-and-access.md#等待-mde-申请获批)后，可进行硬件开发行中列出的操作，并处理分配给自己的[软件审阅与合入](parameter-management.md)。获得授权后，还可在[设备调试](device-debugging.md)中写入节点、执行重载和恢复。 |
| 管理员（`admin`） | 按[组织管理与业务治理](organization-and-governance.md)管理成员、审批注册申请、查询审计和维护业务模块，也可管理[参数与配置](parameter-management.md)及[工程知识](knowledge.md)，并在授权范围内进行上述工程操作。 |
| 平台超级管理员（`platform-admin`） | 可在各篇指南规定的范围内进行上述管理员操作。受保护角色和注册申请队列的跨组织注意事项见[组织管理与业务治理](organization-and-governance.md)。 |

## 操作指南

- [账号与访问](account-and-access.md)：本地注册、MDE 审批、改密与重置密码，以及部署方提供的 OIDC 登录方式。
- [参数管理](parameter-management.md)：查询与对比、草稿、提交与审阅、项目初始化、导入及配置发布。
- [设备调试](device-debugging.md)：连接 HDC/ADB 设备、读取和安全写入节点、测试 DTS 重载、恢复基线并查看证据。
- [日志分析](log-analysis.md)：上传日志、跟踪分析进度、识别降级结果、核对证据、反馈分析质量，并生成知识草稿。
- [工程知识](knowledge.md)：检索与询问小泽、创建和发布条目、上传文件、管理修订与归档，以及检查索引健康。
- [小泽](xiaoze.md)：围绕当前工作提问、核对来源、调整建议，并批准或拒绝 Agent 操作。
- [组织管理与业务治理](organization-and-governance.md)：管理成员与 MDE 注册申请、查询审计、维护业务模块，并提交产品反馈。

## 查找其它资料

- [文档知识库](../README.md)：开发者与运维人员的阅读入口。
- [身份认证参考](../api/authentication.md)：身份认证和本地账号的契约说明。
