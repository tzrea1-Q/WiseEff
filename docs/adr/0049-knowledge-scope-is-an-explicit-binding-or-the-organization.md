# ADR-0049: Knowledge scope is an explicit binding or the whole organization

> Chinese companion: [Chinese](../zh-CN/design-docs/adr-0049-knowledge-scope-is-an-explicit-binding-or-the-organization.md)

Date: 2026-10-21

## Status

Accepted. Settled in the 2026-10-21 user-curated knowledge design session; delivered by the [user-curated knowledge plan](../exec-plans/completed/2026-10-21-knowledge-user-curation.md).

## Decision

Every knowledge consumer — Xiaoze, analysis skills, parameter definitions, and the debugging surfaces — retrieves published entries within a **knowledge scope**. A scope is exactly one of two things: an explicit set of entry identities bound to the consumer's own object (an analysis skill, a parameter definition), or the whole organization. It is never a tag query, a similarity rule, or any other dynamic selection. Scope only narrows retrieval; it never widens it past published entries in the caller's organization.

We chose this because published skill revisions freeze their eligible entries and each run pins the knowledge revisions it actually retrieved. A tag-defined scope would let any later upload or retag silently change what an already-published skill retrieves, breaking that provenance. With bulk import turning folder names into tags, tags are uploader-controlled labels, not curated scope.

## Considered options

- **Tag-based binding** ("this skill uses everything tagged 充电"). Rejected for the provenance reason above. Pickers may still offer "add everything tagged X" as an authoring shortcut that expands to entry identities when the consumer is edited.
- **Automatic similarity binding for parameter definitions.** Rejected: definitions show only explicitly referenced knowledge, so a definition page never implies a relationship nobody asserted.
- **Context-narrowed Xiaoze retrieval** (search only the current page's bound entries). Rejected: Xiaoze always searches the organization, so a relevant upload is never hidden by where the conversation started.
- **A new debug-node knowledge binding.** Rejected: debugging surfaces derive their scope from the parameter definitions they are already bound to.

## Consequences

- Each consumer owns its binding with its own permission rule. Skill bindings belong to the skill. Definition references belong to the entry, because they describe what the entry is about; adding one from either side requires governing the entry.
- An archived entry drops out of every scope while its binding row stays visible as archived. A hard-deleted entry leaves a dangling identity that consumers display as deleted; completed-run provenance is never rewritten.
- A consumer with an empty explicit set falls back to the organization only where that fallback is already its stated behaviour (analysis skills, reported as organization-generic scope); definition and debugging surfaces show nothing instead.
