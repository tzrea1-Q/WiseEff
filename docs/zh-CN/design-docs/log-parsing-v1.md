# 日志解析 v1

> 英文：[English reference](../../design-docs/log-parsing-v1.md)

`skill/v1` 新增可选 `parsing`。解码核心实现抽取、类型转换、寄存器、寄存器映射和字节布局帧；查表、解码值信号及脚本由后续任务扩展。构件集合封闭，拒绝未知键，保存草稿与发布时返回带路径的问题。

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

## 技能适用文件与角色

外层 `skill/v1` 规范接受可选的 `files: [{glob, role?}]`：有序列表最多 100 项，通配非空且最多 256 字符，可选短角色最多 40 字符。省略或空列表表示适用于所有文件。通配区分大小写，匹配完整包内相对路径：`*` 不跨路径段，`**` 可跨斜杠，`**/` 可匹配零级目录，`?` 匹配一个非斜杠字符，`[abc]`、`[0-9]` 等字符类匹配一个字符。路径为相对路径并使用 `/`；拒绝不安全的绝对路径或穿越通配。校验返回 `files.0.glob`、`files.0.role` 等稳定路径。

第一个匹配项决定可选角色，后续项不会覆盖。没有角色与未匹配是不同状态。只有匹配且可分析的文件会应用所钉技能的信号规则、抽取器及解码；抽取器自身的 `files` 过滤进一步限制事件范围。未匹配的可分析文件继续产生通用信号，Agent 仍可列出、检索和按行读取。

工作区实时文件预览、服务端预览及 Worker 使用同一匹配器。存储的样例日志包提供全部清单路径，旧单文本样例则提供一个路径。每条记录的 `log_files` 保存 Worker 分配的角色及适用状态；记录 API 清单与 Agent 文件列表均包含两者。报告「文件」页显示角色，未匹配文件标记为「仅通用分析」。旧记录或尚未处理的记录可以没有适用范围分配结果。

## 规范与匹配

严格根结构为 `{schemaVersion: "parsing/v1", extractors: Extractor[], registers?, registerMaps?, frames?}`，最多 200 个抽取器。每个抽取器包含唯一 `id`（字母开头，后接最多 99 个字母、数字、下划线或连字符）、`pattern`、`fields`，以及可选 `files`、`multiline`。所有捕获组必须命名，且与声明字段一一对应；不需要捕获的括号使用 `(?:...)`。管理员模式统一经过 `compileLogPattern` 和 RE2JS，拒绝环视和反向引用，无原生正则回退。每个解析模式最多 512 个 UTF-16 码元，计数重复上限 100。默认执行搜索，完整匹配需自行加锚点；组装文本中的点可匹配换行。每个抽取器对一行或一个组装块最多产出一个事件。

抽取器的 `files` 最多包含 200 个区分大小写的路径通配，每项最多 1024 字符。它与技能适用范围共用有界正则编译器，并保留原有抽取器通配语法和路径处理行为：`*` 不跨路径段，`?` 匹配一个非斜杠字符，`**` 可跨斜杠，`**/` 可匹配零级目录。为保持不可变 `parsing/v1` 版本的行为，抽取器通配中的方括号仍按字面匹配：`capture[1].log` 匹配该完整文件名，不匹配 `capture1.log`。只有顶层 `skill/v1.files` 支持字符类。省略表示全部匹配技能且已分析的文件，空数组表示不选择文件；这与顶层 `skill/v1.files` 为空时适用于所有文件不同。跳过文件不参与解码。路径与从 1 开始的行号对应原始文件清单。

共享编译器限制格式画像、抽取器、信号及源码模式的程序大小。计数重复的上下界最多为 100；编译前保守估算展开量，拒绝嵌套重复和长字面量重复导致的膨胀，编译后的 `programSize()` 也不得超过 16,384 条指令。每个请求缓存及每份规范的总预算为 65,536 条指令；规范中的重复声明仍保守计入预算。校验错误定位到具体字段。格式预览的校验及两次解析共享同一缓存，抽取器预览的时间戳识别与生成模式校验也共享同一缓存。

## 字段类型

