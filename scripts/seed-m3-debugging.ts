import "dotenv/config";
import { pathToFileURL } from "node:url";

import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";

const organizationId = "org-chargelab";
const projectId = "aurora";
const deviceId = "sim-device-aurora-1";
const targetId = "sim-target-aurora-1";
const targetRef = "simulator://aurora-1";

type DebugParameterSeed = {
  id: string;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: "RO" | "RW";
  unit: string;
  rangeLabel: string;
  minValue: number;
  maxValue: number;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
  sortOrder: number;
};

const parameters: DebugParameterSeed[] = [
  {
    id: "dbg-fast-charge-current",
    name: "Fast charge current",
    key: "fast_charge_current",
    description: "Fast-charge constant current node for simulator write/readback validation.",
    module: "Battery Charging",
    nodePath: "/sys/class/power_supply/battery/constant_charge_current",
    accessMode: "RW",
    unit: "mA",
    rangeLabel: "0-5000",
    minValue: 0,
    maxValue: 5000,
    risk: "High",
    currentValue: "3000",
    targetValue: "3100",
    sortOrder: 10
  },
  {
    id: "dbg-input-current-limit",
    name: "Input current limit",
    key: "input_current_limit",
    description: "Adapter input current limit used by the simulator target.",
    module: "Battery Charging",
    nodePath: "/sys/class/power_supply/battery/input_current_limit",
    accessMode: "RW",
    unit: "mA",
    rangeLabel: "0-5000",
    minValue: 0,
    maxValue: 5000,
    risk: "Medium",
    currentValue: "2800",
    targetValue: "2900",
    sortOrder: 20
  },
  {
    id: "dbg-temp-limit",
    name: "Temperature limit",
    key: "temp_limit",
    description: "Battery temperature limit used to validate high-risk writes.",
    module: "Battery Safety",
    nodePath: "/sys/class/power_supply/battery/temp_limit",
    accessMode: "RW",
    unit: "C",
    rangeLabel: "30-70",
    minValue: 30,
    maxValue: 70,
    risk: "High",
    currentValue: "45",
    targetValue: "48",
    sortOrder: 30
  },
  {
    id: "dbg-cycle-count",
    name: "Cycle count",
    key: "cycle_count",
    description: "Read-only battery cycle count exposed by the simulator.",
    module: "Battery Health",
    nodePath: "/sys/class/power_supply/battery/cycle_count",
    accessMode: "RO",
    unit: "cycles",
    rangeLabel: "0-9999",
    minValue: 0,
    maxValue: 9999,
    risk: "Low",
    currentValue: "128",
    targetValue: "128",
    sortOrder: 40
  },
  {
    id: "dbg-readback-mismatch",
    name: "Readback mismatch probe",
    key: "readback_mismatch",
    description: "Simulator node configured to report a readback mismatch after writes.",
    module: "Diagnostics",
    nodePath: "/sys/class/power_supply/battery/readback_mismatch",
    accessMode: "RW",
    unit: "",
    rangeLabel: "0-9",
    minValue: 0,
    maxValue: 9,
    risk: "Low",
    currentValue: "1",
    targetValue: "2",
    sortOrder: 50
  }
];

