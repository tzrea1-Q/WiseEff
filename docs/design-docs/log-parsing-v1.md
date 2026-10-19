# Log parsing v1

> Chinese: [Chinese reference](../zh-CN/design-docs/log-parsing-v1.md)

`skill/v1` accepts optional `parsing`. The decoding core implements extraction, typed conversion, registers, register maps and byte-layout frames. Lookups, decoded-value signals and scripts are later additions. The construct set is closed: unknown keys are rejected on draft save and publication with issue paths.

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

## Schema and matching

The strict root is `{schemaVersion: "parsing/v1", extractors: Extractor[], registers?, registerMaps?, frames?}` (at most 200 extractors). Each extractor has a unique `id` (letter followed by up to 99 letters, digits, underscores or hyphens), `pattern`, `fields`, optional `files`, and optional `multiline`. All capture groups must be named and correspond exactly to declared fields. Use `(?:...)` for grouping without capture. Administrator patterns use `compileLogPattern` and RE2JS; lookaround and backreferences are rejected, with no native-regex fallback. Parsing patterns are at most 512 UTF-16 code units, with counted repetition bounds at most 100. Extraction uses unanchored search unless the author supplies anchors; dot matches newlines in assembled text. Each matching extractor produces at most one event per line or assembled group.

`files` is an optional list of at most 200 case-sensitive path globs, each at most 1024 characters. `*` matches within one path segment, `?` matches one non-slash character, and `**` matches across slashes; `**/` can match zero directories. Other characters are literal. Omission selects all analyzed files; an empty list selects none. Skipped files are never decoded. Paths and one-based line numbers refer to the original file inventory.

## Field types

| Type | Accepted input and output |
| --- | --- |
| `int`, `uint` | Decimal, `0x` hexadecimal or `0b` binary, case-insensitive prefixes, optional sign. Output must be a safe JSON integer without a register decoder; `uint` rejects negative values. Register-decoded integers outside the safe range use decimal strings. |
| `hex` | Hexadecimal integer, with optional `0x` prefix; retains raw text and a numeric value, or a decimal string outside the safe integer range when register-decoded. |
| `float` | Finite decimal, fractional or exponent notation; rejects empty input, trailing text, NaN and infinity. |
| `bool` | Case-insensitive `true/false`, `1/0`, `yes/no`, `on/off`. |
| `string` | Captured text, unchanged. |
| `enum` | Required `values: Record<raw, label>` with at most 64 entries and labels at most 128 UTF-16 code units; exact raw-key lookup yields its string label. Unknown keys are field errors. |
| `timestamp` | Required `format`; converts to UTC ISO 8601 with milliseconds, as specified below. |
| `hexbytes` | Even number of hexadecimal digits, ignoring whitespace (including assembled newlines). Outputs lowercase `{hex, length}`. |
| `bytes` | Alias of `hexbytes`; frame decoding accepts an optional `0x` prefix. |
| `base64bytes` | Canonical standard Base64 with padding when required; no whitespace or URL-safe alphabet. Outputs lowercase `{hex, length}`. |

String fields are plain strings. Converted fields retain `{raw: string, value: scalar | {hex, length}}`, including enum labels. A failed field is omitted from `fields` and has a field-specific error; other fields remain available. Optional groups that did not participate are errors rather than invented empty values.

The timestamp subset is `%Y` (four-digit year), `%m` (month), `%d` (day), `%H` (24-hour), `%M` (minute), `%S` (second), `%f` (1–6 fraction digits), `%z` (`Z`, `+HHMM`, `-HHMM`, `+HH:MM`, `-HH:MM`) and `%%` (literal percent). All other text is literal. Duplicate directives, unsupported directives and a trailing percent are invalid specs. Missing components default to `1970-01-01 00:00:00 UTC`; fractions are right-padded or truncated to milliseconds. Calendar rollover, invalid days, leap seconds and out-of-range times/offsets are field errors. No host timezone or locale is consulted.

## Registers and register maps

