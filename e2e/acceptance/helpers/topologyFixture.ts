import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "playwright/test";

import { authHeadersForRole } from "./bearerAuth";
import { withPgClient } from "./database";
import { apiRoute } from "./runtime";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const primarySources: Record<string, string> = {
  aurora: readFileSync(join(root, "src/config/dts-seed/aurora-board.dts"), "utf8"),
  nebula: readFileSync(join(root, "src/config/dts-seed/nebula-board.dts"), "utf8")
};

const organizationId = "org-chargelab";

function primaryFileName(projectId: string): string {
  return `${projectId}-board.dts`;
}

function adminHeaders() {
  return authHeadersForRole("admin");
}

export type SemanticTopologyContext = {
  configSetId: string;
  revisionId: string;
  status: string;
};

async function uploadDts(
  request: APIRequestContext,
  projectId: string,
  fileName: string,
  content: string
): Promise<{ fileId: string; versionId: string }> {
  const response = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders(),
    data: {
      fileName,
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    }
  });
  if (!response.ok()) {
    throw new Error(`upload ${fileName} failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    item: { id: string };
    version: { id: string };
  };
  return { fileId: body.item.id, versionId: body.version.id };
}

/**
 * Ensure aurora/nebula `default` Config Set has a project-primary DTS member and a
 * semantic revision produced by production upload→ingest (not teaching fixtures).
 */
export async function ensureProjectSemanticTopology(
  request: APIRequestContext,
  projectId: "aurora" | "nebula"
): Promise<SemanticTopologyContext> {
  const primarySource = primarySources[projectId];
  const fileName = primaryFileName(projectId);
  if (!primarySource) throw new Error(`No committed project-primary DTS exists for ${projectId}.`);
  const setsResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
    headers: adminHeaders()
  });
  if (!setsResponse.ok()) {
    throw new Error(`list config-sets failed: ${setsResponse.status()}`);
  }
  const setsBody = (await setsResponse.json()) as { items: Array<{ id: string; name: string }> };
  let configSetId = setsBody.items.find((item) => item.name === "default")?.id;
  if (!configSetId) {
    const createSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: "default", description: "Disposable acceptance semantic topology" }
    });
    if (!createSet.ok()) {
      throw new Error(`create default config-set failed: ${createSet.status()} ${await createSet.text()}`);
    }
    const createBody = (await createSet.json()) as { item: { id: string } };
    configSetId = createBody.item.id;
  }

  const filesResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders()
  });
  if (!filesResponse.ok()) {
    throw new Error(`list parameter-files failed: ${filesResponse.status()}`);
  }
  const filesBody = (await filesResponse.json()) as {
    items: Array<{ id: string; fileName: string }>;
  };
  let primaryFileId = filesBody.items.find((item) => item.fileName === fileName)?.id;

  const uploadedPrimary = await uploadDts(request, projectId, fileName, primarySource);
  primaryFileId = uploadedPrimary.fileId;

  const addPrimary = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: primaryFileId, role: "base", sortOrder: 0 }
    }
  );
  if (!addPrimary.ok() && addPrimary.status() !== 409) {
    throw new Error(`add primary to config-set failed: ${addPrimary.status()} ${await addPrimary.text()}`);
  }

  // Re-upload primary to trigger production maybeIngestSemanticConfigRevision.
  await uploadDts(request, projectId, fileName, primarySource);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await withPgClient(async (client) => {
      const revision = await client.query<{ id: string; status: string }>(
        `
        select id, status
        from dts_config_revisions
        where organization_id = $1
          and project_id = $2
          and config_set_id = $3
        order by revision_number desc
        limit 1
        `,
        [organizationId, projectId, configSetId]
      );
      if (!revision.rows[0]) return null;
      const gpio = await client.query<{ n: string }>(
        `
        select count(*)::text as n
        from project_parameter_binding_revisions br
        inner join project_parameter_bindings b on b.id = br.binding_id
        inner join parameter_specs ps on ps.id = b.parameter_spec_id
        where br.config_revision_id = $1
          and (
            ps.specification_key like '%/gpio_int'
            or exists (
              select 1 from dts_property_specs dps
              where dps.parameter_spec_id = ps.id and dps.property_key = 'gpio_int'
            )
          )
        `,
        [revision.rows[0].id]
      );
      if (Number(gpio.rows[0]?.n ?? 0) < 2) return null;
      return {
        configSetId,
        revisionId: revision.rows[0].id,
        status: revision.rows[0].status
      };
    });
    if (ready) return ready;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for ${projectId} default Config Set semantic ingest (gpio_int bindings).`
  );
}

export function ensureAuroraSemanticTopology(request: APIRequestContext) {
  return ensureProjectSemanticTopology(request, "aurora");
}