export async function seedM3Debugging(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `
      insert into organizations (id, name)
      values ($1, $2)
      on conflict (id) do update set name = excluded.name
      `,
      [organizationId, "ChargeLab"]
    );

    await tx.query(
      `
      insert into debugging_devices (
        id,
        organization_id,
        project_id,
        name,
        transport,
        status,
        firmware,
        last_seen_at,
        metadata,
        updated_at
      )
      values ($1, $2, $3, $4, 'simulator', 'online', $5, now(), $6::jsonb, now())
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        project_id = excluded.project_id,
        name = excluded.name,
        transport = excluded.transport,
        status = excluded.status,
        firmware = excluded.firmware,
        last_seen_at = excluded.last_seen_at,
        metadata = excluded.metadata,
        updated_at = now()
      `,
      [
        deviceId,
        organizationId,
        projectId,
        "Aurora Simulator Device",
        "sim-fw-aurora-1",
        JSON.stringify({ fixture: "test-fixtures/debugging/simulator-state.json" })
      ]
    );

    await tx.query(
      `
      insert into debugging_targets (
        id,
        organization_id,
        project_id,
        device_id,
        protocol,
        target_ref,
        label,
        status,
        detected_at,
        metadata
      )
      values ($1, $2, $3, $4, 'hdc', $5, $6, 'detected', now(), $7::jsonb)
      on conflict (device_id, protocol, target_ref) do update set
        organization_id = excluded.organization_id,
        project_id = excluded.project_id,
        id = excluded.id,
        label = excluded.label,
        status = excluded.status,
        detected_at = excluded.detected_at,
        metadata = excluded.metadata
      `,
      [
        targetId,
        organizationId,
        projectId,
        deviceId,
        targetRef,
        "Aurora Simulator 1",
        JSON.stringify({ online: true })
      ]
    );

    for (const parameter of parameters) {
      await tx.query(
        `
        insert into debugging_parameters (
          id,
          organization_id,
          project_id,
          name,
          key,
          description,
          module,
          node_path,
          access_mode,
          unit,
          range_label,
          min_value,
          max_value,
          risk,
          current_value,
          target_value,
          sort_order,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
        on conflict (project_id, key) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          description = excluded.description,
          module = excluded.module,
          node_path = excluded.node_path,
          access_mode = excluded.access_mode,
          unit = excluded.unit,
          range_label = excluded.range_label,
          min_value = excluded.min_value,
          max_value = excluded.max_value,
          risk = excluded.risk,
          current_value = excluded.current_value,
          target_value = excluded.target_value,
          sort_order = excluded.sort_order,
          updated_at = now()
        `,
        [
          parameter.id,
          organizationId,
          projectId,
          parameter.name,
          parameter.key,
          parameter.description,
          parameter.module,
          parameter.nodePath,
          parameter.accessMode,
          parameter.unit,
          parameter.rangeLabel,
          parameter.minValue,
          parameter.maxValue,
          parameter.risk,
          parameter.currentValue,
          parameter.targetValue,
          parameter.sortOrder
        ]
      );

      await tx.query(
        `
        insert into debug_nodes (
          id, organization_id, project_id, name, description, detailed_description,
          write_format_example, write_format_hint, module, enabled
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        on conflict (id) do update set
          name = excluded.name,
          description = excluded.description,
          detailed_description = excluded.detailed_description,
          write_format_example = excluded.write_format_example,
          write_format_hint = excluded.write_format_hint,
          module = excluded.module,
          enabled = excluded.enabled,
          updated_at = now()
        `,
        [
          parameter.id,
          organizationId,
          projectId,
          parameter.name,
          parameter.description,
          parameter.description,
          parameter.id === "dbg-fast-charge-current" ? "3100" : "",
          parameter.id === "dbg-fast-charge-current"
            ? "输入毫安值，例如 3100，系统会通过 HDC 写入 constant_charge_current 节点。"
            : "",
          parameter.module
        ]
      );

      await tx.query(
        `
        insert into debug_node_bindings (
          id, organization_id, project_id, node_id, protocol, node_path, access_mode, enabled, notes
        )
        values ($1, $2, $3, $4, 'hdc', $5, $6, true, $7)
        on conflict (node_id, protocol) do update set
          node_path = excluded.node_path,
          access_mode = excluded.access_mode,
          enabled = excluded.enabled,
          notes = excluded.notes,
          updated_at = now()
        `,
        [
          `${parameter.id}:hdc`,
          organizationId,
          projectId,
          parameter.id,
          parameter.nodePath,
          parameter.accessMode,
          "Seeded HDC node binding."
        ]
      );

      await tx.query(
        `
        insert into debugging_parameter_node_bindings (
          id, organization_id, project_id, parameter_id, protocol, node_path, access_mode, enabled, notes, metadata, updated_at
        )
        values ($1, $2, $3, $4, 'hdc', $5, $6, true, $7, '{}'::jsonb, now())
        on conflict (parameter_id, protocol) do update set
          node_path = excluded.node_path,
          access_mode = excluded.access_mode,
          enabled = excluded.enabled,
          notes = excluded.notes,
          updated_at = now()
        `,
        [`${parameter.id}:hdc`, organizationId, projectId, parameter.id, parameter.nodePath, parameter.accessMode, "Seeded HDC node binding."]
      );
    }

    const moduleNames = [...new Set(parameters.map((parameter) => parameter.module.trim()).filter(Boolean))];
    for (const moduleName of moduleNames) {
      await tx.query(
        `
        insert into debug_node_modules (id, organization_id, name, description, scope)
        values ($1, $2, $3, '', '')
        on conflict (organization_id, name) do nothing
        `,
        [`dmod-${organizationId}-${moduleName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, organizationId, moduleName]
      );
    }
  });
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M3 debugging data.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  await seedM3Debugging(db);

  console.log("Seeded M3 debugging data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