The root accepts optional `registers` and `registerMaps` dictionaries keyed by definition id, with at most 32 registers and 200 maps. A register is `{width: 8 | 16 | 32 | 64, fields: RegisterField[]}`, with at most 64 fields. Each field has `bits: [hi, lo]` (inclusive, high bit first) and `name`, plus optional `enum: Record<integer, label>`, finite `scale`, finite `offset`, `unit`, `signed` and `description`. Each enum has at most 64 entries, with labels at most 128 UTF-16 code units. Each extractor can attach register or register-map decoders to at most 8 captured fields. These limits are validated on draft save, publication and preview. Fields cannot overlap, exceed the register width or repeat a name. Validation identifies the exact definition, field index and property, such as `registers.REG0C.fields.2.bits` for overlap, `registers.REG0C.fields.2.bits.0` for an out-of-range high bit, or `registers.REG0C.fields.2.name` for a duplicate name.

An extractor's `int`, `uint` or `hex` field may declare exactly one of `decode: {register: "REG0C"}` and `decode: {registerMap: "charger"}`. A map is `{selectBy: "addr", cases: {"0x0C": "REG0C"}, default?: "fallbackRegister"}`. `selectBy` names another field of the same extractor; numeric case keys compare to its typed integer value, so address 12 matches `0x0C`. Equivalent numeric case keys are rejected as duplicates. Referenced fields and definitions must exist. An unmatched case without a default records `unmatched_register` on the event while preserving extracted values and continuing the run.

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

For `addr=0x0C val=0x20`, `val.value` is 32; `val.fields.CHRG_FAULT.value` is 2 with `meaning: "thermal_shutdown"`, while `WATCHDOG_FAULT` and `NTC_FAULT` are 0. Each child preserves its extracted bit value as `raw`. Signed fields use two's complement at the field's width before applying `value * scale + offset` (defaults 1 and 0); `unit` remains separate metadata. Enum labels are `meaning`, preserving the numeric value. Unscaled 64-bit values outside the safe integer range use decimal strings; scaling an unsafe integer records `register_precision` rather than losing precision. Values outside the register width record `register_range`.

Register work uses the existing line, event and elapsed-time budgets, with a checkpoint per bit field, at most 1024 total fields per event (`field_cap` on overflow), and frame/register construct nesting at most 8. The event contract permits 25 structural tree levels to accommodate TLV collection/item/payload wrappers and register leaves within those 8 construct levels. No executable expressions or scripts are admitted. The parsing engine module remains the shared interface for validation, line/group decoding and pattern generalization. Workspace forms and YAML code view write the same `ParsingSpec`; serializing to YAML and parsing back preserves register definitions and map references.

The paste-table dialog accepts at most 64 KiB UTF-8 and 512 input lines. Oversized input shows an error and cannot be imported. Preview distinguishes valid and rejected rows with text and icons, retains source line numbers and reasons, and shows the valid/rejected counts. The confirmation explicitly replaces all fields of the selected register with the valid rows; it does not append to the existing table.

## Parse tests

`skill/v1` accepts optional `parseTests` alongside `parsing` and `signalRules`. Tests are part of the draft's existing spec JSON and immutable published revision; no migration or test-result table is required. For the register configuration above, a test can be written as:

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

`id` is unique within the spec (1–100 characters); `name` is nonblank (at most 200 characters). `fileName` is optional (1–1024 characters), defaults to `sample.log`, and participates in extractor file-glob matching. Each `lines` item is one raw line, without CR or LF. The strict `expect` object accepts optional `fields`, `signals` and `exactSignals`.

`expect.fields` maps dot-separated field paths to JSON values. Paths start at the event's `fields`, so nested register expectations use `val.fields.CHRG_FAULT.meaning`. Paths contain identifier segments and cannot contain prototype-access keys. Expected objects match recursively as subsets; all expectations must match the same decoded event. With multiple events, any fully matching event passes; on failure, the event with the fewest differences supplies the diff. A scalar expectation unwraps a converted field's `value` and normalizes numeric strings, including hexadecimal, against numbers. Explicit `.raw` expectations compare the original representation. Arrays compare as complete values. Missing values are reported as `actual: null, missing: true` with their field path, distinguishing an absent field from a present null.

