import type { Queryable } from "../../shared/database/client";
import { nodeTypeKeyForNode, normalizeMatchToken } from "./modulePlacement";
import { resolveModuleIdForBinding } from "./resolveModuleForBinding";
import { findEffectiveModuleForLegacyAttribution } from "../parameter-catalog-api/governance/index";

export function compatibleSourceKey(compatible: string): string {
  return `compatible:${normalizeMatchToken(compatible) ?? compatible.trim().toLowerCase()}`;
}

/** Resolve retained attribution evidence without materializing technical modules. */
export async function resolveAttributionModuleForBinding(
  db: Queryable,
  input: {
    organizationId: string;
    driverModule: string | null;
    compatible: string | null;
    instanceName: string | null;
    nodeLocator?: string | null;
    attributionSubjectId?: string | null;
    preferExplicitMapping?: boolean;
  },
): Promise<string> {
  const nodePath = input.nodeLocator && input.nodeLocator !== "/" ? input.nodeLocator.replace(/^\//, "") : "";
  const rawName = input.instanceName ?? (nodePath.split("/").filter(Boolean).at(-1) ?? "");
  const [name, unitAddress] = rawName.split("@");
  const nodeType = nodeTypeKeyForNode({ name: name || "/", unitAddress, nodePath });
  if (input.attributionSubjectId) {
    const current = await findEffectiveModuleForLegacyAttribution(db, input.organizationId, input.attributionSubjectId);
    if (current) return current;

  }
  return resolveModuleIdForBinding(db, { ...input, nodeType });
}
