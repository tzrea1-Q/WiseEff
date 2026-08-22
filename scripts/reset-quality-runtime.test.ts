import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetQualityRuntime,
  resolveFlatOrLegacyDefinitionsTable,
  resolveFlatOrLegacyPpvTable
} from "./reset-quality-runtime";
import { cleanupQualityVisualReview, seedQualityVisualReview } from "./seed-quality-visual-review";
import { seedQualityRuntime } from "../e2e/quality/helpers";
import type { Database, Queryable } from "../server/shared/database/client";

function createRecordingDb(handler?: (text: string, values: unknown[]) => { rows: unknown[]; rowCount: number }): {
  db: Database;
  queries: Array<{ text: string; values: unknown[] }>;
} {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const tx: Queryable = {
    async query(text, values = []) {
      const normalized = text.replace(/\s+/g, " ").trim();
      queries.push({ text: normalized, values });
      if (handler) return handler(normalized, values);
      return { rows: [], rowCount: 0 };
    }
  };
  const db: Database = {
    query: tx.query,
    async transaction(callback) {
      return callback(tx);
    }
  };
  return { db, queries };
}

const exactFixtureRequestRow = {
  organization_id: "org-chargelab",
  submission_round_id: "PSR-2026-08-22-001",
  project_id: "aurora",
  base_version: 1,
  current_value_matches_binding: true,
  target_value: "<4600 0>",
  status: "hardware_review",
  submitter_user_id: "u-zhao-heng",
  assigned_to_user_id: "u-wang-jie",
  workflow_hardware_committer_user_id: "u-wang-jie",
  workflow_software_committer_user_id: "u-sun-mei",
  workflow_software_user_id: "u-liu-min",
  reviewer_note: null,
  reject_reason: null,
  fast_track: false,
  specification_key: "vendor/nodename/battery0/cccv_0",
  binding_matches_seed_selection: true,
  action: "set",
  base_config_revision_id: null,
  binding_revision_id: null,
  property_occurrence_id: null,
  source_file_version_id: null,
  expected_checksum: null,
  occurrence_span: null,
  candidate_config_revision_id: null,
  edit_subject_kind: "binding",
  logical_node_id: null,
  created_at_matches: true,
  updated_at_matches: true
};

const exactFixtureRoundRow = {
  organization_id: "org-chargelab",
  project_id: "aurora",
  submitter_user_id: "u-zhao-heng",
  status: "hardware_review",
  summary: "Aurora 快充参数审阅",
  created_at_matches: true,
  updated_at_matches: true
};

const exactFixtureItemRow = {
  organization_id: "org-chargelab",
  submission_round_id: "PSR-2026-08-22-001",
  change_request_id: "PRQ-8910",
  current_value_matches_request: true,
  target_value: "<4600 0>",
  reason: "将 Aurora 电池 CCCV 起始电压从 4500 调整为 4600",
  binding_matches_request: true,
  action: "set",
  candidate_config_revision_id: null,
  edit_subject_kind: "binding",
  logical_node_id: null
};

type FixtureRowScope = "request" | "round" | "item";

const omittedFixtureOwnershipNearCollisions: Array<{
  scope: FixtureRowScope;
  field: string;
  changedValue: string | number | boolean | null;
}> = [
  { scope: "request", field: "base_version", changedValue: 2 },
  { scope: "request", field: "current_value_matches_binding", changedValue: false },
  { scope: "request", field: "status", changedValue: "merged" },
  { scope: "request", field: "submitter_user_id", changedValue: "u-foreign" },
  { scope: "request", field: "assigned_to_user_id", changedValue: "u-foreign" },
  { scope: "request", field: "workflow_hardware_committer_user_id", changedValue: "u-foreign" },
  { scope: "request", field: "workflow_software_committer_user_id", changedValue: "u-foreign" },
  { scope: "request", field: "workflow_software_user_id", changedValue: "u-foreign" },
  { scope: "request", field: "reviewer_note", changedValue: "foreign note" },
  { scope: "request", field: "reject_reason", changedValue: "foreign reason" },
  { scope: "request", field: "fast_track", changedValue: true },
  { scope: "request", field: "binding_matches_seed_selection", changedValue: false },
  { scope: "request", field: "base_config_revision_id", changedValue: "revision-foreign" },
  { scope: "request", field: "binding_revision_id", changedValue: "revision-foreign" },
  { scope: "request", field: "property_occurrence_id", changedValue: "occurrence-foreign" },
  { scope: "request", field: "source_file_version_id", changedValue: "source-foreign" },
  { scope: "request", field: "expected_checksum", changedValue: "checksum-foreign" },
  { scope: "request", field: "occurrence_span", changedValue: "span-foreign" },
  { scope: "request", field: "candidate_config_revision_id", changedValue: "revision-foreign" },
  { scope: "request", field: "edit_subject_kind", changedValue: "property" },
  { scope: "request", field: "logical_node_id", changedValue: "node-foreign" },
  { scope: "request", field: "created_at_matches", changedValue: false },
  { scope: "request", field: "updated_at_matches", changedValue: false },
  { scope: "round", field: "created_at_matches", changedValue: false },
  { scope: "round", field: "updated_at_matches", changedValue: false },
  { scope: "item", field: "current_value_matches_request", changedValue: false },
  { scope: "item", field: "binding_matches_request", changedValue: false },
  { scope: "item", field: "candidate_config_revision_id", changedValue: "revision-foreign" },
  { scope: "item", field: "edit_subject_kind", changedValue: "property" },
  { scope: "item", field: "logical_node_id", changedValue: "node-foreign" }
];

