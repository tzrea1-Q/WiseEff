import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "playwright/test";

import { authHeadersForRole } from "./bearerAuth";
import { withPgClient } from "./database";
import { apiRoute } from "./runtime";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const baseSource = readFileSync(join(root, "src/config/dts-seed/wiseeff-power-base.dts"), "utf8");
const overlaySource = readFileSync(join(root, "src/config/dts-seed/aurora-power-overlay.dts"), "utf8");

const organizationId = "org-chargelab";
const projectId = "aurora";
const defaultConfigSetId = "dcs-default-aurora";
const baseFileName = "wiseeff-power-base.dts";
const overlayFileName = "wiseeff-power-overlay.dts";

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
 * Ensure aurora `default` Config Set has base+overlay members and a semantic
 * revision produced by production upload→ingest (not teaching fixtures).
 * Always re-uploads committed seed overlays so acceptance picks up seed fixes
 * (e.g. status=okay) without business-table SQL mutation.
 */
export async function ensureAuroraSemanticTopology(
  request: APIRequestContext
): Promise<SemanticTopologyContext> {
  const setsResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
    headers: adminHeaders()
  });
  if (!setsResponse.ok()) {
    throw new Error(`list config-sets failed: ${setsResponse.status()}`);
  }
  const setsBody = (await setsResponse.json()) as { items: Array<{ id: string; name: string }> };
  const configSetId =
    setsBody.items.find((item) => item.name === "default")?.id ?? defaultConfigSetId;

  const filesResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders()
  });
  if (!filesResponse.ok()) {
    throw new Error(`list parameter-files failed: ${filesResponse.status()}`);
  }
  const filesBody = (await filesResponse.json()) as {
    items: Array<{ id: string; fileName: string }>;
  };
  let baseFileId = filesBody.items.find((item) => item.fileName === baseFileName)?.id;
  let overlayFileId = filesBody.items.find((item) => item.fileName === overlayFileName)?.id;

  const uploadedBase = await uploadDts(request, baseFileName, baseSource);
  baseFileId = uploadedBase.fileId;
  const uploadedOverlay = await uploadDts(request, overlayFileName, overlaySource);
  overlayFileId = uploadedOverlay.fileId;

  const addBase = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: baseFileId, role: "base", sortOrder: 0 }
    }
  );
  if (!addBase.ok() && addBase.status() !== 409) {
    throw new Error(`add base to config-set failed: ${addBase.status()} ${await addBase.text()}`);
  }

  const addOverlay = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: overlayFileId, role: "overlay", sortOrder: 1 }
    }
  );
  if (!addOverlay.ok() && addOverlay.status() !== 409) {
    throw new Error(
      `add overlay to config-set failed: ${addOverlay.status()} ${await addOverlay.text()}`
    );
  }

  // Re-upload overlay to trigger production maybeIngestSemanticConfigRevision.
  await uploadDts(request, overlayFileName, overlaySource);

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
    "Timed out waiting for aurora default Config Set semantic ingest (gpio_int bindings)."
  );
}