`expect.signals` lists expected rule ids, generic signal kinds or signal titles. Repeated hits and order do not matter. By default, extra signals are permitted; `exactSignals: true` also reports unexpected signals. Omitted field or signal expectations do not assert their absence; an empty signal list with exact mode asserts no signals.

| Bound | Limit |
| --- | --- |
| Tests per skill | 50, with unique ids |
| Input per test | 1–200 lines, at most 6144 UTF-16 code units per line |
| Input across a run | 5000 lines and 1,048,576 UTF-16 code units |
| Expectations per test | 200 field paths, each at most 1024 characters; 200 signals, each at most 200 characters; 65,536 serialized JSON code units; JSON nesting depth at most 12 |
| Signal-rule graph | 64 rules, 16 conditions per rule, 256 conditions in total; each text pattern at most 4096 UTF-16 code units and all patterns at most 65,536 units; only distinct `i`, `m`, `s` flags |
| Signal-rule values | 16 token names per comparison side, each at most 100 characters; rule ids at most 200 characters, prose at most 4096 characters, 32 suggested actions per list |
| Execution | 1000 ms for validation, decoding, signal extraction and comparison across all tests |
| Decoded output across a run | Existing engine caps: 50,000 events, 4 MiB serialized output and 32,768 fields, plus per-event and per-line caps |
| On-demand HTTP body | 8 MiB for parse-test POSTs, including repeated/trailing-slash route aliases; reject excess bytes with HTTP 413 during body collection, before JSON parsing |

Signal-rule limits live in the shared schema, so draft saves, publication and on-demand runs validate the same graph. Preflight checks reject oversized graphs before child validation or pattern compilation. Patterns still use the shared RE2 engine without a native-regex fallback. The on-demand endpoint validates under a hard 1000 ms deadline and passes only the remaining time to execution. Invalid input, including a validation timeout, returns HTTP 400 (`VALIDATION_FAILED`); it does not create a test run.

One server runner uses the worker's cooperative decoder and signal extractor, including its format-profile parsing and real signal rules. It returns `{total, passed, failed, results, truncated}`. Each result contains `id`, `name`, `passed`, `diffs: [{path, expected, actual, missing?}]`, `missingSignals`, `unexpectedSignals`, actual `events` and signal ids, and an optional execution error. After validation succeeds, an execution deadline, decoding error or exhausted output cap marks the affected test failed with `truncated: true` rather than rejecting the request or claiming complete success.

Draft save and publication return a fresh optional `parseTestRun`. `POST /api/v1/log-skills/:skillId/parse-tests` accepts `{spec}` to test current edits on demand under the same skill-administration permission and organization scope. Results are response data held only in the open workspace and matched to the tested spec, not persisted: recomputing bounded deterministic tests avoids storing a stale result or adding a migration. The Tests section uses field-path forms with a code-view fallback and an inline diff table; its toolbar owns Run tests and a compact passed/failed count, Not run or Running status. The publish dialog puts passed/total and a failure link at the top, followed by named per-test additions, changes and deletions with changed parts identified. Failed results never block publication.

## Byte-layout frames

`frames` maps definition ids to `{endian?: "big" | "little", fields: FrameField[]}`, with at most 32 frames and 64 fields per frame. Each switch/TLV map has at most 256 cases. Fields consume bytes in array order; offsets are computed rather than authored. The frame default is big-endian. A field's `endian` overrides its frame's default for integer, tag, length and checksum storage. An extractor attaches `decode: {frame: "packet"}` to a `hex`, `bytes`, `hexbytes` or `base64bytes` capture; frame hex input accepts optional `0x` and whitespace. Decoding preserves raw bytes and nests the decoded fields below the capture.

Every frame field has `name` and `type`, with the following options:

