# Organization provisioning belongs to the platform; member admission belongs to the organization

> Chinese: [组织由平台建立，成员由组织接纳](../zh-CN/design-docs/adr-0051-organization-provisioning-and-member-admission.md)

## Status

Accepted on 2026-10-23. Questions Q1–Q20 and the [assembled design](../design-docs/2026-10-23-organization-management-design.md) were confirmed in Q21. The design interview is complete; implementation remains a separate subsequent request.

## Confirmed decision

An Organization is an independent collaboration and data space. Departments and teams are groups within that space, not alternative names for an Organization. This preserves the isolation meaning of [ADR-0037](0037-organization-administration-is-home-org-tenant-operations.md).

Platform administrators establish Organizations and designate their initial Organization administrators. Organization administrators admit members through invitations or direct addition. The first iteration uses managed provisioning rather than allowing any user to create an Organization. This provides an accountable owner at establishment while letting each Organization operate its own membership without routing every admission through the platform administrator.

The planned organization directory and provisioning flow revise ADR-0037's v1 exclusion of those capabilities. This is a product-scope expansion, not evidence that the existing implementation already supports them.

## Identity and operating scope

Ordinary accounts continue to belong to one Home organization. Multi-organization membership and ordinary-user organization switching are outside the first iteration; there is no confirmed collaboration need that justifies changing the entire account and admission model.

A platform super administrator may explicitly enter any target Organization to manage its members, projects and business assets. This uses a separate Operating organization, not a membership change or an impersonated user. The interface must keep the target visible, and operations must record both the actual administrator and the target Organization. Ordinary users remain scoped to their Home organization. This revises ADR-0037's exclusion of cross-organization business administration while preserving deliberate scope and accountability; it does not turn every read into an unscoped platform-wide query.

## Internal collaboration

The first iteration supports flat Teams within an Organization. A member may join several Teams. Teams support grouping and bulk administration but do not automatically grant project permissions; department trees and inherited permissions are deferred.

Projects are visible to members of their Organization by default. Non-participants may view; modifying project business data requires explicit participation and the appropriate project role. Review and merge duties remain separately configured. Organization administrators and platform administrators operating in that Organization can manage projects directly. Private projects are outside the first iteration. Existing project review-duty configuration is an implemented capability to reuse, not a general membership system to relabel.

Migration preserves existing effective editing eligibility by materializing participation and corresponding project roles for existing projects. Existing review and merge assignments remain intact; migration adds no extra authority. Organization-wide business roles then cease to imply write access to every project. New projects require explicitly configured participants. This preserves working access without perpetuating implicit grants to future projects.

## Administrators and member admission

An Organization may have several equal administrators, who may appoint or remove other Organization administrators. Normal administration must retain at least one effective administrator. A platform administrator may urgently disable the last Organization administrator and subsequently designate a successor through the recovery entry. There is no separate unique owner whose departure would prevent succession. At least one usable platform super administrator must always remain; before deleting its Home organization, any platform administrator that must be retained is transferred to another Organization. No undeletable system Organization or separate organization-less account model is introduced.

The first iteration supports copyable, one-time invitation links and direct account creation. An invitee sets their own local account password; administrators can inspect invitation status, revoke invitations and regenerate links. The inviter preselects Organization roles, Teams, projects and project roles; acceptance activates those grants without a second approval, and the invitee cannot elevate them. Invitations have configurable expiry; regeneration invalidates the old link. An existing account in another Organization must use the platform's account-transfer flow rather than changing membership through an invitation. Email delivery is not a prerequisite. OIDC continues to use explicit identity binding.

Regular Organizations admit members through invitations or administrator addition. Public registration is a separately enabled evaluation entry targeting one designated Evaluation Organization. It cannot automatically admit someone to an arbitrary regular Organization. When evaluation registration is disabled, the login surface offers login and invitation joining. An Evaluation Organization remains an ordinary Organization rather than a separate permission model.

## Member departure and account transfer

Departure first disables the account and revokes its personal access credentials and device pairings. It then exposes outstanding duties, tasks and assets for handover. Administrators may designate a successor or leave an item pending for later resolution. Organization business data and history remain available; handover must not require keeping the departed account usable. Organization-owned machine credentials are a separate principal, not automatically the departing creator's personal credentials ([ADR-0048](0048-integration-credentials-are-a-machine-principal.md)).

A platform administrator may transfer an account to another Organization after previewing the impact on duties, tasks and credentials. The account still belongs to exactly one Organization. Its old Organization permissions are cleared and target Organization permissions are configured anew. Projects, knowledge and history stay in the source Organization rather than following the account.

Unfinished business drafts, tasks and responsibilities remain available for administrator takeover or assignment, including an explicit pending-handover state when no successor has been selected. Historical attribution preserves the person and Organization at the time of the operation; transfer, account deletion and succession do not rewrite that history as the new assignee's work. Passwords, sessions and device pairings are not handed to a successor.

OIDC retains its existing Organization-claim verification. After a transfer revokes old access, the interface identifies any required external identity-system synchronization and provides the target Organization and verification result. Login resumes only with the correct Organization claim and explicit binding. Local-password accounts do not require this external synchronization. This accepts an explicit external dependency rather than silently changing OIDC identity resolution.

## Organization lifecycle

The first iteration supports platform-admin-controlled disabling and restoration. While disabled, members retain read access under their existing permissions. New business changes, integration calls, task starts and device operations stop; queued tasks pause. Already-started analysis and similar non-device work may finish and save results. Already-dispatched device commands retain their actual outcome without a promise of automatic rollback. Platform administrators retain access for recovery and handover. Restoration does not reactivate individually disabled members or revoked credentials.

A platform super administrator may permanently delete an Organization after inspecting its impact. Permanent deletion includes the Organization's own accounts, business data and files; platform-shared Catalog definitions remain. This choice gives platform administration control over obsolete Organizations instead of retaining every Organization indefinitely.

Confirmation puts the Organization into an unusable cleanup state. Progress and failed items remain visible to platform administration, and failed cleanup can be retried. Only complete cleanup is reported as deletion. The platform retains a minimal receipt identifying the actor, time, target Organization, deleted counts and outcome, without retaining that Organization's business content. Backups expire according to deployment retention; online deletion does not claim that backups have already been erased.

Permanent deletion is a distinct action from disabling, not an automatic consequence of inactivity. Disabling is reversible; partially completed permanent cleanup is not presented as a reversible state transition.

## Accepted complete design

Questions Q1–Q20 are resolved. Navigation, implementation seams, delivery and acceptance are consolidated in the [complete design](../design-docs/2026-10-23-organization-management-design.md), accepted in Q21. Feature implementation, ticket creation and GitHub delivery remain separate subsequent requests.
