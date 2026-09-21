# T3.2 剩余验证 — 留待合适环境

> English: [English](../../../../exec-plans/active/849-inventory/t32-remaining-verification.md)

target-synthetic-acceptance 已在 SHA `d520964e4` **通过**（见 [t32-local-acceptance.md](t32-local-acceptance.md)）。**minimal-upgrade 仍不是通过。** 该行有当前通过证据之前，T3.2 保持未勾。不得把 skip、历史 CI SKIPPED 或 arm64 拒绝当作验收。

local-non-HDC Gate0、smoke、quality、coverage、operations 和 target-non-hdc 的历史回执见上述链接；它们不是 2026-09-21 本地闭环候选的验证。

## 仍延期的项

| 项 | 此处无法跑的原因 | 所需环境 | 命令 / 入口 | 何谓通过 |
| --- | --- | --- | --- | --- |
| minimal-upgrade | 已在本机跑过：`linux/aarch64`，要求 `linux/x86_64`。断言：`the existing self-hosted base-image contract requires native amd64`。T3.4a 未 SEALED。未授权 `workflow_dispatch` `acceptance_mode=minimal-upgrade`。 | linux/x86_64 Docker 主机或 GitHub hosted runner；已封印候选 SHA；docker daemon id。 | `npx tsx scripts/run-minimal-upgrade-acceptance.ts <40-char-sha> "$(docker info --format '{{.ID}}')"` 或 `gh workflow run ci.yml -f acceptance_mode=minimal-upgrade` | 退出码 0，精确候选的已脱敏 `evidence.zip` 满足下述终端探针条件。架构拒绝、产物缺失或清理失败均不是通过。 |

## 终端探针与交付完成的区别

现有[探针](../../../../../scripts/run-minimal-upgrade-acceptance.ts)有意保持 `complete:false`，因为终端彩排后还需要独立评审及必需 CI。此前 `complete:true` 判据不可达，本轮只修正文档，不改变探针或放宽断言。

仅就终端探针而言，须同时满足：进程退出码 0；`candidateSha` 与指定的干净候选一致；`nextStage: "independent-review-and-required-ci"`；没有 `failedStage` 或 `failure`；`cleanup: "complete"`；没有未完成的 `browserCleanup`；以及成功脱敏并发布的 `evidence.zip`。仅成功阶段标记不够，后续清理或产物发布仍可能失败。`complete` 的任一取值本身都不构成通过依据。这些条件不产生 Hosted、目标主机或完整 T3.4a SEAL 证据。2026-09-21 的文档修正没有执行原生 amd64 重跑。

## 续跑规则

1. 在 T3.4a 将封印的 **同一候选 SHA** 上重跑，或重跑后再封印。
2. 把精确 SHA、环境、命令、通过/失败/跳过计数和产物路径记入 [t32-local-acceptance.md](t32-local-acceptance.md)（中英）。
3. 不得用这些本地结果启动 T3.3b/目标执行。
4. minimal-upgrade 也有当前通过证据之前，T3.2 保持未勾。

## 此处范围外

T3.3a Docker/S2 彩排、T3.3b 目标、T3.4a 封印、T3.4b PR/Hosted/merge、T3.5 Issue 关闭。
