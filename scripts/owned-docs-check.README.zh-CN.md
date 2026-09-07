# 独占环境中的文档验证

[English](owned-docs-check.README.md)

既有 `run-upgrade-component-tests.ts` runner 接受精确的 `docs-check`
suite。它沿用 daemon 准入和资源归属检查，新建独占的 pgvector PostgreSQL
16 容器、网络、卷及私有目标 receipt，然后在当前仓库执行
**`npm run docs:check`**。子进程只接收本次独占数据库连接和 receipt，
不继承环境中的数据库连接或 GitHub OIDC bearer。

独立观测开发 daemon 后，使用 runner 已有的 `--expected-daemon-id` 和
`--suite docs-check` 参数。Hosted 调用另经已有 `--github-hosted` 准入。
没有新增生产目标、远程 context 或通用 shell 命令输入。原有期限、输出
脱敏和精确资源清理同样覆盖 npm 及其后代进程。

`schema-doc` 仍是独立的生成命令。生成成功不等于文档验证成功：
`docs-check` 执行 package 定义的文档治理及 schema 漂移检查，并保留
非零退出码，不更新已跟踪的生成文档。此次注册不新增 CI step，也不代表
已经执行真实 PostgreSQL 验证；路由测试不能证明文档或升级已就绪。
