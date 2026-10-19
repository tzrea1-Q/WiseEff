# 日志解析 v1

> 英文：[English reference](../../design-docs/log-parsing-v1.md)

`skill/v1` 新增可选 `parsing`。本解码核心只实现抽取与类型转换；寄存器、寄存器映射、帧、查表、解码值信号及脚本由后续任务扩展。解析根对象、抽取器、多行配置和字段规范均拒绝未知键，保存草稿与发布时返回带路径的问题。

```yaml
schemaVersion: parsing/v1
extractors:
  - id: current
    files: ["kernel*.log", "device/**"]
    pattern: 'current=(?P<current>0x[0-9A-Fa-f]+|[0-9]+) state=(?P<state>[0-9]+)'
    fields:
      current: {type: uint}
      state: {type: enum, values: {"0": idle, "2": thermal}}
```

## 规范与匹配

严格根结构为 `{schemaVersion: "parsing/v1", extractors: Extractor[]}`，最多 200 个抽取器。每个抽取器包含唯一 `id`（字母开头，后接最多 99 个字母、数字、下划线或连字符）、`pattern`、`fields`，以及可选 `files`、`multiline`。所有捕获组必须命名，且与声明字段一一对应；不需要捕获的括号使用 `(?:...)`。管理员模式统一经过 `compileLogPattern` 和 RE2JS，拒绝环视和反向引用，无原生正则回退。每个解析模式最多 512 个 UTF-16 码元，计数重复上限 100。默认执行搜索，完整匹配需自行加锚点；组装文本中的点可匹配换行。每个抽取器对一行或一个组装块最多产出一个事件。

`files` 最多包含 200 个区分大小写的路径通配，每项最多 1024 字符。`*` 匹配单个路径段内任意字符，`?` 匹配一个非斜杠字符，`**` 可跨斜杠，`**/` 可以匹配零层目录，其余字符均按字面匹配。省略表示全部已分析文件，空数组表示不选择文件；跳过文件不参与解码。路径与从 1 开始的行号对应原始文件清单。

## 字段类型

| 类型 | 输入与输出 |
| --- | --- |
| `int`、`uint` | 十进制、`0x` 十六进制或 `0b` 二进制，前缀不区分大小写，可带正负号。结果必须是安全 JSON 整数；`uint` 拒绝负数。 |
| `float` | 有限十进制、小数或指数格式，拒绝空串、尾随文本、NaN 和无穷。 |
| `bool` | 不区分大小写的 `true/false`、`1/0`、`yes/no`、`on/off`。 |
| `string` | 保留捕获文本。 |
| `enum` | 必填 `values: Record<raw, label>`；按原始文本精确查找字符串标签，未知值为字段错误。 |
| `timestamp` | 必填 `format`，按下述子集转换为带毫秒的 UTC ISO 8601。 |
| `hexbytes` | 偶数个十六进制数字，忽略空白（含组装换行）；输出小写 `{hex, length}`。 |
| `base64bytes` | 标准、规范的 Base64，按需补齐 padding；不接受空白或 URL-safe 字母表，输出小写 `{hex, length}`。 |

字符串字段直接输出字符串。转换字段保留 `{raw: string, value: 标量 | {hex, length}}`，枚举的 `value` 为标签。转换失败只省略该字段并记录字段错误，其余字段仍可使用。未参与匹配的可选组记录错误，不捏造空值。

时间格式支持 `%Y`（四位年份）、`%m`（月）、`%d`（日）、`%H`（24 小时）、`%M`（分）、`%S`（秒）、`%f`（1–6 位小数）、`%z`（`Z`、`+HHMM`、`-HHMM`、`+HH:MM`、`-HH:MM`）和 `%%`（字面百分号），其他文本按字面匹配。重复指令、不支持的指令或末尾单独百分号为规范错误。缺失分量默认为 `1970-01-01 00:00:00 UTC`；小数右补零或截断至毫秒。日期溢出、无效日期、闰秒及超范围时间或时区为字段错误，不依赖主机时区和 locale。

## 多行组装

`multiline` 为 `{start, continue?, end?, keyField?, maxLines}`，`maxLines` 为 1–200。控制模式逐原始行匹配。指定 `keyField` 时，每个已配置控制模式均须捕获该已声明字段，按其原始键在文件内分别组装，交错键不会混入彼此文本。没有键时只保留一个打开的组。start 打开新组并提交相同键的旧组；end 纳入组后提交；continue 纳入组。当无 continue 且无键时，后续行持续纳入，直到 end、新 start、文件结束或上限。文件结束提交未关闭的组。抽取器对组内行以 `\n` 连接后的文本执行匹配。

没有 end 而达到 `maxLines` 时，即使抽取模式未匹配也产出带 `max_lines` 的受限事件，不再追加；最后允许行恰好匹配 end 则正常完成。过长行跳过并清空打开的组，防止跨缺失内容形成错误匹配。`line` 为组首行，`endLine` 为最后纳入行；交错时两者之间的行不一定都属于此组。结果按文件、抽取器遍历及组完成顺序确定，不按行号全局排序。

## 上限与计数

