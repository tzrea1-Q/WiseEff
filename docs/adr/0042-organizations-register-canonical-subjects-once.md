# Organizations register canonical subjects once and place them once

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0042-organizations-register-canonical-subjects-once.md)

Date: 2026-08-31

## Status

Accepted as the target contract for [Choose organization registration and placement semantics](https://github.com/tzrea1-Q/WiseEff/issues/675). This is a decision for the parameter-catalog replacement; it does not claim that current production already behaves this way. ADR-0039 remains the current operational contract until a later implementation plan and verified cutover replace it.

## Context

The Platform schema catalog is the sole structural source of formal Driver and NodeType identities and their Parameter definitions. An Organization must be able to use only the catalog subjects relevant to it without receiving a private copy of each subject or every Platform definition.

The current model does not provide that boundary consistently. Driver placement has an organization/subject uniqueness guard, NodeType placement is inferred from module rows, review-time `createSpec` can mint an organization subject from observation evidence, and migration 0127 creates a placement for every complete Platform Driver in every Organization, including newly created Organizations. Those behaviours confuse four separate facts: formal catalog identity, an Organization's decision to use that identity, the Organization's taxonomy placement, and observed project usage.

The row classification in [Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) also proves that property keys, display names, node labels, modules, and observed occurrences are weak evidence. They cannot establish formal identity or safely merge the R6/R8 shapes into a definition.

## Decision

### Canonical subject, registration, and placement are separate facts

- A **formal catalog subject** is a Platform-owned Driver or NodeType identity. Organizations never copy, shadow, or privately redefine it.
- An **Organization subject registration** is the durable declaration that one Organization uses one formal catalog subject. Its identity is the pair `(organization, formal subject)` and its lifecycle is `active | retired`.
- A **subject placement** is the one authoritative taxonomy node belonging to that registration. Registration and initial placement are created atomically; a registration is never active or retired without exactly one retained placement.
- A module, observation, occurrence, project binding, property key, display name, or source-key token is not a formal subject and cannot be promoted into one.

Driver and NodeType registrations use the same registration and one-placement invariant. Their placement node kind still differs (`driver-group` versus `node-type`), and a NodeType may be explicitly placed under a business category, a registered Driver, or a registered NodeType when the taxonomy parent rules allow it.

### Explicit registration

An Organization Admin with catalog-governance authority may pre-register a formal subject before any project observes it. The act selects a valid parent category or explicitly accepts the Organization's reserved unclassified root. Platform authority manages the Platform catalog; Platform privilege alone does not silently place subjects into tenant taxonomies.

A user-directed Agent cannot stand in for an explicit registration. A trusted system path may create a registration only through the uniquely proven observation rule below. Explicit and automatic registration, including their placement, are organization-scoped domain writes with trusted audit in the same transaction.

### A uniquely proven observation registers automatically

An Organization cannot opt out of deterministic automatic registration when the current Platform catalog and matcher revision prove exactly one active formal subject. The write is idempotent under concurrency and creates the registration plus one `origin=auto` placement when none exists.

The proof must come from the authoritative Platform catalog matcher and include the subject kind and current schema/revision context. Zero candidates, multiple candidates, owner or kind disagreement, a conflicting existing placement, or incomplete referenced DTS context are not unique proof. A property key, display name, compatible suffix, bare node name, observed module, binding, or occurrence is never sufficient by itself.

Driver and NodeType follow the same rule, but NodeType automatic registration requires a formal Platform NodeType matcher result. A bare node name or a `nodetype:*` module does not establish that result.

Subject recognition and property recognition are independent:

- one uniquely proven subject may create the Organization registration even when the observed property is unknown;
- an unknown property still enters review and creates no definition binding; and
- a recognized binding requires one current Platform definition for the proven subject and property, not merely a registered subject.

An observation never restores a retired registration automatically. It creates a `retired-registration-observed` review item instead.

### Placement is deterministic and dynamically inherited

Organization creation establishes only the reserved taxonomy infrastructure, including one stable unclassified root. It creates no subject registrations and never copies the Platform catalog into the Organization.

An automatically registered subject receives one stable placement node under that root. An explicit registration must choose a valid parent or explicitly accept the same default. The node's stable identity comes from the registration, not from its localized display name or an observed module.

Every current and future Platform definition owned by the formal subject dynamically inherits the registration's current placement in that Organization. Definitions do not store organization-specific placement snapshots or placement overrides. Projects in the Organization share the same registration and placement; observed usage counts do not create project-specific registrations or additional placements.

Rename and reparent mutate the same placement identity. They do not change the formal subject, definition, project-binding, or history identity. A human rename or move promotes an `origin=auto` placement to `curated`. Moving a placement changes the current taxonomy projection for all inherited definitions, while historical binding revisions and observation evidence remain unchanged. A module deletion that would orphan a placement is refused; the placement must be moved instead. Retiring the registration does not make its durable placement deletable.

### Retirement is reversible; domain hard deletion is forbidden

An Organization registration moves `active -> retired -> active`. Retirement:

- keeps the registration and placement IDs, prior definitions, observations, bindings, and audit readable;
- removes the registration from current selection and blocks new projects or new bindings from adopting it;
- does not rewrite released baselines or historical binding revisions; and
- is never inferred from the last observed Project disappearing.

Restore reuses the same registration and placement. There is no subject-registration or placement hard-delete action in the catalog domain, even for an unused registration. Whole-Organization erasure, if supported elsewhere, follows its own retention and audit contract and is not authorized by this decision.

Platform subject retirement prevents new explicit or automatic registrations and marks existing registrations as upstream-retired. Existing Organization registration, placement, history, and released interpretations remain readable; the retirement never fabricates an Organization deletion or a replacement identity.

### Unknown and ambiguous observations enter review, not the catalog

Every unmatched observation remains immutable evidence with its Organization, project/config revision, source locator, matcher/catalog revision, candidates, and evidence fingerprint. Review work is grouped by Organization, matcher revision, and evidence fingerprint so repeated occurrences add evidence without minting identity rows.

Review reasons include at least `unknown`, `ambiguous`, `placement-conflict`, and `retired-registration-observed`. Zero or multiple valid candidates create no registration, subject placement, recognized definition, or recognized binding. Review may only:

1. select an existing Platform subject and register or restore it with an authoritative placement;
2. mark the evidence out of scope; or
3. submit a governed Platform catalog-publication proposal.

Organization review cannot create an Organization definition, Organization subject, or definition-shaped provisional identity. A Platform publication is a separate Platform governance act; after publication, ordinary matching may register the new formal subject only when the result is uniquely proven.

Open review items are re-evaluated against later catalog revisions. If an open item becomes uniquely proven, the deterministic automatic-registration rule may resolve it. A human-dismissed or out-of-scope item is not automatically reopened.

### Audit and failure behaviour

Explicit registration, automatic registration, placement rename/reparent, retirement/restore, and review resolution record the trusted initiator, accountable principal or system identity, reason, before/after state, catalog and matcher revisions, and the supporting evidence reference. The audit commits with the domain mutation. Unknown, ambiguous, conflicting, or malformed evidence fails closed without a partial subject, registration, placement, definition, or binding write.

## Supersession and scope

| Prior decision                                                                                                             | Target replacement                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0007: a registration is a curated module plus mappings                                                                 | A formal Platform subject, Organization registration, and subject placement are three separate facts; the module is placement only.                                                                               |
| ADR-0013: an Organization subject may shadow a Platform subject                                                            | Organization shadow subjects retire from the target model. Organizations reference canonical Platform subjects.                                                                                                   |
| ADR-0014: an Organization definition may override a Platform definition                                                    | The Platform catalog is the sole definition source. Organization registration and placement do not copy or override structural definitions.                                                                       |
| ADR-0039 / migration 0127: complete Platform Drivers receive placements in every Organization and on Organization creation | Target registration is selective: explicit use or one uniquely proven observation creates it. Organization creation produces zero subject registrations. ADR-0039 remains current production truth until cutover. |
| D-AG-04: registration defaults drive automatic placement replay                                                            | The default-placement rule applies only after a registration exists. It cannot create registrations or place the catalog across every Organization. Human-moved curated placement remains stable.                 |

This ADR decides domain semantics only. It does not choose relational table names, HTTP shapes, migration batches, UI layout, or implementation sequencing; those belong to the later specification and tickets.

## Considered options

- **Place every Platform subject in every Organization.** Rejected because it fills each tenant with unused catalog entries and makes Organization creation depend on catalog size.
- **Send even a unique formal match through human review.** Rejected because review would add no missing judgment after identity is deterministically proved and would block ordinary ingestion unnecessarily.
- **Let module creation or observation create identity.** Rejected because taxonomy and occurrence evidence are mutable and cannot supply formal schema authority.
- **Snapshot definition placement at registration time.** Rejected because it creates per-definition placement drift and makes one module move a bulk definition migration.
- **Hard-delete unused or retired registrations.** Rejected because the registration and placement are referenced by evidence, history, and trusted audit; restore must preserve continuity.

## Consequences

- The replacement must remove eager Organization-by-catalog placement maintenance and the review path that mints Organization subjects or definitions from observations.
- Driver and NodeType need the same database-enforced Organization-registration and one-placement invariant.
- Migration must classify existing Organization subjects, definitions, modules, and placements using the R0-R10 evidence rules; weak evidence cannot be used to fabricate canonical registration.
- Current production behaviour is unchanged by this documentation-only decision. Implementation begins only after the Wayfinder map is collapsed through `/to-spec` and `/to-tickets`.
