/**
 * Module placement helpers for instance submodules (Type U / N / C).
 *
 * Shared by seed generation and ingest ensure-instance logic. Scaffolding nodes
 * stay out of the product module tree; driver groups key on compatible.
 */

export const BOARD_INSTANCE_MODULE_NAME = "board";

/**
 * Bus / interconnect segments and driver-group labels excluded from the product
 * module tree and provisional「未分类 · …」buckets (RFC managed-node scaffolding).
 */
export const MODULE_SCAFFOLDING_SEGMENT_RE =
  /^(spmi\d*|amba(-bus)?|i2c@[0-9a-fA-F]+|pmic@[0-9a-fA-F]+|gic(-v?\d+)?|gpio\d*)$/i;

const PROVISIONAL_UNCLASSIFIED_PREFIX = "未分类 · ";

/** Compatible tail / driver / module-leaf label that is scaffolding-only. */
export function isScaffoldingDriverLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  let bare = label.trim().toLowerCase();
  if (bare.startsWith(PROVISIONAL_UNCLASSIFIED_PREFIX.toLowerCase())) {
    bare = bare.slice(PROVISIONAL_UNCLASSIFIED_PREFIX.length).trim();
  }
  const tail = bare.includes(",") ? bare.slice(bare.lastIndexOf(",") + 1).trim() : bare;
  return MODULE_SCAFFOLDING_SEGMENT_RE.test(tail);
}

/** True when a module display name is a provisional unclassified scaffolding bucket. */
export function isProvisionalScaffoldingUnclassifiedModuleName(
  moduleName: string | null | undefined
): boolean {
  if (!moduleName) return false;
  const trimmed = moduleName.trim();
  if (!trimmed.startsWith(PROVISIONAL_UNCLASSIFIED_PREFIX)) return false;
  return isScaffoldingDriverLabel(trimmed.slice(PROVISIONAL_UNCLASSIFIED_PREFIX.length));
}

export type ModuleInstanceTaxonomy = "U" | "N" | "C" | "scaffolding";

export type ResolvedPlacementNode = {
  name: string;
  unitAddress?: string;
  compatible?: string;
  nodePath: string;
};

export type DriverGroupPlacement = {
  moduleName: string;
  businessCategory: string;
  compatibleKey: string;
};

export type InstanceModulePlacement = {
  moduleName: string;
  parentModuleName: string;
  taxonomy: Exclude<ModuleInstanceTaxonomy, "scaffolding">;
  nodePath: string;
  compatibleKey: string | null;
};

export type InstanceModulePlacementPlan = {
  driverGroups: Map<string, DriverGroupPlacement>;
  instances: Map<string, InstanceModulePlacement>;
};

export function instanceModuleNameForNode(input: {
  name: string;
  unitAddress?: string | null;
}): string {
  return input.unitAddress ? `${input.name}@${input.unitAddress}` : input.name;
}

export function isModuleScaffoldingNode(input: {
  name: string;
  compatible?: string | null;
  nodePath?: string | null;
  unitAddress?: string | null;
}): boolean {
  if (input.nodePath === "" || input.name === "/") return true;
  if (isScaffoldingDriverLabel(input.compatible)) return true;
  const leaf =
    input.nodePath && input.nodePath.length > 0
      ? input.nodePath.split("/").filter(Boolean).at(-1) ?? input.name
      : instanceModuleNameForNode(input);
  return MODULE_SCAFFOLDING_SEGMENT_RE.test(leaf) || MODULE_SCAFFOLDING_SEGMENT_RE.test(input.name);
}

export function classifyModuleInstanceTaxonomy(
  node: ResolvedPlacementNode,
): ModuleInstanceTaxonomy {
  if (isModuleScaffoldingNode(node)) return "scaffolding";
  if (node.compatible) return node.unitAddress ? "U" : "N";
  return "C";
}

/** Compatible tail fallback when instance names do not share a stable prefix. */
export function driverGroupDisplayNameFromCompatible(compatible: string): string {
  const normalized = compatible.trim().toLowerCase();
  return normalized.includes(",")
    ? normalized.slice(normalized.lastIndexOf(",") + 1).trim()
    : normalized;
}

export function driverGroupModuleNameForInstances(instanceNames: readonly string[]): string {
  if (instanceNames.length === 0) return "";
  const bases = instanceNames.map((name) => (name.includes("@") ? name.split("@")[0]! : name));
  const firstBase = bases[0]!;
  if (bases.every((base) => base === firstBase)) return firstBase;

  const prefix = instanceNames.reduce((acc, name) => {
    let index = 0;
    while (index < acc.length && index < name.length && acc[index] === name[index]) {
      index += 1;
    }
    return acc.slice(0, index);
  }, instanceNames[0]!);
  const trimmed = prefix.replace(/_+$/, "");
  return trimmed || firstBase;
}

