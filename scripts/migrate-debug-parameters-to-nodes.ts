import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { loadServerEnv } from "../server/config/env";

async function migrateDebugParametersToNodes(client: Client) {
  const result = await client.query<{
    parameter_id: string;
    organization_id: string;
    project_id: string | null;
    name: string;
    description: string;
    module: string;
    protocol: string;
    node_path: string;
    access_mode: string;
    sort_order: number;
    enabled: boolean;
    notes: string | null;
  }>(
    `
    select
      p.id as parameter_id,
      p.organization_id,
      p.project_id,
      p.name,
      p.description,
      p.module,
      b.protocol,
      b.node_path,
      b.access_mode,
      p.sort_order,
      b.enabled,
      b.notes
    from debugging_parameters p
    inner join debugging_parameter_node_bindings b on b.parameter_id = p.id
    where b.enabled = true
      and p.archived_at is null
    order by p.sort_order asc, p.name asc, b.protocol asc
    `
  );

  const seenNodes = new Set<string>();

  for (const row of result.rows) {
    const nodeId = row.parameter_id;

    if (!seenNodes.has(nodeId)) {
      seenNodes.add(nodeId);
      await client.query(
        `
        insert into debug_nodes (
          id, organization_id, project_id, name, description, module, enabled
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update set
          name = excluded.name,
          description = excluded.description,
          module = excluded.module,
          enabled = excluded.enabled,
          project_id = excluded.project_id,
          updated_at = now()
        `,
        [
          nodeId,
          row.organization_id,
          row.project_id,
          row.name,
          row.description,
          row.module,
          row.enabled
        ]
      );
    }

    const bindingId = `${nodeId}:${row.protocol}`;
    await client.query(
      `
      insert into debug_node_bindings (
        id, organization_id, project_id, node_id, protocol, node_path, access_mode, enabled, notes
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (node_id, protocol) do update set
        organization_id = excluded.organization_id,
        project_id = excluded.project_id,
        node_path = excluded.node_path,
        access_mode = excluded.access_mode,
        enabled = excluded.enabled,
        notes = excluded.notes,
        updated_at = now()
      `,
      [
        bindingId,
        row.organization_id,
        row.project_id,
        nodeId,
        row.protocol,
        row.node_path,
        row.access_mode,
        row.enabled,
        row.notes
      ]
    );

    await client.query(
      `
      update node_operations
      set node_id = $3
      where organization_id = $1
        and parameter_id = $2
        and protocol = $4
        and (node_id is null or node_id = $5)
      `,
      [row.organization_id, row.parameter_id, nodeId, row.protocol, bindingId]
    );
  }
}

async function main() {
  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await migrateDebugParametersToNodes(client);
    console.log("Migrated debugging parameters into debug_nodes and debug_node_bindings.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