| 类型 | 输入与输出 |
| --- | --- |
| `int`、`uint` | 十进制、`0x` 十六进制或 `0b` 二进制，前缀不区分大小写，可带正负号。未配置寄存器解码时，结果必须是安全 JSON 整数；`uint` 拒绝负数。寄存器解码允许用十进制字符串保留超出安全范围的整数。 |
| `hex` | 十六进制整数，可带 `0x` 前缀；保留原始文本和数值，配置寄存器解码时超出安全整数范围的值使用十进制字符串。 |
| `float` | 有限十进制、小数或指数格式，拒绝空串、尾随文本、NaN 和无穷。 |
| `bool` | 不区分大小写的 `true/false`、`1/0`、`yes/no`、`on/off`。 |
| `string` | 保留捕获文本。 |
| `enum` | 必填 `values: Record<raw, label>`，最多 64 项，标签最多 128 个 UTF-16 单元；按原始文本精确查找字符串标签，未知值为字段错误。 |
| `timestamp` | 必填 `format`，按下述子集转换为带毫秒的 UTC ISO 8601。 |
| `hexbytes` | 偶数个十六进制数字，忽略空白（含组装换行）；输出小写 `{hex, length}`。 |
| `bytes` | `hexbytes` 的别名，帧解码输入支持可选 `0x` 前缀。 |
| `base64bytes` | 标准、规范的 Base64，按需补齐 padding；不接受空白或 URL-safe 字母表，输出小写 `{hex, length}`。 |

字符串字段直接输出字符串。转换字段保留 `{raw: string, value: 标量 | {hex, length}}`，枚举的 `value` 为标签。转换失败只省略该字段并记录字段错误，其余字段仍可使用。未参与匹配的可选组记录错误，不捏造空值。

时间格式支持 `%Y`（四位年份）、`%m`（月）、`%d`（日）、`%H`（24 小时）、`%M`（分）、`%S`（秒）、`%f`（1–6 位小数）、`%z`（`Z`、`+HHMM`、`-HHMM`、`+HH:MM`、`-HH:MM`）和 `%%`（字面百分号），其他文本按字面匹配。重复指令、不支持的指令或末尾单独百分号为规范错误。缺失分量默认为 `1970-01-01 00:00:00 UTC`；小数右补零或截断至毫秒。日期溢出、无效日期、闰秒及超范围时间或时区为字段错误，不依赖主机时区和 locale。

## 寄存器与寄存器映射

根对象接受可选 `registers` 和 `registerMaps` 字典，以定义 id 为键，最多 32 个寄存器、200 个映射。寄存器为 `{width: 8 | 16 | 32 | 64, fields: RegisterField[]}`，每个最多 64 个字段。字段必填 `bits: [hi, lo]`（包含两端，高位在前）和 `name`，可选 `enum: Record<整数, 标签>`、有限数 `scale`、有限数 `offset`、`unit`、`signed` 和 `description`。每个枚举最多 64 项，标签最多 128 个 UTF-16 单元；每个抽取器最多为 8 个捕获字段绑定寄存器或映射解码器。保存草稿、发布和预览均校验这些上限。位段不能重叠、超出位宽或重复名称。校验路径精确到定义、字段下标和属性，例如重叠为 `registers.REG0C.fields.2.bits`，高位越界为 `registers.REG0C.fields.2.bits.0`，重名为 `registers.REG0C.fields.2.name`。

抽取器的 `int`、`uint` 或 `hex` 字段可配置 `decode: {register: "REG0C"}` 或 `decode: {registerMap: "charger"}`，两者只能选其一。映射结构为 `{selectBy: "addr", cases: {"0x0C": "REG0C"}, default?: "fallbackRegister"}`。`selectBy` 指向同一抽取器中的另一个字段；数值键按类型化整数比较，因此地址 12 匹配 `0x0C`。等价数值键会作为重复项拒绝，引用的字段与定义必须存在。没有匹配分支且未配置默认项时，事件记录 `unmatched_register`，保留已抽取值并继续运行。

