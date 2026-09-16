---
name: wiseeff-ui-verification
description: Verify a WiseEff visible UI change in a real browser. Use for changed copy, layout, forms, navigation, or interactions; not for backend-only or invisible type refactors.
---
# Verify the changed UI

Read the applicable sections of `docs/developer/ui-quality-checklist.md` and the accepted task's evidence contract. That checklist owns the verification policy; do not create an additional gate list here.

Identify the changed routes, user states, and runtime mode. Select existing focused tests and the browser observations required by the actual change. Default to the affected PC state at 1440x900; add compact-PC coverage only for layout risk. Do not launch tablet/mobile sweeps unless requested or required by a device-specific contract. Use any explicitly named tooling. Do not claim mock or component tests prove server authorization or API integration.

Exercise changed interactions and inspect appearance where relevant. Keep evidence bound to the actual candidate. Record console/network failures and missing environments honestly. Missing browser capability blocks browser acceptance, not safe independent edits.

Return one compact evidence summary with routes, viewports, interactions, command outcomes, screenshots where relevant, and remaining gaps. Do not open a PR or deploy from this skill.
