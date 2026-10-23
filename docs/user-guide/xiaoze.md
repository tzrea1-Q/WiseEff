# Ask Xiaoze and approve an action

> Chinese: [Chinese](../zh-CN/user-guide/xiaoze.md)

## Who can do this

- Signed-in users, including guests (`guest`), can ask read-only questions within their permissions. Parameter and knowledge queries require `parameter:view` and `knowledge:view`; node snapshots require `debugging:view`, and recent log conclusions require `logs:view`.
- Hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`) can approve parameter proposals only with `parameter:edit` and access to the target project. Creating a knowledge draft requires `knowledge:edit`.
- Organization Admins and Platform Admins can open Audit center (`/audit`) and Knowledge administration (`/knowledge-admin`). Once a page is open, the server still checks permission for each action.

Xiaoze is available only in the app's API mode. It opens as a popup and has no separate navigation page. The UI is Chinese-first; the English labels below give their meaning, and the routes identify the pages. See [Account and access](account-and-access.md) for role requirements.

## Ask about your current work

1. Open Parameter changes (`/parameters`), select your project, and choose Open Xiaoze. You can also ask from Knowledge base (`/knowledge`); its Ask the knowledge base (Xiaoze) entry opens Xiaoze with a fixed preset prompt and does not include your search question. Replace or extend that prompt with your actual question before sending.
2. State what you want to understand and name the parameter or object. The page supplies its route, page identity, your role, a project identifier where applicable, and a short context summary. Xiaoze does not read the full screen and may not see every table row, selection, or unsaved edit, so name the relevant object in your question.
3. Ask Xiaoze to provide evidence. Its read-only tools can query project parameter counts and pending requests, search configured parameters and explain their definitions and values, and search or read published knowledge. It can also retrieve stored node snapshots associated with Node debugging (`/node-debugging`) and recent conclusions from Intelligent analysis (`/logs`).
4. Check the returned sources before using the explanation. Read-only queries do not require an approval card, but the server still checks permissions. Project tools require project access, and knowledge retrieval is limited to your Organization. Node snapshots and recent log conclusions currently return Organization-scoped records; check whether they belong to your selected project.

Xiaoze reads existing log conclusions; running an analysis still requires the log-analysis workflow. Node snapshots come from stored records and cannot confirm a fresh device read. The registered write tools currently submit parameter changes and create knowledge drafts; they do not write device nodes. Use [Device debugging](device-debugging.md) and [Log analysis](log-analysis.md) for those workflows.

![Xiaoze conversation panel on the parameter workbench](images/xiaoze-panel.png)

*The Xiaoze welcome panel, scrolled to its beginning after the parameter workbench finishes loading; no LLM request or approval card is generated.*

![Xiaoze conversation history panel](images/xiaoze-history.png)

*History before any question is sent; this is not evidence of an executed or approved action.*

## Review a parameter proposal before approving

When a Platform Admin enters a target Organization, Xiaoze works in that fixed target while retaining the administrator's real Home identity. Conversations remain private to that account and target; switching Organization opens its own history and stops the previous stream. Knowledge citations and approval results retain their Organization and revision. Resume an approval from its original workspace: switching target does not transfer or approve it. Knowledge retrieval still excludes unpublished drafts, and device operations keep their existing owner and human-approval requirements.

On Parameter changes (`/parameters`), ask Xiaoze to prepare a change for a specific parameter. Tools that change business data pause for explicit human approval, so the proposal has not yet taken effect. Approval must be given through the card; agreeing in the conversation is not enough.

When Confirm parameter change appears:

1. Check the Project and Parameter identifiers against the object you intended to change.
2. Review Target value, the Change reason when supplied, and any source links. Do not approve an unexplained or incorrectly targeted proposal.
3. Edit Target value if needed. The card submits that edited value with the rest of the proposal; the server validates it in the parameter's source format and rechecks authorization. Project, parameter, and change reason cannot be edited on this card. If those are wrong, reject the proposal and ask for a corrected one.
4. Choose Approve to execute the proposal, or Reject to prevent the write. You may fill in Rejection reason to explain what needs correcting; this field is optional.
5. Check the execution result. Permission, validation, or execution errors can still cause failure after approval. A successful parameter action creates a change request without immediately writing to a device or merging it. Follow it through Change review (`/parameter-review`) if your role permits. See the [parameter-management guide](parameter-management.md) for the full submission and review path.

## Turn a useful answer into a knowledge draft

Ask Xiaoze to prepare a new knowledge draft from the conversation. In the Confirm creation of a knowledge draft card, inspect Draft title, Tags, any Source analysis, and Content preview. The preview may be shortened and may not contain the complete body. Only the title is editable on this card. If the body, tags, or source need changes, reject it and request a revised proposal.

After checking the proposal, choose Approve and inspect the new draft in Knowledge base (`/knowledge`). This action does not change an existing knowledge entry or publish anything automatically. Xiaoze's knowledge retrieval reads only published entries; drafts and archived entries are excluded. A human must publish a draft before it can be retrieved. Authorized administrators can also review the Agent draft publishing queue in Knowledge administration (`/knowledge-admin`). Publishing requires a separate human decision.

Xiaoze's recent log conclusions include the analysis source and reason for degradation. The primary conclusion's summary also flags degradation. If the approved draft cites a degraded log analysis, the platform adds a source notice at the top of the body, identifying rule fallback or early convergence and its limitation. If the body already starts with exactly the same notice, it is not added again. Review the notice and source evidence before publishing. The notice remains editable, and creating and publishing the draft still require separate human decisions.

## Distinguish AI output from its sources

- Assistant answers are labeled Xiaoze, and the chat warns that AI may make mistakes and important decisions need independent verification. Generated explanations need checking and cannot be treated as authoritative engineering decisions.
- When citations are available, Sources appears below the answer. Sources come from tool results, such as parameter records, node snapshots, log conclusions, or published knowledge. A source with a link opens the referenced object; a source without a link is shown as a label. Answers without sources need their evidence checked independently, however confident they sound.
- Knowledge entry details show a revision and a Source label distinguishing Human from Agent. The administrator's Agent draft queue shows the creator, originating session, and associated source analysis when present. Check these alongside the draft content before publishing. The Agent label identifies where the content came from; its quality still needs review.

## Understand who approved and who acted

The approval chain records the human decision and links the action to its session, tool call, and approval. After you approve a Xiaoze action, the audit record still identifies the Agent as its initiator rather than treating it as a direct user action. Authorized administrators can investigate in Audit center (`/audit`).

For the maintained approval and provenance contracts, see [the DB-backed Agent approval decision](../adr/0024-agent-approval-state-is-db-backed.md). Return to the [User Guide](README.md) for other workflows.
