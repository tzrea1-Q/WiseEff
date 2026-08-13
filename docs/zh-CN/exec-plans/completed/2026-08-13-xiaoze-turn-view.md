# 小泽回合视图:回合渲染的唯一纯裁决点

> 状态:**已完成 2026-08-13**(单 PR 变更;计划在完成时记录)
> 日期:2026-08-13
> 分支:`refactor/xiaoze-turn-view`
> English: [`docs/exec-plans/completed/2026-08-13-xiaoze-turn-view.md`](../../../exec-plans/completed/2026-08-13-xiaoze-turn-view.md)
> 来源:2026-08-12 架构审查候选 3(Strong)

## 目标

一个小泽回合由七路来源渲染(流式助手消息、权威 `xiaoze_turn_reply`、实时 `xiaoze_turn_state` 快照、实时运行步骤、持久化线程元数据、推理消息、运行标志)。优先级规则与五个显示门此前无测试地散在 `XiaozeTurnBlock` 组件体内——它调用的每个辅助函数都有测试,而 bug 真正藏身的组合点没有。本次把整条裁决收进一个纯函数 `resolveXiaozeTurnView(input) → XiaozeTurnView`(`src/features/agent/xiaozeTurnView.ts`),`XiaozeTurnBlock` 缩为 hooks 进、ViewModel 出的薄渲染。

## 决定

- `resolveXiaozeTurnView` 拥有:步骤优先级(live → reply → state → metadata)、答案优先级(done 状态文本 → reply/消息裁决 + 延迟门)、推理优先级(消息 → reply → state)、流式判定,以及全部显示门(推理面板、思考占位、相位条、答案)。
- `shouldDeferTurnAnswer` / `resolveTurnAnswerText` 从 `xiaozeTurnGrouping.ts` 迁入新模块(唯一消费方就是回合块);`shouldShowTurnThinking` 内联后删除。grouping 只留消息分组与助手挑选。
- 行为红线:渲染输出不变;断言从组件体逐行移译。

## 验证

- `xiaozeTurnView.test.ts`:15 个用例,覆盖延迟门、答案裁决(reply 对流式、内部文本回退、去重)、步骤优先级链、推理优先级链、活跃思考回合的推理流式判定、相位条/答案门、done 状态覆盖、引用优先级。`src/features/agent` 全套绿(34 文件 / 101 测试);`tsc -b`、`npm run build` 绿。
- 浏览器验证(隔离 deterministic 运行时,全新 Postgres):`/` 上的小泽弹窗,只读回合渲染用户气泡 → 步骤条(查询项目概览 · 完成)→ 带引用徽章的答案;视口 1440x900 / 768x1024 / 390x844;console 0 错误;截图 `work/ui-checks/turn-view-{desktop,tablet,mobile}.png`(不入库)。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + 中文版 |
| 前端文档 | No change | `docs/FRONTEND.md` 不列举回合块内部 |
| 其他 | No change | 线协议、产品行为、质量门未动 |

## 文档更新门禁

- [x] `docs/PLANS.md` 中英文列出本计划
- [x] `npm run docs:check` 全绿
