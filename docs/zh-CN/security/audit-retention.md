# 审计保留

> English: [English](../../security/audit-retention.md)

这是安全文档，说明身份、授权、审计、数据分级、密钥和权限设计。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：security。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- `log_webhook_deliveries` 是审计相邻的运维历史，不是不可变的 `audit_events` 产品证据。活动日志 worker 按组织内每个日志业务域，以稳定的 `created_at DESC, id DESC` 顺序默认保留最近 10,000 次尝试；每批删除 1,000 行，每 60 秒最多 10 批。清理对 Webhook 投递 fail-open，只记录删除数量/耗时或脱敏错误码。`LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED=false` 只停止未来删除，已裁剪记录只能通过正常数据库备份/恢复找回。

## 同类中文文档

- [docs/zh-CN/security/README.md](README.md)
- [docs/zh-CN/security/threat-model.md](threat-model.md)
- [docs/zh-CN/security/data-classification.md](data-classification.md)
- [docs/zh-CN/security/secrets-management.md](secrets-management.md)
- [docs/zh-CN/security/audit-retention.md](audit-retention.md)
- [docs/zh-CN/security/user-permission-design.md](user-permission-design.md)
