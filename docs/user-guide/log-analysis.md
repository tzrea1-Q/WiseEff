# Analyze a log

> Chinese: [Chinese](../zh-CN/user-guide/log-analysis.md)

## Who can do this

Intelligent analysis (`/logs`), under Log analysis, is available to hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`). Guests cannot open this page. Viewing records requires `logs:view`; uploading and giving quality feedback require an active account with `logs:upload` and `logs:feedback`, respectively. Standard non-guest roles include these permissions. Records remain scoped to your Organization.

Turning a report into a knowledge draft also requires `knowledge:edit`. Admins maintain Log domains in Log administration (`/log-admin`), with `logs:admin-domains`. This guide describes the real API-backed workflow; mock mode simulates uploads and does not prove that an analysis or feedback was saved on the server.

## Upload a log and choose its domain

1. Open Intelligent analysis (`/logs`) and choose **Upload new log**.
2. Before selecting a file, set the optional **Business domain**. A Log domain describes the log format, domain knowledge, and analysis emphasis; it is not an Organization or an intake channel. Choose a registered domain that fits the file, or leave **Uncategorized (general analysis)** selected. Ask an Admin to maintain missing domains in Log administration (`/log-admin`).
3. Optionally enter an **Analysis question**, such as which events explain a temperature rise. To associate a parameter, select its project and then a current project parameter; selecting a project alone is not enough.
4. Select or drop one `.log`, `.txt`, `.csv`, or `.json` text log. API-backed uploads also accept single-file `.gz` and single-entry `.zip` archives, which the server unpacks. Review the file check, then choose **Confirm upload**. A filename check does not guarantee that the server can parse the contents.
5. Follow the new record in **History**. Select another history item to inspect its status and report.

Single-file selection opens a confirmation step. Selecting or dropping several files starts their uploads without per-file confirmation, using the current options; set the domain and question first. An unsupported file can still be submitted with **Upload anyway**, but this does not make its format supported.

## Follow the analysis stages

The page shows Processing, Complete, or Failed and a four-stage timeline. These are progress milestones, not four independent verdicts:

| Stage | Meaning |
| --- | --- |
| Log parsing | Read and parse the file into log lines, using the domain's format profile when present. |
| Pattern matching | The pipeline's milestone for finding known operational patterns before root-cause analysis. |
| Root-cause inference | Analyze log evidence to form a likely explanation; the multi-step Log analysis agent runs inside this stage. |
| Report generation | Prepare the conclusion, impact, evidence, and suggested actions. |

Wait for **Complete** before treating the result as a finished report. On **Failed**, read the failure stage and reason, correct the input if needed, and choose **Upload again**. This opens the upload dialog; it does not silently retry the same file.

## Check who produced the result

Read the source badge and any degraded-reason text alongside the conclusion:

- **Agent analysis** means the Log analysis agent produced the result. Its confidence is labeled **Model self-estimate**, not a calibrated probability that the conclusion is correct.
- **Degraded analysis · rule fallback** means the rule engine produced the conclusion, not a full AI analysis. The reason can identify an unavailable AI service or failure to obtain a valid evidence-grounded conclusion within the budget. Confidence is labeled **Rule score**.
- **Degraded analysis · early convergence** is still an Agent result: the step or token budget ran out, and the Agent reached a low-confidence conclusion from evidence already read. This is not rule fallback.

Older records may lack source badges. Do not infer the source from the confidence percentage alone. A completed degraded report still needs review; completion does not certify correctness. The Log analysis agent is distinct from Xiaoze, the conversational assistant, which can discuss finished conclusions but is not the analysis worker.

## Trace a finding back to raw lines

1. In Intelligent analysis (`/logs`), read the conclusion and impact, then inspect the **Evidence chain** beside **Raw log**. Each evidence card shows its stage, cited line numbers and excerpts, inference, any rule hit, and suggested action.
2. Select a card to focus it and scroll to its first cited raw line. Hovering the card highlights its cited lines. Check surrounding events, time, and module rather than relying on the excerpt alone.
3. Select a raw line number with evidence to jump back to its first corresponding card. Lines without evidence do not have this jump action.
4. Use raw-log search and previous/next match buttons to inspect other occurrences. If a column filter hides a cited line, clear that filter before locating it.

After completion, **Export report** downloads a Markdown summary; **Copy link** copies a link to the selected record. Sharing a link does not grant access to another Organization's record.

## Give feedback on report quality

In Intelligent analysis (`/logs`), choose **Give analysis-quality feedback** for the selected report. Select **High: credible judgment**, **Medium: needs review**, or **Low: possible misjudgment**. Optionally describe missing evidence, a wrong root cause, or omitted log fragments. Choose **Submit feedback** and wait for the success notification; if submission fails, the dialog displays an error so you can retry.

The current API stores High as helpful and Medium/Low as not helpful, with the optional note. Feedback does not change the report's confidence or conclusion; do not assume submission retrains the analyzer. Admins can inspect aggregated quality feedback in Log administration (`/log-admin`).

## Turn a reviewed analysis into knowledge

1. On a completed report in Intelligent analysis (`/logs`), choose **Distil into knowledge**, available when your account can edit knowledge.
2. The app creates a draft and opens its detail in Knowledge base (`/knowledge`). Pre-filled content includes the conclusion, impact, severity and confidence, cited evidence, and suggested actions when present, with a link back to the source analysis record.
3. Choose **Edit**, check the text, title, and tags, and save. For a degraded source analysis, the platform automatically places a provenance notice at the start of the draft, with the rule-fallback or early-convergence label, the reason, and a reminder to check the evidence before relying on the conclusion. The confidence caption distinguishes rule scores from model self-estimates; legacy records retain their existing caption. Recheck the source report and keep the notice accurate while editing. Do not turn an uncertain inference into a confirmed diagnosis.
4. Choose **Publish** only after human review. The draft is not published automatically and does not participate in knowledge retrieval until published. Governing your own entry requires `knowledge:edit`; governing someone else's entry requires knowledge-management permission.

For maintained terminology, see the [domain glossary](../../CONTEXT.md). For the integration contract rather than interactive steps, see [Log Analysis Integration](../api/log-analysis-integration.md).