| 上限 | 行为 |
| --- | --- |
| 原始行 UTF-8 大小 8 KiB | 整行跳过，计 `line_cap`；不截断以避免伪匹配。 |
| 每个解析模式最多 512 个 UTF-16 单元，计数重复上限 100 | 在 RE2 编译之前拒绝超限规范，多行控制模式同样受限；转义、引用及字符类中的大括号按字面处理。 |
| 每行匹配输入最多 6144 个 UTF-16 单元，多行组最多 16,384 个单元 | 超长行整行跳过，计 `match_input_cap` 并清除打开的组；超长组只产出错误事件，不从截断前缀抽取字段。 |
| 默认每运行跨文件、抽取器共 50,000 事件 | worker 可用 `LOG_DECODE_MAX_EVENTS` 覆盖；保留先产出事件，被丢弃的匹配计 `event_cap`；打开的多行组也有共享准入上限。 |
| bytes 字段解码后 4 KiB | 省略字段，事件记录 `byte_cap`。 |
| 多行最多 200 行 | 产出受限事件并记录 `max_lines`。 |
| worker 解码默认最多 15,000 ms | `LOG_DECODE_MAX_MS` 最大取 20,000 ms，worker 实际最多使用当前剩余任务租约的四分之一。每行、组提交和编译前检查截止时间；停止时保留已完成事件、丢弃未完成组、计一次 `time_cap`，继续分析。 |
| 转换无效 | 仅省略该字段并记录 `invalid_field`。 |

计数为 `{total, byExtractor: Record<id, count>, errors: Record<code, count>}`。解码错误不导致分析运行失败。`unmatchedLineCount` 统计未纳入产出事件的输入行，每文件按行计一次，不因多个抽取器重复计数。预览最多接受 UTF-8 1 MiB，在固定 100 ms 校验和解码预算内最多处理 5000 行，最多返回 500 事件。超限返回 `truncated: true` 和 `reason: "time_cap" | "line_cap" | "event_cap"`；计数描述已完成工作，未处理行计入未匹配。worker 环境变量不能提高预览预算。

引擎确定性执行，不访问数据库、不做 IO。迭代器在逐行检查点间保留多行状态和事件顺序。worker 与预览调度器约每 8 ms 或 2000 个检查点让出事件循环，以先达到者为准，包含长度检查和文件结束时的组提交。worker 截止时间为协作检查，不能抢占单次受限 RE2 调用。预览额外使用 VM 硬超时保护内部固定回调的校验和解码，不执行管理员源码；被中断时恢复最近完整检查点的事件和计数，并丢弃迭代器。这不实现沙箱脚本。JSONL 经 gzip 背压流式压缩，只收集压缩块供对象存储 Buffer 使用。

事件仍保留顺序数组以稳定 `query_events` 游标偏移和抽取器/组完成顺序。文件/行证据索引引用同一批对象，不复制 raw/类型字段；多个抽取器重访早前行时，把索引展平会改变顺序，因此保留两种引用结构。默认值面向标准 384 MiB worker，解析输入和不定长字段仍占用内存，提高限制前须检查内存和租约预算。可选 `npx tsx scripts/log-decode-memory-probe.ts` 对三个总计 95 MiB 文件执行 worker 的解码、压缩和索引函数，报告内存、耗时和事件循环漂移；它独立于测试，不代表已有 100 MiB 容量结果。

## 版本化事件与运行产物

```json
{"v":1,"source":"declarative","extractor":"current","file":"kernel.log","line":412,"fields":{"current":{"raw":"0x10","value":16},"state":{"raw":"2","value":"thermal"}}}
```

契约为 `{v: 1, source: "declarative", extractor, file, line, endLine?, fields: Record<string, DecodedValue>, errors?: {field?, code, message}[]}`。`DecodedValue` 为 JSON 标量、`{hex, length}` 或包裹它们的 `{raw, value}`。`source: "script"` 为未来隔离沙箱保留，当前不接受、不执行。

worker 按不可变钉住版本解码已分析文件，每运行写一个 gzip JSONL 对象，解析完成后在当前任务租约保护下把键和计数存入 `log_analysis_runs.decoded_events_object_key`、`decoded_event_counts`，provider 重试时仍保留。无抽取器时字段保持 null，不创建解码对象。`log_evidence.decoded_fields` 与 DTO `decodedFields` 包含被引用的精确文件/首行锚点对应事件；保留事件外壳避免不同抽取器或引用行的同名字段冲突。worker 统一补充，覆盖循环、单次 LLM 与规则回退报告。

压缩或上传失败时记录 `errors.artifact_error`，持久化空产物键，继续分析且不提供解码事件。按内置本地/S3 存储共用的内容寻址键尽力清理上传；清理失败也不使分析失败。即使无法存储产物，计数仍保留已完成的解码工作。worker 不续租，解码至少预留当前剩余租约的四分之三供压缩、存储和分析使用。

旧钉住版本若超出新模式限制，记录 `errors.decode_error`、产物键置空，继续分析且不解码；新保存/发布则以校验路径拒绝这些模式。

只有钉住版本含抽取器时才提供 `describe_event_schema()`、`query_events(...)`。grounding 仅认可查询工具自身 `events[].file/line`；endLine 范围、字段内或知识检索中嵌入的引用不代表已看到行。预览与查询细节见 [API 契约](api-contract.md)。

`query_events` 最多返回 50 事件，含响应外壳的序列化输出最多 16 KiB，每字段最多 1 KiB；超长值转为带标记的字符串预览，字段过多的事件可省略尾部字段。字段缩短或分页时返回 `truncated: true`，`nextCursor` 从第一个未返回事件继续。筛选始终使用原始类型值，存储事件和证据仍保留完整字段。
