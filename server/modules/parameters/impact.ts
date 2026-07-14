import type { Queryable } from "../../shared/database/client";
import type { ImpactItemDto } from "./types";
import type { ParameterRiskLevel } from "./status";

export type ChangeRequestImpactInput = {
  projectId: string;
  projectParameterValueId: string;
  title: string;
  module: string;
  currentValue: string;
  targetValue: string;
  risk: ParameterRiskLevel;
  sourceFileName?: string | null;
  sourceNodePath?: string | null;
};

type BoundNodeRow = {
  node_id: string;
  node_path: string;
  compatible: string | null;
  file_id: string;
  file_name: string;
  version_id: string;
  config_set_id: string | null;
};

type PhandleImpactRow = {
  from_node_path: string;
  from_property: string;
  target_label: string;
};

type CompatibleImpactRow = {
  node_path: string;
  compatible: string;
};

type ConfigSetImpactRow = {
  file_name: string;
};

/** Legacy two-item impact used when no structural DTS info is available. */
export function buildTemplateImpact(input: {
  title: string;
  module: string;
  currentValue: string;
  targetValue: string;
  risk: ParameterRiskLevel;
}): ImpactItemDto[] {
  return [
    {
      kind: "parameter",
      name: input.title,
      note: `Changes ${input.module} parameter from ${input.currentValue} to ${input.targetValue}.`,
      risk: input.risk
    },
    {
      kind: "module",
      name: input.module,
      note: `${input.risk} risk module review recommended.`,
      risk: input.risk
    }
  ];
}

/** Resolve dts_nodes.node_path from a parsed_index-style `nodePath/prop` source path. */
export function nodePathFromSourceNodePath(sourceNodePath: string): string {
  const slash = sourceNodePath.lastIndexOf("/");
  if (slash <= 0) {
    return sourceNodePath;
  }
  return sourceNodePath.slice(0, slash);
}

async function findBoundNode(
  db: Queryable,
  input: { projectId: string; sourceFileName: string; sourceNodePath: string }
): Promise<BoundNodeRow | null> {
  const nodePath = nodePathFromSourceNodePath(input.sourceNodePath);
  const result = await db.query<BoundNodeRow>(
    `
    select
      n.id as node_id,
      n.node_path,
      n.compatible,
      f.id as file_id,
      f.file_name,
      v.id as version_id,
      f.config_set_id
    from project_parameter_files f
    inner join project_parameter_file_versions v on v.id = f.current_version_id
    inner join dts_nodes n on n.file_version_id = v.id
    where f.project_id = $1
      and f.file_name = $2
      and (n.node_path = $3 or n.node_path = $4)
    order by case when n.node_path = $3 then 0 else 1 end
    limit 1
    `,
    [input.projectId, input.sourceFileName, nodePath, input.sourceNodePath]
  );
  return result.rows[0] ?? null;
}

async function listPhandleSources(db: Queryable, nodeId: string): Promise<PhandleImpactRow[]> {
  const result = await db.query<PhandleImpactRow>(
    `
    select
      src.node_path as from_node_path,
      p.name as from_property,
      r.target_label
    from dts_phandle_refs r
    inner join dts_properties p on p.id = r.from_property_id
    inner join dts_nodes src on src.id = p.node_id
    where r.resolved_target_node_id = $1
    order by src.node_path asc, p.name asc, r.id asc
    `,
    [nodeId]
  );
  return result.rows;
}

async function listCompatiblePeers(
  db: Queryable,
  input: { versionId: string; nodeId: string; compatible: string }
): Promise<CompatibleImpactRow[]> {
  const result = await db.query<CompatibleImpactRow>(
    `
    select n.node_path, n.compatible
    from dts_nodes n
    where n.file_version_id = $1
      and n.compatible = $2
      and n.id <> $3
    order by n.node_path asc
    `,
    [input.versionId, input.compatible, input.nodeId]
  );
  return result.rows;
}

async function listConfigSetPeers(
  db: Queryable,
  input: { configSetId: string; fileId: string }
): Promise<ConfigSetImpactRow[]> {
  const result = await db.query<ConfigSetImpactRow>(
    `
    select f.file_name
    from project_parameter_files f
    where f.config_set_id = $1
      and f.id <> $2
    order by f.config_set_sort_order asc, f.file_name asc
    `,
    [input.configSetId, input.fileId]
  );
  return result.rows;
}

function toStructuralImpact(
  input: ChangeRequestImpactInput,
  bound: BoundNodeRow,
  phandles: PhandleImpactRow[],
  compatiblePeers: CompatibleImpactRow[],
  configSetPeers: ConfigSetImpactRow[]
): ImpactItemDto[] {
  const items: ImpactItemDto[] = [];

  for (const phandle of phandles) {
    items.push({
      kind: "phandle",
      name: phandle.from_node_path,
      note: `Phandle reference via ${phandle.from_property} → ${phandle.target_label} targets ${bound.node_path}.`,
      risk: input.risk
    });
  }

  for (const peer of compatiblePeers) {
    items.push({
      kind: "compatible",
      name: peer.node_path,
      note: `Shares compatible "${peer.compatible}" with ${bound.node_path}.`,
      risk: input.risk
    });
  }

  for (const peer of configSetPeers) {
    items.push({
      kind: "config-set",
      name: peer.file_name,
      note: `Same configuration set variant as ${bound.file_name}.`,
      risk: input.risk
    });
  }

  return items;
}

/**
 * Real change-request impact: structural DTS facts when available, otherwise the
 * legacy two-item template (no regression for unbound / non-DTS parameters).
 */
export async function buildChangeRequestImpact(
  db: Queryable,
  input: ChangeRequestImpactInput
): Promise<ImpactItemDto[]> {
  const sourceFileName = input.sourceFileName?.trim() || null;
  const sourceNodePath = input.sourceNodePath?.trim() || null;
  if (!sourceFileName || !sourceNodePath) {
    return buildTemplateImpact(input);
  }

  const bound = await findBoundNode(db, {
    projectId: input.projectId,
    sourceFileName,
    sourceNodePath
  });
  if (!bound) {
    return buildTemplateImpact(input);
  }

  const phandles = await listPhandleSources(db, bound.node_id);
  const compatiblePeers = bound.compatible
    ? await listCompatiblePeers(db, {
        versionId: bound.version_id,
        nodeId: bound.node_id,
        compatible: bound.compatible
      })
    : [];
  const configSetPeers = bound.config_set_id
    ? await listConfigSetPeers(db, { configSetId: bound.config_set_id, fileId: bound.file_id })
    : [];

  const structural = toStructuralImpact(input, bound, phandles, compatiblePeers, configSetPeers);
  if (structural.length === 0) {
    return buildTemplateImpact(input);
  }

  // Keep the direct parameter item so risk/audit consumers that look for
  // kind === "parameter" keep working; drop the legacy module filler.
  return [buildTemplateImpact(input)[0], ...structural];
}
