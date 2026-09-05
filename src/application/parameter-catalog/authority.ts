import type { CatalogDomainState } from "./states";

export const catalogActorKinds = ["user", "org-admin", "platform-admin", "agent"] as const;
export type CatalogActorKind = (typeof catalogActorKinds)[number];

export const catalogAuthorizedActions = [
  "read",
  "register-subject",
  "retire-registration",
  "restore-registration",
  "update-placement",
  "resolve-review-item",
  "create-proposal",
  "submit-proposal",
  "withdraw-proposal",
  "accept-proposal",
  "reject-proposal"
] as const;
export type CatalogAuthorizedAction = (typeof catalogAuthorizedActions)[number];

const ACTOR_ACTIONS: Record<CatalogActorKind, readonly CatalogAuthorizedAction[]> = {
  user: ["read", "create-proposal", "submit-proposal", "withdraw-proposal"],
  "org-admin": [
    "read",
    "register-subject",
    "retire-registration",
    "restore-registration",
    "update-placement",
    "resolve-review-item",
    "create-proposal",
    "submit-proposal",
    "withdraw-proposal"
  ],
  "platform-admin": ["read", "accept-proposal", "reject-proposal"],
  agent: ["read"]
};

export function catalogActionsForActor(actor: CatalogActorKind): readonly CatalogAuthorizedAction[] {
  return ACTOR_ACTIONS[actor];
}

/** Map the live shell role onto Catalog authority. Agent is not a platform role. */
export function catalogActorForRole(roleId: string): CatalogActorKind {
  if (roleId === "platform-admin") {
    return "platform-admin";
  }
  if (roleId === "admin") {
    return "org-admin";
  }
  return "user";
}

export function isCatalogActionEnabled(
  actor: CatalogActorKind,
  action: CatalogAuthorizedAction,
  state: CatalogDomainState
): boolean {
  if (!ACTOR_ACTIONS[actor].includes(action)) {
    return false;
  }
  if (action === "read") {
    return true;
  }
  if (
    state.kind === "unregistered" &&
    (action === "register-subject" || action === "resolve-review-item")
  ) {
    return true;
  }
  return state.kind === "ready";
}