```yaml
schemaVersion: parsing/v1
extractors:
  - id: charger
    pattern: 'addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)'
    fields:
      addr: {type: uint}
      val: {type: hex, decode: {registerMap: charger}}
registerMaps:
  charger: {selectBy: addr, cases: {"0x0C": REG0C}}
registers:
  REG0C:
    width: 8
    fields:
      - {bits: [7, 7], name: WATCHDOG_FAULT}
      - {bits: [6, 6], name: BOOST_FAULT}
      - bits: [5, 4]
        name: CHRG_FAULT
        enum: {"0": normal, "1": input_fault, "2": thermal_shutdown, "3": safety_timer}
      - {bits: [3, 3], name: BAT_FAULT}
      - {bits: [2, 0], name: NTC_FAULT}
```

对于 `addr=0x0C val=0x20`，`val.value` 为 32；`val.fields.CHRG_FAULT.value` 为 2，`meaning` 为 `thermal_shutdown`，`WATCHDOG_FAULT` 和 `NTC_FAULT` 均为 0。子字段通过 `raw` 保留原始位值。有符号字段先按字段位宽解释补码，再计算 `value * scale + offset`（默认 1 和 0）；单位单独保留为 `unit`。枚举标签为 `meaning`，不替换数值。未缩放的 64 位值超出安全整数范围时使用十进制字符串；对不安全整数缩放记录 `register_precision`，避免丢失精度。超出寄存器位宽记录 `register_range`。

寄存器工作计入既有逐行、逐运行和耗时预算，每个位字段均有检查点，每事件字段总数最多 1024（超限记录 `field_cap`），帧/寄存器构件最多嵌套 8 层。事件契约允许最多 25 层结构树，用于容纳 8 层构件内的 TLV 集合/条目/载荷外壳及寄存器叶节点。不允许可执行表达式或脚本。解析引擎模块仍统一提供校验、行/组解码和模式泛化接口。工作区表单与 YAML 代码视图写入同一个 `ParsingSpec`；序列化为 YAML 再解析后，寄存器定义与映射引用保持一致。

粘贴表格对话框最多接受 UTF-8 64 KiB、512 行输入。超限显示错误并禁止导入。预览以文字和图标区分有效与被拒行，保留源行号和原因，并汇总有效/被拒行数。确认操作明确将当前寄存器的全部字段替换为有效行，不追加到原字段表。

## 解析测试

`skill/v1` 在 `parsing`、`signalRules` 之外接受可选 `parseTests`。测试保存在草稿已有的 spec JSON 中，随不可变版本发布；无需迁移或测试结果表。上述寄存器配置可搭配以下测试：

```yaml
parseTests:
  - id: charger-thermal
    name: Charger thermal shutdown
    fileName: kernel.log
    lines: ["addr=0x0C val=0x20"]
    expect:
      fields:
        addr: 12
        val: 32
        val.fields.CHRG_FAULT.meaning: thermal_shutdown
      signals: []
      exactSignals: false
```

`id` 在规范内唯一（1–100 字符）；`name` 不能为空白（最多 200 字符）。可选 `fileName` 为 1–1024 字符，默认 `sample.log`，参与抽取器文件通配匹配。`lines` 每项是一条原始行，不含 CR 或 LF。严格的 `expect` 对象接受可选 `fields`、`signals` 和 `exactSignals`。

`fileName` 也遵循技能适用文件规则（含默认的 `sample.log`）：未匹配时仅使用通用解析和信号，不运行技能抽取或解码，已完成适用性判断的结果返回 `applicability: {skillMatched, role}`，匹配文件仍须遵循抽取器自身的通配。

`expect.fields` 将点分字段路径映射到 JSON 值。路径从事件的 `fields` 起算，因此嵌套寄存器字段使用 `val.fields.CHRG_FAULT.meaning`。路径各段为标识符，不接受原型访问键。期望对象递归按子集匹配，全部期望必须在同一个解码事件中满足。多事件时任一事件完全匹配即通过；失败时使用差异最少的事件生成差异。标量期望先解包转换字段的 `value`，数值字符串（含十六进制）与数字归一化比较。显式 `.raw` 期望比较原始表示。数组按完整值比较。缺失值在对应字段路径中报告为 `actual: null, missing: true`，与存在但为 null 的字段区分。

