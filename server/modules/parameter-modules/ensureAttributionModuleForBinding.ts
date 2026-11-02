import type { Queryable } from "../../shared/database/client";
import { nodeTypeKeyForNode, normalizeMatchToken } from "./modulePlacement";
import { findModuleRecognitionOverride, resolveModuleIdForBinding } from "./resolveModuleForBinding";
import { getDriverRegistrationPlacement, getNodeTypeDefinitionPlacement } from "./driverRegistrationPlacement";
import { nodeTypeSourceKey } from "./modulePlacement";
import { activeBusinessAncestor, findEffectiveModuleForLegacyAttribution } from "../parameter-catalog-api/governance/index";

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
  const override = await findModuleRecognitionOverride(db, { organizationId: input.organizationId,
    compatible: input.compatible, nodeType: name || "/" });
  if (override.moduleId) return override.moduleId;

  if (input.attributionSubjectId) {
    const current = await findEffectiveModuleForLegacyAttribution(db, input.organizationId, input.attributionSubjectId);
    if (current) return current;

    const node = nodeType ? await getNodeTypeDefinitionPlacement(db, {
      organizationId: input.organizationId, attributionSubjectId: input.attributionSubjectId, sourceKey: nodeTypeSourceKey(nodeType),
    }) : null;
    const driver = await getDriverRegistrationPlacement(db, {
      organizationId: input.organizationId, attributionSubjectId: input.attributionSubjectId,
    });
    const legacyModuleId = node?.moduleId ?? driver?.driverGroupModuleId;
    if (legacyModuleId) {
      const active = await activeBusinessAncestor(db, input.organizationId, legacyModuleId);
      if (active) return active;
    }
  }
  return resolveModuleIdForBinding(db, { ...input, nodeType });
}
