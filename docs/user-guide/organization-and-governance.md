# Organization administration and governance

> Chinese: [Chinese](../zh-CN/user-guide/organization-and-governance.md)

## Who can do this

Organization Admins (`admin`) and Platform Admins (`platform-admin`) manage their home Organization and business consoles within their permissions. Member and Organization-name changes require `users:manage`; Audit center and Feedback management require `admin:access`. Business consoles also enforce their own permissions and resource scope; Platform console is restricted to Platform Admins. An active, signed-in user of any role, including guest, can send product feedback and view their own feedback.

The other roles are guest, hardware user, software user, hardware committer, and software committer. See [Account and access](account-and-access.md) for registration and password tasks rather than using an admin console to request access.

An Organization is one company or deployment customer's boundary, not a hardware/software department. Organization administration manages your home Organization; it does not create, list, or switch Organizations, and membership is not project access. Platform Admin status does not grant unrestricted access to other Organizations' business data. The registration-request queue is an explicit exception: Platform Admins can review pending requests across Organizations.

## Maintain your Organization and members

1. Open Organization management (`/organization`). Check the Organization identifier and display name. To rename it, edit the display name and select Save name. This changes the label, not the Organization's identity or your membership.
2. Open People management (`/organization/members`) and the Account library tab. Search or filter the directory to find the member; check their role and enabled/disabled status before changing anything. Old `/user-permissions` bookmarks resolve to this people-management area.
3. To create a local account, select Add user, enter the name, username, title, initial password and confirmation, and choose the appropriate role. Follow the form's validation and wait for a successful result before handing over the account.
4. To change a member's role or enabled status, use the row control, review the confirmation, and confirm the intended change. Disabling an account prevents sign-in; enabling it restores access under its assigned roles, not extra permissions.

An Organization Admin cannot grant or revoke the Platform Admin role or manage a Platform Admin account through the protected row controls. Only a Platform Admin can perform those privileged operations. You cannot disable or delete your own signed-in account, or remove your own final Admin capability.

Prefer disabling an account when access needs to stop without destroying the account. Delete user is permanent: the account's roles, credentials, sessions and temporary data are removed; retained business and audit history remains, with deleted-user attribution where applicable. Read the confirmation before proceeding. For password resets, use [Reset a member's local password](account-and-access.md#reset-a-members-local-password).

## Decide a Committer registration request

In People management (`/organization/members`), switch to Registration requests. Check the applicant's account identifier, current role and requested hardware/software committer role, then choose Approve or Reject.

- Approval assigns the requested Committer role and activates the account. The applicant can then sign in with the original credentials.
- Rejection records the decision but does not activate the account or grant the requested role. A pending Committer account remains inactive after rejection.
- Organization Admins review their own Organization's requests. Platform Admins' queue can include other Organizations. The current queue shows account and role details, not an Organization label; verify the applicant's Organization separately before a cross-Organization decision.

This queue handles self-registration requests; changing an existing member's role is a separate Account library operation. If a request was already decided or the action fails, refresh and check the resulting state rather than assuming approval succeeded.

## Find who changed what, when and why

Open Audit center (`/audit`). It searches your Organization's parameter, log, debugging, Agent and user-governance events; it is not a cross-Organization audit browser.

1. Search for the operation, actor or event type. Narrow by business module, project, time window and severity; the project filter is available when projects are listed.
2. Select an event. Check the actor, occurrence time, operation and target. Inspect the change summary and before/after values or reason **when the event provides them**. Not every event contains a reason or a value diff.
3. Expand technical details if you need object identifiers or the trace identifier. When a trace is present, inspect related events or filter to that trace to follow one correlated operation.
4. Use Load more for additional matches. Export CSV exports matching records in API mode, capped at 2,000 rows; narrow the filters for larger investigations. The CSV contains event identifiers and summary fields, not every detail or reason shown in the event dialog.

Absence of a match is not proof that no action occurred: check filters, loading errors and the available history. For retention policy, see [Audit retention](../security/audit-retention.md).

## Choose the right console and maintain modules

Organization management is separate from Organization-scoped parameter governance. Start in the console that owns the asset, then use Audit center (`/audit`) to correlate recorded changes across consoles.

| Task | Navigation label and route | What belongs here |
| --- | --- | --- |
| Maintain parameter assets | Parameter admin (`/parameter-admin`); Parameter definition management (`/parameter-admin/specs`); Module management (`/parameter-admin/modules`); Project operations (`/parameter-admin/projects`) | Govern definitions, organize the parameter module tree, and manage projects. See [Parameter management](parameter-management.md) for imports and project workflows. |
| Maintain debugging assets | Debugging admin (`/debugging-admin`); Node debugging area (`/debugging-admin/nodes`) | The default area maintains reload configuration; the node area maintains logical nodes, protocol bindings and the debugging module tree. See [Device debugging](device-debugging.md). |
| Govern log analysis | Log admin (`/log-admin`) | Inspect analysis records and quality, and maintain business domains. Domain governance requires `logs:admin-domains`. See [Log analysis](log-analysis.md). |
| Govern knowledge | Knowledge admin (`/knowledge-admin`) | Review Agent drafts, manage archived entries and inspect index health. Management operations require the knowledge-management capability. See [Knowledge](knowledge.md). |
| Operate Platform-owned assets | Platform console (`/platform-console`) | A separate Platform Admin surface, not an Organization switcher or a replacement for these business consoles. |

For parameter modules, open Module management (`/parameter-admin/modules`), expand the tree and select the appropriate parent before adding a root or child module. Use the available rename/edit and move controls to maintain the hierarchy; inspect registered Catalog subjects through their placement controls rather than treating a classification change as a new definition. Deletion is not a general cleanup tool: ordinary modules with children, parameter references or Catalog placements cannot be deleted. Read any driver-group dissolution warning separately; it is not the same operation as deleting an empty category.

For debugging modules, open Debugging admin's Node debugging area (`/debugging-admin/nodes`) and Module management. Add roots or children, rename, or move modules to an allowed parent. Delete only modules without children or node references. The parameter and debugging trees are maintained separately: changing one does not reorganize the other.

## Send product feedback with screenshots

Problem feedback is a dialog on the **current route**, not a separate feedback page. Open it from the navigation's Problem feedback action or, where present, the page footer. Start from the affected page so the captured page title and path identify the right context.

1. Choose Experience issue, Data issue, Export/submission failure, or Feature suggestion. Describe what you did, what you expected and what happened; a nonblank description is required.
2. Paste optional screenshots from the clipboard into the form. Preview them and remove irrelevant images before submission. The service accepts PNG, JPEG and WebP: up to five images, 5 MiB per image and 15 MiB total. Remove secrets and unrelated personal information before pasting.
3. Submit feedback and wait for confirmation. Save draft keeps an unfinished report for later; it is not submission. Closing a dirty composer asks whether to discard unsent edits.
4. Open My feedback in the same dialog to revisit drafts or check submitted records, attachments, status and public progress. Internal admin notes are not part of the submitter's view.

Admins use Feedback management (`/feedback-admin`) to filter reports by status/type or search, inspect the description and screenshots, and record progress. They can start handling a report, mark it resolved with a resolution and public explanation, or confirm closure; resolved reports can be reopened with a reason, while closed reports are read-only. Distinguish public progress from internal notes when recording an update. Product feedback is separate from rating a log-analysis result.
