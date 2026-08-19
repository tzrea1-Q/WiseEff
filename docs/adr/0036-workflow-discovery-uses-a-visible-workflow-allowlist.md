# Workflow discovery uses a visible-workflow allowlist

雷泽 has four peer workflows: parameter management, log analysis, debugging, and the knowledge base. Unfinished workflows must not be offered on discovery surfaces, but they are not unauthorized, not retired, and not capability-disabled.

We decided that **discovery surfaces read a closed visible-workflow allowlist in product code**. A workflow appears on those surfaces only when it is on the list. New workflows stay off the list until someone adds them in a PR. The first allowlist is `parameter-management` and `debugging`. Log analysis and the knowledge base remain reachable by deep link.

## Considered Options

- **Environment variable / build flag.** Rejected. Visibility is a product decision, not an operator knob. This repository already retired a page-level `VITE_` flag for the configuration workbench.
- **Permission matrix (`canAccessPage`).** Rejected. Roles already decide who may open a page. Hiding an unpolished workflow is not a role change, and frontend hide is not a security boundary.
- **Interim hide like `/debugging` + `NoEntryPage`.** Rejected. That pattern means the route is retired. Discovery hide must keep the page catalog and routes intact.
- **Hidden-workflow denylist.** Rejected. A newly added unfinished workflow would appear on discovery until someone remembered to hide it. An allowlist makes launch explicit.
- **Runtime org setting or Admin toggle.** Rejected. That is tenant packaging, not “conveniently hide unfinished work.”
- **Capability shutdown (APIs, Xiaoze tools, cross-workflow CTAs).** Rejected. The ask was to hide entries, not to dismantle distillation, retrieval, or acceptance tests that deep-link into `/logs` and `/knowledge`.

## Consequences

- Discovery surfaces are the app sidebar group, homepage sub-app cards, homepage flow tabs, homepage header/footer workflow links, and homepage promotional copy that names a workflow as something the product offers.
- Deep links, contextual CTAs (related knowledge, distil-to-knowledge), Agent tools, utility nav, and incidental mentions inside another visible workflow’s copy are not discovery surfaces.
- Local, CI, and product builds share the same allowlist. Discovery tests assert the user-visible set.
- Unhiding a workflow is a PR that adds its id to the allowlist and restores any homepage copy that should name it.