`expect.signals` 列出期望规则 id、通用信号种类或信号标题，忽略重复命中与顺序。默认允许额外信号；`exactSignals: true` 还会报告多出的信号。省略字段或信号期望不表示要求其不存在；空信号列表加精确模式表示不应产生任何信号。

| 上限 | 限制 |
| --- | --- |
| 每技能测试数 | 50，id 唯一 |
| 每测试输入 | 1–200 行，每行最多 6144 个 UTF-16 码元 |
| 每次运行输入总量 | 5000 行、1,048,576 个 UTF-16 码元 |
| 每测试期望 | 200 个字段路径，每个最多 1024 字符；200 个信号，每个最多 200 字符；序列化 JSON 最多 65,536 个码元；JSON 嵌套深度最多 12 |
| 信号规则图 | 64 条规则，每条 16 个条件，条件合计 256 个；每条文本模式最多 4096 个 UTF-16 码元，信号模式合计最多 65,536 个码元；同时受共享程序大小预算约束：每条模式最多 16,384 条指令，整个规范或请求内的所有模式合计最多 65,536 条指令。结构上限与程序预算必须同时满足；仅允许不重复的 `i`、`m`、`s` 标记 |
| 信号规则值 | 比较每侧最多 16 个 token 名，每个最多 100 字符；规则 id 最多 200 字符，说明文本最多 4096 字符，每个建议动作列表最多 32 项 |
| 执行 | 全部测试的校验、解码、信号提取与比较共 1000 ms |
| 每次运行解码输出总量 | 沿用引擎上限：50,000 事件、4 MiB 序列化输出、32,768 字段，并受逐事件与逐行上限约束 |
| 按需运行 HTTP 请求体 | 解析测试 POST 最多 8 MiB，包含重复/尾随斜杠的路由别名；收集请求体时即以 HTTP 413 拒绝超限字节，不进入 JSON 解析 |

信号规则上限位于共享 schema，保存草稿、发布和按需运行均校验同一规则图。预检查在子项校验与模式编译前拒绝超限图。模式仍使用共享 RE2 引擎，不回退到原生正则。按需运行接口对校验设置 1000 ms 硬截止时间，仅将剩余时间传给执行。无效输入（含校验超时）返回 HTTP 400（`VALIDATION_FAILED`），不生成测试运行结果。

统一服务端运行器使用 Worker 的协作式解码器和信号提取器，包含格式画像解析与真实信号规则。返回 `{total, passed, failed, results, truncated}`。每项包含 `id`、`name`、`passed`、`diffs: [{path, expected, actual, missing?}]`、`missingSignals`、`unexpectedSignals`、实际 `events` 与信号 id，以及可选执行错误。校验通过后，执行截止时间、解码错误或输出上限耗尽使受影响测试失败，并返回 `truncated: true`，不拒绝请求或报告为完整通过。

保存草稿与发布返回新的可选 `parseTestRun`。`POST /api/v1/log-skills/:skillId/parse-tests` 接受 `{spec}`，按需检查当前编辑，沿用技能管理权限与组织范围。结果仅作为响应保留在打开的工作区，并关联所测试的规范，不持久化：有界确定性测试可重新计算，避免存储过期结果和新增迁移。「测试」分区提供字段路径表单、代码视图及内联差异表；分区工具栏提供「运行测试」，并紧凑显示通过/失败数、「未运行」或「运行中」。发布对话框顶部显示通过数/总数与失败项链接，再按名称列出各测试的新增、修改和删除，并标明修改部分。测试失败不阻止发布。

## 字节布局帧

`frames` 将定义 id 映射到 `{endian?: "big" | "little", fields: FrameField[]}`，最多 32 个帧，每帧最多 64 字段，每个 switch/TLV 映射最多 256 分支。字段按数组顺序消耗字节，偏移自动计算。帧默认使用大端；字段的 `endian` 覆盖所在帧的默认值，用于整数、tag、length 及校验和存储。抽取器可将 `decode: {frame: "packet"}` 连接到 `hex`、`bytes`、`hexbytes` 或 `base64bytes` 捕获；帧十六进制输入支持可选 `0x` 和空白。解码保留原始字节，捕获节点下包含嵌套字段。

