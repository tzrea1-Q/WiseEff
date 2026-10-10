import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { loadServerEnv } from "../server/config/env";
import { parseDts } from "../server/modules/dts/parser";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import type { AuthContext } from "../server/modules/auth/types";
import { buildDtsParsedIndex } from "../server/modules/parameter-files/parseIndex";
import { ingestDtsFileVersion } from "../server/modules/parameter-files/structuralIngest";
import type { ObjectStore } from "../server/modules/logs/objectStore";
import { ingestConfigRevisionInTransaction } from "../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../server/modules/parameter-topology/types";
import { createPostgresDatabase, getRootPostgresPool, type Database, type RootDatabase } from "../server/shared/database/client";
import { buildDtsPowerSeed, type DtsPowerSeedParameter, type DtsPowerSeedProjectFile } from "./dts-power-seed";
import { loadCommittedDtsSeedFiles } from "./compile-dts-seed";
import { ensureCanonicalCatalogAfterLegacySeed } from "../server/modules/parameter-bindings/seedInitialization/seedCanonicalAfterLegacy";
import { ensurePublishedVendorCatalog } from "./sync-vendor-property-docs";
import { insertAttributionSubjectForNewModule } from "../server/modules/parameter-modules/attributionSubjectRepository";
import { getAuthContext } from "../server/modules/auth/repository";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../server/modules/audit/trustedRefusalSink";
import { parseDtsValue } from "../server/modules/dts/valueAst";
import { listCatalogBindingRowsForProject, loadPublishedCatalog } from "../server/modules/parameter-bindings/catalogProjectValueSync";
import { createCanonicalValueDraft, loadCanonicalBindingPins, submitCanonicalValueChange, reviewCanonicalValueChange } from "../server/modules/parameter-bindings/drafts";

/**
 * Demo projects use one self-contained project-primary DTS per project
 * (`{projectId}-board.dts`). Semantic ingest and writeback target that file.
 */
export type PowerManagementProject = {
  id: string;
  name: string;
  code: string;
};

export type PowerManagementParameterValue = {
  currentValue: string;
  recommendedValue: string;
};

export type PowerManagementParameter = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: string;
  valueKind?: "scalar" | "complex";
  sourceFileName?: string;
  sourceNodePath?: string;
  values: Record<string, PowerManagementParameterValue | undefined>;
};

export type PowerManagementParameterModule = {
  name: string;
  description: string;
  scope: string;
  parent?: string;
  kind?: "business" | "driver-group" | "node-type";
  origin?: "curated" | "auto";
  sourceKey?: string | null;
};

export type PowerManagementConfig = {
  projects: PowerManagementProject[];
  parameterModules?: PowerManagementParameterModule[];
  parameterLibrary: PowerManagementParameter[];
};


const powerManagementConfigSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string()
    })
  ),
  parameterModules: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        scope: z.string(),
        parent: z.string().optional(),
        kind: z.enum(["business", "driver-group", "node-type"]).optional(),
        origin: z.enum(["curated", "auto"]).optional(),
        sourceKey: z.string().nullable().optional()
      })
    )
    .optional(),
  parameterLibrary: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      explanation: z.string(),
      configFormat: z.string(),
      module: z.string(),
      range: z.string(),
      unit: z.string(),
      risk: z.string(),
      valueKind: z.enum(["scalar", "complex"]).optional(),
      sourceFileName: z.string().optional(),
      sourceNodePath: z.string().optional(),
      values: z.record(
        z.object({
          currentValue: z.string(),
          recommendedValue: z.string()
        })
      )
    })
  )
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const organizationId = "org-chargelab";
const seedUserId = "u-xu-yun";
const workflowRoleBindings = [
  { userId: "u-wang-jie", roleId: "hardware-committer" },
  { userId: "u-sun-mei", roleId: "software-committer" },
  { userId: "u-liu-min", roleId: "software-user" },
  { userId: "u-li-peng", roleId: "hardware-committer" },
  { userId: "u-chen-na", roleId: "software-user" }
] as const;

/**
 * The demo taxonomy config uses a flat `module` display field. Map the
 * DTS seed's `businessCategory` onto it here rather than reintroducing
 * `module` on `DtsPowerSeedParameter` itself.
 */
