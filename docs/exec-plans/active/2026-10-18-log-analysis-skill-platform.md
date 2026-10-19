# Log analysis skill platform

> Status: **Proposed — design only, implementation not started**
> Date: 2026-10-18
> Planning branch: `docs/log-analysis-skills-design` (this plan, ADR-0047, glossary)
> Implementation branches: one per phase, each from the latest `main` (`feat/log-skills-s1-revisions`, `feat/log-skills-s2-bundles`, `feat/log-skills-s3-decoding`, `feat/log-skills-s4-source`, `feat/log-skills-s5-testing-integration`)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-10-18-log-analysis-skill-platform.md`](../../zh-CN/exec-plans/active/2026-10-18-log-analysis-skill-platform.md)
> Decision record: [ADR-0047](../../adr/0047-log-analysis-is-a-skill-platform-over-a-shared-agent-kernel.md); kernel stack unchanged from [ADR-0022](../../adr/0022-log-analysis-agent-runs-outside-the-xiaoze-stack.md)
> Predecessor: [Agent log analysis system](2026-08-12-agent-log-analysis-system.md) (P1–P3b shipped; its external-input items remain open there)

## Goal

Turn the shipped log analysis system into a general platform. Administrators build an **analysis skill** per business module: a diagnostic procedure, declarative parsing and decoding of structured log content, signal rules, Markdown knowledge from the knowledge base, the module's source code, and test cases. WiseEff provides the common infrastructure: log bundle intake and unpacking, file management, generic signal extraction, and one bounded agent workflow that runs any skill. Integrators onboard a new scenario by publishing a skill, not by changing WiseEff code.

## Context

What the current code gives us and where it stops is recorded in ADR-0047 (Context). In short: the job pipeline, read-only bounded agent, grounding, honest degradation, organization scoping and the two eval layers are kept; domain-specific rules in code, unversioned live domain configuration, a fixed toolset, single-file intake, opaque structured payloads and developer-only quality checks are what this plan replaces.

### Settled decisions (product owner, 2026-10-18)

- **Parsing**: declarative first. It must support extracting data from lines of a known format and decoding it by configured rules such as protocol fields and register definitions. Scripts restricted to log parsing are supported in a later phase.
- **Data flow**: source code and log excerpts may be sent to the configured backend LLM API (`LOG_ANALYSIS_*`).
- **Reference module**: proceed with the general design without a second business module. The product owner validates it in a real scenario by following the integration guide once the initial implementation lands.
- **Kernel**: ADR-0022 holds — plain bounded loop, no LangGraph, no ToolRegistry, no write path.
- **UX**: decided by the implementing agent using established patterns, recorded in the PR (standing delegation).

## Non-goals

- Executing administrator code before S6, or any skill gaining device, parameter or database write access.
- Interactive follow-up conversations about a report (would need a new ADR per ADR-0022).
- Binary log formats that are not line-oriented text (for example raw ring-buffer dumps). Hex or base64 payloads inside text lines are in scope.
- An external search service for source or logs.
- Cross-organization skill marketplaces. Export/import between organizations is in scope; shared publication is not.

## Architecture

### Skill and revision

```
analysis skill (org-scoped identity; the existing log_domains row)
 └─ skill revision (draft → published → superseded; immutable once published)
     ├─ procedure.md          diagnostic procedure, inserted into the agent prompt
     ├─ applicability         file globs + signature patterns (routing, file roles)
     ├─ parsing spec          format profile + extractors + decoders (versioned schema)
     ├─ signal rules          conditions over lines, fields and decoded values
     ├─ knowledge links       knowledge-base entries (live published revision)
     ├─ source snapshot ref   optional default snapshot + version-label matching
     ├─ budgets/model         max steps, token budget (≤ platform caps), model name
     └─ test cases            parse tests (deterministic) + analysis cases (real model)
