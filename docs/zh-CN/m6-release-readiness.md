# M6.6 自托管发布、回滚与容量门禁

这份中文说明用于开发者快速理解 M6.6 的证据边界。英文 canonical 文档见：

- [../runbooks/release-rollback.md](../runbooks/release-rollback.md)
- [../developer/verification-matrix.md](../developer/verification-matrix.md)
- [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md)

## 关键命令

```bash
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256>
```

`capacity:gate` 写入 `docs/generated/capacity-gate.md`，用于记录容量门禁证据。

`selfhost:release-gate` 写入 `docs/generated/m6-release-readiness.md`，用于记录 release candidate 的版本、commit、artifact、环境指纹、迁移清单、备份、回滚、容量、target synthetic acceptance 和 HDC scope。

## 必须保持诚实的 Pending 项

如果没有真实目标环境证据，以下项目不能标记为完成：

- target capacity run，
- rollback rehearsal，
- target synthetic acceptance，
- queue drain / pause / resume，
- observability release watch，
- backup / restore drill，
- HDC device-lab evidence，
- full-pilot readiness。

本地脚本输出只能证明门禁结构和证据格式，不等于目标环境 release-ready。

## 容量证据

目标环境容量证据至少应包含：

- p95 latency，
- error rate，
- throughput，
- CPU，
- memory，
- database connections，
- queue backlog，
- object-store probe。

没有 observed metrics 时，`capacity:gate` 应输出 failed / pending。这是正确行为，不是脚本失败。

## Go / No-Go

只有当 `selfhost:smoke`、target synthetic acceptance、capacity gate、backup/restore、rollback rehearsal、queue evidence 和 observability evidence 都有真实目标环境记录时，才可以考虑 controlled self-hosted release candidate Go。

缺少任一项时，结论应保持 No-Go 或 pending。