function toPowerManagementParameter(parameter: DtsPowerSeedParameter): PowerManagementParameter {
  return {
    id: parameter.id,
    name: parameter.name,
    description: parameter.description,
    explanation: parameter.explanation,
    configFormat: parameter.configFormat,
    module: parameter.businessCategory,
    range: parameter.range,
    unit: parameter.unit,
    risk: parameter.risk,
    valueKind: parameter.valueKind,
    sourceFileName: parameter.sourceFileName,
    sourceNodePath: parameter.sourceNodePath,
    values: parameter.values
  };
}

function stableSeedId(prefix: string, value: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${prefix}-${digest}`;
}

/** Auth context for seed-driven writes (semantic ingest, module resolution). */
function seedAuthContext(): AuthContext {
  return {
    user: {
      id: seedUserId,
      organizationId,
      name: "Xu Yun",
      email: "xu@chargelab.cn",
      title: "Platform Owner",
      isActive: true
    },
    organization: { id: organizationId, name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
}

function resolveSeedModules(config: PowerManagementConfig): PowerManagementParameterModule[] {
  const byName = new Map((config.parameterModules ?? []).map((module) => [module.name, module]));
  for (const parameter of config.parameterLibrary) {
    if (!byName.has(parameter.module)) {
      byName.set(parameter.module, {
        name: parameter.module,
        description: "",
        scope: ""
      });
    }
  }

  const ordered: PowerManagementParameterModule[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (module: PowerManagementParameterModule) => {
    if (visited.has(module.name)) return;
    if (visiting.has(module.name)) {
      throw new Error(`Parameter module seed contains a parent cycle at ${module.name}.`);
    }
    visiting.add(module.name);
    if (module.parent) {
      const parent = byName.get(module.parent);
      if (!parent) {
        throw new Error(`Parameter module seed parent not found: ${module.name} -> ${module.parent}.`);
      }
      visit(parent);
    }
    visiting.delete(module.name);
    visited.add(module.name);
    ordered.push(module);
  };

  for (const module of byName.values()) visit(module);
  return ordered;
}

export function parsePowerManagementConfig(configPath: string, source: string): PowerManagementConfig {
  try {
    return powerManagementConfigSchema.parse(JSON.parse(source));
  } catch (error) {
    const details =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.path.join(".") || "<root>").join(", ")
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Invalid M1 parameter seed config at ${configPath}: ${details}`);
  }
}


