# Organization administration and governance

> Chinese: [Chinese](../zh-CN/user-guide/organization-and-governance.md)

## Who can do this

Organization Admins (`admin`) and Platform Admins (`platform-admin`) can manage their home Organization and use business consoles within their permissions. Changing member details or the Organization name requires `users:manage`; using Audit center and Feedback management requires `admin:access`. Each business console also checks its own permissions and resource scope. Active, signed-in users, including guests, can send product feedback and view their own feedback.

The other roles are guest, hardware user, software user, hardware committer, and software committer. See [Account and access](account-and-access.md) for registration, password tasks, and access requests. Admin consoles are not the entry point for requesting access.

An Organization represents a company or deployment customer. Departments such as hardware and software do not form separate Organizations. Organization administration manages only your home Organization; it does not create, list, or switch Organizations. Members still need project access separately. Platform Admins cannot freely access other Organizations' business data, but they can review pending registration requests across Organizations.

## Maintain your Organization and members

1. Open Organization management (`/organization`). Check the Organization identifier and display name. To rename it, edit the display name and select Save name. Renaming does not change the Organization's identity or your membership.
2. Open People management (`/organization/members`) and the Account library tab. Search or filter the directory to find the member; check their role and enabled/disabled status before changing anything. Old `/user-permissions` bookmarks resolve to this people-management area.
3. To create a local account, select Add user, enter the name, username, title, initial password and confirmation, and choose the appropriate role. Follow the form's validation and wait for a successful result before handing over the account.
4. To change a member's role or enabled status, use the row control and review the confirmation before submitting. Disabling an account prevents sign-in. Enabling it restores access under its assigned roles without granting extra permissions.

An Organization Admin cannot grant or revoke the Platform Admin role or manage a Platform Admin account through the protected row controls. Only a Platform Admin can perform those privileged operations. You cannot disable or delete your own signed-in account, or remove your own final Admin capability.

If you only need to stop access, disable the account. Delete user is permanent and removes the account's roles, credentials, sessions and temporary data. Retained business and audit history remains, with attribution to the deleted user where applicable. Read the confirmation before proceeding. For password resets, use [Reset a member's local password](account-and-access.md#reset-a-members-local-password).

![Organization member management with seeded accounts](images/organization-and-governance-members.png)

*Seeded member management as an Organization Admin; no role or account is changed.*

## Decide a Committer registration request

In People management (`/organization/members`), switch to Registration requests. Check the applicant's account identifier, current role and requested hardware/software committer role, then choose Approve or Reject.

- Approval assigns the requested Committer role and activates the account. The applicant can then sign in with the original credentials.
- Rejection records the decision but does not activate the account or grant the requested role. A pending Committer account remains inactive after rejection.
- Organization Admins review their own Organization's requests. Platform Admins' queue can include other Organizations. The current queue shows account and role details, not an Organization label; verify the applicant's Organization separately before a cross-Organization decision.

This queue handles self-registration requests; change existing members' roles in Account library. If a request has already been handled or the action fails, refresh and check the result. After choosing Approve, check that approval succeeded.

## Find who changed what, when and why

Open Audit center (`/audit`) to search parameter, log, debugging, Agent and user-governance events. The available records are limited to your Organization.

1. Search for the operation, actor or event type. Narrow by business module, project, time window and severity; the project filter is available when projects are listed.
2. Select an event. Check the actor, occurrence time, operation and target. Review the change summary, before/after values and reason when available; some events do not include these details.
3. Expand technical details if you need object identifiers or the trace identifier. When a trace is present, inspect related events or filter to that trace to check the records for the same operation.
4. Use Load more for additional matches. Export CSV exports matching records in API mode, capped at 2,000 rows; narrow the filters for larger investigations. The CSV contains event identifiers and summary fields, not every detail or reason shown in the event dialog.

If no record appears, check the filters, loading errors and available history before deciding whether an action occurred. For retention policy, see [Audit retention](../security/audit-retention.md).

![Organization audit center search and filters](images/organization-and-governance-audit.png)

*Audit search and filters; no business actions were performed to populate the history for this screenshot.*

## Choose the right console and maintain modules

Organization management and Organization-scoped parameter governance have different entry points. To maintain an asset, start in its business console, then use Audit center (`/audit`) to check the changes recorded across consoles.

| Task | Navigation label and route | What belongs here |
| --- | --- | --- |
| Maintain parameter assets | Parameter admin (`/parameter-admin`); Parameter definition management (`/parameter-admin/specs`); Module management (`/parameter-admin/modules`); Project operations (`/parameter-admin/projects`) | Govern definitions, organize the parameter module tree, and manage projects. See [Parameter management](parameter-management.md) for imports and project workflows. |
| Maintain debugging assets | Debugging admin (`/debugging-admin`); Node debugging area (`/debugging-admin/nodes`) | The default area maintains reload configuration; the node area maintains logical nodes, protocol bindings and the debugging module tree. See [Device debugging](device-debugging.md). |
| Govern log analysis | Log admin (`/log-admin`) | Inspect analysis records and quality, and maintain business domains. Domain governance requires `logs:admin-domains`. See [Log analysis](log-analysis.md). |
| Govern knowledge | Knowledge admin (`/knowledge-admin`) | Review Agent drafts, manage archived entries and inspect index health. Management operations require the knowledge-management capability. See [Knowledge](knowledge.md). |

For parameter modules, open Module management (`/parameter-admin/modules`), expand the tree and check the parent before adding a root or child module. Use the available edit, rename and move controls to adjust the hierarchy. Inspect registered Catalog subjects through their placement controls; changing a classification does not create a new definition. Ordinary modules can be deleted only when they have no children, parameter references or Catalog placements. Read driver-group dissolution warnings separately; do not treat this as deleting an empty category.

For debugging modules, open Debugging admin's Node debugging area (`/debugging-admin/nodes`) and Module management. Add roots or children, rename, or move modules to an allowed parent. Delete only modules without children or node references. The parameter and debugging trees are maintained separately: changing one does not reorganize the other.

## Send product feedback with screenshots

Problem feedback opens a dialog on the current route and has no separate page. Open it from Problem feedback in the navigation or, where available, the page footer. Start from the affected page so the feedback records the correct page title and path.

1. Choose Experience issue, Data issue, Export/submission failure, or Feature suggestion. Describe what you did, what you expected and what happened; a nonblank description is required.
2. Paste optional screenshots from the clipboard into the form. Preview them and remove irrelevant images before submission. The service accepts PNG, JPEG and WebP: up to five images, 5 MiB per image and 15 MiB total. Remove secrets and unrelated personal information before pasting.
3. Submit feedback and wait for confirmation. Save draft keeps an unfinished report for later submission. If you close the dialog with unsent edits, the app asks whether to discard them.
4. Open My feedback in the same dialog to revisit drafts or check submitted records, attachments, status and public progress. Internal admin notes are not part of the submitter's view.

Admins use Feedback management (`/feedback-admin`) to search or filter reports by status and type, inspect descriptions and screenshots, and record progress. They can start handling a report, mark it resolved after entering a resolution and public explanation, or confirm closure. Resolved reports can be reopened with a reason; closed reports are read-only. Distinguish public progress from internal notes when recording an update. Product feedback and ratings of log-analysis results use separate workflows.
