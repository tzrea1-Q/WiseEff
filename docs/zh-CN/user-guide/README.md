# WiseEff 用户指南

> English: [English](../../user-guide/README.md)

## 谁可以使用

本指南面向准备申请账号的用户，以及访客、硬件开发、软件开发、硬件MDE、软件MDE、管理员（`admin`）和平台超级管理员（`platform-admin`）。每篇操作指南会说明所需角色或权限；阅读指南并不会获得操作权限。

WiseEff 将参数变更、设备调试、日志分析和工程知识连接在同一组织的研发流程中。工程师可以提出修改、核对证据，并保留可追溯的处理记录；小泽在权限和人工确认的边界内提供辅助。组织代表一家公司或一个部署客户，不是硬件部、软件部等部门。当前仓库适合受控 staging 和试点证据采集，不能据此宣称已全面生产就绪。

## 按角色开始

这里只列出已完成的指南。先阅读[账号与访问](account-and-access.md)，其它工作流指南会在完成后加入。

| 你的角色 | 从这里开始 |
| --- | --- |
| 访客（`guest`） | [注册或登录](account-and-access.md#注册本地账号)，了解新账号加入哪个组织。 |
| 硬件开发（`hardware-user`） | [创建本地账号](account-and-access.md#注册本地账号)，以及[修改自己的密码](account-and-access.md#修改自己的本地密码)。 |
| 软件开发（`software-user`） | [创建本地账号](account-and-access.md#注册本地账号)，以及[修改自己的密码](account-and-access.md#修改自己的本地密码)。 |
| 硬件MDE（`hardware-committer`） | [申请审阅角色](account-and-access.md#等待-mde-申请获批)，获批后再登录。 |
| 软件MDE（`software-committer`） | [申请审阅角色](account-and-access.md#等待-mde-申请获批)，获批后再登录。 |
| 管理员（`admin`） | [审批注册申请](account-and-access.md#审批-mde-注册申请)，以及[重置成员密码](account-and-access.md#重置成员的本地密码)。 |
| 平台超级管理员（`platform-admin`） | 阅读[账号与访问](account-and-access.md)，在自己的归属组织执行管理员操作；本指南不介绍跨组织操作。 |

## 操作指南

- [账号与访问](account-and-access.md)：本地注册、MDE 审批、改密与重置密码，以及部署方提供的 OIDC 登录方式。
- [参数管理](parameter-management.md)：查询与对比、草稿、提交与审阅、项目初始化、导入及配置发布。
- [设备调试](device-debugging.md)：连接 HDC/ADB 设备、读取和安全写入节点、测试 DTS 重载、恢复基线并查看证据。
- [日志分析](log-analysis.md)：上传日志、跟踪阶段、识别降级结果、核对证据、反馈质量，并生成知识草稿。

## 查找其它资料

- [文档知识库](../README.md)：开发者与运维人员的阅读入口。
- [身份认证参考](../api/authentication.md)：身份与本地账号契约的维护文档。
