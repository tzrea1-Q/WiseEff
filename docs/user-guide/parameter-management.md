# Manage project parameters

> Chinese: [Chinese](../zh-CN/user-guide/parameter-management.md)

## Who can do this

- Guests (`guest`) can browse parameters and published definitions with `parameter:view`.
- Hardware users, software users, and hardware/software committers can prepare changes with `parameter:edit` and access to the target project. A project must finish initialization before normal changes can be submitted.
- Current parameter-value requests need a software committer bound to that project, or an Organization Admin (`admin`), to review them. The submitter cannot approve their own request. Hardware committers handle hardware review in the separate staged workflow described below.
- Organization Admins manage initialization, imports, project files, config sets, and baselines with `admin:access`. Platform Admin (`platform-admin`) access to admin pages does not by itself grant every project review or merge action; the server checks the relevant role bindings again.

The UI is Chinese-first. The English page names below give the meaning of its labels; use the routes to locate them. [Account and access](account-and-access.md) explains how to obtain a role.

## Find a parameter and compare projects

1. Open **Parameter changes** (`/parameters`) and select the project. **My workbench** (`/parameter-home`) also provides project-scoped work and pending-action entry points.
2. Search the parameter table and narrow the module or importance filters. Open a row's details to inspect its property key, node or configuration instance, current value, definition revision, source location, and history. A shared name alone does not prove two parameters have the same meaning.
3. Open **Cross-project comparison** from the row details, still within `/parameters`. Select the peer configuration instance and compare values and revision information. If editing is permitted, **Use this project configuration in a draft** prepares a change; it does not apply the peer value immediately.

The former **Comparison analysis** page (`/parameter-comparison`) is unavailable. Use row-level comparison instead.

## Prepare and keep a draft

In the current API workbench on **Parameter changes** (`/parameters`), open **Edit**, enter the target value and a reason, then choose **Validate and add to this round**. Validation must succeed before a persisted draft appears in the **Modified this round** tray. Saving a draft does not change the current value or source file. Check any validation diagnostics rather than treating text in the editor as a saved change.

Closing this editor retains its unvalidated text while the workbench remains mounted; **Continue editing** can reopen it. That local text is not a server draft and must not be relied on after a reload or leaving the workbench. Successfully created server drafts can be loaded again. Removing a persisted draft from the tray deletes that draft rather than merely hiding the row.

The older, non-API editor has a distinct explicit **Save draft** action: it copies the edited item into the local round. Closing that editor discards unsaved edits, retaining only the last saved local version. **Stash this round** is separate from saving an editor item; in API-backed persistence it saves pending drafts for later. Do not confuse these older controls with the current API editor's validation action.

## Submit the intended changes

On **Parameter changes** (`/parameters`), select the saved drafts you intend to submit, inspect their targets and reasons, and submit from the round tray. For current parameter values, choose a software reviewer or leave the request in the software review pool. Submission freezes the reviewed targets and source context; drafts are not permission to silently change that context later.

A round groups changes prepared together. Current canonical requests retain their own request and batch identities; they are not converted into the older submission-round records. Node-enablement drafts and canonical parameter-value drafts cannot be submitted together. Separate them, and resolve missing role candidates, stale working revisions, or validation blockers before retrying.

Open **My historical submissions** (`/parameter-submissions`) from the workbench to track your requests. Current requests show pending, approved, rejected, or withdrawn status, the target changes, source evidence, and reviewer notes. A submitter can withdraw a pending request; to continue afterward, prepare and submit a new request.

## Review the right workflow

Open **Change review** (`/parameter-review`), select the project and a pending item, and inspect its type before acting.

### Approve current parameter-value requests

Current software-configuration requests use software review, not an automatic hardware-review → software-review → separate-merge timeline. The project's software committer or Organization Admin checks the frozen value/source difference, affected bindings, reason, and any conflict decision. Approval rechecks the source and commits the reviewed change; there is no additional merge-link step in this panel. A reviewed batch is approved or rejected together. Source drift or inconsistent evidence blocks approval rather than silently retargeting the request.

### Advance staged requests

Node-enablement requests still use the staged workflow. Retained older records can also show these stages, but an archived read-only record is not an actionable current request.

- For hardware review, check hardware conditions, configured values, safety/risk implications, and the submitter's evidence.
- For software review, check implementation/configuration impact, source consistency, and the earlier review.
- For software merge, check completed review requirements and supply a valid HTTP(S) merge link. Merge is a per-request action.

For review and merge eligibility, see the maintained [User Permission Design](../security/user-permission-design.md).

