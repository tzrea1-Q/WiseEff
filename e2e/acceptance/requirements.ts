export type AcceptanceWorkflowId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

export type AcceptanceRequirement = {
  id: string;
  workflow: AcceptanceWorkflowId;
  title: string;
  required: boolean;
};

export const acceptanceRequirements: AcceptanceRequirement[] = [
  {
    id: "AUTH-RUNTIME-001",
    workflow: "A",
    title: "API-mode browser runtime loads current user with the same auth contract used by local dev.",
    required: true
  },
  {
    id: "AUTH-LOCAL-PASSWORD-001",
    workflow: "A",
    title:
      "A signed-in local user changes their password from the profile dialog; the current session stays active and other sessions are revoked.",
    required: false
  },
  {
    id: "AUTH-LOCAL-ADMIN-RESET-001",
    workflow: "A",
    title: "An Admin resets a member password from /organization/members; every session for that user is revoked.",
    required: false
  },
  {
    id: "AUTH-LOCAL-SELF-REGISTER-001",
    workflow: "A",
    title: "When self-registration is disabled, the auth screen hides Register and the API rejects POST /api/v1/auth/register.",
    required: false
  },
  {
    id: "AUTH-LOCAL-BOOTSTRAP-HINT-001",
    workflow: "A",
    title: "When no local Admin exists, the auth screen shows the npm run admin:bootstrap hint.",
    required: false
  },
  {
    id: "NOTIF-INBOX-001",
    workflow: "A",
    title: "TopBar notification bell opens the inbox panel and inbox APIs load for the current user.",
    required: true
  },
  {
    id: "NOTIF-READ-001",
    workflow: "A",
    title: "Notifications can be marked read through the backend inbox API.",
    required: true
  },
  {
    id: "PFB-SUBMIT-001",
    workflow: "I",
    title: "Active user submits product feedback from the sidebar with description and optional images; API persists it and the UI shows success.",
    required: true
  },
  {
    id: "PFB-ADMIN-001",
    workflow: "I",
    title: "Admin lists product feedback, opens detail, advances open to in_progress to closed, and sets an admin note.",
    required: true
  },
  {
    id: "PFB-AUTHZ-001",
    workflow: "I",
    title: "Non-Admin users cannot access product feedback admin APIs or the feedback-admin page.",
    required: true
  },
  {
    id: "KB-READ-001",
    workflow: "J",
    title: "Org member lists knowledge entries, searches published entries only, and reads a published entry detail.",
    required: true
  },
  {
    id: "KB-EDIT-001",
    workflow: "J",
    title: "Editor creates a markdown knowledge entry, publishes it, revises it in place with a new immutable revision, and restores a prior revision as a new revision.",
    required: true
  },
  {
    id: "KB-FILE-001",
    workflow: "J",
    title: "Editor uploads a file knowledge entry through the object store and sees its text-extraction status on the entry.",
    required: true
  },
  {
    id: "KB-ASK-001",
    workflow: "J",
    title:
      "Org member asks the knowledge base from /knowledge (API mode only): the entry point opens Xiaoze, and a deterministic Xiaoze run grounds the answer via knowledge.search with a citation deep link to the published entry.",
    required: true
  },
  {
    id: "KB-INDEX-001",
    workflow: "J",
    title:
      "Knowledge admin sees per-entry retrieval index health (status, failure reason, indexed revision) with the honest retrieval-mode banner on /knowledge-admin, and can retry one entry or rebuild the whole index.",
    required: true
  },
  {
    id: "KB-DISTILL-001",
    workflow: "J",
    title:
      "Editor distils a completed log-analysis conclusion into a pre-filled knowledge draft from the log result page, lands in the /knowledge draft editor via the entry deep link, and publishes the reviewed draft with source linkage and audit evidence.",
    required: true
  },
  {
    id: "KB-DISTILL-002",
    workflow: "J",
    title:
      "Editor distils a terminal DTS reload run (behaviourally verified / unverifiable / contradicted / failed) into a pre-filled knowledge draft from the /dts-reload run history/detail surface with the run outcome stated honestly, lands in the /knowledge draft editor via the entry deep link, and publishes the reviewed draft with reload-run source linkage and audit evidence.",
    required: true
  },
  {
    id: "KB-ADMIN-001",
    workflow: "J",
    title:
      "An agent knowledge draft created through the approval-gated action.createKnowledgeDraft tool (deterministic Xiaoze interrupt, then approve) lands in the /knowledge-admin agent-draft publish queue with creator, session origin, and source analysis link; a reviewer publishes one draft and archive-rejects another, and drafts stay out of retrieval until published.",
    required: true
  },
  {
    id: "KB-REC-001",
    workflow: "J",
    title:
      "A completed log-analysis record shows a related-knowledge section derived from its stored conclusion/impact text: related published entries appear with a citation deep link into /knowledge, draft and archived entries never appear, and the section reports the retrieval mode that actually ran.",
    required: true
  },
  {
    id: "KB-XREF-001",
    workflow: "J",
    title:
      "An editor manages structural parameter-definition references on a knowledge entry (audited add/remove bound to the parameter_specs.id surrogate); the definition detail's related-knowledge list shows the published referencing entry while draft entries never appear there, and deprecating the definition keeps the knowledge-side chip with an honest deprecated badge.",
    required: true
  },
  {
    id: "SHELL-DIAG-001",
    workflow: "A",
    title: "Core routes fail acceptance on unexpected console, page, request, or critical API errors.",
    required: true
  },
  {
    id: "SHELL-FOOTER-001",
    workflow: "A",
    title:
      "Included routes expose one page-ending footer with current-page feedback; the homepage does not duplicate its footer, approved contact protocols remain safe, and auth/bootstrap/error/download/full-height-workbench exclusions stay unchanged.",
    required: true
  },
  {
    id: "SHELL-DISCOVERY-001",
    workflow: "A",
    title: "Sidebar and homepage discovery surfaces offer only allowlisted workflows; hidden workflows remain deep-linkable.",
    required: false
  },
  {
    id: "PARAM-REASON-001",
    workflow: "B",
    title: "Parameter drafts cannot be submitted with an empty or blank reason.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-001",
    workflow: "B",
    title: "Parameter submission defaults to eligible assignees for every workflow slot.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-002",
    workflow: "B",
    title: "Parameter submission dropdowns hide inactive, guest, admin-only, and role-ineligible users.",
    required: true
  },
  {
    id: "PARAM-ASSIGNEE-003",
    workflow: "B",
    title: "Forced invalid workflow assignees are rejected by the API and surfaced by the UI.",
    required: true
  },
  {
    id: "PARAM-HAPPY-001",
    workflow: "B",
    title: "Parameter search, draft, submit, review, merge, persistence, and audit happy path works.",
    required: true
  },
  {
    id: "PARAM-HOME-001",
    workflow: "B",
    title: "Parameter home dashboard loads summary and hotspots from API data and supports in-page window and dimension controls.",
    required: true
  },
  {
    id: "PARAM-ADMIN-001",
    workflow: "C",
    title: "Parameter admin import preview and audit drawer remain available to Admin.",
    required: true
  },
  {
    id: "PARAM-ADMIN-002",
    workflow: "C",
    title: "Admin can run the five-step parameter import wizard with target project selection, multi-format source, per-row review, batch preview, and apply.",
    required: false
  },
  {
    id: "PARAM-ADMIN-003",
    workflow: "C",
    title:
      "Admin project list preserves q/status/sort through reload and browser history, supports pagination and keyboard-isolated row actions, and renders complete 390px cards, a 768px scroll table with a visible rail, and a non-overflowing 1440px table.",
    required: false
  },
  {
    id: "PARAM-INIT-WIZARD-001",
    workflow: "C",
    title: "Creator completes project parameter initialization with sources and selection and reaches pending review.",
    required: false
  },
  {
    id: "PARAM-INIT-EMPTY-001",
    workflow: "C",
    title: "Explicit empty-library initialization can be approved to initialized with zero bindings.",
    required: false
  },
  {
    id: "PARAM-INIT-REVIEW-001",
    workflow: "C",
    title: "Admin approves an initialization review; the project unlocks and bindings match the snapshot.",
    required: false
  },
  {
    id: "PARAM-INIT-REJECT-001",
    workflow: "C",
    title: "Admin rejects initialization with a reason; the creator can revise and resubmit.",
    required: false
  },
  {
    id: "PARAM-INIT-LOCK-001",
    workflow: "C",
    title: "Non-initialized projects cannot submit normal typed binding change rounds.",
    required: false
  },
  {
    id: "PROJ-OPS-001",
    workflow: "C",
    title: "Superseded by PROJ-CONFIG-CUTOVER-001: legacy project-operation deep links redirect to equivalent configuration-workbench contexts; unknown project ids show not-found.",
    required: false
  },
  {
    id: "PROJ-OPS-002",
    workflow: "C",
    title: "Superseded by PROJ-CONFIG-READ-001 / PROJ-CONFIG-CUTOVER-001: three-viewport configuration workbench layout without clipping or page-level horizontal overflow.",
    required: false
  },
  {
    id: "PROJ-OPS-003",
    workflow: "C",
    title: "Superseded by PROJ-CONFIG-BASELINE-001 / PROJ-CONFIG-OPS-001 / PROJ-CONFIG-CONFLICT-001: baseline, membership, and conflict confirmations in workbench source context.",
    required: false
  },
  {
    id: "PROJ-CONFIG-READ-001",
    workflow: "C",
    title: "The canonical project configuration route resolves Config-set context and reads active member DTS source in source-dominant and responsive layouts.",
    required: false
  },
  {
    id: "PROJ-CONFIG-SOURCE-001",
    workflow: "C",
    title: "Source-located configuration workbench navigation exposes structural spans, unified search grouped by file, URL deep links, scroll sync, and independent structure/source retries.",
    required: false
  },
  {
    id: "PROJ-CONFIG-INSPECT-001",
    workflow: "C",
    title: "Context inspector and file-history source modes provide leveled inspection, immutable history download, labeled read-only canvas modes with restore, and PCW-D15 overlay persistence.",
    required: false
  },
  {
    id: "PROJ-CONFIG-CANDIDATE-001",
    workflow: "C",
    title: "Candidate file version upload, impact review, parse-failure diagnostics, and abandon leave Working configuration and Config set membership unchanged.",
    required: false
  },
  {
    id: "PROJ-CONFIG-EDIT-001",
    workflow: "C",
    title: "Structured DTS edit sessions in the configuration workbench open a typed property editor, accumulate session changes with shared markers, and validate/submit selected edits through the existing change-request flow while the source canvas stays read-only.",
    required: false
  },
  {
    id: "PROJ-CONFIG-DRAFT-001",
    workflow: "C",
    title: "Recoverable configuration-workbench session drafts are scoped by user/org/project/config/file/base, restore after reload when the base matches, remain inspectable but block validate/submit when the base is stale, clear on logout, and prove cross-user isolation in component tests where full browser coverage is heavy.",
    required: false
  },
  {
    id: "PROJ-CONFIG-ACTIVITY-001",
    workflow: "C",
    title: "Contextual Activity inspector replaces permanent audit banner: scoped server audit projection, product-language events, target restore, toast + refresh, and resilient loading states.",
    required: false
  },
  {
    id: "PROJ-CONFIG-ACTIVATE-001",
    workflow: "C",
    title: "Candidate activation with expected-current-version CAS, new-file Config set/role intent, stale-base safety, impact confirmation, and Working configuration promotion.",
    required: false
  },
  {
    id: "PROJ-CONFIG-OPS-001",
    workflow: "C",
    title: "Admin creates and configures Config sets, adds or removes members with role and order plus blast-radius confirmation, sees ungrouped files outside Working/Release, runs manual sync with task evidence, exports from the command context, and empty sets show a focused upload/assignment path without auto-activation; non-admin denial keeps read context.",
    required: false
  },

  {
    id: "PROJ-CONFIG-CONFLICT-001",
    workflow: "C",
    title: "Source-located three-way conflict arbitration in the project configuration workbench: equal-weight file and UI outcomes with confirm plus optional audit reason, queue advance in source context, eligible bulk resolve with impact preview, open conflicts block candidate activation, and an empty queue keeps the Conflicts dock collapsed.",
    required: false
  },
  {
    id: "PROJ-CONFIG-READINESS-001",
    workflow: "C",
    title: "Server-owned release readiness for the selected Config set: command-bar summary, Issues task dock with ordered blockers/warnings and remediation locators, fail-closed baseline create/release when blocked/unavailable/stale or local session dirty, and no client-side reconstruction of release permission from unrelated counts.",
    required: false
  },
  {
    id: "PROJ-CONFIG-BASELINE-001",
    workflow: "C",
    title: "Release baseline create/compare/release/restore in source context: snapshot without mutating files, readiness-gated create/release, draft/released/historical identities, unified or side-by-side compare with Working position restore, warning acknowledgement, impact release with audit and drift refresh, restore preview and atomic apply leaving released tip unchanged.",
    required: false
  },
  {
    id: "PROJ-CONFIG-REVISION-GATE-001",
    workflow: "C",
    title:
      "Admin lists real project config revisions for the selected config set through the topology seam, selects a listed id (never an invented teaching fallback), runs revision validation, and when the run reports requiresConfirmation must acknowledge that risk in the baseline-release ConfirmDialog.",
    required: false
  },
  {
    id: "PROJ-CONFIG-CUTOVER-001",
    workflow: "C",
    title: "Legacy project-operation routes redirect to canonical configuration-workbench contexts with preserved focus; new links use only /configuration; three viewports prove integrated cutover.",
    required: false
  },

  {
    id: "PARAM-ADMIN-DIALOG-001",
    workflow: "C",
    title: "Param-admin dialogs trap focus, restore focus to the trigger, close only the top-most dialog on Escape, ignore press-inside/release-outside, and keep their styling through the portal.",
    required: false
  },
  {
    id: "PARAM-ADMIN-IA-001",
    workflow: "C",
    title: "Organization admin offers definition management and module management peers; review embeds under specs; identity mapping nests with legacy redirects.",
    required: false
  },
  {
    id: "PARAM-IMPORT-DTS-FULL-001",
    workflow: "C",
    title: "Admin full .dts import uses server parse-dts with distinct @address module paths; /include/ is rejected.",
    required: true
  },
  {
    id: "PARAM-IMPORT-REVIEW-META-001",
    workflow: "C",
    title: "Import preview with reviewMetadata.skippedRows persists that structure on batch-import audit metadata.",
    required: true
  },
  {
    id: "PARAM-DRAFT-EDIT-001",
    workflow: "B",
    title: "Parameter draft edit and remove operations work before final submission.",
    required: true
  },
  {
    id: "PARAM-REJECT-001",
    workflow: "B",
    title: "Parameter rejection records status, reason, and audit evidence.",
    required: true
  },
  {
    id: "LOG-HAPPY-001",
    workflow: "D",
    title: "Log upload, analysis progress, evidence, feedback, archive, and unsupported-file path work.",
    required: true
  },
  {
    id: "LOG-CONFIDENCE-PERCENT-001",
    workflow: "D",
    title: "AI confidence renders as a percentage (e.g. 85%), never as a raw 0-1 fraction with a percent sign.",
    required: true
  },
  {
    id: "LOG-REANALYZE-001",
    workflow: "D",
    title: "Log reanalysis creates a new run with progress and audit evidence.",
    required: true
  },
  {
    id: "LOG-DOMAIN-001",
    workflow: "D",
    title: "Admin registers a log domain in /log-admin and an upload binds to it end to end.",
    required: true
  },
  {
    id: "LOG-DEGRADED-001",
    workflow: "D",
    title: "A degraded analysis (rules fallback) is visibly marked with its provenance and reason.",
    required: true
  },
  {
    id: "LOG-DOMAIN-KNOWLEDGE-001",
    workflow: "D",
    title: "Admin links published knowledge entries to a log domain in /log-admin; only published entries are selectable and the link set is audited.",
    required: true
  },
  {
    id: "LOG-FEEDBACK-INSIGHTS-001",
    workflow: "D",
    title: "The /log-admin analysis-quality section aggregates log feedback helpful rate per domain, analysis source, and prompt version over the selected time window.",
    required: true
  },
  {
    id: "LOG-EVAL-DRAFT-001",
    workflow: "D",
    title: "Admin exports an eval-case annotation draft (case.yaml with deIdentified: false + log.txt) from a completed log record with the de-identification checklist shown.",
    required: true
  },
  {
    id: "LOG-ARCHIVE-UPLOAD-001",
    workflow: "D",
    title: "A .gz log upload is unpacked server-side and completes analysis end to end like a plain text upload.",
    required: true
  },
  {
    id: "LOG-DOMAIN-WEBHOOK-001",
    workflow: "D",
    title:
      "Admin configures a domain result webhook in /log-admin (write-only secret, audited); a domain-bound analysis delivers a signed payload to the receiver and the recent-deliveries list shows the attempt.",
    required: true
  },
  {
    id: "LOG-DOMAIN-MODEL-001",
    workflow: "D",
    title:
      "Admin sets a per-domain model override in /log-admin; the override persists on the domain and is recorded as the report's model provenance for analyses bound to that domain.",
    required: true
  },
  {
    id: "DEBUG-SIM-001",
    workflow: "E",
    title: "Simulator read, write, mismatch, rollback, and audit path work, including complex JSON value metadata.",
    required: true
  },
  {
    id: "DEBUG-PERM-001",
    workflow: "E",
    title: "Debugging write controls are hidden or blocked for roles without write permission.",
    required: true
  },
  {
    id: "DEBUG-ADMIN-001",
    workflow: "E",
    title: "Debugging admin governs the logical-node catalog in API mode: create, edit, disable/re-enable, protocol-bind, cascade-delete node history, export, and import through production APIs with database and audit evidence.",
    required: true
  },
  {
    id: "BRIDGE-WIN-001",
    workflow: "E",
    title: "Windows-first local bridge panel covers missing/pairing/startup/online states with same-origin download CTA.",
    required: false
  },
  {
    id: "BRIDGE-HDC-001",
    workflow: "E",
    title: "Real paired bridge HDC detect smoke runs when DEVICE_BRIDGE_HDC_AVAILABLE is enabled.",
    required: false
  },
  {
    id: "DTS-RELOAD-DEPLOY-001",
    workflow: "E",
    title: "Validated reload overlay deploys through a fake local device bridge (mount, pushFile, trigger) to unverifiable.",
    required: true
  },
  {
    id: "DTS-RELOAD-KERNEL-001",
    workflow: "E",
    title: "Kernel log capture after reload trigger stays unjudged evidence and does not change run status.",
    required: true
  },
  {
    id: "DTS-RELOAD-VERIFY-001",
    workflow: "E",
    title: "After successful trigger, bound parameters are read via debug.readNode; run graduates to verified/contradicted or stays unverifiable.",
    required: true
  },
  {
    id: "DTS-RELOAD-RESIDUE-001",
    workflow: "E",
    title: "After a post-device-write reload terminal, residue is recorded for the device; restore-baseline starts a compensating run that clears residue only on success.",
    required: true
  },
  {
    id: "DTS-RELOAD-DEPLOY-HW-001",
    workflow: "E",
    title: "Reload overlay deploy to a real HDC target through a paired local device bridge when lab env is enabled.",
    required: false
  },
  {
    id: "DTS-RELOAD-HANDOFF-001",
    workflow: "E",
    title: "Parameter workbench carries a selected binding set into /dts-reload via project and bindingIds query so the engineer does not re-search.",
    required: false
  },
  {
    id: "DTS-RELOAD-PROMOTE-001",
    workflow: "E",
    title: "A verified or acknowledged-unverifiable ordinary reload run can promote selected stored debug values into parameter drafts without creating a change request.",
    required: false
  },
  {
    id: "HDC-LAB-001",
    workflow: "F",
    title: "Real HDC device lab read/write smoke runs when explicitly enabled.",
    required: false
  },
  {
    id: "ADB-LAB-001",
    workflow: "F",
    title: "Real ADB device lab read-only smoke runs when explicitly enabled, with optional write and rollback.",
    required: false
  },
  {
    id: "XIAOZE-PERCEPTION-001",
    workflow: "G",
    title: "Xiaoze answers grounded read-only questions using page context and perception tools.",
    required: true
  },
  {
    id: "XIAOZE-PERCEPTION-AUTHZ-001",
    workflow: "G",
    title: "Out-of-scope Xiaoze questions return a safe non-data answer.",
    required: true
  },
  {
    id: "XIAOZE-POPUP-MOVE-001",
    workflow: "G",
    title: "Desktop and tablet users can drag the Xiaoze launcher; while open, the launcher and modeless popup move together, remain resizable and restorable, and coexist with page navigation; mobile remains full screen.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-APPROVE-001",
    workflow: "G",
    title: "Xiaoze parameter change approval executes through the agent audit chain.",
    required: true
  },
  {
    id: "XIAOZE-APPROVAL-CARD-001",
    workflow: "G",
    title: "The browser approval card is clickable above the open chat: approving resolves the interrupt without closing the chat.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-EDITEDARGS-001",
    workflow: "G",
    title: "Approving a Xiaoze action with edited arguments executes the edited payload into the change request.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-REJECT-001",
    workflow: "G",
    title: "Rejecting a Xiaoze action approval does not mutate parameter state.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-AUTHZ-001",
    workflow: "G",
    title: "Users without edit permission cannot approve Xiaoze mutating actions.",
    required: true
  },
  {
    id: "XIAOZE-ACTION-RESUME-001",
    workflow: "G",
    title: "Xiaoze AG-UI native resume continues an approved mutating action without reopening a change request.",
    required: true
  },
  {
    id: "XIAOZE-APPROVAL-EXEC-FAIL-001",
    workflow: "G",
    title: "When approved Xiaoze tool execution fails, the chat shows a Chinese assistant failure turn and the thread stays usable.",
    required: false
  },
  {
    id: "XIAOZE-PLAN-MULTISTEP-001",
    workflow: "G",
    title: "Xiaoze resumes a multi-step plan after approval and reports the observed execution result.",
    required: true
  },
  {
    id: "XIAOZE-PROACTIVE-001",
    workflow: "G",
    title: "Opt-in Xiaoze proactive suggestions are read-only, authz-bounded, and absent when disabled.",
    required: true
  },
  {
    id: "PERM-GOV-001",
    workflow: "H",
    title: "User governance page is Admin-only and active Admin cannot disable itself.",
    required: true
  },
  {
    id: "PERM-MATRIX-001",
    workflow: "H",
    title: "Role inclusion rules are enforced for visible UI operations.",
    required: true
  },
  {
    id: "PERM-MATRIX-002",
    workflow: "H",
    title: "Role inclusion and project-scoped workflow eligibility are enforced by API-backed operations.",
    required: true
  },
  {
    id: "PERM-USER-MGMT-001",
    workflow: "H",
    title: "Admin user-management mutation is covered with non-Admin denial and audit evidence.",
    required: true
  },
  {
    id: "ORG-ADMIN-RENAME-001",
    workflow: "H",
    title: "Admin can rename the home organization with audit evidence, and non-Admin rename is rejected.",
    required: true
  },
  {
    id: "MOD-TREE-PARAM-001",
    workflow: "C",
    title: "Admin creates nested parameter modules, assigns a parameter, and parent filtering includes the child subtree.",
    required: true
  },
  {
    id: "MOD-TREE-PARAM-002",
    workflow: "C",
    title: "Admin moves a parameter module to a new parent and cycle moves are rejected.",
    required: true
  },
  {
    id: "MOD-TREE-DEBUG-001",
    workflow: "E",
    title: "Admin creates nested debug node modules and parent filtering includes assigned child nodes.",
    required: true
  },
  {
    id: "MOD-TREE-AUTHZ-001",
    workflow: "C",
    title: "Non-admin cannot mutate module trees and deleting non-empty modules returns 409.",
    required: true
  },
  {
    id: "PARAM-FILE-ADMIN-001",
    workflow: "C",
    title: "Admin uploads a project parameter file, lists versions, and manual sync creates a file_sync draft with source binding.",
    required: true
  },
  {
    id: "PARAM-FILE-CONFLICT-001",
    workflow: "C",
    title: "Admin resolves an open file/UI draft conflict by keeping the file or UI value.",
    required: true
  },
  {
    id: "PARAM-FILE-ROLLBACK-001",
    workflow: "C",
    title:
      "Admin restores a historical parameter-file version as current by inserting a new origin=rollback pointer version (history is not rewound) and sees the operator display name on the version list.",
    required: false
  },
  {
    id: "PARAM-DTS-STRUCTURE-001",
    workflow: "C",
    title: "Admin can read the structured DTS model (nodes/properties/phandles) for a file version.",
    required: true
  },
  {
    id: "PARAM-DTS-EDIT-001",
    workflow: "C",
    title: "Structured value editor contract is served by typed structure properties (value_type / rawText).",
    required: true
  },
  {
    id: "PARAM-DTS-EDIT-002",
    workflow: "C",
    title: "Structured edit submits a change request with rawText fidelity, advances review to merge, and CST writeback preserves rawText (no normalized rewrite).",
    required: true
  },
  {
    id: "PARAM-DTS-CONFIGSET-001",
    workflow: "C",
    title: "Admin can manage config sets and release baselines from the projects file dialog (workflow C).",
    required: true
  },
  {
    id: "PARAM-DTS-DIFF-001",
    workflow: "C",
    title: "Baseline compare returns structured diffs that render as a change-set view.",
    required: true
  },
  {
    id: "PARAM-DTS-SEARCH-001",
    workflow: "C",
    title: "Project DTS structured search returns hits by path/address/label/compatible/value and the search panel mounts.",
    required: true
  },
  {
    id: "PARAM-DTS-IMPACT-001",
    workflow: "B",
    title: "Change-request impact includes structural kinds (phandle/compatible/config-set) when DTS bindings exist.",
    required: true
  },
  {
    id: "PARAM-DTS-RBAC-001",
    workflow: "C",
    title: "Sensitive-node writes without parameter:edit-critical return 403; agent writes to critical nodes are denied.",
    required: true
  },
  {
    id: "PARAM-SPEC-GOVERN-001",
    workflow: "C",
    title: "Admin can search parameter specs, open detail, and resolve inference review tasks with audit evidence.",
    required: true
  },
  {
    id: "PARAM-SPEC-EDIT-001",
    workflow: "C",
    title: "Admin edits units, constraints, example value, and documentation on an active definition; save then reopen round-trips every value, including constraint-key removal and clearing units.",
    required: false
  },
  {
    id: "PARAM-SPEC-EDIT-002",
    workflow: "C",
    title: "The spec editor actions stay reachable and operable at 1440×900 / 768×1024 / 390×844 with the Xiaoze FAB present; focus enters the dialog on open and returns to the trigger on close.",
    required: false
  },
  {
    id: "PARAM-SPEC-IDENTITY-001",
    workflow: "C",
    title: "Admin corrects a definition's attribution subject from the library; the declared subject updates on reopen; lifecycle and reference count are kept; no second definition appears for the same property.",
    required: false
  },
  {
    id: "PARAM-SPEC-IDENTITY-002",
    workflow: "C",
    title: "A property-key rename is offered on a zero-reference definition and refused with a stated reason on a referenced one; a correction that collides with an existing (including deprecated) definition surfaces the blocker.",
    required: false
  },
  {
    id: "PARAM-TOPOLOGY-BROWSE-001",
    workflow: "B",
    title: "Users can toggle source/effective topology, search two gpio_int bindings, and open binding detail without path-as-identity.",
    required: true
  },
  {
    id: "PARAM-TOPOLOGY-EDIT-001",
    workflow: "B",
    title: "Typed binding edits surface schema diagnostics and reject stale base-revision edits.",
    required: true
  },
  {
    id: "PARAM-DRAFT-REMOVE-001",
    workflow: "B",
    title: "Removing a draft from the tray deletes it on the server: it stays gone after a page reload.",
    required: true
  },
  {
    id: "PARAM-IDENTITY-MAP-001",
    workflow: "B",
    title: "Unresolved overlay targets and open identity mapping tasks block publish until resolved.",
    required: true
  },
  {
    id: "PARAM-IDENTITY-MAP-ADMIN-001",
    workflow: "B",
    title:
      "Admin resolves identity mapping tasks and safely corrects an applied choice through protected re-resolve with evidence and governance audit.",
    required: true
  },
  {
    id: "PARAM-CONFIG-PUBLISH-GATE-001",
    workflow: "B",
    title: "Publish is blocked by compiler/edit diagnostics; clean revisions validate/publish with audit and semantic persistence after reload.",
    required: true
  },
  // Remaining MOD-ATTR / DRV-* IDs stay required: false until their
  // `@acceptance-planned` stubs become runnable. PARAM-ENABLE-* are automated.
  {
    id: "PARAM-ENABLE-GATE-001",
    workflow: "B",
    title: "Structural properties do not create spec review tasks or block candidate promotion or migration finalize.",
    required: true
  },
  {
    id: "PARAM-ENABLE-VISIBLE-001",
    workflow: "B",
    title: "Topology shows node enablement badges and workbench no-effect notices for disabled nodes.",
    required: true
  },
  {
    id: "PARAM-ENABLE-TOGGLE-001",
    workflow: "B",
    title: "Node disable requires reason and confirmation; enablement drafts share the working tip with binding edits.",
    required: true
  },
  {
    id: "PARAM-ENABLE-GUARD-001",
    workflow: "B",
    title: "Non-standard status values are read-only unless explicitly acknowledged for override.",
    required: true
  },
  {
    id: "MOD-ATTR-QUEUE-001",
    workflow: "C",
    title:
      "The unclassified compatible queue lists only non-scaffolding, non-dismissed compatibles with parameter and project counts; dismissing removes an entry and restoring brings it back, both audited.",
    required: false
  },
  {
    id: "MOD-ATTR-CLASSIFY-001",
    workflow: "C",
    title:
      "Classifying a compatible shows the impact preview, applies on confirm, moves parameters into the new driver group, and removes the emptied unclassified bucket.",
    required: false
  },
  {
    id: "MOD-ATTR-BULK-001",
    workflow: "C",
    title: "Several selected compatibles are filed into one business category in a single confirmed action.",
    required: false
  },
  {
    id: "MOD-ATTR-TREE-001",
    workflow: "C",
    title:
      "Tree actions are kind-scoped: node-type and driver-group modules offer no delete, node-type modules can move, renaming an auto module adopts it, and the adopted name survives a re-ingest.",
    required: false
  },
  {
    id: "MOD-ATTR-RECLASSIFY-001",
    workflow: "C",
    title:
      "Admin reclassifies a node-type module to a business category in the edit dialog; the tree kind badge and filters update, and re-ingest does not revert the curated kind.",
    required: false
  },
  {
    id: "MOD-ATTR-IMPORTANCE-001",
    workflow: "C",
    title:
      "Importance set on a business category is inherited by its driver groups and node-type units and drives the workbench importance filter.",
    required: false
  },
  {
    id: "DRV-REG-001",
    workflow: "C",
    title:
      "Admin registers a driver before any DTS upload; it appears in the module tree as a not-yet-observed curated driver group with a parse-coverage chip.",
    required: false
  },
  {
    id: "DRV-REG-002",
    workflow: "C",
    title:
      "Admin claims an observed-but-unregistered driver from the queue or module tree; the driver group origin becomes curated.",
    required: false
  },
  {
    id: "DRV-REG-003",
    workflow: "C",
    title:
      "After a DTS upload, the one-shot ingest summary reports matched registered drivers and newly observed unregistered compatibles.",
    required: false
  },
  {
    id: "DRV-REG-004",
    workflow: "C",
    title:
      "Admin edits driverNature / instanceCardinality on an org registration; platform-admin edits appear in org audit; Org Admin cannot edit platform-tier registrations; changing to singleton-per-project opens/refreshes singleton-cardinality publish blockers without rewriting topology.",
    required: false
  },
  {
    id: "DRV-REG-005",
    workflow: "C",
    title:
      "Admin sets a driver registration default business category and runs replay-from-registration; auto driver-groups reparent to the default; curated placements stay frozen.",
    required: false
  },
  {
    id: "DRV-SCHEMA-001",
    workflow: "C",
    title:
      "Admin authors a draft organization overlay schema from an uncovered driver group, activates it, and sees the coverage chip change to organization-covered.",
    required: false
  },
  {
    id: "DRV-SCHEMA-002",
    workflow: "C",
    title:
      "Uploading a DTS whose compatible only the organization overlay claims binds typed properties and does not open unmatched review tasks for those properties.",
    required: false
  },
  {
    id: "DRV-SCHEMA-003",
    workflow: "C",
    title:
      "Activating an overlay for a compatible a pinned schema already covers is rejected with an explanation.",
    required: false
  },
  {
    id: "DRV-SCHEMA-004",
    workflow: "C",
    title:
      "Activating an overlay for an already-uploaded device upgrades existing provisional specs in place without a re-upload and closes related review tasks.",
    required: false
  },
  {
    id: "MOD-ATTR-CREATE-KIND-001",
    workflow: "C",
    title:
      "Admin creates empty business or driver-group modules from the attribution tree with parent-kind rules, required compatibles for driver groups, and not-yet-observed markers on empty curated nodes; node-type units are ingest-only.",
    required: false
  },
  {
    id: "PLAT-ROLE-001",
    workflow: "C",
    title: "Platform admin sees platform console; other roles are denied on direct navigation.",
    required: true
  },
  {
    id: "PLAT-ROLE-002",
    workflow: "C",
    title: "Organization Admin cannot grant platform-admin and the control is hidden.",
    required: true
  },
  {
    id: "PLAT-ROLE-003",
    workflow: "C",
    title: "Platform admin cannot access another organization's parameters, logs, or users.",
    required: true
  },
  {
    id: "DRV-PROMOTE-001",
    workflow: "C",
    title: "Shadowed overlay names the tier that replaced it on the attribution tree.",
    required: false
  },
  {
    id: "DRV-PROMOTE-002",
    workflow: "C",
    title: "Promoted overlay reads as promoted and links the platform row.",
    required: false
  },
  {
    id: "DRV-PROMOTE-003",
    workflow: "C",
    title: "Authoring an org overlay when platform covers compatible is refused with reason.",
    required: false
  },
  {
    id: "DRV-PROMOTE-004",
    workflow: "C",
    title: "After promotion, org without overlay sees platform-covered compatible on tree.",
    required: false
  },
  {
    id: "DRV-PROMOTE-005",
    workflow: "C",
    title: "Console promotion confirms cross-tenant blast radius; revert restores contributors.",
    required: false
  },
  {
    id: "SPEC-DEPRECATE-001",
    workflow: "C",
    title: "Admin soft-deprecates a definition with reason; default library excludes it; reference count reported.",
    required: false
  },
  {
    id: "SPEC-RESTORE-001",
    workflow: "C",
    title: "Admin restores a deprecated definition to the state activated_at implies.",
    required: false
  },
  {
    id: "SPEC-EDIT-DIFF-001",
    workflow: "C",
    title: "Saving an active definition shows value_shape/constraints diff before confirm.",
    required: false
  },
  {
    id: "IDMAP-NEWID-001",
    workflow: "C",
    title: "Confirm-as-new-identity releases the revision while a remaining rejection does not.",
    required: false
  },
  {
    id: "IDMAP-HISTORY-001",
    workflow: "C",
    title: "Identity mapping history lists resolved, dismissed, and new_identity outcomes.",
    required: false
  },
  {
    id: "IDMAP-REOPEN-001",
    workflow: "C",
    title: "Reopen is offered on non-destructive outcomes and refused on resolved.",
    required: false
  },
  {
    id: "MOD-QUEUE-RESTORE-001",
    workflow: "C",
    title: "Dismissed unclassified queue entries can be restored from Admin.",
    required: false
  },
  {
    id: "OVERLAY-RETIRE-001",
    workflow: "C",
    title: "Overlay retirement shows parse-coverage impact before confirm.",
    required: false
  },
  {
    id: "MOD-ATTR-SORT-001",
    workflow: "C",
    title: "Module tree up/down reorder persists via sortOrder PATCH.",
    required: false
  },
  {
    id: "XIAOZE-ACTION-EDITEDARGS-001",
    workflow: "G",
    title: "Approval card argument edits are sent on approve and the executed tool call uses the edited arguments.",
    required: true
  },
  // Unit/component-covered requirements referenced by the coverage map. They carry no
  // browser-spec markers; the map row names the owning non-browser tests.
  {
    id: "BRIDGE-TOOLS-001",
    workflow: "E",
    title:
      "Connected bridge with tools.adb.available false shows tools-missing copy and an install-tools CTA instead of bridge-missing copy.",
    required: false
  },
  {
    id: "PARAM-ADMIN-AUDIT-RECENT-001",
    workflow: "C",
    title:
      "After an admin mutation that audits server-side, the recent strip shows a matching audit-center event via listAuditEvents projection.",
    required: false
  }
];