export function parentNodePath(nodePath: string): string | null {
  if (!nodePath) return null;
  const parts = nodePath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/** Demo seed business-leaf routing shared by seed generation and ingest placement. */
export function businessCategoryForNodePath(nodePath: string, propertyName = ""): string {
  const path = `${nodePath}/${propertyName}`.toLowerCase();
  if (!nodePath || propertyName === "board_id") return "Board Identity";
  if (path.includes("wireless") || path.includes("mt5788")) return "Wireless Charging";
  if (path.includes("direct_charge") || path.includes("direct_charger")) return "Direct Charging";
  if (
    path.includes("huawei_batt_info") ||
    path.includes("fm1230") ||
    path.includes("t91407") ||
    path.includes("batt_identify")
  ) {
    return "Battery Authentication";
  }
  if (path.includes("temp_fitting") || path.includes("multi_btb_temp")) return "Battery Thermal";
  if (path.includes("battery_charge_balance") || path.includes("battery_cccv")) return "Battery Balance";
  if (
    path.includes("hisi_bci_battery") ||
    path.includes("battery_ocv") ||
    path.includes("scharger_v800_coul") ||
    path.includes("hi6xxx_coul") ||
    path.includes("soh_core")
  ) {
    return "Battery Gauge";
  }
  if (path.includes("vbat_drop") || path.includes("btb_check")) return "Battery Protection";
  if (path.includes("charging_core") || path.includes("huawei_charger") || path.includes("charge_mode_test")) {
    return "Charging Policy";
  }
  if (path.includes("sc8562")) return "Charge Pump IC";
  if (path.includes("scharger") || path.includes("hl7603") || path.includes("boost_5v")) return "Charger IC";
  return "Board Identity";
}

function nearestManageableAncestor(
  nodePath: string,
  nodesByPath: Map<string, ResolvedPlacementNode>,
): ResolvedPlacementNode | null {
  let cursor = parentNodePath(nodePath);
  while (cursor !== null) {
    const ancestor = nodesByPath.get(cursor);
    if (ancestor && !isModuleScaffoldingNode(ancestor)) {
      return ancestor;
    }
    cursor = parentNodePath(cursor);
  }
  return null;
}

export function planInstanceModulePlacements(
  nodes: readonly ResolvedPlacementNode[],
  businessCategoryForPath: (nodePath: string) => string,
): InstanceModulePlacementPlan {
  const nodesByPath = new Map(nodes.map((node) => [node.nodePath, node]));
  const driverGroups = new Map<string, DriverGroupPlacement>();
  const instances = new Map<string, InstanceModulePlacement>();
  const compatibleMembers = new Map<string, Array<{ node: ResolvedPlacementNode; moduleName: string; taxonomy: "U" | "N" }>>();

  for (const node of nodes) {
    const taxonomy = classifyModuleInstanceTaxonomy(node);
    if (taxonomy === "scaffolding" || taxonomy === "C" || !node.compatible) continue;
    const moduleName = instanceModuleNameForNode(node);
    const compatibleKey = node.compatible.trim().toLowerCase();
    const members = compatibleMembers.get(compatibleKey) ?? [];
    members.push({ node, moduleName, taxonomy });
    compatibleMembers.set(compatibleKey, members);
  }

  for (const [compatibleKey, members] of compatibleMembers) {
    const businessCategory = businessCategoryForPath(members[0]!.node.nodePath);
    const groupName = driverGroupModuleNameForInstances(members.map((member) => member.moduleName));
    driverGroups.set(compatibleKey, {
      moduleName: groupName,
      businessCategory,
      compatibleKey,
    });
    for (const member of members) {
      if (member.moduleName === groupName) {
        instances.set(member.moduleName, {
          moduleName: member.moduleName,
          parentModuleName: businessCategory,
          taxonomy: member.taxonomy,
          nodePath: member.node.nodePath,
          compatibleKey,
        });
        continue;
      }
      instances.set(member.moduleName, {
        moduleName: member.moduleName,
        parentModuleName: groupName,
        taxonomy: member.taxonomy,
        nodePath: member.node.nodePath,
        compatibleKey,
      });
    }
  }

  for (const node of nodes) {
    if (classifyModuleInstanceTaxonomy(node) !== "C") continue;
    const moduleName = instanceModuleNameForNode(node);
    const ancestor = nearestManageableAncestor(node.nodePath, nodesByPath);
    const parentModuleName = ancestor
      ? instanceModuleNameForNode(ancestor)
      : businessCategoryForPath(node.nodePath);
    instances.set(moduleName, {
      moduleName,
      parentModuleName,
      taxonomy: "C",
      nodePath: node.nodePath,
      compatibleKey: null,
    });
  }

  return { driverGroups, instances };
}