The staged submission selects hardware-review, software-review, and software-merge assignees. Each discipline acts only at its permitted stage. High-risk staged changes require hardware and software review evidence before merge. UI availability alone is not authorization: the server rechecks active roles and project scope.

## Read the timeline and respond to rejection

Use **My historical submissions** (`/parameter-submissions`) for your requests and **Change review** (`/parameter-review`) for review details. Older rounds show selection, target-value preparation, hardware review, software review, and software merge in their timeline. Read the status and reason alongside it: a rejected or withdrawn round is not progressing merely because a stage remains highlighted. Eligible active rounds offer **Withdraw this round**; archived rounds are read-only.

For current requests, use their pending/history entries and reviewer notes rather than expecting the older five-step timeline. If rejected, read the reason, revisit the target and source context on **Parameter changes** (`/parameters`), supply the missing evidence or corrected value, and create a new submission. Withdrawal also requires a new submission to resume work; it does not reopen the old request.

## Understand definitions before governing a project

Open **Parameter definitions** (`/parameters/definitions`) to browse published contracts and revisions. A definition says what a property means; a project binding identifies its actual node or configuration occurrence, and the project value is that occurrence's configured value. Changing a project value does not redefine the shared property contract.

The Catalog is Platform-owned and published as immutable releases. An Organization registers Catalog subjects and places them in its own taxonomy; this is not a private fork of the definition schema. In **Parameter admin** (`/parameter-admin`), **Parameter definition management** (`/parameter-admin/specs`) provides the governance entry point. A proposal or uploaded DTS is not itself a published definition. Follow the maintained [Catalog authoring and publication reference](../design-docs/catalog-authoring-and-publication-control-plane.md) for that separate governed process.

## Initialize or import project parameters

As an Organization Admin, open **Parameter admin** (`/parameter-admin`) and its **Project list** (`/parameter-admin/projects`). Start the project initialization wizard, fill in project identity and owner, select source projects and a primary source when using several, choose the candidate parameters, and submit the snapshot for review. The wizard also supports explicitly starting from an empty library. Submission leaves the project pending review, not initialized. An Admin approves or rejects initialization in **Change review** (`/parameter-review`); approval materializes the selected bindings, while rejection allows the creator to revise. Ordinary parameter submission stays locked until initialization succeeds.

Open **Batch parameter import** in the organization-configuration area of **Parameter admin** (`/parameter-admin`), select the target project and upload or paste JSON, CSV, or DTS content. Inspect the parse report, row decisions and batch preview before confirming. Full DTS is parsed by the server, not guessed locally. A canonical import stages drafts: current values and source files remain unchanged until submission and approval. Read the confirmation/result status; do not equate an import preview with applied values.

For project DTS/JSON source files, open **Configuration workbench** under **Parameter admin** (`/parameter-admin/projects/:projectId/configuration`, replacing `:projectId` with the selected project). Inspect the working source, uploaded candidate, differences, and history. Uploading a file or candidate does not automatically activate it as working configuration; explicitly assign files to a config set and follow the offered review/apply action. JSON source changes also retain their exact source context; they are not free-form edits to the global Catalog.

## Keep working configuration and releases distinct

In **Configuration workbench** (`/parameter-admin/projects/:projectId/configuration`):

- **Config set:** the selected group of member files, with roles and ordering. Working configuration comes from those members' active versions; ungrouped files are outside that set's Working and Release views.
- **Release baseline:** a snapshot pinning member versions. Creating a draft baseline is not publishing it. Check the server's release-readiness summary, resolve blocking issues, and acknowledge required warnings before release. Local unsaved edits or unavailable/stale readiness can block the action.
- **Restore:** preview affected members before restoring a baseline into Working. Restore can create rollback-origin versions; it does not silently replace the released baseline pointer.
- **Conflict:** file content and a UI draft disagree about an intended change. Inspect both sources and choose the file or draft outcome in the conflict task. The choice is retained in the reviewed request; approval refuses drift from that decision.
- **Writeback:** approval/merge writes the reviewed change to its exact project source and preserves version/history evidence. It is not a device write, and does not mean a baseline has been released. If the pinned source no longer matches, resolve the conflict or refresh and resubmit rather than assuming the file was updated.

Older project `/files`, `/config-sets`, `/structure`, and `/conflicts` links redirect to this integrated workbench. See the maintained [configuration workbench reference](../design-docs/2026-08-06-project-configuration-workbench-design.md) for the underlying model, and return to the [User Guide](README.md) for other workflows.
