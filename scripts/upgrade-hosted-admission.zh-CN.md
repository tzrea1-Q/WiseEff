# 隔离 PostgreSQL 组件的签名 Hosted 准入

English: [English](upgrade-hosted-admission.md)

此模块只增加开发测试运行器的准入路径，不批准部署、数据库迁移、恢复、应用启动、队列恢复或公开流量。既有 Docker 本地端点检查、逐次 daemon 核验、全新资源创建、所有权标签与清理检查继续生效。Docker Desktop 的本地准入仍是独立路径。

## 信任合同与归属

`upgrade-hosted-admission.ts` 自行请求 token，并从固定的 GitHub 官方 JWKS 地址读取签名公钥。不接受调用者提供的 token、JWKS、序列化批准、`CI` 布尔值或测试开关。`node:crypto` 执行 RSA 验签；`node:https` 显式要求证书校验，不跟随重定向，每次请求限时 10 秒、正文上限 256 KiB。应用 OIDC 模块包含业务用户治理映射，属于独立私有边界，本次不复用或修改。

issuer 固定为 `https://token.actions.githubusercontent.com`，仓库固定为 `tzrea1-Q/WiseEff`，workflow 文件固定为 `.github/workflows/ci.yml`。完整 `workflow_ref` 必须匹配当前预期引用，仅支持分支或 PR merge 引用。签名声明还必须匹配实测 checkout SHA、run ID、run attempt，并声明 `runner_environment=github-hosted`。token 必须当前有效、签发于十分钟内且有效区间不超过十分钟。仅接受 RS256、唯一匹配且兼容的至少 2048 位 RSA 签名公钥。

每次签发使用全新随机 nonce，将 daemon 身份等全部观察事实绑定到 audience 摘要。摘要自身**不发现或独立证明 Docker 身份**。组件运行器必须先通过拒绝远端端点的 `createIsolatedUpgradeDocker` 取得 daemon 身份，通过 Git 取得 checkout SHA，再通过必需的 `observeCurrent` 回调在验签后重新观察。run/workflow 环境字段只是预期值，没有匹配的签名声明时不构成权限。

返回值是冻结的、仅在当前进程有效的 `new-owned-pg-components` 能力。`assertHostedUpgradeAdmission` 检查对象确由本模块签发、尚未到期且当前事实一致。复制或序列化会失去权限。创建自有资源前立即调用此检查；每次 Docker 调用仍经过原身份保护。准入到期不能妨碍必要清理，但清理仍须核验资源所有权。禁止将此模块用于通用 Docker 命令或备份消费。

## 威胁与验收矩阵

| 威胁 | 拒绝方式或保留边界 |
| --- | --- |
| 调用者伪造 Hosted 环境值 | 必须取得官方 TLS JWKS 且验签通过 |
| self-hosted、错误仓库、workflow、SHA、run 或 attempt | 签名声明精确匹配失败即拒绝 |
| 跨请求或 daemon 复制 token | 全新 audience 挑战和请求后的重新观察拒绝 |
| 到期、未来或陈旧 token，复制能力对象 | 时间检查和私有 WeakSet 拒绝 |
| 不可信端点、重定向、超时、超大正文、TLS 失败 | 不转发凭据，使用有界固定错误 |
| 准入后资源漂移 | 原逐次 daemon 和自有资源检查继续生效 |
| 将 receipt 借作恢复或发布批准 | 能力仅限全新自有 PG 组件资源 |

失败仅含固定原因码，不含请求 URL、token、request bearer、底层错误或远端正文。token 不写入文件、日志、receipt 或交付附件。

## 接线与证据边界

父协调者维护的组件运行器传入已观察事实、最小 OIDC 请求环境字段及同步重新观察函数，并消费进程内能力。GitHub job 的 `id-token: write` 仅用于请求签名 token。workflow 和共享运行器接线属于独立修改。GitHub 未给予 OIDC 权限时，包括受限 fork 工作流，必须失败，不能生成通过证据。

在隔离开发工作树执行合成测试：

```sh
./node_modules/.bin/vitest run --config vitest.scripts.config.ts scripts/upgrade-hosted-admission.test.ts
```

测试使用合成 RSA 密钥和受控 HTTPS 响应接口，执行真实密码学验签和错误行为验证；不证明真实 GitHub 签发、Hosted Docker 隔离或实际证书握手。真实 Hosted 执行必须另行记录；此处不提供生产命令。

2026-09-07 核实来源：[GitHub OIDC 声明及 token 请求](https://docs.github.com/en/actions/reference/security/oidc)、[官方 issuer discovery](https://token.actions.githubusercontent.com/.well-known/openid-configuration)。来源明确 issuer、JWKS、RS256、自定义 audience、runner environment 与 workflow/run 字段；本模块另行限定只供组件测试使用的更窄策略。
