# 运维与安全阅读路径

本页是中文开发者和试点操作者的运维/安全入口。英文详细来源见 [docs/runbooks/README.md](../runbooks/README.md) 和 [docs/security/README.md](../security/README.md)。

## 运维 runbook

- [M5 商用试点就绪](../runbooks/m5-commercial-pilot-readiness.md)：当前 go/no-go 清单。
- [Staging 部署](../runbooks/staging-deployment.md)：部署顺序和 smoke。
- [备份与恢复](../runbooks/backup-restore.md)：backup/restore drill。
- [回滚](../runbooks/rollback.md)：回滚演练和紧急回滚。
- [监控告警](../runbooks/monitoring-alerting.md)：信号、告警和第一轮排查。
- [HDC 设备实验室](../runbooks/hdc-device-lab.md)：真实设备证据。
- [Agent Provider](../runbooks/agent-provider.md)：live provider readiness、fallback 和 trace 证据。

## 安全文档

- [Security baseline](../SECURITY.md)：当前安全基线和不可妥协规则。
- [威胁模型](../security/threat-model.md)：高风险路径和控制。
- [数据分级](../security/data-classification.md)：哪些数据可以提交，哪些不能。
- [密钥管理](../security/secrets-management.md)：`.env`、API key、token、rotation。
- [审计保留](../security/audit-retention.md)：审计覆盖和保留建议。

## 核心规则

- 前端权限只负责体验，不是安全边界。
- 生产写入必须经过后端认证、授权、校验、事务和审计。
- Agent mutating tool 必须产生 approval record，不能直接执行。
- 设备写入必须有权限、租约、范围校验、快照、回读和审计。
- `.env.example` 可以提交；真实 `.env`、API key、对象存储密钥和 staging/prod token 不能提交。
- HDC、backup/restore、rollback、live provider 和 staging smoke 需要目标环境证据，不能用本地 skip 代替。
