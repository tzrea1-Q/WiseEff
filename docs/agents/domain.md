# Domain documentation

> Chinese: [Domain documentation](../zh-CN/agents/domain.md)

Use the repository's established terminology and accepted decisions. Begin with the affected code and tests; search `CONTEXT.md` for the relevant concepts instead of reading the entire glossary for every task.

`ARCHITECTURE.md` maps the system. `docs/design-docs/domain-model.md` defines entities and state machines. `docs/design-docs/full-stack-architecture.md` describes boundaries. Read relevant ADRs and feature-design sections when the change touches those decisions.

These documents are complementary references, not successive mandatory full-context imports. Historical plans describe historical evidence unless the current task explicitly adopts them. A generic external domain-modeling skill is not required to explore or modify WiseEff.

When a proposed change conflicts with an accepted ADR, identify the concrete conflict and obtain the required decision before changing that invariant. Resolve ordinary terminology questions from existing code and documentation without escalating a reversible wording choice.

Update the closest existing authoritative document when a durable decision changes. Keep `CONTEXT.md` navigable and avoid creating a second architecture narrative. Do not invent domain terms or reopen completed programs because an old template names them.
