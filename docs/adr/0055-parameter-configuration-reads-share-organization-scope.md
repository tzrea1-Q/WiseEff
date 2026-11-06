# Parameter configuration reads share Organization scope

> Chinese: [Parameter configuration visibility](../zh-CN/design-docs/adr-0055-parameter-configuration-reads-share-organization-scope.md)

## Status

Accepted design on 2026-11-05 through Q4 of the [parameter library design](../design-docs/2026-11-05-parameter-library-design.md). Catalog configuration-usage scope is implemented by #1515; the remaining library experience and deployment are separate work.

## Decision

An active authenticated user with `parameter:view` can read project configurations within the server-authorized current Organization. The parameter library's project counts, current-instance/value counts, configuration details and comparisons use that same Organization scope. A project-specific role granting this read capability does not restrict those parameter reads to that project. Edit, submission, review and merge authority remain governed by their existing project and action permissions.

Published Platform parameter definitions remain readable through the existing Catalog authorization independently of Organization registration or project usage. Reading a definition alone never grants access to project configurations. Counts and detail require the same configuration-read capability; unavailable or unauthorized usage is not reported as zero. Platform definitions do not permit cross-Organization value searches. An explicitly authorized Operating organization uses its existing server-owned context and never becomes an unscoped query.

This explicitly replaces the project-role-based visibility rule for definition current-configuration usage aggregates when implementing this design. It aligns those reads with existing project-parameter and comparison behavior and [ADR-0051](0051-organization-provisioning-and-member-admission.md), instead of inferring a permission change merely from project-list visibility. It does not broaden Catalog publication, governance queues, policy/reference details, destructive impact previews, other business domains or machine-principal permissions.

## Trade-off

Keeping project-limited aggregates was a real alternative: it would retain the current Catalog policy but would either hide counts for configurations the same user can already inspect or require narrowing existing project-parameter reads. The chosen rule supports Organization-wide engineering reference and comparison, while preserving project-controlled changes and Organization isolation. Reversing it later would change which configurations members may learn from, so the boundary is recorded explicitly.

## Implementation evidence required

Catalog's configuration-usage projection now uses Organization scope after authenticating an active user with `parameter:view`. The existing `parameterUsageProjectScope` remains project-scoped for publication and shared-DTSI governance callers; changing those unrelated scopes is outside this decision. `rootUsageScope.integration.test.ts` covers the new Catalog rule and retains adversarial authorization cases.

Implementation requires independent review and role-faithful PostgreSQL evidence for same-Organization nonparticipant reads, project-role readers, readers without `parameter:view`, inactive users, cross-Organization identifiers, Organization-scoped cache/query reuse, and denied writes by readers. Counts and rows must derive from the same current-instance selection, including configuration sets, source availability, deletion and retirement rules. Missing environments remain unrun evidence. No live policy, production publication or data migration is authorized by this ADR.
