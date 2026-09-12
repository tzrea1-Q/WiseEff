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
  "reject-proposal",
  "preview-publication",
  "publish-publication",
  "review-high-risk-publication"
] as const;
export type CatalogAuthorizedAction = (typeof catalogAuthorizedActions)[number];

export const catalogPublicationPermissionByAction = {
  "preview-publication": "catalog:author",
  "publish-publication": "catalog:publish",
  "review-high-risk-publication": "catalog:review-high-risk"
} as const;

export type CatalogPublicationAction = keyof typeof catalogPublicationPermissionByAction;

const ACTOR_ACTIONS: Record<CatalogActorKind, readonly CatalogAuthorizedAction[]> = {
  user: ["read"],
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

export function catalogActionsForSession(input: {
  actor: CatalogActorKind;
  permissions?: readonly string[] | null;
}): readonly CatalogAuthorizedAction[] {
  if (input.actor === "agent") {
    return catalogActionsForActor("agent");
  }
  const actions = [...catalogActionsForActor(input.actor)];
  const permissions = new Set(input.permissions ?? []);
  for (const [action, permission] of Object.entries(catalogPublicationPermissionByAction) as Array<
    [CatalogPublicationAction, (typeof catalogPublicationPermissionByAction)[CatalogPublicationAction]]
  >) {
    if (permissions.has(permission) && !actions.includes(action)) {
      actions.push(action);
    }
  }
  return actions;
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

export function catalogActorForSession(input: { roleId?: string | null }): CatalogActorKind {
  return catalogActorForRole(input.roleId ?? "");
}

export function isCatalogActionEnabled(
  actor: CatalogActorKind,
  action: CatalogAuthorizedAction,
  state: CatalogDomainState,
  permissions?: readonly string[] | null
): boolean {
  if (!catalogActionsForSession({ actor, permissions }).includes(action)) {
    return false;
  }
  if (action === "read") {
    return true;
  }
  if (
    action === "preview-publication" ||
    action === "publish-publication" ||
    action === "review-high-risk-publication"
  ) {
    return state.kind === "ready" || state.kind === "unregistered" || state.kind === "empty";
  }
  if (
    state.kind === "unregistered" &&
    (action === "register-subject" || action === "resolve-review-item")
  ) {
    return true;
  }
  return state.kind === "ready";
}
