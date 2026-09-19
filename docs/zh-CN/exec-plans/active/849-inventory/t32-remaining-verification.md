# T3.2 剩余验证 — 留待合适环境

> English: [English](../../../exec-plans/active/849-inventory/t32-remaining-verification.md)

下列项 **不是通过**。本 worktree 会话无法执行，必须在匹配环境重跑后才能勾 T3.2。不得把 skip、历史 CI SKIPPED 或本次延期当作验收。

本 Scratch 上 local-non-HDC Gate0、smoke、quality、coverage、operations 已有当前证据（见 [t32-local-acceptance.md](t32-local-acceptance.md)）。

## 延期项

| 项 | 此处无法跑的原因 | 所需环境 | 命令 / 入口 | 何谓通过 |
| --- | --- | --- | --- | --- |
| target-synthetic-acceptance | 本会话没有目标前端/API URL 或鉴权。`WISEEFF_ACCEPTANCE_FRONTEND_URL`、`WISEEFF_TARGET_FRONTEND_URL`、`TARGET_FRONTEND_URL`（及对应 API）均未设置。 | 带前端+API URL、鉴权、可选目标 `DATABASE_URL` 的实目标或已授权合成目标。CI 为 `workflow_dispatch` `target-synthetic-acceptance`。 | GitHub Actions `ci.yml` `acceptance_mode=target-non-hdc` 或 `full-pilot`：`npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime --frontend-url <target>` | 在具名候选 SHA 上 `--no-start-runtime` 跑完并归档产物。缺密钥/skip 不是通过。 |
| minimal-upgrade | `scripts/run-minimal-upgrade-acceptance.ts` 要求 **已封印** 40 位 SHA、本机 Docker **`linux/x86_64`** 和 daemon id。本机 Docker 为 `linux/aarch64` / arm64。T3.4a 尚未封印。未授权 `workflow_dispatch` `acceptance_mode=minimal-upgrade`。 | linux/x86_64 Docker 主机或 GitHub hosted runner；已封印候选 SHA；docker daemon id。 | `npx tsx scripts/run-minimal-upgrade-acceptance.ts <40-char-sha> "$(docker info --format '{{.ID}}')"` 或 `gh workflow run ci.yml -f acceptance_mode=minimal-upgrade` | 封印 SHA 上终端证据 `complete:true`。`complete:false`、arm64 拒绝或未封印 SHA 不是通过。 |

## 续跑规则

1. 在 T3.4a 将封印的 **同一候选 SHA** 上重跑，或重跑后再封印。
2. 把精确 SHA、环境、命令、通过/失败/跳过计数和产物路径记入 [t32-local-acceptance.md](t32-local-acceptance.md)（中英）。
3. 不得用这些本地结果启动 T3.3b/目标执行。
4. 两行都有当前通过证据之前，T3.2 保持未勾。

## 此处范围外

T3.3a Docker/S2 彩排、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭。
