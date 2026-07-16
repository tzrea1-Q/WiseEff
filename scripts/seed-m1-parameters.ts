import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { loadServerEnv } from "../server/config/env";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { buildDtsParsedIndex } from "../server/modules/parameter-files/parseIndex";
import { ingestDtsFileVersion } from "../server/modules/parameter-files/structuralIngest";
import type { ObjectStore } from "../server/modules/logs/objectStore";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { buildDtsPowerSeed, type DtsPowerSeedParameter, type DtsPowerSeedProjectFile } from "./dts-power-seed";
import { compileDtsSeedFiles, loadCommittedDtsSeedFiles } from "./compile-dts-seed";
import { LEGACY_SQL } from "../server/modules/parameter-topology/migration";

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
};

export type PowerManagementConfig = {
  projects: PowerManagementProject[];
  parameterModules?: PowerManagementParameterModule[];
  parameterLibrary: PowerManagementParameter[];
};

type ProjectParameterValueSeedRow = {
  id: string;
  value_version: number;
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
        parent: z.string().optional()
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
 * Legacy M1 seed rows still key on a flat `module` display field. Map the
 * semantic seed's `businessCategory` onto it here rather than reintroducing
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

export async function seedM1Parameters(db: Database, config: PowerManagementConfig): Promise<void> {
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
      const id = stableSeedId("pmod-seed", module.name);
      const parentId = module.parent ? moduleIdByName.get(module.parent) ?? null : null;
      const parentPath = module.parent ? modulePathByName.get(module.parent) ?? null : null;
      const modulePath = parentPath ? `${parentPath}/${id}` : id;
      const result = await tx.query<{ id: string }>(
        `
        insert into parameter_modules (
          id, organization_id, parent_id, name, path, depth, sort_order, description, scope
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (organization_id, (coalesce(parent_id, '')), name) do update set
          path = excluded.path,
          depth = excluded.depth,
          sort_order = excluded.sort_order,
          description = excluded.description,
          scope = excluded.scope,
          updated_at = now()
        returning id
        `,
        [
          id,
          organizationId,
          parentId,
          module.name,
          modulePath,
          module.parent ? (modulePath.match(/\//g)?.length ?? 0) + 1 : 1,
          index,
          module.description,
          module.scope
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

    for (const parameter of config.parameterLibrary) {
      await tx.query(
        `
        insert into parameter_definitions (
          id,
          organization_id,
          name,
          description,
          explanation,
          config_format,
          module,
          default_range,
          unit,
          risk,
          value_kind,
          parameter_module_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          description = excluded.description,
          explanation = excluded.explanation,
          config_format = excluded.config_format,
          module = excluded.module,
          default_range = excluded.default_range,
          unit = excluded.unit,
          risk = excluded.risk,
          value_kind = excluded.value_kind,
          parameter_module_id = excluded.parameter_module_id,
          updated_at = now()
        `,
        [
          parameter.id,
          organizationId,
          parameter.name,
          parameter.description,
          parameter.explanation,
          parameter.configFormat,
          parameter.module,
          parameter.range,
          parameter.unit,
          parameter.risk,
          parameter.valueKind ??
            (parameter.configFormat.trim().startsWith("DTS:") ||
            parameter.configFormat.toLowerCase().includes("string-list")
              ? "complex"
              : "scalar"),
          moduleIdByName.get(parameter.module) ?? null
        ]
      );

      for (const project of config.projects) {
        const value = parameter.values[project.id];
        if (!value) {
          continue;
        }

        const projectParameterValueId = `${project.id}-${parameter.id}`;
        const projectParameterValue = await tx.query<ProjectParameterValueSeedRow>(
          `
          insert into project_parameter_values (
            id,
            organization_id,
            project_id,
            parameter_definition_id,
            current_value,
            ${LEGACY_SQL.recommendedValueColumn},
            value_version,
            updated_by_user_id,
            source_file_name,
            source_node_path
          )
          values ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
          on conflict (project_id, parameter_definition_id) do update set
            organization_id = excluded.organization_id,
            current_value = excluded.current_value,
            ${LEGACY_SQL.recommendedValueColumn} = excluded.${LEGACY_SQL.recommendedValueColumn},
            value_version = case
              when project_parameter_values.current_value is distinct from excluded.current_value
                then project_parameter_values.value_version + 1
              else project_parameter_values.value_version
            end,
            updated_by_user_id = excluded.updated_by_user_id,
            source_file_name = excluded.source_file_name,
            source_node_path = excluded.source_node_path,
            updated_at = now()
          returning id, value_version
          `,
          [
            projectParameterValueId,
            organizationId,
            project.id,
            parameter.id,
            value.currentValue,
            value.recommendedValue,
            seedUserId,
            parameter.sourceFileName ?? null,
            parameter.sourceNodePath ?? null
          ]
        );
        const seededValue = projectParameterValue.rows[0];
        if (!seededValue) {
          throw new Error(`Failed to seed parameter value for project ${project.id} and definition ${parameter.id}.`);
        }

        await tx.query(
          `
          insert into parameter_history_entries (
            id,
            organization_id,
            project_id,
            parameter_definition_id,
            project_parameter_value_id,
            version,
            value,
            changed_by_user_id
          )
          select $1, $2, $3, $4, $5, $6, $7, $8
          where not exists (
            select 1 from parameter_history_entries
            where project_parameter_value_id = $5
              and version = $6
          )
          `,
          [
            `${seededValue.id}-history-v${seededValue.value_version}`,
            organizationId,
            project.id,
            parameter.id,
            seededValue.id,
            seededValue.value_version,
            value.currentValue,
            seedUserId
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
        [fileSeedId, organizationId, projectFile.projectId, projectFile.fileName, configSetId, "overlay"]
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
        await tx.query(
          `
          update project_parameter_file_versions
          set storage_key = $2,
            size_bytes = $3,
            parsed_index = $4::jsonb,
            created_by_user_id = $5
          where id = $1
          `,
          [versionId, stored.storageKey, stored.fileSizeBytes, JSON.stringify(parsedIndex), seedUserId]
        );
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
        set current_version_id = $2,
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

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M1 parameter data.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const configPath = path.join(root, "src", "config", "power-management.json");
  const compatibilityConfig = parsePowerManagementConfig(configPath, await readFile(configPath, "utf8"));
  const baseDtsSource = await readFile(
    path.join(root, "src", "config", "dts-seed", "base-power-overlay.dts"),
    "utf8"
  );
  const dtsSeed = buildDtsPowerSeed(baseDtsSource);
  const projectFiles = await loadCommittedDtsSeedFiles(root);
  for (const generatedFile of dtsSeed.projectFiles) {
    const committedFile = projectFiles.find((file) => file.projectId === generatedFile.projectId);
    if (committedFile?.source !== generatedFile.source) {
      throw new Error(
        `Committed DTS seed artifact is stale for ${generatedFile.projectId}. Run npm run dts:seed:generate.`
      );
    }
  }
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
  await compileDtsSeedFiles(projectFiles);
  await seedM1Parameters(db, config);
  await seedM1DtsFiles(db, createObjectStoreFromEnv(env), projectFiles);

  console.log("Seeded M1 parameter data and full project DTS baselines.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
