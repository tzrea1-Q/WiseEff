# Analyze a log

> Chinese: [Chinese](../zh-CN/user-guide/log-analysis.md)

## Who can do this

Intelligent analysis (`/logs`), under Log analysis, is available to hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`). Guests cannot open this page. Viewing records requires `logs:view`. Uploading requires an active account with `logs:upload`; giving quality feedback requires an active account with `logs:feedback`. Standard non-guest roles include these permissions, but records are accessible only within your Organization's scope.

Turning a report into a knowledge draft also requires `knowledge:edit`. Admins with `logs:admin-domains` can maintain Log domains in Log administration (`/log-admin`). This guide describes the real API workflow. Mock mode simulates uploads and cannot confirm whether an analysis or feedback was saved on the server.

## Author a diagnostic procedure

In API mode, Admins with `logs:admin-domains` can open a skill in `/log-admin?tab=skills` and choose Diagnostic procedure. The Markdown editor prefills five headings when no procedure exists: scope, what to check first, root-cause criteria, common misjudgements, and recommended actions. Switch between Edit and Preview to check the text. The counter shows the 20,000-character limit.

Save the draft, review the procedure's before/after text in the publish dialog, then publish to create a revision. Discard draft deletes the saved draft and unsaved edits, restoring the current published revision. Draft edits do not change queued analyses or reruns explicitly pinned to an older revision; new uploads use the current published revision. Procedures guide the read-only agent and cannot authorize writes or replace log evidence. Rule-fallback analysis ignores them.

## Upload a log and choose its domain

1. Open Intelligent analysis (`/logs`) and choose "Upload new log".
2. Before selecting a file, set the optional "Business domain". A Log domain describes the log format, domain knowledge, and analysis focus. It is a separate concept from an Organization or an intake channel. Choose a registered domain that fits the file, or leave "Uncategorized (general analysis)" selected. If the domain you need is missing, ask an Admin to maintain it in Log administration (`/log-admin`).
3. Optionally enter an "Analysis question", such as which events explain a temperature rise. To associate a parameter, select its project and then a current project parameter. Both selections are needed to complete the association.
4. Select or drop one `.log`, `.txt`, `.csv`, or `.json` text log. API uploads also accept single-file `.gz` and single-entry `.zip` archives, which the server unpacks. Review the file check, then choose "Confirm upload". After the filename check passes, the server still needs to parse the contents; parsing may fail.
5. Follow the new record in "History". Select another history item to inspect its status and report.

Single-file selection opens a confirmation step. Selecting or dropping several files starts their uploads without per-file confirmation, using the current options; set the domain and question first. An unsupported file can still be submitted with "Upload anyway", but this does not make its format supported.

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
2. Select a card to focus it and scroll to its first cited raw line. Hovering the card highlights its cited lines. Check surrounding events, time, and module rather than relying on the excerpt alone.
3. Select a raw line number with evidence to jump back to its first corresponding card. Lines without evidence do not have this jump action.
4. Use raw-log search and previous/next match buttons to inspect other occurrences. If a column filter hides a cited line, clear that filter before locating it.

After completion, choose "Export report" to download a Markdown summary or "Copy link" to copy the selected record's link. Recipients still need access to the record within its Organization.

![Selected evidence card with cited log lines](images/log-analysis-evidence.png)

*A selected evidence card from the freshly uploaded sample exposes cited raw lines and inference for manual checking.*

## Give feedback on report quality

In Intelligent analysis (`/logs`), choose "Give analysis-quality feedback" for the selected report. Select "High: credible judgment", "Medium: needs review", or "Low: possible misjudgment". Optionally describe missing evidence, a wrong root cause, or omitted log fragments. Choose "Submit feedback" and wait for the success notification; if submission fails, the dialog displays an error so you can retry.

The current API stores High as helpful and Medium/Low as not helpful, with the optional note. Feedback records your quality assessment without directly changing the report's confidence or conclusion. Submitting it does not mean the analyzer has been retrained. Admins can inspect aggregated quality feedback in Log administration (`/log-admin`).

## Turn a reviewed analysis into knowledge

1. On a completed report in Intelligent analysis (`/logs`), choose "Distil into knowledge". This action is available only to accounts with knowledge-editing permission.
2. The app creates a draft and opens its detail in Knowledge base (`/knowledge`). Pre-filled content includes the conclusion, impact, severity and confidence, cited evidence, and suggested actions when present, with a link back to the source analysis record.
3. Choose "Edit", check the text, title, and tags, and save. If the source analysis is degraded, the platform adds a source warning at the start of the draft. It includes the rule-fallback or early-convergence label, the reason, and a reminder to check the evidence before relying on the conclusion. Confidence is labeled "Rule score" or "Model self-estimate", respectively; older records retain their "Confidence" caption. Check the notice against the source report while editing, and preserve the uncertainty of any unverified inference.
4. Choose "Publish" only after human review. Drafts require manual publication and enter knowledge retrieval only after publication. Governing your own entry requires `knowledge:edit`; governing someone else's entry requires knowledge-management permission.

For maintained terminology, see the [domain glossary](../../CONTEXT.md). For the integration contract rather than interactive steps, see [Log Analysis Integration](../api/log-analysis-integration.md).
