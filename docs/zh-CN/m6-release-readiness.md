# M6.6 自托管发布、回滚与容量门禁

这份中文说明用于开发者快速理解 M6.6 的证据边界。英文 canonical 文档见：

- [../runbooks/release-rollback.md](../runbooks/release-rollback.md)
- [../developer/verification-matrix.md](../developer/verification-matrix.md)
- [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md)

## 关键命令

```bash
npm run identity:check
npm run rollback:rehearsal
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256> --identity-readiness passed --rollback-readiness passed --rollback-evidence docs/generated/m6-rollback-rehearsal-evidence.md --capacity-readiness passed --capacity-evidence docs/generated/capacity-gate.md --target-synthetic-readiness passed --target-synthetic-evidence <path-or-record> --queue-readiness passed --queue-evidence <path-or-record> --observability passed --observability-evidence <path-or-record>
```

`capacity:gate` 写入 `docs/generated/capacity-gate.md`，用于记录容量门禁证据。

`rollback:rehearsal` 写入 `docs/generated/m6-rollback-rehearsal-evidence.md`，用于记录停止写入、队列 drain、artifact 回滚、可选数据库/对象存储恢复、回滚后 smoke 等步骤状态。本地输出只能证明证据格式；只有在非客户目标环境真实执行后，才算 rollback readiness 证据。

`identity:check` 写入 `docs/generated/m6-identity-evidence.md`，用于记录 M6.2 目标 OIDC 身份证据。它必须证明 discovery/JWKS、Admin `/api/v1/me`、错误 issuer、错误 audience、过期 token、浏览器 token 获取/刷新/登出等检查。不能用本地 HMAC smoke 或静态 bearer 注入代替。

`selfhost:release-gate` 写入 `docs/generated/m6-release-readiness.md`，用于记录 release candidate 的版本、commit、artifact、环境指纹、迁移清单、身份、备份、回滚、容量、target synthetic acceptance 和 HDC scope。

当 `rollback readiness`、`capacity readiness`、`target synthetic readiness`、`queue readiness` 或 `observability` 被标记为 `passed` 时，release record 必须通过对应的 evidence 参数指向真实目标环境证据或经过批准的外部记录。只有 evidence path 而没有 readiness passed，不能代表该门禁通过；只有 readiness passed 而没有 evidence path，也会被 release gate 阻断。

## 必须保持诚实的 Pending 项

如果没有真实目标环境证据，以下项目不能标记为完成：

- target capacity run，
- target OIDC identity evidence，
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

只有当 `identity:check`、`selfhost:smoke`、target synthetic acceptance、capacity gate、backup/restore、rollback rehearsal、queue evidence 和 observability evidence 都有真实目标环境记录时，才可以考虑 controlled self-hosted release candidate Go。

缺少任一项时，结论应保持 No-Go 或 pending。
