# Workflow publication is platform-wide UI availability

> Chinese: [工作流发布是全平台统一的界面开放策略](../zh-CN/design-docs/adr-0050-workflow-publication-is-platform-wide-ui-availability.md)

## Status

Accepted by the user on 2026-10-23 after the design interview begun on 2026-10-22. This decision supersedes ADR-0036's static discovery-only policy. Verification and deployment status remain separate from design acceptance.

## Confirmed decision

Only platform super administrators configure publication, globally across all organizations and at whole-workflow granularity. For non-administrators, an unpublished workflow loses its UI entry points and direct page access. Organization administrators and platform super administrators remain able to see it, subject to existing data and operation permissions. Publication neither grants permissions nor disables the existing APIs or Xiaoze capabilities.

This revises [ADR-0036](0036-workflow-discovery-uses-a-visible-workflow-allowlist.md): the requested product control now includes runtime administration and direct page access, which discovery-only hiding deliberately excluded. Keeping publication separate from capability authorization lets administrators evaluate experimental interfaces while preserving existing integrations and tenant isolation. Per-organization packaging, per-page switches, and capability shutdown were considered and excluded by the confirmed scope.

## Confirmed operating behavior

- Parameter management, device debugging, log analysis, and the knowledge base initially remain published. A super administrator must explicitly unpublish them. Future workflows default to unpublished until explicitly published; an absent new workflow is never implicitly open.
- Saved changes apply on a user's next full refresh or page navigation. An already open page is not polled out of existence or forcibly unmounted. Existing unsaved-change navigation guards run before leaving an editor; in-page query/filter/tab changes are not new page entries. A successful new navigation uses current publication state; a failed refresh of that state does not silently admit the destination using stale publication values.
- If the knowledge base is unpublished, other published workflows retain permitted read-only knowledge references. Entry points that navigate into knowledge-base pages or create knowledge entries, including distillation, disappear for non-administrators. Xiaoze and API capability permissions remain unchanged, including knowledge retrieval. This is interface publication, not content confidentiality.
- On initial publication-load failure, non-administrators can use the homepage and retry but cannot enter a workflow until its publication state is known. Administrators continue to use pages under their existing permissions. The initial loading state does not flash all workflows as available.

## Management interface

Add a standalone **Workflow publication** utility entry at `/workflow-publication` for platform super administrators, alongside existing organization/audit utilities, outside the four controlled workflows. Its page lists the four workflows with their published/unpublished state and a labelled switch, plus Save and Discard actions and the latest saved actor/time. Switching edits a local draft; only a successful explicit save applies it across organizations. Use the existing settings form's dirty-state, navigation-confirmation and validation patterns.

Organization administrators retain access to all workflow interfaces but do not see or gain access to this management page. Unpublished workflows can be identified as available to administrators for preview. Homepage, login, recovery and management utilities remain outside publication control, including when all four workflows are unpublished. The empty homepage offers an honest no-published-workflows state instead of broken links or an empty tab selection. A blocked direct URL displays “暂未开放” with a route back to the homepage, without loading the blocked workflow page.

## Implementation boundaries

- Reuse the existing closed workflow catalog and page/group mappings. Apply one viewer-aware publication snapshot consistently to sidebar groups, homepage cards/tabs/header/footer/copy, route aliases and child routes, and contextual links. The log-skill child-route permission exception must still be evaluated alongside publication state.
- API-mode homepage discovery already requires an authenticated session, so reading publication state remains authenticated. It returns only the publication state ordinary clients need; management metadata is super-administrator-only. Xiaoze may still return permitted data and citations; any hidden-workflow destination opened from such a citation encounters the same frontend route gate.
- Store one durable platform-wide publication configuration, separate from organization settings. The server validates known workflow identifiers and boolean states; only an active platform super administrator with an organization-wide platform role binding may modify it. Hiding the management link is not the write authorization check.
- Saving uses the last read configuration version to detect concurrent edits, and records the trusted actor plus before/after state in a platform audit event in the same transaction. Conflicts and failed saves preserve the local draft and never claim success. Initial setup is idempotent and never reopens workflows an administrator previously unpublished.
- New-session configuration and navigation refresh must distinguish “unpublished” from “configuration unavailable.” Retry remains available. No realtime revocation, new entitlement system, organization packaging, content deletion, API shutdown or background-task cancellation is introduced.

## Acceptance cases

1. Unpublishing logs or knowledge persists across server restart and affects non-administrators in two different organizations on their next refresh/navigation. Existing business permissions and organization isolation still apply.
2. Sidebar, homepage discovery and contextual create/navigation entry points agree; direct links, aliases, child pages and browser navigation cannot load unpublished workflow pages. Permitted read-only knowledge references remain usable without offering a hidden-page link.
3. Both administrator types can access unpublished workflows; only platform super administrators can read or edit the management page. Unauthorized configuration writes and project-scoped role spoofing are rejected by the server.
4. A user editing an open page is not expelled when publication changes. Existing unsaved-change confirmation precedes leaving. Initial/configuration-refresh failure shows retry without admitting an ordinary user to an unverified destination; administrators can still recover configuration.
5. All four workflows can be unpublished without hiding homepage, login or management utilities. Current workflows start published; an unknown/new workflow stays unpublished until explicitly configured.
6. Save failure, stale-version conflict and audit failure do not partially apply configuration or discard the editor's local draft. Successful saves record actual changes and a trusted actor.

The user confirmed the complete design and authorized implementation. This record states the accepted product boundary; local tests and browser checks do not establish deployment or production acceptance.
