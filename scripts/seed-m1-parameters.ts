import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";

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
  values: Record<string, PowerManagementParameterValue | undefined>;
};

export type PowerManagementConfig = {
  projects: PowerManagementProject[];
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

    const modules = [...new Set(config.parameterLibrary.map((parameter) => parameter.module))];
    for (const project of config.projects) {
      for (const [index, moduleName] of modules.entries()) {
        await tx.query(
          `
          insert into project_modules (id, organization_id, project_id, name, sort_order)
          values ($1, $2, $3, $4, $5)
          on conflict (project_id, name) do update set
            organization_id = excluded.organization_id,
            sort_order = excluded.sort_order
          `,
          [
            `${project.id}-${moduleName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
            organizationId,
            project.id,
            moduleName,
            index
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
          risk
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
          parameter.risk
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
            recommended_value,
            value_version,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, 1, $7)
          on conflict (project_id, parameter_definition_id) do update set
            organization_id = excluded.organization_id,
            current_value = excluded.current_value,
            recommended_value = excluded.recommended_value,
            value_version = case
              when project_parameter_values.current_value is distinct from excluded.current_value
                then project_parameter_values.value_version + 1
              else project_parameter_values.value_version
            end,
            updated_by_user_id = excluded.updated_by_user_id,
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
            seedUserId
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

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M1 parameter data.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const configPath = path.join(root, "src", "config", "power-management.json");
  const config = parsePowerManagementConfig(configPath, await readFile(configPath, "utf8"));
  await seedM1Parameters(db, config);

  console.log("Seeded M1 parameter data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
