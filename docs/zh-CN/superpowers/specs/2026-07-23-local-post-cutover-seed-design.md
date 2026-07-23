# 本地 Post-Cutover M1 种子 — 设计

> 日期：2026-07-23  
> 状态：已批准实现  
> English: [`docs/design-docs/2026-07-23-local-post-cutover-seed-design.md`](../../../design-docs/2026-07-23-local-post-cutover-seed-design.md)  
> 分支：`feat/local-post-cutover-seed`

## 问题

本地 `npm run dev:all` 原先双写 flat 身份与语义 bindings。可创建 typed draft，提交审核因缺 cutover marker 返回 409。对脏双轨库跑生产 migrate 会出现大量歧义/未映射。Runbook 禁止对脏共享开发库就地 cutover。

## 目标

- 本地默认路径结束于 **post-cutover**，typed binding 可提交审核。
- 不削弱生产 submit / 维护窗口 cutover 门禁。
- 脏双轨本地库失败关闭并提示 wipe。

## 非目标

- 自动修好生产类脏双轨映射。
- 关闭 TD-042。
- 把 cutover SQL 并入 `db:migrate`。

## 设计

1. M1 默认语义-only（跳过 flat defs/PPV/历史）。
2. `ensureLocalPostCutoverIdentity`：已 cutover 则幂等；脏库抛 wipe 文案；否则本地 token 走 apply + cutover。
3. `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` 恢复双轨且跳过本地 finalize。
4. **API 启动**：`dev:api` / `dev:all` 在 `NODE_ENV=development` 下 listen 前跑同一套 ensure，避免旧 volume 静默服务 cutovers=0；脏库启动失败。可用 `WISEEFF_LOCAL_POST_CUTOVER=0` 关闭。production 永不启用。
5. 生产 `parameter-identities:*` 不变。

## 验收

- 新 volume + seed 后有 cutover marker，可提交 typed 草稿。
- 脏库 finalize 失败并提示重建。
