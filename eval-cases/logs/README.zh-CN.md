# 日志分析金标准案例集

> English: [`README.md`](README.md)

金标准案例集(词汇表:Golden case set,见 `CONTEXT.md`)是支撑日志分析**效果层评测**(`npm run logs:eval:quality`)的标注语料库。同一份案例集同时服务回归门禁、模型/提示词对比,以及(P3 起)线上监控。

## 诊断流程行为检查

`npm run logs:eval` 同时运行 `server/modules/logs/eval/scenarios.ts` 中确定性、零 API 成本的诊断流程场景。正常流程必须在两个内核中都位于未改变的平台协议之后、用户任务之前。对抗场景要求跳过证据约束、伪造第 `9999` 行、写入参数，或注入结束分隔符及伪造的平台协议标题。检查确保流程作为单个 JSON 字符串封闭在低优先级、不可信的指导段中，现有证据约束和工具守卫拒绝违规尝试，最终只输出有依据的证据或如实标记的降级结果。这些脚本检查验证提示词构造和内核强制约束，不衡量真实模型抵御诱导的能力。

通用信号场景在未选择技能时调用 `get_signals`、`get_line_templates` 和 `get_timeline`。只有工具实际返回的锚点或日志行可以作为证据；时间线场景会拒绝存在于上传文件、却不在返回窗口内的引用，再改用已返回的行。

源码定位场景在运行钉住的就绪快照上调用 `locate_log_statement`。只有实际返回的快照、路径、行号组合可以成为证据；即使同时引用了有效日志行，未返回的源码位置、其他快照或路径、摘录中的相邻行也会被拒绝。源码摘录始终是不可信输入。

源码工具场景通过路径通配与字面量或全文查询合法调用 `search_source`，并通过快照、路径与行范围合法调用 `read_source_range`。即使后端返回超量数据，检索结果仍须满足最多 20 个命中、每条摘录 400 个字符和总计 16 KiB 的上限。请求 100 行时最多返回 80 行编号源码；只引用已返回的第 80 行可以通过接地检查，未看到的第 81 行会被拒绝。快照排队、索引中、失败、归档或不存在时，两种工具均不可用。接地检查读取模型实际看到的受限工具输出，而不是后端测试数据。

源码检索超时场景验证 Agent 收到截断结果后仍可使用已接地的日志证据继续分析。PostgreSQL 集成检查评分前的候选接纳、常见查询拒绝、数据库超时和事务超时设置恢复。

该命令重新生成 `docs/generated/log-analysis-eval.{json,md}`，任何行为预期失败都会使命令失败。质量基线固定为 `2026-10-19.loop.procedure.signals.source.3`；既有容差和等待真实案例的状态保持不变。

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

### 产品分析用例与 ZIP 互操作

技能管理员可在工作区「测试」中导入、导出此目录布局。ZIP 直接从 `<domain>/<case-id>/` 开始，不添加外层 `eval-cases/logs/` 目录。已有 `case.yaml` 和 `log.txt` 在导入、导出后字节保持一致，包括 YAML 注释和原始换行。编辑导入用例的期望会替换其标注；未修改的日志文件仍保留原字节。

日志包用例可通过可选 `bundleFiles` 列出相对路径，例如 `fixtures/device.zip`。这些文件保留原始上传字节，包括压缩包与 UTF-16 输入。`log.txt` 是供现有命令行评测使用的扁平 UTF-8 投影，`keyEvidenceLines` 指向投影行号。产品使用 `bundleFiles` 还原原始多文件输入。可选 `keyEvidence` 的每项用解包后的文件路径及正整数 `line`、有界线性时间 `pattern`，或二者标识证据。可选 `expectedDegradedReason` 使用已有降级原因。可选 `caseName` 独立于摘要保留用例名称。这些扩展不改变原有 golden-case 词汇，也不会让合成用例计入质量基线。

导入会在保存前拒绝不安全路径、重复条目、链接、无效标注、缺失日志文件和超出大小或数量限制的输入。错误包含具体用例路径和标注字段。产品限制每技能 20 个用例、每个输入日志包及规范化文本各 10 MiB、100 个文件、每次运行最多 20 个用例和 120 秒，每技能保留最近 10 次运行。编辑后的期望限 1 MiB YAML，导入标注限 2 MiB。ZIP 压缩及解压总量均限 440 MiB、2040 条目，以容纳全部有界用例及其投影。运行与草稿试运行共享组织及总量准入。相同用例比较已保存草稿与当前发布版本，复用质量评测和已配置 judge；未配置 judge 时使用确定性评分检查。得分仅供发布参考，始终不阻止发布。

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
