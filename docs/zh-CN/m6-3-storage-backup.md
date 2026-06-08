# M6.3 自托管对象存储与备份恢复

本文面向需要在自有 Linux 服务器上部署 WiseEff 的开发者和运维人员。M6.3 不要求使用云服务商对象存储，而是要求一个 S3-compatible 自托管对象存储，并通过健康探针和备份恢复演练证明它可用。

## 对象存储要求

WiseEff 应用侧只依赖 S3-compatible 行为：

- bucket `HEAD`
- object `PUT`
- object `GET`
- object `HEAD`
- object `DELETE`
- `x-amz-meta-*` metadata
- content type
- checksum 校验

具体产品选择记录在 `ops/self-hosted/storage/provider-decision.md`。RustFS-compatible、MinIO-compatible、Ceph RGW 或其他方案都可以，只要通过同一套探针和演练。

## 常用命令

```bash
npm run restore:drill
npm run backup:drill
npm run backup:check
```

`restore:drill` 用于检查恢复目标是否安全，避免误恢复到 live database、live bucket 或空前缀。

`backup:drill` 生成 `docs/generated/m6-backup-restore-evidence.json` 和 `.md`，记录 provider、环境、分支、commit、数据库备份/恢复目标、对象存储备份/恢复目标、checksum、表计数、采样日志对象引用、命令 exit code 和 Redis 状态。

`backup:check` 检查 evidence 是否字段完整、已脱敏、没有失败命令、没有危险恢复目标、没有 missing log object。Redis durable queue 尚未进入 M6.4 前，queue 状态应为 `conditional`。

## 关键环境变量

```text
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_TLS_POLICY=required
OBJECT_STORAGE_PATH_STYLE=true
OBJECT_STORAGE_HEALTH_PREFIX=.health/
OBJECT_STORAGE_RETENTION_CLASS=pilot-default

BACKUP_DATABASE_TARGET=file:///var/backups/wiseeff/postgres/wiseeff.dump
BACKUP_OBJECT_STORAGE_TARGET=file:///var/backups/wiseeff/object-store/
RESTORE_DATABASE_URL=postgres://wiseeff_restore:restore-password@postgres:5432/wiseeff_restore
RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore
RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/
```

恢复目标必须和生产目标隔离。`RESTORE_DATABASE_URL` 不能等于 `DATABASE_URL`，`RESTORE_OBJECT_STORAGE_BUCKET` 不能等于 live bucket，`RESTORE_OBJECT_STORAGE_PREFIX` 必须非空并以 `/` 结尾。

## Evidence 规则

本地 evidence 只能证明脚本、脱敏和安全门禁有效，不能替代目标环境验收。

只有在真实 non-customer 或 pilot target 中完成 isolated restore，并且 `npm run backup:check` 通过后，才能把该 evidence 作为目标环境 backup/restore 依据。`M5_BACKUP_RESTORE_DRILL_AT` 只能在真实目标恢复演练通过后设置。

不要提交数据库 dump、对象文件、真实客户日志、密钥、bearer token、signed URL 或包含凭据的数据库 URL。
