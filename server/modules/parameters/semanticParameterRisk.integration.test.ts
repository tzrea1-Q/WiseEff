/**
 * Post-cutover risk source: change-request routing and the high-risk merge gate read
 * `impact.risk`, which flows from getProjectParameterForUpdate. The semantic branch used to
 * hardcode `'Low' as risk`, so every post-cutover change request looked Low-risk and the
 * High -> hardware_review routing and the high-risk double-review merge gate never fired.
 * These tests assert the semantic reads surface the real parameter_specs.risk (migration 0052).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { getProjectParameterForUpdate } from "./repository";
import { listSemanticParameters } from "./semanticParameterReads";

const ORG = "org-cr-risk";
const USER = "user-cr-risk";
const PROJECT = "project-cr-risk";
const SPEC = "pspec-cr-risk-high";
const MODULE = "mod-cr-risk-unclassified";
const BINDING = "binding-cr-risk-high";

const databaseAvailable = await isTestDatabaseAvailable();

async function seedHighRiskBinding(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'CR Risk Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'CR Risk', 'cr-risk@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'CR Risk Project', 'CRR', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key, risk)
     values ($1, $2, 'dts', 'sc8562/gpio_int', 'High')`,
    [SPEC, ORG]
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, parent_id, sort_order)
     values ($1, $2, 'Unclassified', 'Unclassified', 0, 'unclassified', 'auto', null, 0)`,
    [MODULE, ORG]
  );
  await db.query(
    `insert into project_parameter_bindings (id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id)
     values ($1, $2, $3, $4, $5, null)`,
    [BINDING, ORG, PROJECT, SPEC, MODULE]
  );
}

describe.skipIf(!databaseAvailable)("post-cutover parameter risk source", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    setParameterIdentityMode("semantic");
    await seedHighRiskBinding(db);
  });

  afterEach(async () => {
    setParameterIdentityMode(null);
    await db?.rollback();
    db = undefined;
  });

  it("getProjectParameterForUpdate returns the spec risk that drives review routing and the merge gate", async () => {
    const parameter = await getProjectParameterForUpdate(db!, {
      organizationId: ORG,
      projectId: PROJECT,
      parameterId: BINDING
    });
    expect(parameter?.risk).toBe("High");
  });

  it("listSemanticParameters surfaces the spec risk instead of a hardcoded Low", async () => {
    const rows = await listSemanticParameters(db!, { organizationId: ORG, limit: 50 });
    const row = rows.find((candidate) => candidate.id === BINDING);
    expect(row?.risk).toBe("High");
  });
});
