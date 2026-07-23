# 本地演示账号种子 — 执行计划

> English: [`docs/exec-plans/active/2026-07-23-local-demo-credentials-seed.md`](../../../exec-plans/active/2026-07-23-local-demo-credentials-seed.md)  
> 设计: [`docs/zh-CN/superpowers/specs/2026-07-23-local-demo-credentials-seed-design.md`](../../superpowers/specs/2026-07-23-local-demo-credentials-seed-design.md)  
> 分支: `feat/local-demo-credentials-seed`

## 目标

仅在 `NODE_ENV=development` 时，M0 seed 为七个 ChargeLab persona upsert 固定 username + 共用演示密码，避免按角色测 UI 时手动注册/bootstrap。

## Git & PR

| 角色 | 允许 |
| --- | --- |
| 实现 | 在 `feat/local-demo-credentials-seed` 提交；不得推/合 `main` |
| 父会话 | 审阅、开 PR、合并、同步 `main` |

## 任务

- [x] Task 1: `seedLocalDemoCredentials` helper + 单测（TDD）
- [x] Task 2: 接入 `seed-m0.ts` + `seed-m0.test.ts`
- [x] Task 3: 中英 local-development / authentication + PLANS 索引
- [x] Task 4: 本地 re-seed + login smoke

共用密码：`WiseEff-Dev!`  
Username：`xu.yun` / `zhao.heng` / `liu.min` / `wang.jie` / `chen.na` / `li.peng` / `sun.mei`

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 本地开发 | Update | `docs/developer/local-development.md`、中文对应页 |
| API 认证 | Update | `docs/api/authentication.md`、中文对应页 |
| 计划索引 | Update | `docs/PLANS.md`、中文 PLANS、本计划 |
| 环境变量示例 | No change | 无新 env（仅 `NODE_ENV`） |
| Security | Review | 确认未暗示生产带演示密码 |

## 文档更新门禁

Update/Review 完成或注明不变后，跑 `npm run docs:check` 方可完成。

## 验证

```bash
npm run test:server -- --run server/modules/auth/seedLocalDemoCredentials.test.ts server/scripts/seed-m0.test.ts
npm run docs:check
NODE_ENV=development npm run db:seed:m0
```