```

- Runs pin `skill_revision_id`; the worker loads the pinned revision only.
- Runs record the knowledge revisions and source snapshot actually used.
- Without a skill, a run uses the platform's generic signals and tools only (the evolved uncategorized log domain).

### Parsing and decoding (answers "can this be done": yes)

A line with a known format is matched by an extractor; captured fields are typed; typed values are decoded with a closed set of constructs. The schema below is **illustrative**; S3 fixes the final `parsing/v1` schema.

```yaml
# Lines this example decodes:
#   2026-10-12 08:14:03.112 [chg] reg_dump addr=0x0C val=0x20
#   2026-10-12 08:14:03.140 [pd] rx hdr=0x2161 data=2C9101082CD10200
#     → msg_type Source_Capabilities, 2 fixed PDOs: 5000 mV / 3000 mA, 9000 mV / 3000 mA
extractors:
  - id: reg_dump
    files: ["kernel*.log", "dmesg*"]
    pattern: '\[chg\] reg_dump addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)'
    fields:
      addr: { type: uint }
      val:  { type: uint, decode: { registerMap: bq25890, keyField: addr } }
  - id: pd_rx
    pattern: '\[pd\] rx hdr=(?P<hdr>0x[0-9A-Fa-f]{4}) data=(?P<data>[0-9A-Fa-f]*)'
    fields:
      hdr:  { type: uint, decode: { register: pd_header } }
      data: { type: hexbytes, decode: { frame: pd_data_objects } }

registers:
  pd_header:
    width: 16
    fields:
      - { name: msg_type,    bits: "4:0",   enum: { 1: Source_Capabilities, 2: Request } }
      - { name: num_objects, bits: "14:12" }
  fixed_pdo:
    width: 32
    fields:
      - { name: supply_type,    bits: "31:30", enum: { 0: fixed, 1: battery, 2: variable, 3: apdo } }
      - { name: voltage_mV,     bits: "19:10", scale: 50 }
      - { name: max_current_mA, bits: "9:0",   scale: 10 }

registerMaps:
  bq25890:                       # register definitions keyed by address
    0x0C:
      width: 8
      fields:
        - { name: WATCHDOG_FAULT, bits: "7" }
        - { name: CHRG_FAULT,     bits: "5:4", enum: { 0: normal, 1: input_fault, 2: thermal_shutdown, 3: safety_timer } }
        - { name: NTC_FAULT,      bits: "2:0" }

frames:
  pd_data_objects:
    endian: little
    repeat: { count: "$hdr.num_objects", item: { register: fixed_pdo } }

signals:
  - id: charger-thermal-shutdown
    when: { extractor: reg_dump, field: "val.CHRG_FAULT", equals: thermal_shutdown }
    severity: error
    label: Charger reported thermal shutdown
```

The decoded event for the first line:

```json
{ "file": "kernel.log", "line": 412, "extractor": "reg_dump",
  "fields": { "addr": 12,
              "val": { "raw": 32, "WATCHDOG_FAULT": 0, "CHRG_FAULT": "thermal_shutdown", "NTC_FAULT": 0 } },
  "signals": ["charger-thermal-shutdown"] }
