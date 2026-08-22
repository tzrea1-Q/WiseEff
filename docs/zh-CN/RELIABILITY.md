# 可靠性指南

> English: [English](../RELIABILITY.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- `/metrics` 现含 DTS 解析/编译延迟与失败、工具链就绪、身份映射/规格审核积压、发布绕过与参数身份 cutover 状态；告警与切换步骤见 `docs/runbooks/parameter-identity-cutover.md`。失败 apply 后禁止部分继续，只能整快照恢复。
- DTS 重载部署为**进程内请求**（ADR-0020）：挂载、推送、触发、内核日志采集与行为核对均在持有桥接 WebSocket 的 API 进程上执行，不走 BullMQ。仓库提供的自托管拓扑只支持一个 API 副本；对于 `--scale api=...` 和 `--scale=api=...`，`ops/self-hosted/scripts/compose` 只允许精确的 `api=1`，其他所有 `api=*` 值都会在调用 Docker 前被拒绝，其他服务扩容仍正常透传。直接调用 Compose 只会绕过保护，并不会让多 API 变成受支持拓扑；orchestrator 或外部部署若没有让 WebSocket 与后续 bridge-backed 请求落到同一 API 进程的 bridge-aware routing，同样不受支持。自定义亲和拓扑不属于仓库 stock 契约，必须另取目标环境证据；本文不声称 HA 或多副本就绪。证据与 UI 在 `/dts-reload`，勿与已下线的 `/debugging` 混淆。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 只有 IP、没有域名的自托管实验室走 [配置向导](../../ops/self-hosted/setup.zh-CN.md) / [IP 实验室 profile](../../ops/self-hosted/ip-lab.zh-CN.md)，不是试点/发布证据。
- 已运行 checkout 使用[自托管升级入口](../../ops/self-hosted/upgrade.zh-CN.md)：锁定一个 commit、停机前构建、校验 PostgreSQL/对象存储/Redis 恢复点，在不删除 volume 的情况下重建服务；migration 后失败会保持流量停止并记录 `recovery-required`。首次 root-only `prepare-host` 为部署用户配置 Docker 与受保护的 journal/备份目录，此后普通动作拒绝任何 root 有效用户，以保留部署用户的 Git/代理环境与文件所有权；受限网络主机用一份权限 `0600`、按 allowlist 解析的代理/npm 源/组织 CA/构建 TLS 策略契约，setup/upgrade 将其传给 BuildKit，但不把凭据写入 journal 或镜像层，Docker daemon 拉取仍是独立边界。`verify` 是默认策略；无法安装 CA 的主机可选择仅构建期 `insecure`，但每次实际构建还必须传 `--allow-insecure-build`，journal 会记录该来源，同时宿主机/运行时 TLS 与包完整性/签名门禁保持开启。固定基础镜像契约同时记录 OCI manifest 和 Docker config digest，使 containerd 与经典 `overlay2` 存储能校验同一归档且不放宽平台门禁；相同 SHA no-op 还必须满足 API/worker/web 使用精确目标镜像并通过公网探测。历史混合 API/worker/web 镜像按服务分别保留，持久锁通过 `lock-status`/`unlock` 安全处理而不是手删。`setup.sh --force` 仍是配置操作，不是升级捷径。
- 自托管图形化监控使用 `ops/self-hosted/scripts/observability up`：Compose profile 会启动 Prometheus、Grafana、Alertmanager、HTTP/TCP 服务探针和主机/PostgreSQL/Redis exporter，自动装载四套 Dashboard。监控 UI 默认只绑定 loopback，通过 SSH 隧道、VPN 或同等级受控运维路径访问；独立 worker 在 Compose 私网端口 `8788` 提供 liveness 与 Prometheus 指标。
- 小泽 readiness 只消费 resolver 规范化后的 atomic `XIAOZE_LLM_*` 组三键；canonical 空值不会回退旧别名。`XIAOZE_DETERMINISTIC=true` 可免 base/key 通过离线 health，但不构成 live-provider 证据。

## 补充说明（小泽 checkpoint）

- 生产与自托管部署使用 `XIAOZE_CHECKPOINTER=postgres`；LangGraph checkpoint 表由 `npm run db:migrate` 确保。
- HITL 多步计划在 API 重启与多副本间可恢复；本地开发/测试默认 `memory`。
- 与用户可见聊天历史（TD-030）分离。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
