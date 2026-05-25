import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";

type PowerManagementProject = {
  id: string;
  name: string;
  code: string;
};

type PowerManagementParameterValue = {
  currentValue: string;
  recommendedValue: string;
};

type PowerManagementParameter = {
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

type PowerManagementConfig = {
  projects: PowerManagementProject[];
  parameterLibrary: PowerManagementParameter[];
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = loadServerEnv(process.env);
const organizationId = "org-chargelab";
const seedUserId = "u-xu-yun";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed M1 parameter data.");
}

const db = createPostgresDatabase(env.DATABASE_URL);
const configPath = path.join(root, "src", "config", "power-management.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as PowerManagementConfig;

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
        [`${project.id}-${moduleName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, organizationId, project.id, moduleName, index]
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
      await tx.query(
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
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
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
        select $1, $2, $3, $4, $5, 1, $6, $7
        where not exists (
          select 1 from parameter_history_entries
          where project_parameter_value_id = $5
        )
        `,
        [
          `${projectParameterValueId}-history-v1`,
          organizationId,
          project.id,
          parameter.id,
          projectParameterValueId,
          value.currentValue,
          seedUserId
        ]
      );
    }
  }
});

console.log("Seeded M1 parameter data.");
