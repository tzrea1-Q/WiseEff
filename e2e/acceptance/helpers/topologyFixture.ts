import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "playwright/test";

import { makeTestAuthContext } from "../../../server/testing/authContext";
import { createPostgresDatabase } from "../../../server/shared/database/client";
import { createLocalObjectStore } from "../../../server/modules/logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../../server/modules/parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../../server/modules/parameter-files/service";
import { setParameterIdentityMode } from "../../../server/modules/parameter-kernel/parameterIdentityMode";

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
  if (!primarySource) throw new Error(`No committed project-primary DTS exists for ${projectId}.`);
  return ensureTopologyForSource(request, projectId, primaryFileName(projectId), primarySource);
}

/**
 * Create (idempotently) a dedicated disposable project whose `default` Config Set is
 * ingested from `source`. Canonical source history is immutable, so scenarios that need
 * a different topology (disabled nodes, a non-standard status token, an extra node)
 * start from their own source instead of editing the shared project afterwards.
 */
export async function ensureDedicatedProjectTopology(
  request: APIRequestContext,
  input: { projectId: string; name: string; code: string; source: string }
): Promise<SemanticTopologyContext> {
  // Fixture-only setup in the disposable database, like the canonical specs: an
  // already initialized project, so ordinary edits are not blocked by initialization.
  await withPgClient(async (client) => {
    await client.query(
      `insert into projects(id, organization_id, name, code, status, initialization_status)
       values ($1, $2, $3, $4, 'initialized', 'initialized')
       on conflict (id) do nothing`,
      [input.projectId, organizationId, input.name, input.code]
    );
  });
  return ensureTopologyForSource(request, input.projectId, `${input.projectId}-board.dts`, input.source);
}

/** Replace the first `status` property declared inside the node whose header matches. */
export function withNodeStatus(source: string, nodeHeader: RegExp, status: string): string {
  const header = nodeHeader.exec(source);
  if (!header) throw new Error(`node header ${nodeHeader} not found in source`);
  const bodyStart = header.index + header[0].length;
  const statusMatch = /status\s*=\s*"[^"]*"\s*;/.exec(source.slice(bodyStart));
  if (!statusMatch) throw new Error(`status property not found after ${nodeHeader}`);
  if (source.slice(bodyStart, bodyStart + statusMatch.index).includes("{")) {
    throw new Error(`status of ${nodeHeader} is not declared before its first child node`);
  }
  const absolute = bodyStart + statusMatch.index;
  return `${source.slice(0, absolute)}status = "${status}";${source.slice(absolute + statusMatch[0].length)}`;
}

/** Aurora's committed primary DTS, for dedicated scenarios that derive their own source. */
export function auroraPrimarySource(): string {
  return primarySources.aurora!;
}

async function ensureTopologyForSource(
  request: APIRequestContext,
  projectId: string,
  fileName: string,
  primarySource: string
): Promise<SemanticTopologyContext> {
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

  // Canonical source history is immutable: once the project's default Config Set has
  // ingested its primary DTS (and any approved changes), the fixture must reuse it
  // instead of re-uploading the primary file.
  const readyTopology = async (): Promise<SemanticTopologyContext | null> => {
    const revision = await withPgClient(async (client) => {
      const result = await client.query<{ id: string; status: string }>(
        `
        select id, status
        from dts_config_revisions
        where organization_id = $1
          and project_id = $2
          and config_set_id = $3
          and status <> 'pending_approval'
        order by revision_number desc
        limit 1
        `,
        [organizationId, projectId, configSetId]
      );
      return result.rows[0] ?? null;
    });
    if (!revision) return null;
    const bindings = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
      headers: adminHeaders()
    });
    if (!bindings.ok()) return null;
    const body = (await bindings.json()) as { items: Array<{ propertyKey: string }> };
    if (body.items.filter((item) => item.propertyKey === "gpio_int").length < 2) return null;
    return { configSetId, revisionId: revision.id, status: revision.status };
  };

  const existing = await readyTopology();
  if (existing) return existing;

  const filesResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders()
  });
  if (!filesResponse.ok()) {
    throw new Error(`list parameter-files failed: ${filesResponse.status()}`);
  }

  const uploadedPrimary = await uploadDts(request, projectId, fileName, primarySource);
  const primaryFileId = uploadedPrimary.fileId;

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
    const ready = await readyTopology();
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

/**
 * Register Catalog driver Subjects for the organization so uploaded DTS sources
 * produce canonical Bindings for them (the canonical replacement for the retired
 * semantic-identity auto-binding). Idempotent: already registered Subjects are skipped.
 */