| Type | Options and behavior |
| --- | --- |
| `uint`, `int` | `length: 1 | 2 | 4 | 8`, optional `endian`, `scale`, `offset`, `unit`, `enum` and `register`. Signed integers use two's complement before scale/offset. Register references decode the unscaled integer into nested bit fields. |
| `bytes` | `length` is a fixed nonnegative byte count or an earlier integer field path. Keeps `{hex, length}` without interpreting its contents. |
| `register` | `register` id, `length: 1 | 2 | 4 | 8`, optional `endian`; reads an integer and applies the referenced register. |
| `frame` | `frame` id and optional fixed or field-driven `length`; applies the nested frame to that sub-slice. |
| `switch` | `on` is an earlier field path, `cases` maps values to `{frame: id}` or `{register: id}`, with optional `default`, `length` and `endian`. Numeric keys normalize exactly like register-map keys; `"0x01"` and `"1"` cannot coexist. A miss without a default is an event decode error. |
| `repeat` | `frame` id, `count` as a constant or earlier integer field path, optional positive integer `multiplier`. Repeats the sub-frame `count * multiplier` times. |
| `tlv` | `tagSize` and `lengthSize` are each `1 | 2 | 4`; optional `endian` and `length` bound the region. `cases` maps tags to frame/register references. Each length counts value bytes only; unknown tags retain their raw value bytes. |
| `checksum` | `algorithm`, covered `range: [start, endExclusive]`, stored `length: 1 | 2 | 4`, optional `endian`. Range offsets are relative to the containing frame. The covered bytes cannot include this field's own stored checksum bytes. |

Paths use dotted decoded field names, including nested register fields. Resolution first checks earlier fields in the containing frame, then already decoded extractor fields, such as `hdr.num_objects`. Field-driven lengths, counts and selectors must be available before the consuming field; forward references are rejected. Values used as lengths or counts must be nonnegative integers. Save, publication and preview share validation for duplicate names, unknown references, cycles, lengths, case-key collisions, forward references and checksum ranges, with exact paths such as `frames.packet.fields.2.count` or `frames.packet.fields.3.cases.0x01.frame`. Validation does not execute arbitrary expressions.

Checksum algorithms are fixed: `sum8` adds bytes modulo 256; `xor8` XORs bytes; `crc8` uses polynomial `0x07`; `crc16-ccitt` uses polynomial `0x1021` and initial value `0xFFFF`; `crc16-modbus` uses reflected polynomial `0x8005` and initial value `0xFFFF`; `crc32` is IEEE CRC-32. Checksum nodes retain `checksum: {expected, actual, ok}`, where expected is calculated from the covered bytes and actual is read from the stored field. A mismatch preserves both values and records an event decode error; the analysis run continues. For ASCII `123456789`, expected CRC values are `0xF4`, `0x29B1`, `0x4B37` and `0xCBF43926`, respectively. Covered ranges from different checksum fields must not overlap either; static offsets are checked during validation and dynamic offsets during decoding.

Frames and registers share a maximum nesting depth of 8. Each frame input is at most 4096 bytes. Every repeat is at most 256 elements after multiplication; frame fields, register fields, repeat elements and TLV items share an event-wide element cap of 1024. Each TLV field is at most 256 items. Bounds and malformed/truncated input produce precise event decode errors while retaining completed work: `frame_depth`, `frame_length`, `repeat_count`, `frame_elements`, `tlv_items` and `frame_range`. Switch misses use `unmatched_switch`; checksum mismatches use `checksum_mismatch`. Field iteration, repeated elements, TLV items and checksum work share the existing time budget and checkpoints. All frame nodes count toward the existing 1024-field event cap, 32 KiB event size, 32,768-field run cap and 4 MiB serialized run cap.

Decoded frame nodes add `byteOffset` and `byteLength` so the workspace can map fields to sample bytes. The hex view fits 16, 8 or 4 bytes per row to the available width, with a matching offset gutter. Field selection highlights its bytes, and byte selection selects the corresponding field; outlines and font weight supplement color without adding glyphs to byte cells. Field rows show decoded preview values and inline checksum status. Plain integer values include decimal and hexadecimal forms; values with units or enum meanings retain their existing display. A field after variable-length content shows a relative offset, such as `+2 after payload`. Forms and YAML code view round-trip the same frame definitions and references.

### USB-PD example

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

`hdr=0x2161 data=2C9101082CD10200` yields header message type 1 with meaning `Source_Capabilities` and count 2. The payload yields two fixed PDOs: 5000 mV / 3000 mA and 9000 mV / 3000 mA. The logged header is already an integer; when the header is part of wire bytes, a 2-byte little-endian register field reads `61 21` as `0x2161`.