每个帧字段都有 `name` 和 `type`，其他选项如下：

| 类型 | 选项与行为 |
| --- | --- |
| `uint`、`int` | `length: 1 | 2 | 4 | 8`，可选 `endian`、`scale`、`offset`、`unit`、`enum`、`register`。有符号整数先按补码解释，再计算比例与偏移。寄存器引用将未缩放的整数解码为嵌套位字段。 |
| `bytes` | `length` 为非负固定字节数或先前整数字段的路径。保留 `{hex, length}`，不解释字节内容。 |
| `register` | `register` id、`length: 1 | 2 | 4 | 8`，可选 `endian`；读取整数后应用对应寄存器。 |
| `frame` | `frame` id，可选固定或字段驱动的 `length`；对子切片应用嵌套帧。 |
| `switch` | `on` 为先前字段路径，`cases` 将值映射到 `{frame: id}` 或 `{register: id}`，可选 `default`、`length`、`endian`。数字键沿用寄存器映射的归一化规则，`"0x01"` 与 `"1"` 不能并存。无匹配项且无默认项时记录事件解码错误。 |
| `repeat` | `frame` id，`count` 为常量或先前整数字段路径，可选正整数 `multiplier`。子帧重复 `count * multiplier` 次。 |
| `tlv` | `tagSize`、`lengthSize` 均为 `1 | 2 | 4`；可选 `endian`、`length` 限定区域。`cases` 将 tag 映射到帧或寄存器引用。length 只计算 value 字节，未知 tag 保留原始 value 字节。 |
| `checksum` | `algorithm`、覆盖范围 `range: [start, endExclusive]`、存储 `length: 1 | 2 | 4`，可选 `endian`。范围相对所在帧，不得包含该字段自身存储校验和的字节。 |

路径用点分隔解码字段名称，可指向嵌套寄存器字段。先查找所在帧先前的字段，再查找已解码的抽取器字段，例如 `hdr.num_objects`。字段驱动的长度、计数和分支判定值必须在使用前可用，禁止向前引用；长度与计数值必须为非负整数。保存、发布和预览共用校验，拒绝重名、未知引用、循环、无效长度、归一化分支键重复、向前引用和校验和范围重叠。错误精确到 `frames.packet.fields.2.count` 或 `frames.packet.fields.3.cases.0x01.frame` 等路径。校验不执行任意表达式。

校验和算法集合固定：`sum8` 为字节和模 256；`xor8` 为逐字节异或；`crc8` 多项式为 `0x07`；`crc16-ccitt` 多项式为 `0x1021`、初值为 `0xFFFF`；`crc16-modbus` 使用反射形式的 `0x8005` 多项式、初值为 `0xFFFF`；`crc32` 为 IEEE CRC-32。校验节点保留 `checksum: {expected, actual, ok}`，expected 为覆盖字节计算值，actual 为存储字段值。失配保留两个值并记录事件错误，分析继续。ASCII `123456789` 的四种 CRC 结果分别为 `0xF4`、`0x29B1`、`0x4B37`、`0xCBF43926`。不同校验字段的覆盖范围也不能重叠；固定偏移在校验时检查，动态偏移在运行时检查。

帧与寄存器共享最多 8 层嵌套。单帧输入最多 4096 字节；每个 repeat 乘上 multiplier 后最多 256 项，帧字段、寄存器字段、重复元素与 TLV 项共享单事件 1024 元素上限；每个 TLV 字段最多 256 项。超限及无效或截断输入记录具体事件解码错误，保留已完成结果。错误码为 `frame_depth`、`frame_length`、`repeat_count`、`frame_elements`、`tlv_items`、`frame_range`，switch 未命中为 `unmatched_switch`，校验和失配为 `checksum_mismatch`。字段、重复元素、TLV 项与校验和工作共享既有时间预算和检查点。所有帧节点计入既有单事件 1024 字段、32 KiB 事件大小、单运行 32,768 字段与 4 MiB 序列化输出上限。

