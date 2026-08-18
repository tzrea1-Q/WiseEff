/**
 * D6 / TD-049: binding and change-request reads pin `parameter_spec_version_id`.
 * Cross-spec match ranks definition_lifecycle active → deprecated → draft.
 * A higher-version draft must not steal a deprecated binding that still parses.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { aggregateHotspotGroups } from "./dashboard/hotspotRepository";
import { listParameterDefinitionsForImport } from "./importBatchRepository";
import { getProjectParameterForUpdate, listParameters } from "./repository";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  getChangeRequestById,
  listChangeRequests,
  listSubmissionRounds
} from "./reviewWorkflowRepository";
import type { BindingWriteLockFields } from "../parameter-drafts/types";
import { listSemanticParameters } from "./semanticParameterReads";
import { loadPinnedSpecVersionId } from "./specVersionSelection";
import { loadSpecCandidates } from "../parameter-topology/migration";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG = "org-td049";
const PROJECT = "project-td049";
const USER = "user-td049";
const SPEC = "spec-td049-deprecated";
const DRAFT_SPEC = "spec-td049-draft-rival";
const BINDING = "binding-td049";
const PINNED_VERSION = "psv-td049-v1";
const DRAFT_VERSION = "psv-td049-v2";
const PROPERTY_KEY = "gpio_int";

async function seedDeprecatedBindingWithDraftSuccessor(db: InMemoryTestDatabase) {
  await seedCoreGraph(db, {
    organization: { id: ORG, name: "TD049 Org" },
    users: [{ id: USER, name: "TD049 User", email: "td049@example.com" }],
    projects: [{ id: PROJECT, name: "TD049 Project", code: "T49" }]
  });
  await seedSpecBindingGraph(db, {
    organizationId: ORG,
    specs: [
      {
        id: SPEC,
        specificationKey: `sc8562/${PROPERTY_KEY}`,
        versions: [
          {
            id: PINNED_VERSION,
            version: 1,
            displayName: "gpio_int",
            description: "pinned-deprecated-meaning",
            valueShape: { kind: "cells", unit: "mA" },
            lifecycle: "deprecated"
          },
          {
            id: DRAFT_VERSION,
            version: 2,
            displayName: "gpio_int_draft",
            description: "draft-successor-must-not-win",
            valueShape: { kind: "string", unit: "A" },
            lifecycle: "draft"
          }
        ],
        propertySpec: { id: "dps-td049", propertyKey: PROPERTY_KEY }
      },
      {
        id: DRAFT_SPEC,
        specificationKey: `mystery/${PROPERTY_KEY}`,
        versions: [
          {
            id: "psv-td049-draft-rival",
            version: 9,
            displayName: "gpio_int_rival",
            description: "cross-spec-draft-must-not-win",
            valueShape: { kind: "string", unit: "V" },
            lifecycle: "draft"
          }
        ],
        propertySpec: { id: "dps-td049-rival", propertyKey: PROPERTY_KEY }
      }
    ],
    modules: [{ id: "pm-td049", name: "sc8562" }],
    configSets: [
      {
        id: "set-td049",
        projectId: PROJECT,
        revisions: [{ id: "rev-td049" }]
      }
    ],
    bindings: [
      {
        id: BINDING,
        projectId: PROJECT,
        parameterSpecId: SPEC,
        moduleId: "pm-td049",
        revisions: [
          {
            id: "bpr-td049",
            configRevisionId: "rev-td049",
            parameterSpecVersionId: PINNED_VERSION,
            rawValue: "<29>"
          }
        ]
      }
    ]
  });
  await db.query(`update parameter_specs set definition_lifecycle = 'deprecated' where id = $1`, [SPEC]);
  await db.query(`update parameter_specs set definition_lifecycle = 'draft' where id = $1`, [DRAFT_SPEC]);
}

describe.skipIf(!databaseAvailable)("D6 lifecycle ranking", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    setParameterIdentityMode("semantic");
    await seedDeprecatedBindingWithDraftSuccessor(db);
  });

  afterEach(async () => {
    setParameterIdentityMode(null);
    await db.rollback();
  });

  it("listSemanticParameters keeps the pinned deprecated version when a higher draft exists", async () => {
    const rows = await listSemanticParameters(db, { organizationId: ORG, limit: 50 });
    const row = rows.find((candidate) => candidate.id === BINDING);
    expect(row).toMatchObject({
      description: "pinned-deprecated-meaning",
      unit: "mA",
      value_kind: "cells",
      current_value: "<29>"
    });
  });

  it("listParameters and getProjectParameterForUpdate do not surface the draft successor", async () => {
    const listed = await listParameters(db, { organizationId: ORG, projectId: PROJECT });
    expect(listed.find((row) => row.id === BINDING)).toMatchObject({
      description: "pinned-deprecated-meaning",
      unit: "mA"
    });

    const forUpdate = await getProjectParameterForUpdate(db, {
      organizationId: ORG,
      projectId: PROJECT,
      parameterId: BINDING
    });
    expect(forUpdate).toMatchObject({
      unit: "mA",
      currentValue: "<29>"
    });
  });

  it("import matching reads the pinned version unit, not the draft successor", async () => {
    const candidates = await listParameterDefinitionsForImport(db, {
      organizationId: ORG,
      projectId: PROJECT,
      names: [PROPERTY_KEY],
      definitionIds: []
    });
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SPEC,
          unit: "mA",
          description: "pinned-deprecated-meaning",
          currentValue: "<29>"
        })
      ])
    );
  });

  it("change-request display pins the locked binding revision version", async () => {
    await db.query(`alter table parameter_change_requests drop column if exists parameter_definition_id`);
    await db.query(`alter table parameter_change_requests drop column if exists project_parameter_value_id`);
    await db.query(`alter table parameter_submission_items drop column if exists project_parameter_value_id`);
    await createSubmissionRound(db, {
      id: "round-td049",
      organizationId: ORG,
      projectId: PROJECT,
      submitterUserId: USER,
      status: "hardware_review",
      summary: "TD049"
    });
    await createChangeRequest(db, {
      id: "cr-td049",
      organizationId: ORG,
      submissionRoundId: "round-td049",
      projectId: PROJECT,
      parameterId: BINDING,
      parameterDefinitionId: "",
      baseVersion: 1,
      currentValue: "<29>",
      targetValue: "<30>",
      status: "hardware_review",
      submitterUserId: USER,
      parameterSpecId: SPEC,
      projectParameterBindingId: BINDING,
      writeLock: {
        baseConfigRevisionId: "rev-td049",
        bindingRevisionId: "bpr-td049",
        expectedChecksum: "checksum-td049"
      } as BindingWriteLockFields
    });
    await createSubmissionItem(db, {
      id: "item-td049",
      organizationId: ORG,
      submissionRoundId: "round-td049",
      changeRequestId: "cr-td049",
      parameterId: BINDING,
      currentValue: "<29>",
      targetValue: "<30>",
      reason: "pin check",
      projectParameterBindingId: BINDING
    });

    const listed = await listChangeRequests(db, { organizationId: ORG, projectId: PROJECT });
    expect(listed.find((row) => row.id === "cr-td049")).toMatchObject({
      parameterDescription: "pinned-deprecated-meaning"
    });

    const byId = await getChangeRequestById(db, { organizationId: ORG, requestId: "cr-td049" });
    expect(byId).toMatchObject({
      parameterDescription: "pinned-deprecated-meaning"
    });

    const rounds = await listSubmissionRounds(db, { organizationId: ORG });
    expect(rounds[0]?.items[0]).toMatchObject({
      name: PROPERTY_KEY,
      unit: "mA"
    });
  });

  it("writeback loads the pinned binding-revision version instead of ranking drafts", async () => {
    const pinned = await loadPinnedSpecVersionId(db, "bpr-td049");
    expect(pinned).toBe(PINNED_VERSION);
    expect(pinned).not.toBe(DRAFT_VERSION);
  });

  it("dashboard identity titles pin the binding revision when one is in scope", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: ORG,
      projectId: PROJECT,
      dimension: "parameter",
      windowStart: "2026-01-01T00:00:00Z",
      windowEnd: "2026-12-31T00:00:00Z"
    });
    expect(groups.find((group) => group.groupId === SPEC)?.title).toBe(PROPERTY_KEY);
    expect(groups.some((group) => group.title === "gpio_int_draft")).toBe(false);
  });

  it("cross-spec match ranks deprecated above a higher-version draft", async () => {
    const candidates = await loadSpecCandidates(db, {
      organizationId: ORG,
      propertyKey: PROPERTY_KEY,
      module: "sc8562"
    });
    expect(candidates[0]).toMatchObject({
      parameterSpecId: SPEC,
      parameterSpecVersionId: PINNED_VERSION,
      lifecycle: "deprecated"
    });
    expect(candidates.some((candidate) => candidate.parameterSpecId === DRAFT_SPEC)).toBe(true);
    expect(candidates.findIndex((candidate) => candidate.parameterSpecId === SPEC)).toBeLessThan(
      candidates.findIndex((candidate) => candidate.parameterSpecId === DRAFT_SPEC)
    );
  });
});