Frame, register and register-map bindings share the limit of eight decoded captures per extractor.

## Multiline assembly

`multiline` is `{start, continue?, end?, keyField?, maxLines}` with `1 <= maxLines <= 200`. Control patterns match individual raw lines. With `keyField`, every supplied control pattern must capture that declared field, and groups are assembled independently by its exact raw key within a file. Interleaving keys does not mix their text. Without a key there is one open group. A matching start opens a group and flushes the previous group with the same key; a matching end is included and flushes it. Matching continuation lines are included. Without a continuation pattern, an unkeyed group includes subsequent lines until an end, next start, EOF or limit. EOF flushes remaining groups. The extractor pattern runs on the group's lines joined by `\n`.

At `maxLines` without an end, the bounded group is emitted with `max_lines`, even if the extractor does not match; no further lines are appended. An end on the last allowed line completes normally. Oversized lines are skipped and clear open assemblies, preventing a match across missing content. `line` anchors the first group line and `endLine` its last included line; interleaved lines inside that range are not necessarily part of the group. Results are deterministic in file/extractor traversal and group completion order, not globally sorted by line.

## Bounds and counters

| Bound | Behavior |
| --- | --- |
| Raw line: 8 KiB in UTF-8 | Skip the entire line, count `line_cap`; never truncate and create a false match. |
| Every parsing pattern: 512 UTF-16 code units; counted repetitions at most 100 | Reject before RE2 compilation, including multiline controls. Escaped/quoted braces and character classes remain literals. |
| Match input: 6144 UTF-16 code units per line; 16,384 per assembled group | Skip an overlong line, count `match_input_cap`, and clear open groups. An oversized assembly emits an error-only event, without extracting fields from a truncated prefix. |
| Events: 50,000 by default, across files/extractors | Worker override: `LOG_DECODE_MAX_EVENTS`. Retain the first events and count dropped matches as `event_cap`; open multiline groups also share a bounded admission limit. |
| Bytes field: 4 KiB decoded | Omit the field and record `byte_cap` on its event. |
| Serialized event: 32 KiB | Omit fields that do not fit and record `event_size` on the event; retain earlier fields and continue decoding. |
| Serialized JSONL: 4 MiB per run | Stop before admitting an event that exceeds the remaining output budget; keep completed events and record one `output_byte_cap`. The limit applies before gzip, including JSONL newlines. |
| Decoded fields: 32,768 per run | Count both root fields and nested children. Stop before admitting an event that exceeds the remaining field budget, retain completed events and record one `output_field_cap`. |
| Multiline: 200 lines maximum | Emit a bounded event with `max_lines`. |
| Worker elapsed decoding: 15,000 ms by default | `LOG_DECODE_MAX_MS` is clamped to 20,000 ms; signals and decoding share at most one quarter of the remaining job lease measured when signal extraction starts. The rest is reserved for compression, storage and analysis; no renewal. Check before every line, group flush and compilation. Stop decoding, keep completed events, discard unfinished groups, record one `time_cap`, and continue analysis. |
| Invalid conversion | Omit only that field and record `invalid_field`. |

Counts are `{total, byExtractor: Record<id, count>, errors: Record<code, count>, truncated?, reason?}`. When aggregate output is exhausted, both the result and persisted run counts carry `truncated: true` and `reason: "output_field_cap" | "output_byte_cap"`; `errors[reason]` is 1. Successful decoding keeps the existing counts shape without extra flags. Errors never fail the analysis run. `unmatchedLineCount` counts input lines not included in emitted events, once per file even when multiple extractors match. Preview accepts at most 1 MiB UTF-8, processes at most 5000 lines within a fixed 100 ms validation/decoding budget, and returns at most 500 events. It returns `truncated: true` and `reason: "time_cap" | "line_cap" | "event_cap" | "output_field_cap" | "output_byte_cap"` when bounded. Counts describe completed work; unprocessed lines remain unmatched. Worker environment settings cannot raise the preview or aggregate output budgets.

