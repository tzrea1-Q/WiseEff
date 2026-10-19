# Analyze a log

> Chinese: [Chinese](../zh-CN/user-guide/log-analysis.md)

## Who can do this

Intelligent analysis (`/logs`), under Log analysis, is available to hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`). Guests cannot open this page. Viewing records requires `logs:view`. Uploading requires an active account with `logs:upload`; giving quality feedback requires an active account with `logs:feedback`. Standard non-guest roles include these permissions, but records are accessible only within your Organization's scope.

Turning a report into a knowledge draft also requires `knowledge:edit`. Admins with `logs:admin-domains` can maintain Log domains in Log administration (`/log-admin`). This guide describes the real API workflow. Mock mode simulates uploads and cannot confirm whether an analysis or feedback was saved on the server.

## Author a diagnostic procedure

In API mode, Admins with `logs:admin-domains` can open a skill in `/log-admin?tab=skills` and choose Diagnostic procedure. The Markdown editor prefills five headings when no procedure exists: scope, what to check first, root-cause criteria, common misjudgements, and recommended actions. Switch between Edit and Preview to check the text. The counter shows the 20,000-character limit.

Save the draft, review the procedure's before/after text in the publish dialog, then publish to create a revision. Discard draft deletes the saved draft and unsaved edits, restoring the current published revision. Draft edits do not change queued analyses or reruns explicitly pinned to an older revision; new uploads use the current published revision. Procedures guide the read-only agent and cannot authorize writes or replace log evidence. Rule-fallback analysis ignores them.

## Build extractors and configure the basic format

Open a skill's Samples and parsing section. Select a line in the docked sample pane or the section, then choose Create extractor from this line. Click segments, or shift-click a range, name each field and choose its type. Key/value pairs remain natural segments; numeric values, hexadecimal registers and quoted strings can be generalized. Unselected numbers, such as timestamps and counters, are generalized by default; turn the option off to keep them literal. The builder recognizes the leading timestamp using the basic format's timestamp pattern when available, otherwise recognizing bracketed numeric dmesg timestamps. This metadata prefix becomes optional while the message stays anchored. Review the pattern, hit count, coverage and matching lines before adding the extractor; trailing empty lines do not count toward coverage. The compact Advanced disclosure opens direct RE2 pattern editing and shows validation errors. A manually edited status identifies a pattern that no longer follows the selected segments; regenerate from segments to restore automatic generation. Editing an extractor uses the same builder. The sample pane identifies matching rules with distinct colors, rule ids and a text legend.

The Basic format form edits the existing `formatProfile`: timestamp pattern, severity patterns for error/warn/info, and either indentation or a start pattern for multi-line entries. The live sample preview shows detected timestamps, each line's severity and the original line numbers grouped into entries. Timestamp capture group 1 is used when present; severity checks error, warn and info in that order. Patterns use RE2. Code view edits the same JSON object and round-trips without converting existing profiles. Invalid code or patterns must be corrected before saving or publishing. Form changes do not migrate profiles or change parsing semantics. Live basic-format preview is limited to the first 500 lines and 1 MiB, with at most 6,144 characters per line.

## Author signal rules

The field picker groups choices by extractor and decoder. Choose a register bit field or frame quantity (units are shown when declared), or its `.meaning` enum label. For example, BQ25890 `addr=0x0C val=0x20` decoded by the charger map can trigger a signal with `charger.val.fields.CHRG_FAULT.meaning` equals `thermal_shutdown`. Meanings offer selectable values for equals/set conditions; numeric thresholds use the scaled decoded value. Paths start with `extractorId.captureName`, traverse `.fields.NAME`, and may end in `.value` or `.meaning`. Repeated frame/TLV elements use `.fields.*` to match any element, such as `pd.pdo.fields.pdos.fields.*.fields.voltage.value`; numeric indexes are not supported. Missing or errored fields do not match. These signals contribute line references to report evidence and participate in rule fallback.

Open a skill's Signals section to add rules in the form “When a condition holds, produce a named signal with a severity.” Conditions match messages with bounded RE2 patterns, compare an extracted `extractorId.fieldName` against a scalar, numeric range or set, or count matches within a time window in one file. Multiple conditions within a rule are alternatives. Reorder or delete rules as needed. Invalid fields show their validation paths and prevent saving or publishing.

Upload a sample in the persistent right pane. Valid rules preview automatically after a short pause. Each collapsed rule card shows its sentence summary and hit count; expand it to edit conditions or choose a matching line chip to highlight the sample. Legacy conditions have readable descriptions and remain editable in code. A limit notice identifies partial results. Preview uses unsaved rules on the server. Save and publish to apply the rules to new uploads; draft changes do not affect a run's pinned revision. The seeded Charging skill carries the existing charging rules, while uploads without a skill retain the legacy charging prefilter.

## Decode registers in a skill

Open a skill in `/log-admin?tab=skills` and choose Decode. Add a register, give it an id and select its width (8, 16, 32 or 64 bits). The field table edits inclusive high/low bits, name, enum labels, scale, offset, unit, signedness and description. Bits must fit the width, must not overlap and cannot share a name. The bit bar runs from high bit to low bit; field names and bit ranges identify each segment alongside its color.

Choose Paste register table to import datasheet rows, up to 64 KiB and 512 lines. Paste columns for bits, name and description separated by tabs, commas, multiple spaces or pipes. Accepted bit notations include `7`, `7:5`, `[7:5]` and `7-5`. Review the valid/rejected counts and preview: header rows are skipped, and each rejected line has an error icon and reason. Confirming replaces all fields of the selected register with the valid rows; check their bit ranges before saving.

For an address or message-id register dump, add a register map, choose the selector field, and enter each case's value and register id, with an optional default. Connect an extractor's integer or hex value field to the register or map. The YAML code view edits the same parsing spec as the forms; [the BQ25890 example](../design-docs/log-parsing-v1.md#registers-and-register-maps) shows the complete configuration. Unknown cases without a default produce an event error rather than stopping analysis.

The sample pane stays on the right while editing. Select a matching sample line to preview the unsaved spec through the server; the bit bar displays each field's decoded value and enum meaning. For `addr=0x0C val=0x20` using BQ25890 REG0C, `CHRG_FAULT` is 2 (`thermal_shutdown`), `WATCHDOG_FAULT` is 0 and `NTC_FAULT` is 0. Signed fields use two's complement before scale and offset; units appear with the physical value. Save and publish when the preview matches the datasheet. In completed reports, cited lines show the raw register value and its nested decoded fields with meanings and units.

## Decode protocol frames in a skill

In the same Decode section, add a frame in the Frames list. Give it an id and choose the default endianness (big-endian if omitted). Add ordered field rows for unsigned/signed integers, bytes, nested registers or frames, switch, repeat, TLV or checksum. Integer fields use 1, 2, 4 or 8 bytes and can carry scale, offset, unit and enum meaning. Offsets update automatically; after variable-length content they appear relative to the preceding field, such as `+2 after payload`.

For variable-length layouts, set a byte length, switch selector or repeat count to an earlier decoded field path. Nested paths such as `hdr.num_objects` can use a previously decoded header register. Repeat can also use a constant count and a fixed multiplier. Switch chooses a frame or register by case value, with an optional default; decimal and hex case keys compare by integer value. TLV reads the configured tag and length widths, applies known tag definitions and retains unknown values as raw bytes. Checksum fields choose `sum8`, `xor8`, `crc8`, `crc16-ccitt`, `crc16-modbus` or `crc32`, a covered byte range and storage endianness. Ranges are relative to the frame, exclude their stored checksum and cannot overlap another checksum's covered range.

Connect an extractor's hex or byte capture to the frame, then select a matching line in the docked sample pane. The editor defaults to the top-level frame decoded on that line and shows its whole payload. The server previews the unsaved draft and puts each decoded value next to its field row. The hex view fits 16, 8 or 4 bytes per row to the column width, with a matching offset gutter: select a field to outline its bytes, or select a byte to select its field. Repeat items can also be selected individually to outline each item's byte range. Outlines and font weight identify the selection alongside color without changing cell width. Plain integer values show decimal and hex together; values with units or enum meanings stay unchanged. The register bit bar finds nested occurrences and shows their field paths; use the occurrence picker when a register appears more than once. Known frame errors show a localized warning with the original detail in its tooltip. Checksum status appears inline; a mismatch stays visible as a decode error while analysis continues. Reports and Agent decoded-event tools use the same nested field tree.

Frames are limited to 4096 bytes, nesting to 8 levels across frames and registers, each repeat to 256 elements, total decoding elements to 1024 per event, and each TLV field to 256 items. Frame output also shares the event/run size, field and time limits. Fix path-specific validation errors before saving; runtime bounds and checksum failures are event errors. The YAML code view round-trips the same definitions. See the [frame schema and USB-PD example](../design-docs/log-parsing-v1.md#byte-layout-frames) for a two-PDO payload decoded to 5000/9000 mV and 3000 mA.

## Link knowledge to a skill

Open a skill in `/log-admin?tab=skills` and choose Knowledge. The list shows each linked entry's title, publication status, current revision and update time. Choose Unlink to remove an entry from the skill draft; this does not delete the knowledge entry.

Entries you cannot read appear with a restricted-entry label and their id; titles, tags, status, revision and update time remain hidden. Log administration does not grant knowledge access. Report sources also hide revision ids for unreadable entries while retaining the recorded entry ids.

- Choose Link existing entry to search published entries in your Organization and add them to the draft. Entries from another Organization cannot be linked.
- Choose Upload Markdown, or drop several `.md` files into the upload area, to create knowledge-base drafts and link them to the skill draft. This uses the normal knowledge creation workflow and audit. Review and publish each entry in Knowledge base before analysis can retrieve it; uploading does not publish it automatically.
- Review each pending file's size and validation message, and remove unwanted files before submitting. Each file must be `.md`, at most 20 MiB and 200,000 characters. If some files fail, the dialog keeps their reasons and the successful results; retrying creates only the failed files.
- Upload requires `knowledge:edit` in addition to skill-administration permission. Without it, the disabled action explains the missing permission. Linking existing published entries does not grant knowledge-editing permission.

Save and publish the skill draft to make its link set available to new analyses. A run uses the entries linked by its pinned skill revision, so later skill edits cannot change that set. Unpublished and archived knowledge is excluded from retrieval. The report's source information records the entry and revision ids actually returned during analysis, rather than treating every linked entry as used. Later knowledge edits do not rewrite that run's recorded sources.

## Keep decoders correct with parse tests

The skill workspace has one Tests section with Parse tests and Analysis cases tabs. Parse tests opens by default; switching tabs preserves their edits and displayed results. Links ending in `?section=tests&tab=parse` or `?section=tests&tab=cases` open the corresponding tab.

In Parse tests, select a sample line in the docked sample pane, then choose Add test. The new test starts with that line and its current decoded fields; without a selected line, fill in the input yourself. Give it a name, review its input lines and optional filename, then edit or remove expectations in the field-path table. Values accept JSON or plain strings. For example, `val.fields.CHRG_FAULT.meaning` should equal `thermal_shutdown` for the BQ25890 sample above. The JSON code view edits the expectations in bulk; choose Apply expectation code to use the changes.

Expected fields are a subset: extra decoded fields are allowed. A scalar expectation compares a converted field's `value`, so `val: 32` checks the numeric value of raw `0x20`; use `val.raw` when the original representation matters. Nested register fields use their full paths. Expected signals accept rule ids or names and ignore order and repeated hits. Enable exact signal matching to also fail on unexpected signals.

Each draft save runs the tests. Run tests in the Parse tests tab toolbar also checks the current edits on demand. The tab label shows a compact passed/total count, Not run or Running; the list shows each test's status and keeps failure details inside the tab. Select a failed test to see Field path, Expected and Actual, with missing and unexpected signals beside the field differences. Editing the spec clears the displayed status until the next run. Parse tests use the worker's parsing engine and signal rules without calling a model.

Tests are saved in the draft and published with its revision. A skill accepts up to 50 tests, each with up to 200 lines; the whole run is limited to 5000 lines, 1,048,576 input characters and one second. Correct invalid or oversized input before running; an execution limit or error is shown as a failed test. See the [parse-test reference](../design-docs/log-parsing-v1.md#parse-tests) for signal-rule, field, transport and output bounds. The latest run is held in the open workspace, so reloading clears its status; saving or running again recomputes it.

Before publication the server reruns parse tests. The publish dialog puts both test summaries in one Pre-publication tests block before the change diff. Its parse-test summary shows passed/total and links failures to the Parse tests tab; the analysis-case run link opens Analysis cases. The change summary lists added, changed and deleted tests by name; changed tests identify the affected parts, such as input lines or expected fields. One shared advisory explains that failed tests and missing runs never disable Publish. Review the results and decide whether to publish.

## Try the draft on a sample

In the skill workspace (`/log-admin/skills/:skillId`), upload the skill's sample log and choose Dry run. This action requires `logs:admin-domains` and API mode. It saves pending edits as a draft, then runs that saved draft on the stored sample with the configured analyzer, including the real model when configured; publishing is not required. Later edits or sample replacement do not change a run already started.

The right-side drawer shows progress, the final conclusion and evidence, and the ordered analysis steps. A summary above the steps totals steps, tool calls and reported input/output tokens, with early-convergence and degradation markers. Review these warnings before relying on the result. Each step shows what tool ran, its bounded argument summary, result size, returned line references, outcome and available token counts. Trace `file:line` references are plain text because a dry run has no log record; evidence references can open the captured sample in the log viewer drawer. Prompts, procedure text, knowledge text and provider payloads are not displayed or stored in traces.

Only one dry run may run per organization at a time, with a shared aggregate cap of 2 by default across API instances. An administrator can configure `LOG_DRY_RUN_MAX_CONCURRENT` from 1 to 4; invalid values use 2. A full-capacity request receives a busy message and starts no analysis. Analysis budgets and a timeout apply. Startup recovery and status reads detect a missing owner process or an expired deadline, mark the run interrupted, and offer Retry in the drawer. Dry runs do not appear in `/logs`, its counts or search, and do not send result webhooks. The latest 10 runs per skill are retained; older completed or failed runs and their traces are removed.

## Measure a draft with analysis cases

In the skill workspace's Tests section, select the Analysis cases tab. Its compact label shows passed/total only for a complete run that is current for the saved draft and cases; otherwise it shows Not run. A case belongs to the skill, across revisions, and contains the original uploaded log bundle, its file inventory and expectations. Add a bundle and describe the expected root cause, decisive evidence and suggested actions; mark an expected refusal or degradation when that is the correct outcome. Add evidence rows by choosing a file and either a line number or an RE2 pattern. For a newly selected archive, enter the internal relative file path; the archive name is not an evidence file. Required fields are marked, and validation messages appear beside the affected fields. Edit expectations before saving.

Run one case or all cases against the saved draft. Pending draft saves lock workspace editing and navigation until they finish. The server uses the configured analysis model and the existing quality rubric, with the configured judge when available and deterministic expectation checks otherwise. The same inputs run against the last published revision. Scores use a percentage scale; degradation is identified beside the score. Expand a case to compare evidence recall and precision, hit and missed lines, root-cause and action scores, category match, expected versus actual refusal, and hallucinated lines for both revisions. Trace links are in these details. A failed or interrupted run is not a passing result. Cases and runs are bounded, share dry-run admission limits, and create no log-list entries, statistics, search results or result webhooks.

In the publish dialog's shared Pre-publication tests block, the analysis-case pass count and comparison appear only when results are current for the saved draft and cases. Otherwise, Not run offers a link to run them in the Analysis cases tab.

On a completed report bound to a skill, administrators with `logs:admin-domains` can choose Save as test case. The edit dialog lists the original uploads and their sizes, and prefills the report conclusion as expected root cause, cited file/line anchors as key evidence and suggestions as expected actions. Provider failures and token-budget degradation are never copied into expected refusal or degradation. Only an actual model's content-level refusal can prefill expected refusal. A degraded source report shows a notice to check the expectations manually. Review these expectations before saving; the case retains the original uploaded bytes rather than the report's truncated preview.

Use Import and Export to move cases as a ZIP in the [`eval-cases/logs` format](../../eval-cases/logs/README.md). The Import button opens a file picker; its result or errors appear in the section's status area. Import validates annotations, fixtures, paths and size limits before saving. Keep the exported directory structure intact; validation errors identify the exact file and field to fix.

## Upload a log and choose its domain

1. Open Intelligent analysis (`/logs`) and choose "Upload new log".
2. Before selecting a file, set the optional "Business domain". A Log domain describes the log format, domain knowledge, and analysis focus. It is a separate concept from an Organization or an intake channel. Choose a registered domain that fits the file, or leave "Uncategorized (general analysis)" selected. If the domain you need is missing, ask an Admin to maintain it in Log administration (`/log-admin`).
3. Optionally enter an "Analysis question", such as which events explain a temperature rise. To associate a parameter, select its project and then a current project parameter. Both selections are needed to complete the association.
4. Select or drop `.log`, `.txt`, `.csv`, or `.json` text logs. In API mode, select several text files for one analysis record, or one `.gz`, `.zip`, `.tar`, `.tar.gz`, or `.tgz` archive for the server to unpack. Review the selected files, remove any unwanted files, then choose "Confirm upload". After the filename check passes, the server still needs to parse the contents; parsing may fail.
5. Follow the new record in "History". Select another history item to inspect its status and report.

The selected files share the current domain and analysis question. The server's configured bundle limits apply; see [environment variables](../developer/environment-variables.md). An unsupported file can still be submitted with "Upload anyway", but this does not make its format supported.

## Follow the analysis stages

The page shows Processing, Complete, or Failed, with a four-stage timeline to track progress. These stages work together to produce one report:

| Stage | Meaning |
| --- | --- |
| Log parsing | Read and parse the file into log lines, using the domain's format profile when present. |
| Pattern matching | The pipeline's milestone for finding known operational patterns before root-cause analysis. |
| Root-cause inference | Analyze log evidence to form a likely explanation; the multi-step Log analysis agent runs inside this stage. |
| Report generation | Prepare the conclusion, impact, evidence, and suggested actions. |

Wait for "Complete" before reading the finished report. On "Failed", read the failure stage and reason, correct the input if needed, and choose "Upload again". This opens the upload dialog; it does not automatically retry the original file.

## Check who produced the result

Read the source badge and any explanation for degraded analysis alongside the conclusion:

- "Agent analysis" means the Log analysis agent produced the result. Its confidence is labeled "Model self-estimate"; this is not a calibrated probability that the conclusion is correct.
- "Degraded analysis · rule fallback" means the rule engine produced the conclusion without a full AI analysis. The AI service may have been unavailable, or the analysis may have failed to reach a valid conclusion supported by evidence within the budget. Confidence is labeled "Rule score".
- "Degraded analysis · early convergence" means the step or token budget ran out and the Agent reached a low-confidence conclusion from evidence already read. The result still comes from the Agent and differs from rule fallback.

Older records may lack source badges, and the confidence percentage alone cannot identify the source. Complete means processing has ended; conclusions still need checking, especially in degraded reports. A dedicated Log analysis agent performs the analysis. Xiaoze, the conversational assistant, can discuss finished conclusions but does not run the log analysis.

![Completed sample charging foldback report with analysis-source badge](images/log-analysis-report.png)

*A fresh sample report from the offline deterministic analysis path, with its Agent source badge and evidence; it is not a live LLM result.*

## Trace a finding back to raw lines

1. In Intelligent analysis (`/logs`), read the conclusion and impact, then inspect the "Evidence chain" beside "Raw log". Each evidence card shows its stage, cited line numbers and excerpts, inference, any rule hit, and suggested action.
2. Click a `file:line` chip to open that file in the log viewer drawer, including files outside the raw-log preview. The drawer scrolls to and highlights the citation, shows context and line numbers, and offers "Load above", "Load below", and a copy action for each line. Hovering a card still highlights its cited lines when present in the raw panel. Check surrounding events, time, and module rather than relying on the excerpt alone.
3. Select a raw line number with evidence to jump back to its first corresponding card. Lines without evidence do not have this jump action.
4. Use raw-log search and previous/next match buttons to inspect other occurrences in the preview. If a column filter hides a cited line, clear that filter before locating it. The raw panel remains available as a bounded preview: at most the first 400 lines per file, sharing a 128 KiB text budget across the run. Use the drawer for citations beyond that preview; each displayed window contains at most 400 lines.

Very long lines in the drawer are limited to 64 KiB and end with `… [line truncated at 64 KiB]`; copying such a line copies its displayed prefix and marker.

After completion, choose "Export report" to download a Markdown summary or "Copy link" to copy the selected record's link. Recipients still need access to the record within its Organization.

![Selected evidence card with cited log lines](images/log-analysis-evidence.png)

*A selected evidence card from the freshly uploaded sample exposes cited raw lines and inference for manual checking.*

## Inspect signals and repeated lines

On a record report in `/logs`, choose the Signals tab beside the existing report. Signals are grouped by kind and show severity, generic or skill source, occurrence count and `file:line` chips. Generic signals include crash signatures, timestamp gaps, restarts, error bursts and each file's first error; they are available even without a selected skill. Skill signals use the revision pinned to that run.

The line-template table groups lines after replacing changing numbers, hexadecimal values, identifiers and paths. Compare each template's count and first/last locations to spot repetition. In API mode, every signal and template anchor opens the same file drawer with the cited line highlighted, even when another file appears in the raw-log preview. Load context above or below and copy individual lines there. A truncation notice means the stored summary reached its bound; inspect raw logs for additional occurrences. A signal is a lead to check, not a root-cause conclusion. Older reports may have no saved signals. Degraded reports keep their source warning and use generic signals together with the pinned skill's rules.

The Signals tab also explains when extraction ran out of time, scanned only the beginning of long lines, or failed. Time-limited results keep completed signals; an extraction failure leaves an empty signal summary. The report and raw logs remain available for checking, and an incomplete summary does not establish that no anomalies exist.

## Inspect the analysis trace

Skill administrators with `logs:admin-domains` can open Analysis trace beside Conclusion, Files and Signals on a `/logs` report. Accounts with only `logs:view` do not see this tab and cannot read the trace API. The trace belongs to the record's current run; older records may have no saved steps.

The summary above the steps totals steps, tool calls and reported input/output tokens and marks degradation or early convergence. Read steps in order to follow model turns, tool calls, early convergence, rule fallback or other degradation. Check the tool's argument summary, result byte count, outcome and short reason, and token counts when the model service provides them. A file argument shows the matching bundle-relative path, truncated to 120 characters; query and pattern text stays redacted. An error or truncation describes that step, not proof that the full analysis failed. Click a returned log `file:line` chip to open the existing log viewer drawer at that line and inspect surrounding context. Source references appear as source badges with a snapshot identity; they do not open the log viewer. Traces contain bounded summaries and line references rather than raw prompts or tool-result text; they help review the procedure but do not replace the final evidence.

## Give feedback on report quality

In Intelligent analysis (`/logs`), choose "Give analysis-quality feedback" for the selected report. Select "High: credible judgment", "Medium: needs review", or "Low: possible misjudgment". Optionally describe missing evidence, a wrong root cause, or omitted log fragments. Choose "Submit feedback" and wait for the success notification; if submission fails, the dialog displays an error so you can retry.

The current API stores High as helpful and Medium/Low as not helpful, with the optional note. Feedback records your quality assessment without directly changing the report's confidence or conclusion. Submitting it does not mean the analyzer has been retrained. Admins can inspect aggregated quality feedback in Log administration (`/log-admin`).

## Turn a reviewed analysis into knowledge

1. On a completed report in Intelligent analysis (`/logs`), choose "Distil into knowledge". This action is available only to accounts with knowledge-editing permission.
2. The app creates a draft and opens its detail in Knowledge base (`/knowledge`). Pre-filled content includes the conclusion, impact, severity and confidence, cited evidence, and suggested actions when present, with a link back to the source analysis record.
3. Choose "Edit", check the text, title, and tags, and save. If the source analysis is degraded, the platform adds a source warning at the start of the draft. It includes the rule-fallback or early-convergence label, the reason, and a reminder to check the evidence before relying on the conclusion. Confidence is labeled "Rule score" or "Model self-estimate", respectively; older records retain their "Confidence" caption. Check the notice against the source report while editing, and preserve the uncertainty of any unverified inference.
4. Choose "Publish" only after human review. Drafts require manual publication and enter knowledge retrieval only after publication. Governing your own entry requires `knowledge:edit`; governing someone else's entry requires knowledge-management permission.

For maintained terminology, see the [domain glossary](../../CONTEXT.md). For the integration contract rather than interactive steps, see [Log Analysis Integration](../api/log-analysis-integration.md).
