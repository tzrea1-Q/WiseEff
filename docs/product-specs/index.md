# Product Specs Index

Product specs define what WiseEff is, who it serves, what workflows matter, and what must be true for milestones to count as done.

## Current Specs

- [Product Spec](product-spec.md): product positioning, roles, goals, domains, workflows, non-functional requirements, and MVP acceptance.
- [Prototype Functional Spec](prototype-functional-spec.md): current frontend prototype behavior and limitations.
- [MVP Scope](mvp-scope.md): M0-M5 milestone split.
- [New User Onboarding](new-user-onboarding.md): first-session product expectations for new WiseEff users.

## Product Summary

WiseEff is an AI-assisted enterprise efficiency platform. The product unifies parameter management, log analysis, and parameter debugging into governed workspaces where AI can help with search, analysis, review, and preparation, while humans retain approval over risky state changes.

## Current Priorities

1. Preserve the existing interactive prototype and demo value.
2. Productize parameter management first: real database, review flow, merge history, and audit.
3. Add real log analysis tasks after parameter management has a stable backend foundation.
4. Add governed device debugging through a device gateway and simulator.
5. Upgrade Agent from frontend rules to backend orchestration with tool approval and audit.

## Maintenance Rules

- Product specs should state user-visible behavior, not implementation details unless the implementation is part of the product contract.
- If a spec describes behavior that is only a prototype simulation, name that boundary explicitly.
- New specs should include users, success criteria, non-goals, and acceptance checks.
