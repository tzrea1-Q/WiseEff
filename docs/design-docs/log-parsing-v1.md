# Log parsing v1

> Chinese: [Chinese reference](../zh-CN/design-docs/log-parsing-v1.md)

`skill/v1` accepts optional `parsing`. The decoding core implements extraction and typed conversion only. Registers, register maps, frames, lookups, decoded-value signals and scripts are later additions. Unknown keys at the parsing, extractor, multiline and field levels are rejected on draft save and publication with issue paths.

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

The strict root is `{schemaVersion: "parsing/v1", extractors: Extractor[]}` (at most 200 extractors). Each extractor has a unique `id` (letter followed by up to 99 letters, digits, underscores or hyphens), `pattern`, `fields`, optional `files`, and optional `multiline`. All capture groups must be named and correspond exactly to declared fields. Use `(?:...)` for grouping without capture. Administrator patterns use `compileLogPattern` and RE2JS; lookaround and backreferences are rejected, with no native-regex fallback. Parsing patterns are at most 512 UTF-16 code units, with counted repetition bounds at most 100. Extraction uses unanchored search unless the author supplies anchors; dot matches newlines in assembled text. Each matching extractor produces at most one event per line or assembled group.

`files` is an optional list of at most 200 case-sensitive path globs, each at most 1024 characters. `*` matches within one path segment, `?` matches one non-slash character, and `**` matches across slashes; `**/` can match zero directories. Other characters are literal. Omission selects all analyzed files; an empty list selects none. Skipped files are never decoded. Paths and one-based line numbers refer to the original file inventory.

## Field types

| Type | Accepted input and output |
| --- | --- |
| `int`, `uint` | Decimal, `0x` hexadecimal or `0b` binary, case-insensitive prefixes, optional sign. Output must be a safe JSON integer; `uint` rejects negative values. |
| `float` | Finite decimal, fractional or exponent notation; rejects empty input, trailing text, NaN and infinity. |
| `bool` | Case-insensitive `true/false`, `1/0`, `yes/no`, `on/off`. |
| `string` | Captured text, unchanged. |
| `enum` | Required `values: Record<raw, label>`; exact raw-key lookup yields its string label. Unknown keys are field errors. |
| `timestamp` | Required `format`; converts to UTC ISO 8601 with milliseconds, as specified below. |
| `hexbytes` | Even number of hexadecimal digits, ignoring whitespace (including assembled newlines). Outputs lowercase `{hex, length}`. |
| `base64bytes` | Canonical standard Base64 with padding when required; no whitespace or URL-safe alphabet. Outputs lowercase `{hex, length}`. |

String fields are plain strings. Converted fields retain `{raw: string, value: scalar | {hex, length}}`, including enum labels. A failed field is omitted from `fields` and has a field-specific error; other fields remain available. Optional groups that did not participate are errors rather than invented empty values.

The timestamp subset is `%Y` (four-digit year), `%m` (month), `%d` (day), `%H` (24-hour), `%M` (minute), `%S` (second), `%f` (1–6 fraction digits), `%z` (`Z`, `+HHMM`, `-HHMM`, `+HH:MM`, `-HH:MM`) and `%%` (literal percent). All other text is literal. Duplicate directives, unsupported directives and a trailing percent are invalid specs. Missing components default to `1970-01-01 00:00:00 UTC`; fractions are right-padded or truncated to milliseconds. Calendar rollover, invalid days, leap seconds and out-of-range times/offsets are field errors. No host timezone or locale is consulted.

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
| Multiline: 200 lines maximum | Emit a bounded event with `max_lines`. |
| Worker elapsed decoding: 15,000 ms by default | `LOG_DECODE_MAX_MS` is clamped to 20,000 ms; worker decoding uses at most one quarter of its remaining job lease. Check before every line, group flush and compilation. Stop decoding, keep completed events, discard unfinished groups, record one `time_cap`, and continue analysis. |
| Invalid conversion | Omit only that field and record `invalid_field`. |