export async function seedM1Parameters(
  db: Database,
  config: PowerManagementConfig
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const project of config.projects) {
      await tx.query(
        `
        insert into projects (id, organization_id, name, code, status)
        values ($1, $2, $3, $4, 'initialized')
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          code = excluded.code,
          status = excluded.status,
          updated_at = now()
        `,
        [project.id, organizationId, project.name, project.code]
      );

      for (const binding of workflowRoleBindings) {
        await tx.query(
          `
          insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
          values ($1, $2, $3, $4, $5)
          on conflict (id) do update set
            user_id = excluded.user_id,
            organization_id = excluded.organization_id,
            project_id = excluded.project_id,
            role_id = excluded.role_id
          `,
          [
            `urb-${binding.userId}-${project.id}-${binding.roleId}`,
            binding.userId,
            organizationId,
            project.id,
            binding.roleId
          ]
        );
      }
    }

    const seedModules = resolveSeedModules(config);
    const moduleIdByName = new Map<string, string>();
    const modulePathByName = new Map<string, string>();
    for (const [index, module] of seedModules.entries()) {
      const parentId = module.parent ? moduleIdByName.get(module.parent) ?? null : null;
      // Deduplicate by org + name so re-parenting a seed module (JSON root → DTS tree)
      // updates the existing row instead of inserting a second same-named module.
      const existing = await tx.query<{ id: string }>(
        `
        select id
        from parameter_modules
        where organization_id = $1 and name = $2
        order by case when coalesce(parent_id, '') = coalesce($3::text, '') then 0 else 1 end, id
        limit 1
        `,
        [organizationId, module.name, parentId]
      );
      const id = existing.rows[0]?.id ?? stableSeedId("pmod-seed", module.name);
      const parentPath = module.parent ? modulePathByName.get(module.parent) ?? null : null;
      const modulePath = parentPath ? `${parentPath}/${id}` : id;
      const depth = module.parent ? (modulePath.match(/\//g)?.length ?? 0) + 1 : 1;
      const kind = module.kind ?? "business";
      const origin = module.origin ?? (kind === "business" ? "curated" : "auto");
      const sourceKey = module.sourceKey ?? null;
      let attributionSubjectId: string | null = null;
      if (kind === "driver-group" || kind === "node-type") {
        // Committed DTS seed modules describe the platform schema taxonomy.
        // Keep their subject global so an organization module can declare a
        // tenant placement for the same canonical driver/node-type identity;
        // organization overlays remain scoped by their `org/<id>/...`
        // schema namespace and do not pass through this seed path.
        const subjectOrganizationId = sourceKey ? null : organizationId;
        attributionSubjectId = await insertAttributionSubjectForNewModule(tx, {
          moduleId: id,
          organizationId: subjectOrganizationId,
          kind,
          displayName: module.name,
          origin,
          sourceKey,
          notes: module.description,
        });
      }
      const result = await tx.query<{ id: string }>(
        `
        insert into parameter_modules (
          id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
          kind, origin, source_key, attribution_subject_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id) do update set
          parent_id = excluded.parent_id,
          name = excluded.name,
          path = excluded.path,
          depth = excluded.depth,
          sort_order = excluded.sort_order,
          description = coalesce(nullif(excluded.description, ''), parameter_modules.description),
          scope = coalesce(nullif(excluded.scope, ''), parameter_modules.scope),
          kind = excluded.kind,
          origin = excluded.origin,
          source_key = coalesce(excluded.source_key, parameter_modules.source_key),
          attribution_subject_id = coalesce(
            excluded.attribution_subject_id,
            parameter_modules.attribution_subject_id
          ),
          updated_at = now()
        returning id
        `,
        [
          id,
          organizationId,
          parentId,
          module.name,
          modulePath,
          depth,
          index,
          module.description,
          module.scope,
          kind,
          origin,
          sourceKey,
          attributionSubjectId
        ]
      );
      const persistedId = result.rows[0]?.id ?? id;
      moduleIdByName.set(module.name, persistedId);
      modulePathByName.set(module.name, parentPath ? `${parentPath}/${persistedId}` : persistedId);
    }


    const modules = [...new Set(config.parameterLibrary.map((parameter) => parameter.module))];
    for (const project of config.projects) {
      for (const [index, moduleName] of modules.entries()) {
        const parameterModuleId = moduleIdByName.get(moduleName) ?? null;
        const seedModule = seedModules.find((module) => module.name === moduleName);
        const parentId = seedModule?.parent ? moduleIdByName.get(seedModule.parent) ?? null : null;
        const modulePath = modulePathByName.get(moduleName) ?? null;
        await tx.query(
          `
          insert into project_modules (
            id, organization_id, project_id, name, sort_order,
            parent_id, path, depth, parameter_module_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (project_id, name) do update set
            organization_id = excluded.organization_id,
            sort_order = excluded.sort_order,
            parent_id = excluded.parent_id,
            path = excluded.path,
            depth = excluded.depth,
            parameter_module_id = excluded.parameter_module_id
          `,
          [
            `${project.id}-${moduleName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
            organizationId,
            project.id,
            moduleName,
            index,
            parentId,
            modulePath,
            modulePath ? (modulePath.match(/\//g)?.length ?? 0) + 1 : 1,
            parameterModuleId
          ]
        );
      }
    }

  });
}

type SeedFileVersionRow = {
  id: string;
  version_number: number | string;
};

/**
 * Seed the authoritative DTS file for each demo project after its parameter
 * definitions/values exist. IDs and checksums are deterministic, so rerunning
 * the seed refreshes structure without creating duplicate versions.
 */
export async function seedM1DtsFiles(
  db: Database,
  objectStore: ObjectStore,
  projectFiles: readonly DtsPowerSeedProjectFile[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const projectFile of projectFiles) {
      const bytes = Buffer.from(projectFile.source, "utf8");
      const stored = await objectStore.put({
        organizationId,
        fileName: projectFile.fileName,
        contentType: "text/plain",
        bytes
      });
      const parsedIndex = buildDtsParsedIndex(projectFile.source);

      const configSetResult = await tx.query<{ id: string }>(
        `
        insert into dts_config_set (
          id, organization_id, project_id, name, description
        )
        values ($1, $2, $3, 'default', $4)
        on conflict (project_id, name) do update set
          organization_id = excluded.organization_id,
          description = excluded.description,
          updated_at = now()
        returning id
        `,
        [
          `dcs-default-${projectFile.projectId}`,
          organizationId,
          projectFile.projectId,
          "Default buildable config set seeded from the full WiseEff power-management overlay."
        ]
      );
      const configSetId = configSetResult.rows[0]?.id ?? `dcs-default-${projectFile.projectId}`;

      const fileSeedId = `seed-dts-file-${projectFile.projectId}`;
      const fileResult = await tx.query<{ id: string }>(
        `
        insert into project_parameter_files (
          id, organization_id, project_id, file_name, format,
          config_set_id, config_set_role, config_set_sort_order, enabled
        )
        values ($1, $2, $3, $4, 'dts', $5, $6, 0, true)
        on conflict (project_id, file_name) do update set
          organization_id = excluded.organization_id,
          format = excluded.format,
          config_set_id = excluded.config_set_id,
          config_set_role = excluded.config_set_role,
          config_set_sort_order = excluded.config_set_sort_order,
          enabled = true,
          updated_at = now()
        returning id
        `,
        [fileSeedId, organizationId, projectFile.projectId, projectFile.fileName, configSetId, "base"]
      );
      const fileId = fileResult.rows[0]?.id ?? fileSeedId;

      const existingVersionResult = await tx.query<SeedFileVersionRow>(
        `
        select id, version_number
        from project_parameter_file_versions
        where file_id = $1
          and checksum = $2
        order by version_number desc
        limit 1
        `,
        [fileId, stored.checksumSha256]
      );
      const existingVersion = existingVersionResult.rows[0];
      let versionId: string;
      let versionNumber: number;

      if (existingVersion) {
        versionId = existingVersion.id;
        versionNumber = Number(existingVersion.version_number);
      } else {
        const nextVersionResult = await tx.query<{ next_version_number: number | string }>(
          `
          select coalesce(max(version_number), 0) + 1 as next_version_number
          from project_parameter_file_versions
          where file_id = $1
          `,
          [fileId]
        );
        versionNumber = Number(nextVersionResult.rows[0]?.next_version_number ?? 1);
        versionId = `seed-dts-version-${projectFile.projectId}-${stored.checksumSha256.slice(0, 16)}`;
        await tx.query(
          `
          insert into project_parameter_file_versions (
            id, file_id, version_number, storage_key, checksum,
            size_bytes, parsed_index, origin, created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'upload', $8)
          on conflict (id) do update set
            storage_key = excluded.storage_key,
            checksum = excluded.checksum,
            size_bytes = excluded.size_bytes,
            parsed_index = excluded.parsed_index,
            created_by_user_id = excluded.created_by_user_id
          `,
          [
            versionId,
            fileId,
            versionNumber,
            stored.storageKey,
            stored.checksumSha256,
            stored.fileSizeBytes,
            JSON.stringify(parsedIndex),
            seedUserId
          ]
        );
      }

      await tx.query(
        `
        update project_parameter_files
        set current_version_id = coalesce(current_version_id, $2),
          updated_at = now()
        where id = $1
        `,
        [fileId, versionId]
      );
      await ingestDtsFileVersion(tx, versionId, projectFile.source);

      const baselineSeedId = `seed-dts-baseline-${projectFile.projectId}`;
      const baselineResult = await tx.query<{ id: string }>(
        `
        insert into dts_release_baseline (
          id, organization_id, config_set_id, name, notes, status, created_by_user_id
        )
        values ($1, $2, $3, 'seed-v1', $4, 'released', $5)
        on conflict (config_set_id, name) do update set
          notes = excluded.notes,
          status = excluded.status,
          created_by_user_id = excluded.created_by_user_id
        returning id
        `,
        [
          baselineSeedId,
          organizationId,
          configSetId,
          "Compiled full-DTS seed baseline for parameter-management functional verification.",
          seedUserId
        ]
      );
      const baselineId = baselineResult.rows[0]?.id ?? baselineSeedId;
      await tx.query(
        `
        insert into dts_release_baseline_members (
          id, baseline_id, file_id, file_version_id, version_number
        )
        values ($1, $2, $3, $4, $5)
        on conflict (baseline_id, file_id) do update set
          file_version_id = excluded.file_version_id,
          version_number = excluded.version_number
        `,
        [`${baselineId}-${fileId}`, baselineId, fileId, versionId, versionNumber]
      );
    }
  });
}

type SeedFileRow = { id: string; current_version_id: string | null };

/**
 * Resolve each project's primary DTS without legacy parameter projection.
 * Must run after `seedM1DtsFiles`. Idempotent per primary file version.
 */
export async function seedM1SemanticTopology(
  db: Database,
  projectFiles: readonly DtsPowerSeedProjectFile[],
): Promise<void> {
  const auth = seedAuthContext();

  await db.transaction(async (tx) => {
    for (const projectFile of projectFiles) {
      const configSetId = `dcs-default-${projectFile.projectId}`;

      const primaryFile = await tx.query<SeedFileRow>(
        `select id, current_version_id from project_parameter_files where project_id = $1 and file_name = $2`,
        [projectFile.projectId, projectFile.fileName]
      );
      const primaryFileRow = primaryFile.rows[0];
      if (!primaryFileRow?.current_version_id) {
        throw new Error(
          `seedM1SemanticTopology requires ${projectFile.fileName} to already be seeded for ${projectFile.projectId}; run seedM1DtsFiles first.`
        );
      }

      const alreadyIngested = await tx.query<{ c: string }>(
        `
        select count(*)::text as c
        from dts_config_revision_members m
        inner join dts_config_revisions cr on cr.id = m.config_revision_id
        where cr.config_set_id = $1 and m.file_version_id = $2
        `,
        [configSetId, primaryFileRow.current_version_id]
      );
      if (Number(alreadyIngested.rows[0]?.c ?? 0) > 0) {
        continue;
      }

      const manifest: ConfigRevisionManifest = {
        organizationId,
        projectId: projectFile.projectId,
        configSetId,
        entryFile: projectFile.fileName,
        includeSearchPaths: ["."],
        overlayOrder: [],
        members: [
          {
            fileId: primaryFileRow.id,
            fileVersionId: primaryFileRow.current_version_id,
            fileName: projectFile.fileName,
            role: "base",
            sortOrder: 0,
            content: projectFile.source
          }
        ]
      };
      await ingestConfigRevisionInTransaction(tx, manifest, auth, undefined);
    }
  });

}

/** Default demo mutation: nudge one sc8562 property so its binding gains a 2nd revision. */
export const BINDING_REVISION_HISTORY_DEMO = {
  projectId: "aurora",
  find: "watchdog_time = <5000>;",
  replace: "watchdog_time = <6000>;"
} as const;

export async function seedM1BindingRevisionHistory(
  db: RootDatabase,
  objectStore: ObjectStore,
  projectFiles: readonly DtsPowerSeedProjectFile[],
  options: { projectId?: string; find?: string; replace?: string } = {}
): Promise<void> {
  const projectId = options.projectId ?? BINDING_REVISION_HISTORY_DEMO.projectId;
  const find = options.find ?? BINDING_REVISION_HISTORY_DEMO.find;
  const replace = options.replace ?? BINDING_REVISION_HISTORY_DEMO.replace;
  if (!projectFiles.some((file) => file.projectId === projectId && file.source.includes(find)) || find === replace) return;
  const propertyKey = find.split("=")[0]!.trim();
  const baseValue = find.slice(find.indexOf("=") + 1).trim().replace(/;$/, "");
  const targetValue = replace.slice(replace.indexOf("=") + 1).trim().replace(/;$/, "");
  const bindings = await listCatalogBindingRowsForProject(db, seedAuthContext(), { projectId });
  const binding = bindings.find((item) => item.propertyKey === propertyKey);
  if (!binding) throw new Error(`Canonical history seed requires ${propertyKey}'s Binding.`);
  if (binding.rawValue === targetValue) return;
  if (binding.rawValue !== baseValue) throw new Error(`Canonical history seed refuses to replace an unexpected ${propertyKey} value.`);
  const pins = await loadCanonicalBindingPins(db, { organizationId, projectId, bindingId: binding.id });
  if (!pins) throw new Error("Canonical history seed requires exact source pins.");
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Canonical history seed requires a published Catalog.");
  const submitter = await getAuthContext(db, "u-liu-min");
  const reviewer = await getAuthContext(db, "u-sun-mei");
  const refusalSink = createTrustedRefusalAuditSink(db);
  const invocation = createUserInvocation(submitter);
  const draft = await createCanonicalValueDraft(db, submitter, {
    projectId, bindingId: binding.id, targetValue: parseDtsValue(propertyKey, targetValue).value,
    reason: "M1 canonical source history demo", baseRevisionId: pins.configRevisionId,
    baseCurrentValueId: pins.currentValueId,
  }, { objectStore, invocation, requestId: "seed-m1-history-draft", refusalSink });
  const request = await submitCanonicalValueChange(db, submitter, {
    projectId, draftId: draft.id, assignedToUserId: reviewer.user.id,
    invocation, requestId: "seed-m1-history-submit", refusalSink,
  });
  await reviewCanonicalValueChange(db, reviewer, {
    projectId, requestId: request.id, decision: "approve",
  }, { objectStore, snapshot, invocation: createUserInvocation(reviewer), traceId: "seed-m1-history-review", refusalSink });
}


/** Parse-only integrity gate for committed `*-board.dts` artifacts (no dtc required). */
export function assertCommittedDtsSeedParses(projectFiles: readonly DtsPowerSeedProjectFile[]) {
  for (const file of projectFiles) {
    try {
      parseDts(file.source);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Committed DTS seed artifact failed to parse for ${file.projectId}: ${detail}`);
    }
  }
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M1 parameter data.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const configPath = path.join(root, "src", "config", "power-management.json");
  const compatibilityConfig = parsePowerManagementConfig(configPath, await readFile(configPath, "utf8"));
  const projectFiles = await loadCommittedDtsSeedFiles(root);
  const auroraPrimary = projectFiles.find((file) => file.projectId === "aurora")?.source;
  if (!auroraPrimary) {
    throw new Error("Committed aurora-board.dts seed artifact is missing.");
  }
  const dtsSeed = buildDtsPowerSeed(auroraPrimary);
  assertCommittedDtsSeedParses(projectFiles);
  console.log(
    "Committed project-primary DTS seed boards passed parse-only integrity checks. Optional dtc compile: npm run dtc:seed:compile."
  );
  const modulesByName = new Map(
    [...(compatibilityConfig.parameterModules ?? []), ...dtsSeed.parameterModules].map((module) => [module.name, module])
  );
  const config: PowerManagementConfig = {
    ...compatibilityConfig,
    parameterModules: [...modulesByName.values()],
    parameterLibrary: [
      ...compatibilityConfig.parameterLibrary,
      ...dtsSeed.parameterLibrary.map(toPowerManagementParameter)
    ]
  };
  try {
    await ensurePublishedVendorCatalog(db);
    await seedM1Parameters(db, config);
    await seedM1DtsFiles(db, createObjectStoreFromEnv(env), projectFiles);
    await seedM1SemanticTopology(db, projectFiles);
    const canonical = await ensureCanonicalCatalogAfterLegacySeed(db, seedAuthContext(), {
      organizationId,
      seedDigest: "seed-m1-canonical",
    });
    await seedM1BindingRevisionHistory(db, createObjectStoreFromEnv(env), projectFiles);
    console.log(
      "Seeded M1 canonical Catalog, source-backed Bindings, Project values and source-commit history.",
      `Canonical catalog ${canonical.catalogReleaseId ?? "unpublished"}; written=${JSON.stringify(canonical.written)}; skipped=${canonical.skipped.join(",") || "none"}.`
    );
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