export async function registerCatalogDriverSubjects(
  request: APIRequestContext,
  subjects: ReadonlyArray<{ subjectId: string; canonicalName: string }>
): Promise<void> {
  const headers = adminHeaders();
  const current = await request.get(apiRoute("/api/v2/catalog"), { headers });
  if (!current.ok()) throw new Error(`read current Catalog failed: ${current.status()} ${await current.text()}`);
  const releaseId = ((await current.json()) as { item: { catalogReleaseId: string } }).item.catalogReleaseId;
  for (const { subjectId, canonicalName } of subjects) {
    // Fixture-only setup in the disposable database: the destination driver-group
    // module and its attribution subject, exactly as the canonical value workflow
    // spec provisions them before registering a Catalog driver Subject.
    const destinationModuleId = `topology-pmod-${canonicalName.replace(/[^a-z0-9]+/gi, "-")}`;
    await withPgClient(async (client) => {
      const attributionId = `topology-attr-${canonicalName.replace(/[^a-z0-9]+/gi, "-")}`;
      await client.query(
        `insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
         values ($1,$2,'driver-registration',$3,$4) on conflict (id) do nothing`,
        [attributionId, organizationId, canonicalName, `compatible:${canonicalName}`]
      );
      await client.query(
        `insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
         values ($1,'physical-device','multiple') on conflict do nothing`,
        [attributionId]
      );
      await client.query(
        `insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
         values ($1,$2,$3,$1,1,'driver-group','curated',$4) on conflict (id) do nothing`,
        [destinationModuleId, organizationId, canonicalName, attributionId]
      );
    });
    const response = await request.post(
      apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`),
      {
        headers: {
          ...headers,
          "X-WiseEff-Catalog-Release": releaseId,
          "Idempotency-Key": `topology-acceptance-register-${subjectId}`
        },
        data: { subjectId, destinationModuleId, placement: { mode: "use-default" }, reason: "Topology acceptance driver registration" }
      }
    );
    if (response.status() !== 201 && response.status() !== 200 && response.status() !== 409) {
      throw new Error(`register ${subjectId} failed: ${response.status()} ${await response.text()}`);
    }
  }
}

/**
 * Seed a Config Set whose second revision has ambiguous node continuity, so an open
 * identity-mapping task exists for the admin surface to resolve.
 *
 * Ambiguous continuity cannot be produced through the public HTTP surface any more:
 * every ingest through it pins canonical source occurrences, and canonical source
 * changes then require a prepared source transaction that never allocates new DTS
 * identity. The identity-mapping subsystem itself (validate gate, task list, resolve
 * route, admin UI, audit) is unchanged, so this fixture ingests the two revisions
 * with the real upload/ingest service without the canonical producer, in the
 * disposable database only. All assertions still go through HTTP and the browser.
 */
export async function seedAmbiguousIdentityMappingConfigSet(
  runtime: { databaseUrl: string; objectStoreRoot: string },
  input: {
    projectId: string;
    configSetName: string;
    baseFileName: string;
    baseText: string;
    overlayFileName: string;
    overlayText: string;
    adminUserId: string;
  }
): Promise<{ configSetId: string; baseRevisionId: string; ambiguousRevisionId: string }> {
  const db = createPostgresDatabase(runtime.databaseUrl);
  // The disposable API runs post-cutover in semantic identity mode; match it in-process.
  setParameterIdentityMode("semantic");
  try {
    const objectStore = createLocalObjectStore(runtime.objectStoreRoot);
    const auth = makeTestAuthContext({ userId: input.adminUserId, organizationId });
    const configSet = await createConfigSet(db, auth, {
      projectId: input.projectId,
      name: input.configSetName,
      description: "Identity-mapping acceptance fixture"
    });
    const upload = (fileName: string, text: string) =>
      uploadProjectParameterFile(db, objectStore, auth, {
        projectId: input.projectId,
        fileName,
        bytes: Buffer.from(text, "utf8")
      });
    const base = await upload(input.baseFileName, input.baseText);
    await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: base.file.id, role: "base", sortOrder: 0 });
    await upload(input.baseFileName, input.baseText);
    const baseRevision = await latestRevision(configSet.id);
    const overlay = await upload(input.overlayFileName, input.overlayText);
    await addConfigSetFile(db, auth, {
      configSetId: configSet.id,
      fileId: overlay.file.id,
      role: "overlay",
      sortOrder: 1
    });
    await upload(input.overlayFileName, input.overlayText);
    const ambiguous = await latestRevision(configSet.id);
    if (ambiguous.id === baseRevision.id || ambiguous.status !== "needs_mapping") {
      throw new Error(`identity-mapping fixture expected a needs_mapping revision, got ${ambiguous.status}`);
    }
    return { configSetId: configSet.id, baseRevisionId: baseRevision.id, ambiguousRevisionId: ambiguous.id };
  } finally {
    setParameterIdentityMode(null);
    await db.close();
  }
}

async function latestRevision(configSetId: string): Promise<{ id: string; status: string }> {
  return withPgClient(async (client) => {
    const result = await client.query<{ id: string; status: string }>(
      `select id, status from dts_config_revisions where config_set_id = $1 order by revision_number desc limit 1`,
      [configSetId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`no revision for config set ${configSetId}`);
    return row;
  });
}
