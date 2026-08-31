# ADR-0042: Organization registration and placement

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0042-organizations-register-canonical-subjects-once.md)

Date: 2026-08-31

## Status

Accepted as the target contract for [Choose organization registration and placement semantics](https://github.com/tzrea1-Q/WiseEff/issues/675). It depends on [ADR-0040](0040-canonical-parameter-catalog-relational-model.md) for the canonical relational model and on [ADR-0041](0041-platform-schema-catalog-releases-materialize-before-runtime.md) for current Catalog Release lifecycle. This is a decision for the parameter-catalog replacement; it does not claim that current production already behaves this way. ADR-0039 remains the current operational contract until a later implementation plan and verified cutover replace it.

## Context

The Platform schema catalog is the sole structural source of Catalog subjects and their Parameter definitions. Every Catalog subject is exactly one Driver or NodeType. An Organization must be able to use only the Catalog subjects relevant to it without receiving a private copy of each subject or every Platform definition.

The current model does not provide that boundary consistently. Driver placement has an organization/subject uniqueness guard, NodeType placement is inferred from module rows, review-time `createSpec` can mint an organization subject from observation evidence, and migration 0127 creates a placement for every complete Platform Driver in every Organization, including newly created Organizations. Those behaviours confuse four separate facts: Catalog subject identity, an Organization's Subject registration, its Subject placement, and observed project usage.

The row classification in [Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) also proves that property keys, display names, node labels, modules, and observed occurrences are weak evidence. They cannot establish formal identity or safely merge the R6/R8 shapes into a definition.

## Decision

### Catalog subject, Subject registration, and Subject placement are separate facts

- A **Catalog subject** is a permanent Platform-owned identity that is exactly one Driver or NodeType. Organizations never copy, shadow, or privately redefine it.
- A **Subject registration** is the durable declaration that one Organization uses one Catalog subject. Its identity is the pair `(Organization, Catalog subject)` and its own lifecycle is `active | retired`.
- A **Subject placement** is the one authoritative Organization taxonomy node belonging to that Subject registration. Registration and initial placement are created atomically; a registration is never active or retired without exactly one retained placement.
- A module or Parameter observation may supply matching evidence. Neither it nor an occurrence, Binding, Project value, property key, display name, or source-key token is a Catalog subject or Parameter definition, and none can be promoted into either identity.

Driver and NodeType registrations use the same registration and one-placement invariant. Their placement node kind still differs (`driver-group` versus `node-type`), and a NodeType may be explicitly placed under a business category, a registered Driver, or a registered NodeType when the taxonomy parent rules allow it.

### The relational model proves exactly one retained placement

ADR-0040's normative relational shape applies without an ADR-0042 override:

- every `organization_subject_registrations.current_placement_id` is non-null;
- every `subject_placements.registration_id` is non-null and `UNIQUE (registration_id)` permits at most one placement row for that registration;
- `(registration_id, organization_id)` on the placement references `(id, organization_id)` on the Subject registration, preventing cross-Organization ownership; and
- the deferrable composite ownership FK from registration `(id, current_placement_id)` to placement `(registration_id, id)` proves that the non-null pointer names the placement owned by that same registration.

Registration and initial placement are inserted in one transaction with the circular ownership constraints deferred until commit. The non-null pointer supplies “at least one,” while `UNIQUE (registration_id)` supplies “at most one.” Together they prove exactly one Subject placement for every Subject registration. The invariant applies unchanged to both `active` and `retired`: retirement never nulls `current_placement_id` or deletes the placement.

### Explicit registration

An Organization Admin with catalog-governance authority may pre-register a Catalog subject before any project observes it, but only while that subject's membership in the current Catalog Release is `active`. A stable Catalog subject root, an active membership in an older release, or a retired current membership is insufficient. The act selects a valid parent category or explicitly accepts the Organization's reserved unclassified root. Platform authority manages the Platform catalog; Platform privilege alone does not silently place subjects into tenant taxonomies.

A user-directed Agent cannot stand in for an explicit registration. A trusted system path may create a registration only through the uniquely proven observation rule below. Explicit and automatic registration, including their placement, are organization-scoped domain writes with trusted audit in the same transaction.

### A uniquely proven Parameter observation registers automatically

An Organization cannot opt out of deterministic automatic registration when the authoritative matcher, anchored to one captured current Catalog Release, proves exactly one Catalog subject whose current release membership is `active`. The proof records that release identity/digest and matcher revision. The write is idempotent under concurrency and creates the Subject registration plus one `origin=auto` Subject placement when none exists.

The proof must come from the authoritative Platform catalog matcher and include the subject kind and current release/schema context. Zero candidates, multiple candidates, owner or kind disagreement, a conflicting existing placement, a retired current membership, or incomplete referenced DTS context are not unique proof. A property key, display name, compatible suffix, bare node name, observed module, Binding, or occurrence is never sufficient by itself.

Driver and NodeType follow the same rule, but NodeType automatic registration requires the authoritative NodeType fallback result: a normalized node-name match only after no Driver matches. A bare node name or a `nodetype:*` module does not establish that result by itself.

Subject recognition and property recognition are independent:

- one uniquely proven Catalog subject may create the Subject registration even when the observed property is unknown;
- an unknown property still enters the Review Queue and creates no Binding; and
- a recognized Binding requires one current Platform definition for the proven subject and property, not merely a Subject registration.

A Parameter observation never restores a retired Subject registration automatically. It creates a `retired-registration-observed` Review Queue item instead.

### Placement is deterministic and dynamically inherited

Organization creation establishes only the reserved taxonomy infrastructure, including one stable unclassified root. A new Organization starts with zero Subject registrations and never receives a copy of the Platform catalog.

An automatically registered Catalog subject receives one stable Subject placement under that root. An explicit registration must choose a valid parent or explicitly accept the same default. The placement's stable identity comes from the Subject registration, not from its localized display name or an observed module.

Every current and future Parameter definition owned by the Catalog subject dynamically inherits the Subject registration's current placement in that Organization. Definitions do not store Organization-specific placement snapshots or placement overrides. Projects in the Organization share the same registration and placement; observed usage counts do not create project-specific registrations or additional placements.

Rename, reparent, and module move mutate the same Subject placement identity. They do not change the Catalog subject, Parameter definition, Binding, Project value, or history identity. A human rename or move promotes an `origin=auto` placement to `curated`. Moving a placement changes the current taxonomy projection for all inherited definitions, while historical Binding revisions and Parameter observation evidence remain unchanged. A module deletion that would orphan a placement is refused; the placement must be moved first. Retiring the Subject registration does not make its durable placement deletable.

### Retirement is reversible; domain hard deletion is forbidden

A Subject registration moves `active -> retired -> active`. Retirement:

- keeps the registration and placement IDs, prior definitions, Parameter observations, Bindings, Project values, and audit readable;
- removes the registration from current selection and blocks new projects or new bindings from adopting it;
- does not rewrite released baselines or historical binding revisions; and
- is never inferred from the last observed Project disappearing.

Restore reuses the same stable Subject registration ID and Subject placement ID. There is no Subject registration or Subject placement hard-delete action in the catalog domain, even for an unused registration. Whole-Organization erasure, if supported elsewhere, follows its own retention and audit contract and is not authorized by this decision.

A Catalog subject root has no independent current lifecycle. Its current status comes only from its membership in the Catalog Release selected by `catalog_state.current_catalog_release_id`. When that membership is `retired`, new explicit registration, automatic matching, and automatic registration are blocked. Existing active or retired Subject registrations, their exactly-one placements, Definitions, Bindings, Project values, observations, release memberships, and history remain retained and addressable; retirement never fabricates an Organization deletion or replacement identity.

A later Catalog Release may restore the subject through an `active` membership for the same stable Catalog subject ID and canonical key. Existing Organization use resumes through the same stable Subject registration and Subject placement IDs. If that Subject registration was independently retired by the Organization, a Parameter observation still cannot restore it automatically; it remains a Review Queue decision.

### Unknown and ambiguous Parameter observations enter the Review Queue, not the catalog

Every unmatched Parameter observation remains immutable evidence with its Organization, project/config revision, source locator, matcher/Catalog Release revision, candidates, and evidence fingerprint. Review Queue work is grouped by Organization, matcher revision, and evidence fingerprint so repeated occurrences add evidence without minting identity rows.

Review reasons include at least `unknown`, `ambiguous`, `placement-conflict`, and `retired-registration-observed`. Zero or multiple valid candidates create no Subject registration, Subject placement, recognized Parameter definition, or Binding. Review may only:

1. select an existing current-release active Catalog subject and register or restore it with an authoritative Subject placement;
2. mark the evidence out of scope; or
3. submit a governed Platform catalog-publication proposal.

Organization review cannot create an Organization definition, Organization subject, or definition-shaped provisional identity. It can never convert a Parameter observation or module into a Catalog subject or Parameter definition. A Platform publication proposal is a separate Platform governance intent; even an accepted proposal creates no definition identity. Only a later immutable Catalog Release and its synchronizer may publish a Catalog subject or Parameter definition. After that release is current, ordinary matching may register its active Catalog subject only when the result is uniquely proven.

Open Review Queue items are re-evaluated against later Catalog Releases. If an open item becomes uniquely proven against an active current membership, the deterministic automatic-registration rule may resolve it. A human-dismissed or out-of-scope item is not automatically reopened.

### Audit and failure behaviour

Explicit registration, automatic registration, placement rename/reparent, retirement/restore, and review resolution record the trusted initiator, accountable principal or system identity, reason, before/after state, catalog and matcher revisions, and the supporting evidence reference. The audit commits with the domain mutation. Unknown, ambiguous, conflicting, or malformed evidence fails closed without a partial subject, registration, placement, definition, or binding write.

## Supersession and scope

| Prior decision                                                                                                             | Target replacement                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0007: a registration is a curated module plus mappings                                                                 | A Catalog subject, Subject registration, and Subject placement are three separate facts; the module is placement only.                                                                                            |
| ADR-0013: an Organization subject may shadow a Platform subject                                                            | Organization shadow subjects retire from the target model. Organizations reference canonical Platform subjects.                                                                                                   |
| ADR-0014: an Organization definition may override a Platform definition                                                    | The Platform catalog is the sole definition source. Subject registration and Subject placement do not copy or override structural definitions.                                                                    |
| ADR-0039 / migration 0127: complete Platform Drivers receive placements in every Organization and on Organization creation | Target registration is selective: explicit use or one uniquely proven observation creates it. Organization creation produces zero subject registrations. ADR-0039 remains current production truth until cutover. |
| D-AG-04: registration defaults drive automatic placement replay                                                            | The default-placement rule applies only after a registration exists. It cannot create registrations or place the catalog across every Organization. Human-moved curated placement remains stable.                 |

This ADR decides domain semantics and adopts ADR-0040's normative relational constraints. It does not choose HTTP shapes, migration batches, UI layout, or implementation sequencing; those belong to the later specification and tickets.

## Considered options

- **Place every Platform subject in every Organization.** Rejected because it fills each tenant with unused catalog entries and makes Organization creation depend on catalog size.
- **Send even a unique authoritative match through human review.** Rejected because review would add no missing judgment after identity is deterministically proved and would block ordinary ingestion unnecessarily.
- **Let module creation or observation create identity.** Rejected because taxonomy and occurrence evidence are mutable and cannot supply formal schema authority.
- **Snapshot definition placement at registration time.** Rejected because it creates per-definition placement drift and makes one module move a bulk definition migration.
- **Hard-delete unused or retired registrations.** Rejected because the registration and placement are referenced by evidence, history, and trusted audit; restore must preserve continuity.

## Consequences

- The replacement must remove eager Organization-by-catalog placement maintenance and the review path that mints Organization subjects or definitions from Parameter observations.
- Driver and NodeType need the same database-enforced Subject registration and exactly-one Subject placement invariant from ADR-0040.
- Migration must classify existing Organization subjects, definitions, modules, and placements using the R0-R10 evidence rules; weak evidence cannot be used to fabricate canonical registration.
- Current production behaviour is unchanged by this documentation-only decision. Implementation begins only after the Wayfinder map is collapsed through `/to-spec` and `/to-tickets`.