Counts are `{total, byExtractor: Record<id, count>, errors: Record<code, count>}`. Errors never fail the analysis run. `unmatchedLineCount` counts input lines not included in emitted events, once per file even when multiple extractors match. Preview accepts at most 1 MiB UTF-8, processes at most 5000 lines within a fixed 100 ms validation/decoding budget, and returns at most 500 events. It returns `truncated: true` and `reason: "time_cap" | "line_cap" | "event_cap"` when bounded. Counts describe completed work; unprocessed lines remain unmatched. Worker environment settings cannot raise the preview budget.

The engine is deterministic and performs no IO or database access. Its iterator retains multiline state and event order across per-line checkpoints. Worker and preview schedulers yield after about 8 ms or 2000 checkpoints, whichever comes first, including length validation and EOF flushing. Worker deadlines are cooperative and cannot interrupt a single bounded RE2 call. Preview also uses a hard VM timeout around constant internal validation/decoding callbacks; no administrator source is evaluated. Interruption restores the last completed event/counter checkpoint and discards the interrupted generator. This watchdog does not implement sandbox scripts. JSONL streams through gzip with backpressure; only compressed chunks are collected for the object-store Buffer.

Events remain in an ordered array for stable `query_events` cursor offsets and extractor/completion order. The evidence file/line index shares these same event objects without copying raw/typed fields. Flattening that index would change order when extractors revisit earlier lines, so both reference structures are retained. Defaults target the stock 384 MiB worker; parsed inputs and variable-sized fields still consume memory, and increasing limits requires reviewing memory and lease budgets. The optional `npx tsx scripts/log-decode-memory-probe.ts` exercises three 95 MiB-total files through the worker decode/compress/index functions and reports memory, elapsed time and event-loop drift; it is separate from tests, not an existing 100 MiB capacity result.

## Versioned event and run artifact

```json
{"v":1,"source":"declarative","extractor":"current","file":"kernel.log","line":412,"fields":{"current":{"raw":"0x10","value":16},"state":{"raw":"2","value":"thermal"}}}
```

Contract: `{v: 1, source: "declarative", extractor, file, line, endLine?, fields: Record<string, DecodedValue>, errors?: {field?, code, message}[]}`. `DecodedValue` is a JSON scalar, `{hex, length}`, or `{raw, value}` around either. `source: "script"` is reserved for future isolated sandbox parsing; it is not accepted or executed by this implementation.

The worker decodes analyzed files using the pinned immutable revision, writes one gzip JSONL object for the run, and stores its key and counters in `log_analysis_runs.decoded_events_object_key` and `decoded_event_counts` after parsing under the current job lease. Provider retries retain this metadata. Runs without extractors keep these columns null and write no decoding object. `log_evidence.decoded_fields` and DTO `decodedFields` contain the decoded events whose exact file/start-line anchors were cited. Keeping the event envelope prevents collisions between fields from different extractors or cited lines. Shared worker decoration covers loop, single-shot and rules-fallback reports.

Compression or artifact upload failure records `errors.artifact_error`, persists a null artifact key, and continues analysis without decoded events. Upload cleanup is best-effort using the content-addressed key shared by shipped local/S3 stores; cleanup failure does not fail analysis. Counts retain completed decoding work even when the artifact cannot be stored. The worker does not renew its lease; decoding reserves at least three quarters of the remaining lease for compression, storage and analysis.

An older pinned revision that exceeds the new pattern bounds records `errors.decode_error` with a null artifact key and continues without decoding. New saves/publications reject those patterns with validation paths.

`describe_event_schema()` and `query_events(...)` are available only when the pinned revision has extractors. Query results are the only decoding-tool shape accepted by grounding: their own `events[].file/line` anchors establish observed lines. End-line ranges and references embedded in fields or retrieved knowledge do not establish observation. See [API contract](api-contract.md) for preview and query details.

`query_events` returns at most 50 events and 16 KiB of serialized output, including the response envelope. Each field is at most 1 KiB; oversized values become marked string previews. An event with many fields can omit trailing fields to fit the output budget. `truncated: true` identifies shortened fields or pagination, and `nextCursor` resumes at the first unreturned event. Filtering uses original typed values; stored events and evidence retain complete fields.