解码帧节点附带 `byteOffset` 与 `byteLength`，工作区据此将字段映射到样例字节。十六进制视图按可用宽度每行显示 16、8 或 4 字节，并同步偏移栏；选择字段高亮对应字节，选择字节会选中其字段，描边与字重提供颜色之外的标识，不向字节单元插入额外符号。字段行显示预览值及校验和状态。普通整数同时显示十进制与十六进制；带单位或枚举含义的值保持原样。变长字段之后的偏移显示为相对形式，如 `+2 after payload`。表单与 YAML 代码视图往返保留同一套帧定义与引用。

### USB-PD 示例

```yaml
schemaVersion: parsing/v1
extractors:
  - id: pd_rx
    pattern: 'hdr=(?P<hdr>0x[0-9A-Fa-f]+) data=(?P<data>[0-9A-Fa-f]+)'
    fields:
      hdr: {type: uint, decode: {register: pd_header}}
      data: {type: hexbytes, decode: {frame: pd_data}}
registers:
  pd_header:
    width: 16
    fields:
      - {name: msg_type, bits: [4, 0], enum: {"1": Source_Capabilities}}
      - {name: num_objects, bits: [14, 12]}
  fixed_pdo:
    width: 32
    fields:
      - {name: supply_type, bits: [31, 30], enum: {"0": fixed}}
      - {name: voltage, bits: [19, 10], scale: 50, unit: mV}
      - {name: max_current, bits: [9, 0], scale: 10, unit: mA}
frames:
  pd_data:
    fields:
      - {name: objects, type: repeat, frame: pd_object, count: hdr.num_objects}
  pd_object:
    endian: little
    fields:
      - {name: pdo, type: register, register: fixed_pdo, length: 4}
```

`hdr=0x2161 data=2C9101082CD10200` 的头字段得到消息类型 1、含义 `Source_Capabilities`，对象数为 2。载荷解码得到两个 fixed PDO：5000 mV / 3000 mA、9000 mV / 3000 mA。日志中的头已经是整数；若头包含在传输字节中，2 字节小端寄存器字段会把 `61 21` 读为 `0x2161`。

帧、寄存器和寄存器映射绑定共用每个抽取器最多八个解码捕获字段的上限。

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
| 序列化事件最多 32 KiB | 省略无法纳入限额的字段，事件记录 `event_size`；保留先前字段并继续解码。 |
| 每运行序列化 JSONL 最多 4 MiB | 不接纳会超出剩余输出预算的事件，保留已完成事件，计一次 `output_byte_cap`；此上限在 gzip 压缩前计算，包含 JSONL 换行。 |
| 每运行最多 32,768 个解码字段 | 同时计算根字段与嵌套子字段。不接纳会超出剩余字段预算的事件，保留已完成事件，计一次 `output_field_cap`。 |
| 多行最多 200 行 | 产出受限事件并记录 `max_lines`。 |
| worker 解码默认最多 15,000 ms | `LOG_DECODE_MAX_MS` 最大取 20,000 ms；信号提取与解码共享最多四分之一的剩余任务租约，从信号提取开始时计算。其余预算留给压缩、存储与分析，不续租。每行、组提交和编译前检查截止时间；停止时保留已完成事件、丢弃未完成组、计一次 `time_cap`，继续分析。 |
| 转换无效 | 仅省略该字段并记录 `invalid_field`。 |

计数为 `{total, byExtractor: Record<id, count>, errors: Record<code, count>, truncated?, reason?}`。累计输出耗尽时，结果与持久化运行计数均带 `truncated: true` 和 `reason: "output_field_cap" | "output_byte_cap"`，`errors[reason]` 为 1。正常解码保留既有计数结构，不添加这些标记。解码错误不导致分析运行失败。`unmatchedLineCount` 统计未纳入产出事件的输入行，每文件按行计一次，不因多个抽取器重复计数。预览最多接受 UTF-8 1 MiB，在固定 100 ms 校验和解码预算内最多处理 5000 行，最多返回 500 事件。超限返回 `truncated: true` 和 `reason: "time_cap" | "line_cap" | "event_cap" | "output_field_cap" | "output_byte_cap"`；计数描述已完成工作，未处理行计入未匹配。worker 环境变量不能提高预览或累计输出预算。

