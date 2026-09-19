# T3.2 剩余验证 — 留待合适环境

> English: [English](../../../exec-plans/active/849-inventory/t32-remaining-verification.md)

target-synthetic-acceptance 已在 SHA `d520964e4` **通过**（见 [t32-local-acceptance.md](t32-local-acceptance.md)）。**minimal-upgrade 仍不是通过。** 该行有当前通过证据之前，T3.2 保持未勾。不得把 skip、历史 CI SKIPPED 或 arm64 拒绝当作验收。

本 Scratch 上 local-non-HDC Gate0、smoke、quality、coverage、operations，以及现在的 target-non-hdc 已有当前证据。

## 仍延期的项

| 项 | 此处无法跑的原因 | 所需环境 | 命令 / 入口 | 何谓通过 |
| --- | --- | --- | --- | --- |
| minimal-upgrade | 已在本机跑过：`linux/aarch64`，要求 `linux/x86_64`。断言：`the existing self-hosted base-image contract requires native amd64`。T3.4a 未 SEALED。未授权 `workflow_dispatch` `acceptance_mode=minimal-upgrade`。 | linux/x86_64 Docker 主机或 GitHub hosted runner；已封印候选 SHA；docker daemon id。 | `npx tsx scripts/run-minimal-upgrade-acceptance.ts <40-char-sha> "$(docker info --format '{{.ID}}')"` 或 `gh workflow run ci.yml -f acceptance_mode=minimal-upgrade` | 封印 SHA 上终端证据 `complete:true`。`complete:false`、arm64 拒绝或未封印 SHA 不是通过。 |

## 续跑规则

1. 在 T3.4a 将封印的 **同一候选 SHA** 上重跑，或重跑后再封印。
2. 把精确 SHA、环境、命令、通过/失败/跳过计数和产物路径记入 [t32-local-acceptance.md](t32-local-acceptance.md)（中英）。
3. 不得用这些本地结果启动 T3.3b/目标执行。
4. minimal-upgrade 也有当前通过证据之前，T3.2 保持未勾。

## 此处范围外

T3.3a Docker/S2 彩排、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭。
