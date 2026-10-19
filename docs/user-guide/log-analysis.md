# Analyze a log

> Chinese: [Chinese](../zh-CN/user-guide/log-analysis.md)

## Who can do this

Intelligent analysis (`/logs`), under Log analysis, is available to hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`). Guests cannot open this page. Viewing records requires `logs:view`. Uploading requires an active account with `logs:upload`; giving quality feedback requires an active account with `logs:feedback`. Standard non-guest roles include these permissions, but records are accessible only within your Organization's scope.

Turning a report into a knowledge draft also requires `knowledge:edit`. Admins with `logs:admin-domains` can maintain Log domains in Log administration (`/log-admin`). This guide describes the real API workflow. Mock mode simulates uploads and cannot confirm whether an analysis or feedback was saved on the server.

## Author a diagnostic procedure

In API mode, Admins with `logs:admin-domains` can open a skill in `/log-admin?tab=skills` and choose Diagnostic procedure. The Markdown editor prefills five headings when no procedure exists: scope, what to check first, root-cause criteria, common misjudgements, and recommended actions. Switch between Edit and Preview to check the text. The counter shows the 20,000-character limit.

Save the draft, review the procedure's before/after text in the publish dialog, then publish to create a revision. Discard draft deletes the saved draft and unsaved edits, restoring the current published revision. Draft edits do not change queued analyses or reruns explicitly pinned to an older revision; new uploads use the current published revision. Procedures guide the read-only agent and cannot authorize writes or replace log evidence. Rule-fallback analysis ignores them.

## Author signal rules

Open a skill's Signals section to add rules in the form “When a condition holds, produce a named signal with a severity.” Conditions match messages with bounded RE2 patterns, compare an extracted `extractorId.fieldName` against a scalar, numeric range or set, or count matches within a time window in one file. Multiple conditions within a rule are alternatives. Reorder or delete rules as needed. Invalid fields show their validation paths and prevent saving or publishing.

Upload a sample in the persistent right pane. Valid rules preview automatically after a short pause. Each collapsed rule card shows its sentence summary and hit count; expand it to edit conditions or choose a matching line chip to highlight the sample. Legacy conditions have readable descriptions and remain editable in code. A limit notice identifies partial results. Preview uses unsaved rules on the server. Save and publish to apply the rules to new uploads; draft changes do not affect a run's pinned revision. The seeded Charging skill carries the existing charging rules, while uploads without a skill retain the legacy charging prefilter.

## Decode registers in a skill

Open a skill in `/log-admin?tab=skills` and choose Decode. Add a register, give it an id and select its width (8, 16, 32 or 64 bits). The field table edits inclusive high/low bits, name, enum labels, scale, offset, unit, signedness and description. Bits must fit the width, must not overlap and cannot share a name. The bit bar runs from high bit to low bit; field names and bit ranges identify each segment alongside its color.

Choose Paste register table to import datasheet rows, up to 64 KiB and 512 lines. Paste columns for bits, name and description separated by tabs, commas, multiple spaces or pipes. Accepted bit notations include `7`, `7:5`, `[7:5]` and `7-5`. Review the valid/rejected counts and preview: header rows are skipped, and each rejected line has an error icon and reason. Confirming replaces all fields of the selected register with the valid rows; check their bit ranges before saving.

For an address or message-id register dump, add a register map, choose the selector field, and enter each case's value and register id, with an optional default. Connect an extractor's integer or hex value field to the register or map. The YAML code view edits the same parsing spec as the forms; [the BQ25890 example](../design-docs/log-parsing-v1.md#registers-and-register-maps) shows the complete configuration. Unknown cases without a default produce an event error rather than stopping analysis.

The sample pane stays on the right while editing. Select a matching sample line to preview the unsaved spec through the server; the bit bar displays each field's decoded value and enum meaning. For `addr=0x0C val=0x20` using BQ25890 REG0C, `CHRG_FAULT` is 2 (`thermal_shutdown`), `WATCHDOG_FAULT` is 0 and `NTC_FAULT` is 0. Signed fields use two's complement before scale and offset; units appear with the physical value. Save and publish when the preview matches the datasheet. In completed reports, cited lines show the raw register value and its nested decoded fields with meanings and units.

## Link knowledge to a skill

Open a skill in `/log-admin?tab=skills` and choose Knowledge. The list shows each linked entry's title, publication status, current revision and update time. Choose Unlink to remove an entry from the skill draft; this does not delete the knowledge entry.

Entries you cannot read appear with a restricted-entry label and their id; titles, tags, status, revision and update time remain hidden. Log administration does not grant knowledge access. Report sources also hide revision ids for unreadable entries while retaining the recorded entry ids.

- Choose Link existing entry to search published entries in your Organization and add them to the draft. Entries from another Organization cannot be linked.
- Choose Upload Markdown, or drop several `.md` files into the upload area, to create knowledge-base drafts and link them to the skill draft. This uses the normal knowledge creation workflow and audit. Review and publish each entry in Knowledge base before analysis can retrieve it; uploading does not publish it automatically.
- Review each pending file's size and validation message, and remove unwanted files before submitting. Each file must be `.md`, at most 20 MiB and 200,000 characters. If some files fail, the dialog keeps their reasons and the successful results; retrying creates only the failed files.
- Upload requires `knowledge:edit` in addition to skill-administration permission. Without it, the disabled action explains the missing permission. Linking existing published entries does not grant knowledge-editing permission.

Save and publish the skill draft to make its link set available to new analyses. A run uses the entries linked by its pinned skill revision, so later skill edits cannot change that set. Unpublished and archived knowledge is excluded from retrieval. The report's source information records the entry and revision ids actually returned during analysis, rather than treating every linked entry as used. Later knowledge edits do not rewrite that run's recorded sources.

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

## Give feedback on report quality

In Intelligent analysis (`/logs`), choose "Give analysis-quality feedback" for the selected report. Select "High: credible judgment", "Medium: needs review", or "Low: possible misjudgment". Optionally describe missing evidence, a wrong root cause, or omitted log fragments. Choose "Submit feedback" and wait for the success notification; if submission fails, the dialog displays an error so you can retry.

The current API stores High as helpful and Medium/Low as not helpful, with the optional note. Feedback records your quality assessment without directly changing the report's confidence or conclusion. Submitting it does not mean the analyzer has been retrained. Admins can inspect aggregated quality feedback in Log administration (`/log-admin`).

## Turn a reviewed analysis into knowledge

1. On a completed report in Intelligent analysis (`/logs`), choose "Distil into knowledge". This action is available only to accounts with knowledge-editing permission.
2. The app creates a draft and opens its detail in Knowledge base (`/knowledge`). Pre-filled content includes the conclusion, impact, severity and confidence, cited evidence, and suggested actions when present, with a link back to the source analysis record.
3. Choose "Edit", check the text, title, and tags, and save. If the source analysis is degraded, the platform adds a source warning at the start of the draft. It includes the rule-fallback or early-convergence label, the reason, and a reminder to check the evidence before relying on the conclusion. Confidence is labeled "Rule score" or "Model self-estimate", respectively; older records retain their "Confidence" caption. Check the notice against the source report while editing, and preserve the uncertainty of any unverified inference.
4. Choose "Publish" only after human review. Drafts require manual publication and enter knowledge retrieval only after publication. Governing your own entry requires `knowledge:edit`; governing someone else's entry requires knowledge-management permission.

For maintained terminology, see the [domain glossary](../../CONTEXT.md). For the integration contract rather than interactive steps, see [Log Analysis Integration](../api/log-analysis-integration.md).