引擎确定性执行，不访问数据库、不做 IO。迭代器在逐行检查点间保留多行状态和事件顺序。worker 与预览调度器约每 8 ms 或 2000 个检查点让出事件循环，以先达到者为准，包含长度检查和文件结束时的组提交。worker 截止时间为协作检查，不能抢占单次受限 RE2 调用。预览额外使用 VM 硬超时保护内部固定回调的校验和解码，不执行管理员源码；被中断时恢复最近完整检查点的事件和计数，并丢弃迭代器。这不实现沙箱脚本。JSONL 经 gzip 背压流式压缩，只收集压缩块供对象存储 Buffer 使用。

事件仍保留顺序数组以稳定 `query_events` 游标偏移和抽取器/组完成顺序。文件/行证据索引引用同一批对象，不复制 raw/类型字段；多个抽取器重访早前行时，把索引展平会改变顺序，因此保留两种引用结构。默认值面向标准 384 MiB worker，解析输入和不定长字段仍占用内存，提高限制前须检查内存和租约预算。可选 `npx tsx scripts/log-decode-memory-probe.ts` 对三个总计 95 MiB 文件执行 worker 的解码、压缩和索引函数，报告内存、耗时和事件循环漂移；它独立于测试，不代表已有 100 MiB 容量结果。

## 版本化事件与运行产物

```json
{"v":1,"source":"declarative","extractor":"current","file":"kernel.log","line":412,"fields":{"current":{"raw":"0x10","value":16},"state":{"raw":"2","value":"thermal"}}}
```

契约为 `{v: 1, source: "declarative", extractor, file, line, endLine?, fields: Record<string, DecodedValue>, errors?: {field?, code, message}[]}`。`DecodedValue` 为 JSON 标量、`{hex, length}`，或包裹标量/字节值的 `{raw, value, meaning?, unit?, byteOffset?, byteLength?, checksum?: {expected, actual, ok}, fields?: Record<string, DecodedValue>}`。寄存器与帧字段作为原始值下的嵌套树，大整数使用十进制字符串，避免 JSON 数字损失精度。`source: "script"` 为未来隔离沙箱保留，当前不接受、不执行。

worker 按不可变钉住版本解码已分析文件，每运行写一个 gzip JSONL 对象，解析完成后在当前任务租约保护下把键和计数存入 `log_analysis_runs.decoded_events_object_key`、`decoded_event_counts`，provider 重试时仍保留。无抽取器时字段保持 null，不创建解码对象。`log_evidence.decoded_fields` 与 DTO `decodedFields` 包含被引用的精确文件/首行锚点对应事件；保留事件外壳避免不同抽取器或引用行的同名字段冲突。worker 统一补充，覆盖循环、单次 LLM 与规则回退报告。

压缩或上传失败时记录 `errors.artifact_error`，持久化空产物键，继续分析且不提供解码事件。按内置本地/S3 存储共用的内容寻址键尽力清理上传；清理失败也不使分析失败。即使无法存储产物，计数仍保留已完成的解码工作。worker 不续租，解码至少预留当前剩余租约的四分之三供压缩、存储和分析使用。

旧钉住版本若超出新模式限制，记录 `errors.decode_error`、产物键置空，继续分析且不解码；新保存/发布则以校验路径拒绝这些模式。

只有钉住版本含抽取器时才提供 `describe_event_schema()`、`query_events(...)`。grounding 仅认可查询工具自身 `events[].file/line`；endLine 范围、字段内或知识检索中嵌入的引用不代表已看到行。预览与查询细节见 [API 契约](api-contract.md)。

`query_events` 最多返回 50 事件，含响应外壳的序列化输出最多 16 KiB，每字段最多 1 KiB；超长值转为带标记的字符串预览，字段过多的事件可省略尾部字段。字段缩短、分页或运行解码不完整时返回 `truncated: true`；累计输出上限还向 Agent 展示具体原因，即使查询已到最后一页。`nextCursor` 从首个未返回的已存事件继续，无法恢复因运行预算未接纳的事件。筛选始终使用原始类型值，查询缩短不修改已保留事件和引用证据；累计输出耗尽后，已完成字段仍可用于报告。
