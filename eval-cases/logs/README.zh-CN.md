# 日志分析金标准案例集

> English: [`README.md`](README.md)

金标准案例集(词汇表:Golden case set,见 `CONTEXT.md`)是支撑日志分析**效果层评测**(`npm run logs:eval:quality`)的标注语料库。同一份案例集同时服务回归门禁、模型/提示词对比,以及(P3 起)线上监控。

## 目录结构

```
eval-cases/logs/
  README.md                      # 英文指南 + README.zh-CN.md(本文件)
  baseline.json                  # 已提交的质量基线(见「基线门禁」)
  <domain>/                      # 业务域 slug,例如 charging-power、uncategorized
    <case-id>/                   # kebab-case,稳定且可读
      log.txt                    # 与真实上传完全一致的日志内容
      case.yaml                  # 标注(schema 见下)
```

## `case.yaml` schema

由 `server/modules/logs/eval/goldenCases.ts`(zod)校验;损坏的案例会让效果层评测以逐案例问题清单失败。

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `domain` | 是 | 业务域 slug,必须与父目录同名 |
| `summary` | 是 | 一句话场景描述 |
| `realLog` | 是 | `true` = 已脱敏的真实日志(计入质量分与基线门禁);`false` = 合成日志(只计入格式覆盖) |
| `deIdentified` | `realLog: true` 时必填 | 脱敏声明;真实案例缺少 `deIdentified: true` 直接校验失败 |
| `rootCauseCategory` | 是 | 评测专用枚举(见下)——绝不进入产品输出契约 |
| `rootCausePoints` | 非拒答案例必填 | 专家确认的根因陈述,结论必须覆盖 |
| `keyEvidenceLines` | 非拒答案例必填 | 决定性证据的 1-based 原始行号(必须存在且非空行) |
| `expectedActions` | 非拒答案例必填 | 专家期望报告给出的行动建议 |
| `expectRefusal` | 否(默认 `false`) | `true` = 诚实的结果是拒答/低置信回答,而不是给出诊断 |
| `analysisQuestion` | 否 | 可选的用户问题;结论必须回应它 |
| `formatProfile` | 否 | 可选的声明式格式画像,解析 `log.txt` 时应用(格式覆盖案例用) |

### `rootCauseCategory` 取值(v1)

`thermal-protection`、`communication-failure`、`device-unavailable`、`power-delivery-degradation`、`configuration-error`、`hardware-fault`、`software-fault`、`no-fault`、`insufficient-evidence`。

该枚举只为打分(根因桶匹配)存在;新域接入时审慎扩展,绝不泄漏进产品契约。

## 从 `/log-admin` 导出标注草稿（P3）

要把线上已分析的案例升格为标注而不必手抄字段：在 `/log-admin` 打开记录抽屉，使用**「导出评测案例草稿」**。它下载两份可直接放入本目录结构的文件：`case.yaml` 草稿（domain slug 取记录的业务域或 `uncategorized`，`realLog: true`、**`deIdentified: false`**、`rootCauseCategory: TODO`，`keyEvidenceLines` 从报告证据锚点预填，`rootCausePoints` 从结论拆分，`expectedActions` 取自建议动作，`analysisQuestion` 一并带上）与 `log.txt`（分析时的原始行，行号稳定）。

导出物刻意只是**草稿**，没有任何仓库写入或自动提交。入库前你仍必须：(1) 按下方清单对 `log.txt` 与 yaml 人工脱敏；(2) 把 `rootCauseCategory` 的 TODO 换成真实枚举值；(3) 请业务域专家确认预填的要点/行号/动作；(4) 把 `deIdentified` 改为 `true`。loader 会拒绝跳过任一步的草稿——未完成的导出绝不会悄悄算作金标准案例。

## 标注指南

1. **来源**:优先使用由业务域专家确认过的真实生产日志。每个域在质量门禁激活前目标 20–50 条真实标注案例。
2. **根因**:`rootCausePoints` 写成专家签字确认的简短事实陈述,不是对日志行的转述。
3. **证据行**:只引用*决定性*的行(通常 1–5 行)。行号基于原始文件、从 1 开始,与产品证据锚点一致。
4. **行动建议**:写合格工程师接下来应做的事;它们喂给 rubric judge,不做字符串精确匹配。
5. **拒答案例**:当日志确实撑不起诊断时,置 `expectRefusal: true` 并把根因字段留空——诚实拒答本身是被打分的行为。
6. **合成案例**:标 `realLog: false`。它们只为覆盖格式画像(时间戳形态、severity 词表、JSON lines、内核风格……),绝不计入质量分。

## 脱敏清单(`realLog: true` 必须全部满足)

真实日志入 git 前,以下各项必须全部成立——无法完全脱敏的案例不进入仓库案例集:

- [ ] 无人名、电话、邮箱、账号标识
- [ ] 无客户/公司名称、项目代号、合同标识
- [ ] 无设备序列号、MAC、IMEI、精确地理位置
- [ ] 无可识别客户网络的 IP/主机名(替换为 `host-anon-N`)
- [ ] 无凭据、token、内部 URL
- [ ] 替换后保持行号与技术语义稳定(行数不变、错误码不变)
- [ ] 业务域专家在脱敏后确认过标注
- [ ] `case.yaml` 中已置 `deIdentified: true`

## 基线门禁

`eval-cases/logs/baseline.json` 存放最近一次被接受的质量分。存在时,`npm run logs:eval:quality` 将当前运行与之比较:**`realLog: true` 案例的分数不得低于基线减去声明容差**(容差在报告中声明)。案例集尚无真实案例时,报告如实输出 `quality baseline pending real cases`,门禁不激活——但机制本身有测试覆盖。

## 人工复核记录(`reviews/`,P3b judge 校准)

每次效果评测按确定性规则抽样已评分案例,产出复核清单 `docs/generated/log-analysis-judge-sample.md`(抽样率 `LOG_ANALYSIS_JUDGE_SAMPLE_RATE`,默认 0.2,至少 1 条)。复核人按与 judge 相同的 0..1 rubric 打分,并把清单中的模板提交为 `eval-cases/logs/reviews/<run-id>.yaml`:

```yaml
runId: qe-20260813-020107
reviewer: expert-name
reviewedAt: 2026-08-13
cases:
  - id: charging-power/case-dir
    humanRootCauseScore: 0.75 # 0..1,与 judge 同尺度
    humanCategoryMatch: true # 可选
    notes: "除次要原因外与标注一致" # 可选
```

下一次 `logs:eval:quality` 会加载 `reviews/` 下的全部文件、校验 schema(损坏文件直接使运行失败)、**按案例 id** 与当前运行的已评分案例匹配,并在报告固定的「Judge calibration」段落输出 judge-human 一致性(精确一致率 + 均差 + 类别一致率)。尚无复核记录时如实输出 "no human reviews yet"。不要为了让指标"活起来"给合成案例伪造复核。

## 当前状态

当前提交的所有案例均为 `realLog: false` 的格式覆盖种子。真实专家标注案例(每域 20–50 条,第二个试点域由产品负责人点名)是 P2 计划中如实跟踪的外部依赖——绝不伪造「真实」案例。出于同样原因目前也没有人工复核记录:对纯合成案例做 judge 校准等于在噪声上校准。
