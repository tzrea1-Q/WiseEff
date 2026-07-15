import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { ResolvedDts, ResolvedNode } from "../dts/resolver";

export type StructuralInsertCounts = {
  nodes: number;
  properties: number;
  phandleRefs: number;
};

/** Replace structural rows for a file version from a resolved DTS model. */
export async function replaceDtsStructuralModel(
  db: Queryable,
  fileVersionId: string,
  resolved: ResolvedDts,
): Promise<StructuralInsertCounts> {
  await db.query(`delete from dts_nodes where file_version_id = $1`, [fileVersionId]);

  const pathToId = new Map<string, string>();
  const sorted = [...resolved.nodes].sort((a, b) => {
    const ad = a.nodePath.split("/").filter(Boolean).length;
    const bd = b.nodePath.split("/").filter(Boolean).length;
    if (ad !== bd) return ad - bd;
    return a.nodePath.localeCompare(b.nodePath);
  });

  let nodeOrder = 0;
  let propertyCount = 0;
  let phandleCount = 0;

  for (const node of sorted) {
    const id = randomUUID();
    pathToId.set(node.nodePath, id);
    const parentPath = parentNodePath(node.nodePath);
    const parentId = parentPath === null ? null : (pathToId.get(parentPath) ?? null);

    await db.query(
      `
      insert into dts_nodes (
        id, file_version_id, parent_id, name, unit_address, labels, ref_target,
        is_overlay_root, node_path, compatible, status, sort_order
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12
      )
      `,
      [
        id,
        fileVersionId,
        parentId,
        node.name,
        node.unitAddress ?? null,
        JSON.stringify(node.labels),
        null,
        node.name === "/",
        node.nodePath,
        node.compatible ?? null,
        node.status ?? null,
        nodeOrder++,
      ],
    );

    let propOrder = 0;
    for (const prop of node.properties) {
      const propId = randomUUID();
      await db.query(
        `
        insert into dts_properties (
          id, node_id, name, value_type, raw_text, normalized_value, sort_order
        ) values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          propId,
          id,
          prop.name,
          prop.valueType,
          prop.rawText,
          prop.normalizedValue,
          propOrder++,
        ],
      );
      propertyCount += 1;

      for (const ref of node.phandleRefs.filter((r) => r.fromProperty === prop.name)) {
        const targetNodeId = findLabelNodeId(resolved.nodes, pathToId, ref.targetLabel);
        await db.query(
          `
          insert into dts_phandle_refs (
            id, from_property_id, target_label, resolved_target_node_id
          ) values ($1, $2, $3, $4)
          `,
          [randomUUID(), propId, ref.targetLabel, targetNodeId],
        );
        phandleCount += 1;
      }
    }
  }

  return { nodes: sorted.length, properties: propertyCount, phandleRefs: phandleCount };
}

function parentNodePath(nodePath: string): string | null {
  if (!nodePath.includes("/")) return null;
  return nodePath.slice(0, nodePath.lastIndexOf("/"));
}

function findLabelNodeId(
  nodes: ResolvedNode[],
  pathToId: Map<string, string>,
  label: string,
): string | null {
  const hit = nodes.find((n) => n.labels.includes(label) || n.nodePath === label || n.name === label);
  if (!hit) return null;
  return pathToId.get(hit.nodePath) ?? null;
}
