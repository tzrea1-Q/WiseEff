import type { Queryable } from "../../shared/database/client";
import type { DtsValueType } from "../dts/types";

export type StructuralPropertyDto = {
  name: string;
  valueType: DtsValueType;
  rawText: string;
  normalizedValue: string;
};

export type StructuralPhandleRefDto = {
  fromProperty: string;
  targetLabel: string;
  resolvedTargetPath?: string;
};

export type StructuralNodeDto = {
  nodePath: string;
  name: string;
  unitAddress?: string;
  labels: string[];
  compatible?: string;
  status?: string;
  properties: StructuralPropertyDto[];
  phandleRefs: StructuralPhandleRefDto[];
};

export type StructuralReadResult = {
  nodes: StructuralNodeDto[];
};

type NodeRow = {
  id: string;
  name: string;
  unit_address: string | null;
  labels: unknown;
  node_path: string;
  compatible: string | null;
  status: string | null;
  sort_order: number | string;
};

type PropertyRow = {
  id: string;
  node_id: string;
  name: string;
  value_type: string;
  raw_text: string;
  normalized_value: unknown;
  sort_order: number | string;
};

type PhandleRefRow = {
  from_property_id: string;
  node_id: string;
  from_property: string;
  target_label: string;
  resolved_target_path: string | null;
};

function parseLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeNormalizedValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Assemble structured DTS model from dts_* tables for a file version (no re-parse). */
export async function readDtsStructuralModel(
  db: Queryable,
  fileVersionId: string,
): Promise<StructuralReadResult> {
  const nodesResult = await db.query<NodeRow>(
    `
    select id, name, unit_address, labels, node_path, compatible, status, sort_order
    from dts_nodes
    where file_version_id = $1
    order by sort_order asc, id asc
    `,
    [fileVersionId],
  );

  const propertiesResult = await db.query<PropertyRow>(
    `
    select p.id, p.node_id, p.name, p.value_type, p.raw_text, p.normalized_value, p.sort_order
    from dts_properties p
    join dts_nodes n on n.id = p.node_id
    where n.file_version_id = $1
    order by p.sort_order asc, p.id asc
    `,
    [fileVersionId],
  );

  const phandleResult = await db.query<PhandleRefRow>(
    `
    select
      r.from_property_id,
      p.node_id,
      p.name as from_property,
      r.target_label,
      tn.node_path as resolved_target_path
    from dts_phandle_refs r
    join dts_properties p on p.id = r.from_property_id
    join dts_nodes n on n.id = p.node_id
    left join dts_nodes tn on tn.id = r.resolved_target_node_id
    where n.file_version_id = $1
    order by r.id asc
    `,
    [fileVersionId],
  );

  const propertiesByNode = new Map<string, StructuralPropertyDto[]>();
  for (const row of propertiesResult.rows) {
    const list = propertiesByNode.get(row.node_id) ?? [];
    list.push({
      name: row.name,
      valueType: row.value_type as DtsValueType,
      rawText: row.raw_text,
      normalizedValue: normalizeNormalizedValue(row.normalized_value),
    });
    propertiesByNode.set(row.node_id, list);
  }

  const phandlesByNode = new Map<string, StructuralPhandleRefDto[]>();
  for (const row of phandleResult.rows) {
    const list = phandlesByNode.get(row.node_id) ?? [];
    list.push({
      fromProperty: row.from_property,
      targetLabel: row.target_label,
      ...(row.resolved_target_path ? { resolvedTargetPath: row.resolved_target_path } : {}),
    });
    phandlesByNode.set(row.node_id, list);
  }

  const nodes: StructuralNodeDto[] = nodesResult.rows.map((row) => ({
    nodePath: row.node_path,
    name: row.name,
    ...(row.unit_address != null ? { unitAddress: row.unit_address } : {}),
    labels: parseLabels(row.labels),
    ...(row.compatible != null ? { compatible: row.compatible } : {}),
    ...(row.status != null ? { status: row.status } : {}),
    properties: propertiesByNode.get(row.id) ?? [],
    phandleRefs: phandlesByNode.get(row.id) ?? [],
  }));

  return { nodes };
}
