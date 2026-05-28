# WiseEff 部署与运维设计

日期：2026-05-25

## 1. 环境

WiseEff 至少需要三个环境：

| 环境 | 用途 | 特点 |
| --- | --- | --- |
| local | 开发 | 可使用 mock、测试数据库、设备模拟器 |
| staging | 验收 | 接近生产配置，禁用前端业务 mock |
| production | 生产 | 强制认证、真实数据库、监控告警、备份 |

## 2. 服务

部署单元：

- `web`：前端静态资源。
- `api`：主业务 API。
- `worker`：日志分析、导入、报表等异步任务。
- `device-gateway`：设备通信网关。
- `postgres`：主数据库。
- `redis`：任务队列和短期缓存。
- `object-storage`：日志文件、导出文件和附件。

## 3. 配置

配置必须通过环境变量或安全配置系统注入：

- `APP_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_BUCKET`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `AGENT_PROVIDER`
- `DEVICE_GATEWAY_URL`
- `MOCK_RUNTIME_ENABLED`

生产环境要求：

- `MOCK_RUNTIME_ENABLED=false`
- 禁止使用开发密钥。
- 禁止设备网关暴露公网。

## 4. CI/CD

CI 阶段：

1. 安装依赖。
2. 类型检查。
3. 前端单元和组件测试。
4. 后端单元和集成测试。
5. API 契约检查。
6. 构建 web/api/worker/device-gateway。
7. 安全扫描和依赖审计。

CD 阶段：

1. 部署到 staging。
2. 运行数据库迁移。
3. 运行 smoke tests。
4. 运行关键 E2E。
5. 人工批准生产发布。
6. 灰度或滚动发布 production。
7. 发布后健康检查和告警观察。

## 5. 数据库迁移

规则：

- 迁移必须可重复执行。
- 破坏性迁移分两步：先兼容写入，再清理旧字段。
- 迁移前自动备份。
- 迁移失败必须阻止发布。
- 每个迁移包含 rollback 或恢复说明。

## 6. 健康检查

API 健康检查：

- `/health/live`：进程存活。
- `/health/ready`：数据库、Redis、对象存储可用。

Worker 健康检查：

- 队列连接。
- 消费延迟。
- 失败任务数量。

Device Gateway 健康检查：

- 网关进程。
- 模拟器连接。
- 真实设备通道可选检查。

## 7. 监控与告警

需要监控：

- API 请求量、错误率、延迟。
- 数据库连接、慢查询、锁等待。
- worker 队列长度、失败率、重试次数。
- 日志分析耗时。
- Agent 工具调用成功率和审批等待时间。
- 设备读写成功率、超时和回读不一致。
- 审计写入失败。

必须告警：

- API 5xx 持续升高。
- 审计写入失败。
- worker 积压超过阈值。
- 数据库连接耗尽。
- 设备网关不可用。
- 生产环境 mock runtime 被启用。

## 8. 备份与恢复

备份对象：

- PostgreSQL。
- 对象存储日志文件和导出文件。
- OpenAPI 合同和部署配置。

恢复要求：

- 至少每日自动备份。
- 关键发布前额外备份。
- 定期恢复演练。
- 明确 RPO 和 RTO，MVP 建议先以 RPO 24 小时、RTO 4 小时为目标。

## 9. 发布与回滚

发布策略：

- 前端静态资源可快速回滚到上一版本。
- 后端采用滚动发布。
- 数据库迁移向前兼容。
- worker 发布前清空或暂停高风险任务。
- 设备网关发布优先在模拟器验证。

回滚触发：

- 参数合入接口错误率异常。
- 审计事件缺失。
- 日志任务大量失败。
- 设备写入异常。
- 权限校验异常。
## M5 Production Auth Boundary

- Local and test environments may use `AUTH_MODE=development`, the seeded development user, and `x-wiseeff-user` for deterministic tests.
- Production must set `NODE_ENV=production`, `AUTH_MODE=production`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_HMAC_SECRET`; short HMAC secrets are rejected outside tests.
- The API verifies `Authorization: Bearer <payload>.<signature>` server-side before creating `AuthContext`. Signed claims must include issuer, subject, and organization, and may include roles and permissions.
- `/api/v1/me` and business routes use the same auth resolver. Production requests without a valid bearer token fail with `UNAUTHENTICATED` instead of falling back to development auth.
- High-risk writes still re-check permissions at execution time, including parameter review, log archive/rerun, debugging writes or rollback, and Agent approval-required tools.

## M5 Object Storage Boundary

- Local and test environments may use `OBJECT_STORE_MODE=local` with `OBJECT_STORE_ROOT=.wiseeff-object-store`.
- Production must set `NODE_ENV=production` and `OBJECT_STORE_MODE=s3`.
- S3/OSS mode requires `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and `OBJECT_STORAGE_SECRET_ACCESS_KEY`; `OBJECT_STORAGE_REGION` is optional.
- Uploaded log objects use organization-scoped keys with SHA-256 checksum prefixes. The adapter writes checksum, byte size, content type, retention class, and encryption-mode metadata.
- `/health/ready` checks the configured bucket through the object-store health seam and returns a 503 with the provider error when the bucket, endpoint, or credentials are not usable.
- The built-in HTTP transport issues HEAD/GET/PUT with WiseEff signing headers. It is an M5 runtime seam, not a full AWS SigV4 implementation or cloud-vendor SDK.
- Pilot smoke should upload a supported log, confirm analysis can read it back, and verify `/health/ready` reports `dependencies.objectStore.status=ready`.
- Cloud-provider SDK wiring, SigV4/provider-specific signing, bucket provisioning, lifecycle policy, KMS policy, replication, and credential rotation remain post-M5 deployment work unless the target environment has already provided them.