The engine is deterministic and performs no IO or database access. Its iterator retains multiline state and event order across per-line checkpoints. Worker and preview schedulers yield after about 8 ms or 2000 checkpoints, whichever comes first, including length validation and EOF flushing. Worker deadlines are cooperative and cannot interrupt a single bounded RE2 call. Preview also uses a hard VM timeout around constant internal validation/decoding callbacks; no administrator source is evaluated. Interruption restores the last completed event/counter checkpoint and discards the interrupted generator. This watchdog does not implement sandbox scripts. JSONL streams through gzip with backpressure; only compressed chunks are collected for the object-store Buffer.

Events remain in an ordered array for stable `query_events` cursor offsets and extractor/completion order. The evidence file/line index shares these same event objects without copying raw/typed fields. Flattening that index would change order when extractors revisit earlier lines, so both reference structures are retained. Defaults target the stock 384 MiB worker; parsed inputs and variable-sized fields still consume memory, and increasing limits requires reviewing memory and lease budgets. The optional `npx tsx scripts/log-decode-memory-probe.ts` exercises three 95 MiB-total files through the worker decode/compress/index functions and reports memory, elapsed time and event-loop drift; it is separate from tests, not an existing 100 MiB capacity result.

## Versioned event and run artifact

```json
{"v":1,"source":"declarative","extractor":"current","file":"kernel.log","line":412,"fields":{"current":{"raw":"0x10","value":16},"state":{"raw":"2","value":"thermal"}}}
```

Contract: `{v: 1, source: "declarative", extractor, file, line, endLine?, fields: Record<string, DecodedValue>, errors?: {field?, code, message}[]}`. `DecodedValue` is a JSON scalar, `{hex, length}`, or `{raw, value, meaning?, unit?, byteOffset?, byteLength?, checksum?: {expected, actual, ok}, fields?: Record<string, DecodedValue>}` around a scalar/byte value. Register and frame fields form a nested tree under the original value; large integers use decimal strings rather than lossy JSON numbers. `source: "script"` is reserved for future isolated sandbox parsing; it is not accepted or executed by this implementation.

The worker decodes analyzed files using the pinned immutable revision, writes one gzip JSONL object for the run, and stores its key and counters in `log_analysis_runs.decoded_events_object_key` and `decoded_event_counts` after parsing under the current job lease. Provider retries retain this metadata. Runs without extractors keep these columns null and write no decoding object. `log_evidence.decoded_fields` and DTO `decodedFields` contain the decoded events whose exact file/start-line anchors were cited. Keeping the event envelope prevents collisions between fields from different extractors or cited lines. Shared worker decoration covers loop, single-shot and rules-fallback reports.

Compression or artifact upload failure records `errors.artifact_error`, persists a null artifact key, and continues analysis without decoded events. Upload cleanup is best-effort using the content-addressed key shared by shipped local/S3 stores; cleanup failure does not fail analysis. Counts retain completed decoding work even when the artifact cannot be stored. The worker does not renew its lease; decoding reserves at least three quarters of the remaining lease for compression, storage and analysis.

An older pinned revision that exceeds the new pattern bounds records `errors.decode_error` with a null artifact key and continues without decoding. New saves/publications reject those patterns with validation paths.

`describe_event_schema()` and `query_events(...)` are available only when the pinned revision has extractors. Query results are the only decoding-tool shape accepted by grounding: their own `events[].file/line` anchors establish observed lines. End-line ranges and references embedded in fields or retrieved knowledge do not establish observation. See [API contract](api-contract.md) for preview and query details.

`query_events` returns at most 50 events and 16 KiB of serialized output, including the response envelope. Each field is at most 1 KiB; oversized values become marked string previews. An event with many fields can omit trailing fields to fit the output budget. `truncated: true` identifies shortened fields, pagination or incomplete run decoding; an aggregate output limit also exposes its reason to the agent even on the last query page. `nextCursor` resumes at the first unreturned stored event and cannot recover events excluded by the run budget. Filtering uses original typed values; query shortening does not mutate retained events or cited evidence. Earlier completed fields remain available to reports after output-budget exhaustion.