```

Construct set for `parsing/v1`:

| Construct | Purpose |
| --- | --- |
| Extractor | File globs + named-group pattern (linear-time engine) + optional multi-line assembly (start/continue/end patterns, grouped by a key field, capped length) |
| Types | `int`/`uint` (dec, `0x`, `0b`), `float`, `bool`, `string`, `enum`, `timestamp` (format string), `hexbytes`, `base64bytes` |
| Register | Fixed width; bit-fields by range; per-field `enum`, `scale`, `offset`, `unit`, `signed` |
| Register map | Register definitions selected by another field's value (address, message id) |
| Frame | Byte layout: ordered fields by type/length, endianness, nested register/frame, `switch` on a decoded field, `repeat` with count from a decoded field, TLV with configured tag/length widths, optional checksum from a fixed set (sum8, xor8, crc8, crc16-ccitt, crc16-modbus, crc32) |
| Lookup table | Code → meaning (error codes, states); may also be authored in knowledge |
| Signal rule | Condition over message regex, field equality/range/set, decoded value, or count-in-window; emits a named signal with severity |

Bounded execution: decode depth ≤ 8, frame ≤ 4 KiB, repeat ≤ 256, line length cap, per-run event and time caps; exceeding a cap records a decode error on that event rather than failing the run.

Beyond `parsing/v1` (S6 scripts): stateful reassembly beyond keyed multi-line assembly, compressed or encrypted payloads, vendor-specific checksums, and computed fields that need arithmetic across events.

### Agent workflow

The ADR-0022 loop, with per-run tool composition:

| Tool | Available when | Phase |
| --- | --- | --- |
| `list_files`, `search_lines`, `read_line_range` (file-aware) | always | S2 (today's single-file versions until then) |
| `get_signals` (generic + skill signals; legacy `get_prefilter_findings` remains supported) | always | S1 (skill signals), S2 (generic signals) |
| `get_line_templates`, `get_timeline` | always | S2 |
| `query_events`, `describe_event_schema` | revision has extractors | S3 |
| `read_domain_knowledge` | always (linked set, else organization-wide) | existing |
| `find_log_statement`, `search_source`, `read_source_range` | revision has an indexed source snapshot | S4 |
| `get_related_parameter_context` | run has a related-parameter pin | existing |

Prompt order: platform protocol → skill procedure (delimited, lower precedence) → mission (question, file inventory, signals, budgets). Evidence kinds: log line (`file`, `line`) and source location (`snapshot`, `path`, `line`); both grounded against tool results. Platform caps: steps ≤ 20, token budget ≤ the global `LOG_ANALYSIS_TOKEN_BUDGET` × 4 (exact caps set in S1 with cost measurements).

The diagnostic-procedure slice (#1227) reads optional `skill/v1.procedure` (maximum 20,000 characters) from the run's pinned revision. It appends a lower-priority, untrusted section to the system protocol, before the user mission. The procedure is JSON-quoted with delimiter characters and line separators escaped; forged closing tags and protocol headings stay inside that data value. It cannot override grounding, tool-result evidence, refusal rules or the prohibition on writes. Rule fallback ignores it; an absent procedure omits that section while platform signal tools remain available. Current loop versions are `2026-10-19.loop.procedure.signals.1` / `2026-10-19.loop.procedure.signals.related-parameter.1`; single-shot versions are `2026-10-19.procedure.signals.1` / `2026-10-19.procedure.signals.related-parameter.1`. Reports record the selected version. Behavioral eval covers benign and adversarial procedures; a PostgreSQL upload-to-report test captures scripted-model prompts across draft edits, publication and revision-pinned reruns.

### Data model (additive; final names fixed per phase)

| Table | Phase | Content |
| --- | --- | --- |
| `log_skill_revisions` | S1 | revision number, status, procedure, applicability, parsing spec, signal rules, budgets, model name, knowledge entry ids, source snapshot ref, content hash, author, publish time |
| `log_analysis_runs.skill_revision_id` | S1 | pin |
| `log_files` | S2 | per record: path, size, sha256, encoding, line count, role, object keys (text + line-offset index) |
| `log_evidence.file_path`, `source_ref` | S2 / S4 | additive evidence location |
| `log_skill_revisions.spec.parseTests` | S3 | parse-test inputs and expectations versioned with the rules; latest results are returned to the workspace, without a new table |
| `log_skill_test_cases`, `log_skill_test_runs` | S5 | analysis cases and results per revision |
| `log_source_snapshots`, `log_source_files`, `log_source_chunks`, `log_source_statements` | S4 | snapshot metadata, files, FTS/trigram chunks, log-statement index |

| `log_analysis_traces` | S1 | per run: ordered steps with tool name, argument summary, result size and lines returned, step outcome, token use; never raw prompts or provider payloads |
| `log_integration_credentials` | S5 | hashed secret, label, scope (organization, optional skill), created/last used/revoked, creator |

All new tables carry `organization_id` with composite foreign keys to their parent's `(id, organization_id)` (the `0107` pattern). Skill publish, source snapshot upload/archive, test-case changes and credential issue/revoke are audited writes (ADR-0027).

## Frontend experience

UX is decided here under the standing delegation and follows `docs/design-docs/ui-design-system.md` (tokens, one accent, five interaction states, `ModalDialog`, `AdminListPage`, Chinese-first copy, empty states with one next action). Three roles use the platform:

| Role | Goal | Where |
| --- | --- | --- |
| Skill author (administrator) | Turn a module's know-how into a published skill | `/log-admin` skills list → skill workspace |
| Analysis user (engineer) | Upload logs, get a trustworthy answer, drill into evidence | `/logs` |
| Integration owner (external system owner) | Push logs from their system and receive results | skill workspace → `集成` |

### Interaction principles

1. **Zero configuration works.** Uploading without a skill always analyzes with generic signals; skills improve results and never gate an upload.
2. **Sample first.** An author starts by attaching a sample log. Parsing, decoding and signal screens preview against it live: matched lines are highlighted, coverage is counted, decoded values are shown.
3. **Forms first, code optional.** Every rule has a visual form. A `代码视图` toggle shows the same draft as YAML for bulk edits and copy/paste; both views edit one draft and validate the same way.
4. **Draft, check, publish.** A sticky draft bar shows `未发布更改` · `运行测试` · `发布`. Publishing shows the change summary and test results and never blocks; rollback publishes an older revision as a new one.
5. **Every claim is one click from its proof.** Evidence opens the log viewer at the cited line, with decoded fields and the source location beside it.
6. **Integration is self-service.** Everything an integrator needs (key, endpoint, credential, copyable request, webhook, delivery log) is on one tab.

### Information architecture

- **`/log-admin?tab=skills`** (replaces `tab=domains`): `AdminListPage` with columns `名称` · `适用文件` · `当前版本` · `草稿` · `近 7 天分析` · `有用率` · `集成状态`. Header actions: `导入技能包` (secondary), `新建技能` (primary). Empty state: `新建第一个分析技能`.
- **`新建技能` dialog** (`md`): name, starting point (`通用文本日志` / `Linux 内核 dmesg` / Android logcat / JSON Lines / `复制已有技能`), optional sample log. Templates prefill the procedure outline, base format and common signals.
- **Skill workspace `/log-admin/skills/:skillId`**: navigator-workbench layout with a left section list, the editing area, and (on `样例与解析` / `解码` / `信号`) a right sample pane that keeps its scroll position across sections. Sections: `概览` · `诊断流程` · `样例与解析` · `解码` · `信号` · `知识` · `源码` · `测试` · `集成` · `版本`.
- **`/logs`**: upload dialog, record list, and the report view with tabs `结论` · `文件` · `信号` · `分析轨迹` (`轨迹` for skill administrators only).

### Key interactions

| Capability | Interaction |
| --- | --- |
| Procedure | Markdown editor prefilled with an outline (`适用场景` / `先检查什么` / `根因判定` / `常见误判` / `建议动作`) and a preview toggle. `试运行` runs the draft on the sample with the real model and opens the analysis trace drawer: each step's tool, what it read, and the final evidence. |
| Base format | Form replacing today's format-profile JSON: timestamp format (picked from the sample with a detected default), severity mapping, multi-line rule, each with a live sample preview. |
| Extractors | Click a sample line → `从此行创建抽取规则`. The line splits into tokens; the author selects spans and names them, choosing a type. The pattern is generalized automatically (digits, hex, quoted strings), shows its match count and coverage, and can be edited directly under `高级`. Each extractor gets a highlight colour in the sample pane. |
| Registers | Bit bar (MSB→LSB boxes coloured per field) above a field table (`位段` · `名称` · `类型` · `枚举/比例/单位`). `粘贴寄存器表` imports bit, name and description columns copied from a datasheet table. Register maps list addresses on the left. Selecting a sample line shows the decoded value on the bit bar. |
| Frames | Ordered field rows with byte offsets computed automatically, plus a hex view of the sample bytes highlighting the selected field; `switch`, repeat and TLV are row types, not free text. |
| Signals | Sentence builder: `当 [抽取规则] 的 [字段] [等于 / 在范围 / 属于 / 匹配] [值]，产生信号 [名称]，级别 [错误]`. Hits in the sample are listed; clicking one jumps to the line. |
| Knowledge | Linked-entry list with `链接已有条目` (picker over published entries) and `上传 Markdown` (multi-file drop; creates knowledge entries linked to the skill). Without knowledge-edit permission the upload shows a disabled reason. |
| Source | Snapshot table (`版本标签` · `文件数` · `索引状态` with progress · `跳过文件` · `上传时间`), `上传源码` dialog (archive + label), `设为默认`. `试一试`: paste a log line and see the source statement that printed it. |
| Tests | Parse tests list Pass / Fail / Not run. Add test uses the selected sample line and current decoded fields; expectations are edited in a field-path table with a code-view fallback. Failures show Field path / Expected / Actual and missing/unexpected signals. The sample inspector follows the section registry's visibility rule. Analysis cases (S5) use a bundle plus expected root cause, evidence and actions, with latest score vs previous revision; cases can also be created from a report. |
| Integration | skillKey and endpoint with copy buttons; a ready-to-run `curl` prefilled with the skillKey; integration credentials (create shows the secret once, then rotate/revoke, last used); result webhook and test delivery (moved from the domain row); delivery records; link to the integration guide. |
| Versions | Revision list; side-by-side diff grouped by section (procedure text, rules added/changed/removed); `回滚` publishes an older revision as a new one. |
| Publish dialog (`lg`) | Change summary; parse tests passed/total with a link to failures; analysis-case scores vs the previous revision; warnings (for example an extractor with zero sample matches); Publish remains available when tests fail. |
| Upload (`/logs`) | Drop files or one archive; optional question and related parameter; skill selector preselected by suggestion with its reason (`推荐：充电电源 · 匹配 kernel.log`); one primary action `开始分析`. |
| Report (`/logs`) | Conclusion card with provenance badges (`技能与版本` · `模型` · `降级`); evidence items show `file:line`, the inference, decoded-field chips and an expandable source excerpt; clicking opens the log viewer drawer at the line with context. `文件` tab: tree with size, lines, role and skipped reasons. Feedback stays; skill administrators also see `存为测试用例`. |

Mock mode keeps a read-only seeded skill so demos and component tests still render; authoring is API-mode only.

### UI by phase

| Phase | Frontend scope |
| --- | --- |
| S1 | Skills list and `新建技能` with templates; workspace shell with draft bar; `概览`, `诊断流程` (with `试运行` and trace drawer), sample upload, `信号` (message and token conditions), `知识`, `集成` (webhook and model moved here), `版本` and publish dialog; skill selector and provenance badge on `/logs` |
| S2 | Multi-file drop zone; `文件` tab; log viewer drawer; `file:line` evidence; applicability globs previewed against the sample bundle |
| S3 | `样例与解析` (base format form, extractor builder), `解码` (register, register map and frame editors, `粘贴寄存器表`), `代码视图`, parse tests; decoded-field chips in evidence |
| S4 | `源码` section with `试一试`; source excerpts in evidence |
| S5 | `分析用例` and `存为测试用例`; upload suggestion; package import/export; integration credentials and `curl` snippet; quality insights by revision |

### UX acceptance

Each phase PR walks its rows above in a real browser at 1440x900 and shows the screenshots in the PR. Builder logic (pattern generalization, decoding, offset computation, form ↔ code round trip) lives in the parsing engine and is tested at its module interface; the browser walkthrough covers the rest, with no separate frontend view-model seam. S5 adds two scripted end-to-end walkthroughs as the design targets: (1) from `新建技能` with a template to a published skill with one extractor, one register decoder and one signal using only forms; (2) from the `集成` tab to a first successful push and webhook delivery using only the copied snippet and a new credential.

## Phase S1 — skill revisions, procedures and data-driven signals

1. Migration: `log_skill_revisions`; backfill revision 1 (published) for every log domain from its current configuration; `log_analysis_runs.skill_revision_id` set for new runs.
2. Service and API: `/api/v1/log-skills` (list, get, create, update draft, publish, list revisions, diff two revisions). `/api/v1/log-domains` and `logDomainId` stay as aliases.
3. Worker loads the pinned revision; prompt gains the procedure section; new prompt version.
4. Signal rule engine (message regex, token/field conditions, count-in-window). Rule ids become open strings. The charging rules become a seed skill (demo seed and eval fixtures); the rules fallback evaluates the pinned revision's signals.
5. Linear-time regex engine for all administrator patterns, including existing format profiles. Choose between a native RE2 binding and a WASM build by self-hosted image compatibility; record the choice in the PR.
6. Analysis trace: the loop records each step (tool, argument summary, result size, lines returned, outcome, tokens) in `log_analysis_traces`; readable by skill administrators only. `试运行` runs a draft revision on the skill's sample without creating a user-visible record.
7. Frontend: the S1 row of [UI by phase](#ui-by-phase).

**S1 acceptance**: a published revision's procedure demonstrably reaches the prompt (behavior eval asserts it); editing a draft never changes a run pinned to the published revision; a rerun of an old record reproduces with the pinned revision; the charging seed skill gives the same rule evidence as today's hard-coded prefilter on the existing eval cases; cross-organization reads/writes of skills and revisions are refused (PostgreSQL integration tests).

## Phase S2 — log bundles, file management and generic signals

1. Intake: `.tar`, `.tar.gz`/`.tgz`, multi-entry `.zip`, `.gz`; nested archives one level deep; reject path traversal, absolute paths, links and device entries; caps (initial, env-tunable): compressed upload 100 MB, unpacked 512 MB, 2,000 files, 200 MB per file, existing 200× ratio rule.
2. Encoding: UTF-8, UTF-16 with BOM, and lossy decode with a per-file flag; binary files are listed but not analyzed.
3. `log_files` with per-file text object and line-offset index; the worker streams files and reads ranges by offset instead of holding all text in memory.
4. Generic signals: crash signatures (kernel panic, Oops, `BUG:`, watchdog, ANR, `FATAL EXCEPTION`, segfault, assert), timestamp gaps and reboots, line-template clustering with counts and first/last occurrence, error bursts, first error per file.
5. File-aware tools plus `get_line_templates`, `get_timeline`; evidence gains `file_path`.
6. Frontend: the S2 row of [UI by phase](#ui-by-phase); applicability globs assign file roles.

**S2 acceptance**: a multi-file bundle produces evidence citing lines in more than one file; malicious archives (traversal, link, bomb, nesting) are rejected with stated reasons; a bundle at the cap analyzes within the worker memory limit measured in the PR; single-file uploads behave as before.

## Phase S3 — structured extraction and decoding

Issue #1237 delivers the extraction core and code view; the sample-line extractor builder and form editing follow in #1240.

1. `parsing/v1` schema (zod) with path-precise validation errors; decoder engine as pure, bounded functions.
2. Parse stage runs extractors and decoders, applies signal rules over decoded values, and stores decoded events as a per-run artifact (object store, line-anchored) plus per-extractor counts and signal hits in the database; reports persist cited events only.
3. Tools `query_events` (extractor, field filters, line/time range, limit) and `describe_event_schema`; an event in a tool result counts as seeing its line for grounding.
4. Parse tests (#1242): optional `skill/v1.parseTests` stores sample lines, optional filename and expected field paths/signals alongside the rules, so publication versions them. Expected fields match a subset of a decoded event, including nested register fields; converted fields compare `value` unless `raw` is explicitly requested. Signal ids or names compare as a set, with optional exact matching. One server runner uses the real parsing engine and per-line signal rules, applies input/output caps and a deadline, and returns per-test results with path/expected/actual differences. It runs after each draft save, on demand from Run tests, and before publication. Results stay only in the open workspace and are recomputed rather than persisted, avoiding a migration and stale-result storage. The publish dialog shows passed/total and a failure link without blocking publication. See the [parse-test contract](../../design-docs/log-parsing-v1.md#parse-tests).
5. Frontend: the S3 row of [UI by phase](#ui-by-phase). Forms and `代码视图` share one validator, so a draft round-trips between them without loss.
6. A preview endpoint decodes pasted or selected sample lines against an unsaved draft for the live panes.

**S3 acceptance**: the illustrative register-map and PD-frame examples decode exactly as specified; every construct has unit tests including cap violations; an agent conclusion cites a decoded field and the report renders it; parse tests block nothing but are shown in the publish dialog.

## Phase S4 — source snapshots

Implementation slice #1243 adds archive upload and audited archival, streaming asynchronous file/chunk indexing, FTS/trigram indexes, configurable limits (1 GiB unpacked, 2 MiB per file, 20,000 files, 100 MiB compressed), bounded skip details, the workspace source table/dialog and draft-only default selection. The optional `defaultSourceSnapshotId` is published with a revision; a run resolves that pinned revision and records the observed snapshot id/status. A non-ready or archived snapshot leaves analysis operational with an explicit Chinese unavailable note. Source statement indexing/evidence (#1244), source search/range tools and upload `sourceVersion` matching (#1245) remain future S4 work; the full S4 acceptance below is not satisfied by #1243 alone. No source snippets are sent to the provider in #1243. Operational details and the standalone 1 GiB RSS probe are in the [runbook](../../runbooks/log-analysis-llm.md#source-snapshots-1243).

1. Upload a source archive with a version label to a skill; object store; asynchronous indexing (mirrors the knowledge indexing worker); text-file allowlist by extension, per-file and total caps (initial: 1 GB unpacked, 2 MB per file), vendored/binary paths skipped and listed.
2. Indexes: files; chunked FTS + trigram search; log-statement index extracted with emitter patterns (defaults for C/C++ `printk`/`pr_*`/`dev_*`, Android `ALOG*`/`Log.*`, `LOG(...)`, Python `logging`, Go `log`/`slog`; skills may add patterns). Format strings are normalized into matchable skeletons.
3. Snapshot selection: upload `sourceVersion` label → matching snapshot, else the revision's default; runs record the snapshot used.
4. Tools `find_log_statement`, `search_source` (path glob, query), `read_source_range` (≤ 80 lines); source-location evidence kind, grounded.
5. Frontend: the S4 row of [UI by phase](#ui-by-phase).
6. `docs/SECURITY.md`: source and log excerpts sent to the configured provider.

**S4 acceptance**: for a log line emitted by an indexed statement, `find_log_statement` returns its file and line; a conclusion can cite a source location that renders; a run whose snapshot is still indexing completes without source tools and says so; source rows are organization-isolated (PostgreSQL integration tests).

## Phase S5 — skill testing, routing, packaging and integration

1. Analysis test cases in the product (bundle + expected root cause, key evidence, actions, optional refusal); run on demand against a draft with the real model; score with the existing quality scoring; compare with the previous published revision; results in the publish dialog. Import/export in the `eval-cases/logs` format.
2. Routing: without a named skill, score published skills by applicability globs and signature patterns; pick the best above a threshold and record why; otherwise generic.
3. Skill package import/export (zip): `SKILL.md` (frontmatter + procedure), `parsing.yaml`, `signals.yaml`, `knowledge/*.md` (import creates draft knowledge entries and links them), `cases/`. Source snapshots are uploaded separately.
4. Rewrite the [integration guide](../../api/log-analysis-integration.md): build a skill, test it, package it, push bundles with `skillKey`, consume webhooks. Update the user guide.
5. Feedback insights grouped by skill revision.
6. Integration credentials: organization-scoped machine credentials limited to uploading logs and reading the records they created (optionally one skill); secret shown once and stored hashed; rotate, revoke, last-used; issue and revoke are audited. This is a new principal kind, so record it as an ADR (extending ADR-0038) before implementation.
7. Suggestion endpoint used by the upload dialog: file names plus the first lines of each file → ranked skills with reasons.
8. Frontend: the S5 row of [UI by phase](#ui-by-phase).

**S5 acceptance**: a skill package exported from one organization imports into another and analyzes the same case with the same rule evidence; routing selects the matching seed skill for its sample bundle and the generic path for an unrelated one; the product owner can follow the integration guide end to end without repository access; both S5 walkthroughs in [UX acceptance](#ux-acceptance) pass; a revoked credential is refused and cannot read another credential's records.

## Phase S6 — sandboxed parse scripts (later)

Requires its own ADR first (QuickJS/WASM in an isolated worker vs a separate no-network container). Contract: input is file text or a line window; output is decoded events in the S3 format; no network, filesystem, database or secrets; CPU, memory, wall-clock and output-size caps; output treated as untrusted data; scripts are part of the skill revision and covered by parse tests.

## Security and privacy

- Organization isolation at the repository layer and in composite foreign keys for every new table; permission `logs:admin-domains` governs skill and snapshot administration (label becomes `管理分析技能`); `logs:view` can list snapshot metadata, including progress and skipped-path reasons, but has no source-file/content browsing route in #1243.
- Procedure text, knowledge, decoded values and source are untrusted model input; the platform protocol is never overridable by a skill.
- Administrator patterns run on a linear-time engine with caps; archives are validated before anything persists.
- Integration credentials carry only upload and own-record read scope, are hashed at rest, and never grant administration.
- Source and log excerpts flow to the configured provider by product-owner decision; reports keep model, prompt version, skill revision and snapshot provenance, never raw prompts.

## Verification

Per phase, following `docs/developer/verification-matrix.md`: `npm run test:impact -- --base main` selection; changed-seam unit tests; PostgreSQL integration tests for migrations and tenancy; `npm run logs:eval` extended with scenarios for each new tool and the procedure section; `npm run build`; `npm run docs:check`; browser checks of `/log-admin` and `/logs` at 1440x900 with an isolated `WISEEFF_RUNTIME_LANE`. Independent review of each PR diff (tenancy, migrations, archive handling, prompt-protocol precedence).

## UI interaction coverage

Each phase's PR lists the interactions from its [UI by phase](#ui-by-phase) row and the automated or browser check that covers each, per `docs/developer/ui-quality-checklist.md` and [UX acceptance](#ux-acceptance).

## Documentation Impact Matrix

| Document | Change | Phase |
| --- | --- | --- |
| ADR-0047 (+ zh companion) | new | planning |
| `CONTEXT.md` | analysis skill terms; log domain retired | planning |
| `ARCHITECTURE.md` (+ zh) | logs module description | S1, S4 |
| `docs/api/log-analysis-integration.md` (+ zh) | skill-based integration | S1 (fields), S5 (rewrite) |
| `docs/user-guide/log-analysis.md` (+ zh) | skills, bundles, decoded evidence, source | S1–S5 |
| `docs/SECURITY.md` (+ zh) | source data flow; scripts | S4, S6 |
| DB schema doc (`docs:check`) | new tables | S1–S5 |
| `docs/developer/environment-variables.md` (+ zh) | intake/snapshot caps, budget caps | S2, S4 |
| `docs/runbooks/log-analysis-llm.md` (+ zh) | budgets, source tools | S1, S4 |
| `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`) | log analysis UI: skills list, workspace, builders, report | S1–S5 |
| `docs/design-docs/ui-design-system.md` | canonical skill workspace layout, bit bar and hex view if adopted as shared patterns | S1, S3 |
| ADR for integration credentials | new principal kind | before S5 |

## Documentation Update Gate

A phase PR is not ready until its rows above are updated with English and Chinese companions and `npm run docs:check` passes.

## Git and PR workflow

One phase → one branch from the latest `main` → one PR, merged when green. Only the coordinating agent opens or merges PRs, within user authorization.

## Risks

- **Schema designed without a reference module.** Mitigation: `parsing/v1` is versioned so a `v2` can coexist; the product owner's real-scenario test after S3 is the first schema review, and S5 documents gaps found.
- **Large bundles and snapshots.** Mitigation: streaming and offset indexes (S2), asynchronous capped indexing (S4), caps tunable by env and measured in the PRs.
- **Higher model cost** from more steps and source context. Mitigation: per-skill budgets under platform caps; cost and step counts in metrics.
- **Procedure or source content steering the agent.** Mitigation: protocol precedence, grounding, no write path, behavior-eval scenarios with adversarial procedure and log text.
- **Five phases of scope.** Mitigation: each phase ships a usable increment; S1 alone delivers per-module procedures and reproducible runs.