describe("quality runtime reset wiring", () => {
  beforeEach(() => {
    vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "true");
    vi.stubEnv("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME", "wiseeff_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects direct visual fixture writes without the isolated-database opt-in", async () => {
    vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "");
    const { db, queries } = createRecordingDb();

    await expect(seedQualityVisualReview(db)).rejects.toThrow(
      "WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true"
    );
    await expect(cleanupQualityVisualReview(db)).rejects.toThrow(
      "WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true"
    );
    expect(queries).toEqual([]);
  });

  it("rejects visual fixture writes when current_database does not match the owned database", async () => {
    const { db, queries } = createRecordingDb((text) => {
      if (text.includes("current_database()")) {
        return { rows: [{ database_name: "shared_target" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(seedQualityVisualReview(db)).rejects.toThrow(
      'expected owned database "wiseeff_test", received "shared_target"'
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("current_database()");
  });

  it("fails closed before cleanup when a fixed request id belongs to another row", async () => {
    const { db, queries } = createRecordingDb((text) => {
      if (text.includes("current_database()")) {
        return { rows: [{ database_name: "wiseeff_test" }], rowCount: 1 };
      }
      if (text.includes("from parameter_change_requests cr")) {
        return {
          rows: [{
            organization_id: "org-foreign",
            submission_round_id: "PSR-FOREIGN",
            project_id: "foreign-project",
            target_value: "unsafe",
            action: "set",
            specification_key: "foreign/key"
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(cleanupQualityVisualReview(db)).rejects.toThrow(
      "Refusing to overwrite non-fixture parameter_change_requests row PRQ-8910"
    );
    expect(queries.some((query) => /^(delete|update) /.test(query.text))).toBe(false);
  });

  it.each(omittedFixtureOwnershipNearCollisions)(
    "fails closed before cleanup when a $scope near-collision differs only in $field",
    async ({ scope, field, changedValue }) => {
      const { db, queries } = createRecordingDb((text) => {
        if (text.includes("current_database()")) {
          return { rows: [{ database_name: "wiseeff_test" }], rowCount: 1 };
        }
        if (text.includes("from parameter_change_requests cr")) {
          const row = scope === "request"
            ? { ...exactFixtureRequestRow, [field]: changedValue }
            : exactFixtureRequestRow;
          return { rows: [row], rowCount: 1 };
        }
        if (text.includes("from parameter_submission_rounds")) {
          const row = scope === "round"
            ? { ...exactFixtureRoundRow, [field]: changedValue }
            : exactFixtureRoundRow;
          return { rows: [row], rowCount: 1 };
        }
        if (text.includes("from parameter_submission_items")) {
          const row = scope === "item"
            ? { ...exactFixtureItemRow, [field]: changedValue }
            : exactFixtureItemRow;
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(cleanupQualityVisualReview(db)).rejects.toThrow(
        `Refusing to overwrite non-fixture ${scope === "request"
          ? "parameter_change_requests row PRQ-8910"
          : scope === "round"
            ? "parameter_submission_rounds row PSR-2026-08-22-001"
            : "parameter_submission_items row PSI-2026-08-22-001"}`
      );
      expect(queries.some((query) => /^(delete|update) /.test(query.text))).toBe(false);
    }
  );

  it("seeds one internally consistent review request and submission item", async () => {
    const { db, queries } = createRecordingDb((text) => {
      if (text.includes("current_database()")) {
        return { rows: [{ database_name: "wiseeff_test" }], rowCount: 1 };
      }
      if (text.includes("from parameter_change_requests cr")) {
        return {
          rows: [exactFixtureRequestRow],
          rowCount: 1
        };
      }
      if (text.includes("from parameter_submission_rounds")) {
        return {
          rows: [exactFixtureRoundRow],
          rowCount: 1
        };
      }
      if (text.includes("from parameter_submission_items")) {
        return {
          rows: [exactFixtureItemRow],
          rowCount: 1
        };
      }
      if (text.includes("select b.id as binding_id")) {
        return {
          rows: [{ binding_id: "binding-1", parameter_spec_id: "spec-1", current_value: "<4500 0>" }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(seedQualityVisualReview(db)).resolves.toEqual({
      requestId: "PRQ-8910",
      roundId: "PSR-2026-08-22-001",
      bindingId: "binding-1"
    });

    const bindingSelection = queries.find((query) => query.text.startsWith("select b.id as binding_id"));
    expect(bindingSelection?.values).toEqual(["vendor/nodename/battery0/cccv_0"]);

    const itemInsert = queries.find((query) => query.text.includes("insert into parameter_submission_items"));
    expect(itemInsert?.values).toEqual([
      "PSI-2026-08-22-001",
      "PSR-2026-08-22-001",
      "PRQ-8910",
      "<4500 0>",
      "<4600 0>",
      "binding-1",
      "将 Aurora 电池 CCCV 起始电压从 4500 调整为 4600"
    ]);
    expect(queries.findIndex((query) => query.text.includes("delete from parameter_submission_items"))).toBeLessThan(
      queries.findIndex((query) => query.text.includes("delete from parameter_change_requests"))
    );
  });

  it("removes only the exact visual review fixture and leaves unknown requests untouched", async () => {
    const requestIds = new Set(["PRQ-8910", "PRQ-UNKNOWN"]);
    const { db, queries } = createRecordingDb((text, values) => {
      if (text.includes("current_database()")) {
        return { rows: [{ database_name: "wiseeff_test" }], rowCount: 1 };
      }
      if (text.includes("from parameter_change_requests cr")) {
        return {
          rows: [exactFixtureRequestRow],
          rowCount: 1
        };
      }
      if (text.includes("from parameter_submission_rounds")) {
        return {
          rows: [exactFixtureRoundRow],
          rowCount: 1
        };
      }
      if (text.includes("from parameter_submission_items")) {
        return {
          rows: [exactFixtureItemRow],
          rowCount: 1
        };
      }
      if (text === "delete from parameter_change_requests where id = $1") {
        requestIds.delete(String(values[0]));
      }
      return { rows: [], rowCount: 0 };
    });

    await cleanupQualityVisualReview(db);

    expect(requestIds).toEqual(new Set(["PRQ-UNKNOWN"]));
    expect(queries.map((query) => query.text).filter((text) => /^(delete|update) /.test(text))).toEqual([
      "delete from parameter_review_decisions where request_id = $1",
      "delete from parameter_submission_items where id = $1 and change_request_id = $2",
      "update parameter_history_entries set request_id = null where request_id = $1",
      "delete from parameter_change_requests where id = $1",
      "delete from parameter_submission_rounds where id = $1"
    ]);
    expect(queries.flatMap((query) => query.values)).not.toContain("PRQ-UNKNOWN");
  });

  it("resets transient user-governance state before quality gate seeding", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");

    expect(helpers).toContain("reset:quality-runtime");
    expect(helpers.indexOf('"reset:quality-runtime"')).toBeLessThan(helpers.indexOf('"db:seed:m0"'));
  });

  it("does not invoke any base seed script in target read-only mode", () => {
    vi.stubEnv("WISEEFF_QUALITY_SKIP_SEED", "true");
    const runScript = vi.fn();

    seedQualityRuntime(runScript);

    expect(runScript).not.toHaveBeenCalled();
  });

  it("keeps the review fixture out of the skippable base seed lifecycle", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const packageJson = readFileSync("package.json", "utf8");

    expect(packageJson).toContain('"seed:quality:visual-review"');
    expect(packageJson).toContain('"cleanup:quality:visual-review"');
    expect(helpers).toContain('"seed:quality:visual-review"');
    const baseSeedLifecycle = helpers.slice(
      helpers.indexOf("export function seedQualityRuntime"),
      helpers.indexOf("export function seedQualityVisualReviewFixture")
    );
    expect(baseSeedLifecycle).not.toContain('"seed:quality:visual-review"');
  });

  it("installs and removes the visual review fixture even when base seeding is skipped", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).toContain("export function seedQualityVisualReviewFixture");
    expect(helpers).toContain("export function cleanupQualityVisualReviewFixture");
    expect(visualSpec).toMatch(
      /beforeAll[\s\S]*seedQualityRuntime\(\)[\s\S]*seedQualityVisualReviewFixture\(\)/
    );
    expect(visualSpec).toMatch(/afterAll[\s\S]*cleanupQualityVisualReviewFixture\(\)/);
  });

  it("keeps visual review fixture writes behind an explicit isolated-database opt-in", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");
    const fixtureScript = readFileSync("scripts/seed-quality-visual-review.ts", "utf8");
    const authorization = readFileSync("scripts/quality-visual-review-authorization.ts", "utf8");
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const localQualityJob = workflow.slice(
      workflow.indexOf("  acceptance-quality:"),
      workflow.indexOf("  acceptance-smoke:"),
    );
    const targetQualityJobStart = workflow.indexOf("  target-synthetic-acceptance:");
    const targetQualityJob = workflow.slice(
      targetQualityJobStart,
      workflow.indexOf("  required:", targetQualityJobStart),
    );

    expect(helpers).toContain("visualReviewFixtureConfigured");
    expect(helpers).toMatch(/seedQualityVisualReviewFixture[\s\S]*assertVisualReviewFixtureAllowed/);
    expect(helpers).toMatch(/cleanupQualityVisualReviewFixture[\s\S]*assertVisualReviewFixtureAllowed/);
    expect(fixtureScript).toContain("assertVisualReviewFixtureDatabase");
    expect(authorization).toContain("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE");
    expect(authorization).toContain("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME");
    expect(authorization).toContain("current_database()");
    expect(visualSpec).toMatch(/parameter-review[\s\S]*test\.skip/);
    expect(localQualityJob).toContain("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true");
    expect(localQualityJob).toContain("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME=wiseeff");
    expect(targetQualityJob).toContain('WISEEFF_QUALITY_SKIP_SEED: "true"');
    expect(targetQualityJob).not.toContain("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true");
    expect(targetQualityJob).not.toContain("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME");
  });

  it("clears transient local-auth and acceptance user-governance rows before seeds rebuild stable users", async () => {
    const { db, queries } = createRecordingDb();

    await resetQualityRuntime(db);

    expect(queries[0].text).toBe(
      "update users set organization_id = 'org-chargelab' where id = any($1::text[])"
    );
    expect(queries.map((query) => query.text).slice(1, 6)).toEqual([
      "delete from local_registration_role_requests",
      "delete from auth_sessions",
      "delete from user_password_credentials",
      "delete from user_role_bindings",
      "delete from audit_events where app in ('auth', 'user-governance') or target_type = 'user'"
    ]);
    expect(queries.at(-1)?.text).toBe("delete from users where id <> all($1::text[])");
    expect(queries.some((query) => query.text.includes("delete from parameter_drafts where user_id"))).toBe(true);
    expect(queries.some((query) => query.text.includes("probe-edit-%.dts"))).toBe(true);
    expect(queries.some((query) => query.text.includes("FoldRegistryTestDG"))).toBe(true);
    expect(queries.some((query) => query.text.includes("compatible:vendor,fold_registry_test"))).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.text.includes("delete from project_modules") &&
          query.text.includes("child.path like root.path")
      )
    ).toBe(true);
    const deleteUsersIndex = queries.findIndex(
      (query) => query.text === "delete from users where id <> all($1::text[])"
    );
    const probeEditIndex = queries.findIndex((query) => query.text.includes("probe-edit-%.dts"));
    const demoModuleIndex = queries.findIndex((query) => query.text.includes("FoldRegistryTestDG"));
    expect(probeEditIndex).toBeGreaterThan(-1);
    expect(demoModuleIndex).toBeGreaterThan(-1);
    expect(probeEditIndex).toBeLessThan(deleteUsersIndex);
    expect(demoModuleIndex).toBeLessThan(deleteUsersIndex);
    expect(queries[0].values[0]).toEqual([
      "u-xu-yun",
      "u-zhao-heng",
      "u-liu-min",
      "u-wang-jie",
      "u-chen-na",
      "u-li-peng",
      "u-sun-mei"
    ]);
    expect(JSON.stringify(queries)).not.toContain("u-tao-lin");
  });

  it("nullifies flat PPV attribution when the pre-cutover table still exists", async () => {
    const { db, queries } = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "project_parameter_values") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await resetQualityRuntime(db);

    expect(
      queries.some((query) =>
        query.text.includes("update project_parameter_values set updated_by_user_id = null")
      )
    ).toBe(true);
    expect(
      queries.some((query) => query.text.includes("update legacy_project_parameter_values"))
    ).toBe(false);
  });

  it("nullifies renamed legacy PPV attribution after identity cutover", async () => {
    const { db, queries } = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "legacy_project_parameter_values") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await resetQualityRuntime(db);

    expect(
      queries.some((query) =>
        query.text.includes("update legacy_project_parameter_values set updated_by_user_id = null")
      )
    ).toBe(true);
    expect(
      queries.some((query) => query.text.includes("update project_parameter_values set updated_by_user_id"))
    ).toBe(false);
  });

  it("skips PPV attribution nullify when neither flat nor legacy table exists", async () => {
    const { db, queries } = createRecordingDb();

    await resetQualityRuntime(db);

    expect(
      queries.some(
        (query) =>
          query.text.includes("update project_parameter_values set updated_by_user_id") ||
          query.text.includes("update legacy_project_parameter_values set updated_by_user_id")
      )
    ).toBe(false);
  });

  it("resolveFlatOrLegacyPpvTable prefers flat name then legacy rename", async () => {
    const flatFirst = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "project_parameter_values") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(resolveFlatOrLegacyPpvTable(flatFirst.db)).resolves.toBe("project_parameter_values");

    const legacyOnly = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "legacy_project_parameter_values") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(resolveFlatOrLegacyPpvTable(legacyOnly.db)).resolves.toBe(
      "legacy_project_parameter_values"
    );

    const neither = createRecordingDb();
    await expect(resolveFlatOrLegacyPpvTable(neither.db)).resolves.toBeNull();
  });

  it("skips definition-table guards when neither flat nor legacy table exists", async () => {
    const { db, queries } = createRecordingDb();

    await resetQualityRuntime(db);

    expect(
      queries.some(
        (query) =>
          query.text.includes("from parameter_definitions") ||
          query.text.includes("from legacy_parameter_definitions")
      )
    ).toBe(false);
  });

  it("guards demo-module prune with flat definitions before cutover", async () => {
    const { db, queries } = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "parameter_definitions") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await resetQualityRuntime(db);

    expect(queries.some((query) => query.text.includes("from parameter_definitions pd"))).toBe(true);
    expect(queries.some((query) => query.text.includes("from legacy_parameter_definitions"))).toBe(false);
  });

  it("guards demo-module prune with renamed legacy definitions after cutover", async () => {
    const { db, queries } = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "legacy_parameter_definitions") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await resetQualityRuntime(db);

    expect(queries.some((query) => query.text.includes("from legacy_parameter_definitions pd"))).toBe(true);
    expect(queries.some((query) => query.text.includes("from parameter_definitions pd"))).toBe(false);
  });

  it("resolveFlatOrLegacyDefinitionsTable prefers flat name then legacy rename", async () => {
    const flatFirst = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "parameter_definitions") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(resolveFlatOrLegacyDefinitionsTable(flatFirst.db)).resolves.toBe("parameter_definitions");

    const legacyOnly = createRecordingDb((text, values) => {
      if (text.includes("information_schema.tables") && values[0] === "legacy_parameter_definitions") {
        return { rows: [{ c: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(resolveFlatOrLegacyDefinitionsTable(legacyOnly.db)).resolves.toBe(
      "legacy_parameter_definitions"
    );

    const neither = createRecordingDb();
    await expect(resolveFlatOrLegacyDefinitionsTable(neither.db)).resolves.toBeNull();
  });
});
