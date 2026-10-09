import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { createRetirementTestHarness } from "../../testing/parameterCatalog/retirementHarness";
import { seedHistoricalSingletonMapping } from "../../testing/parameterCatalog/driverSource";
import { loadDtsReviewEvidenceSourceFixture } from "../../testing/parameterCatalog/dtsObservationSource";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { catalogReviewItemListResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { createLocalObjectStore } from "../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createProject } from "../projects/repository";
import { listIdentityMappingTaskRows } from "./bindingService";
import { ingestConfigRevision } from "./ingestService";
import { loadCandidateSemanticGateCounts } from "./overlayWriteback";
import { listPreviousLogicalNodeSnapshots, listRevisionDiagnostics } from "./repository";

const organizationId = `t1068-production-org-${randomUUID()}`;
const auth = makeTestAuthContext({ organizationId, userId: `${organizationId}-admin` });
const compatible = `t1068,unpublished-${randomBytes(5).toString("hex")}`;
const headers = { authorization: "Bearer t1068" };

describe("#1068 assembled seeded PostgreSQL identity task production retirement", () => {
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let harness: ReturnType<typeof createRetirementTestHarness>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let databaseUrl: string;
  let roleToken: string;

  beforeAll(async () => {
    databaseUrl = process.env.T1068_TEST_DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:55438/t1068_identity_production";
    if (!/^t1068(?:_|$)/.test(new URL(databaseUrl).pathname.slice(1))) {
      throw new Error("#1068 requires an explicitly prepared, seeded t1068 database");
    }
    db = createPostgresDatabase(databaseUrl);
    await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: auth.user.id }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,$3,null,'admin')",
      [`${auth.user.id}-role`, auth.user.id, organizationId]);
    await seedHistoricalSingletonMapping(db, { organizationId, moduleId: `${organizationId}-module`, compatible });
    directory = await mkdtemp(join(tmpdir(), "wiseeff-t1068-production-"));
    storage = createLocalObjectStore(directory);
    roleToken = `t1068prod${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(databaseUrl, {
      mode: "lab", runToken: roleToken,
    });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows)
      .toEqual([{ superuser: false }]);
    harness = createRetirementTestHarness({ db: api, legacyTables: ["identity_mapping_tasks"],
      objectStore: storage,
      auth: { mode: "production", verifier: { verify: async () => auth } },
    });
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    if (roleToken) await dropLabRuntimeLogins(databaseUrl, roleToken);
    await db?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    expect(await resolveParameterIdentityMode(api)).toBe("semantic");
  });

  async function upload(projectId: string, content: string) {
    const response = await requestJson(harness.server, `/api/v1/projects/${projectId}/parameter-files`, {
      method: "POST", headers, body: JSON.stringify({ fileName: "board.dts", contentBase64: Buffer.from(content).toString("base64") }),
    });
    expect(response.status, response.bodyText).toBe(201);
    return response.body as { item: { id: string }; version: { id: string } };
  }

  async function fixture(content?: string) {
    const projectId = `t1068-production-${randomUUID()}`;
    const source = content ?? `/dts-v1/;\n/ { left { compatible = "${compatible}"; }; right { compatible = "${compatible}"; }; };\n`;
    await createProject(db, { organizationId, id: projectId, name: projectId, code: projectId });
    const initial = await upload(projectId, source);
    const set = await createConfigSet(db, auth, { projectId, name: "#1068 production retirement" });
    await addConfigSetFile(db, auth, { configSetId: set.id, fileId: initial.item.id, role: "base", sortOrder: 0 });
    return { projectId, configSetId: set.id, fileId: initial.item.id, fileVersionId: initial.version.id,
      content: source };
  }

  async function ingest(seeded: Awaited<ReturnType<typeof fixture>>) {
    return ingestConfigRevision(api, {
      organizationId, projectId: seeded.projectId, configSetId: seeded.configSetId,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: seeded.fileId, fileVersionId: seeded.fileVersionId, fileName: "board.dts",
        role: "base", sortOrder: 0, content: seeded.content }],
    }, auth);
  }

  async function latestRevision(projectId: string, configSetId: string) {
    const response = await requestJson(harness.server, `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions`, { headers });
    expect(response.status, response.bodyText).toBe(200);
    const body = response.body as { items: { id: string; status: string; revisionNumber: number }[] };
    expect(body.items.length).toBeGreaterThan(0);
    return body.items[0]!;
  }

  async function legacyTasks(projectId: string) {
    return listIdentityMappingTaskRows(api, { organizationId, projectId });
  }

  async function reviewQueue() {
    const response = await requestJson(harness.server,
      `/api/v2/organizations/${organizationId}/parameter-review-items`, { headers });
    expect(response.status, response.bodyText).toBe(200);
    return catalogReviewItemListResponseSchema.parse(response.body);
  }

  it("ingest preserves the singleton refusal without producing a legacy identity task", async () => {
    const seeded = await fixture();
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    await ingest(seeded);
    expect((await latestRevision(seeded.projectId, seeded.configSetId)).status).toBe("needs_mapping");
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
  });

  it("assembled singleton ingest keeps its refusal and sends unknown DTS evidence only to the canonical Queue", async () => {
    const seeded = await fixture();
    const before = await reviewQueue();
    await upload(seeded.projectId, seeded.content);
    expect((await latestRevision(seeded.projectId, seeded.configSetId)).status).toBe("needs_mapping");
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const after = await reviewQueue();
    expect(after.items.filter((item) => !before.items.some((existing) => existing.id === item.id)))
      .toContainEqual(expect.objectContaining({ reason: "unknown", status: "open" }));
  });

  it("validation of a seeded singleton conflict creates no legacy identity tasks", async () => {
    const seeded = await fixture();
    const revision = await ingest(seeded);
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const response = await requestJson(harness.server,
      `/api/v2/projects/${seeded.projectId}/config-revisions/${revision.id}/validate`, {
        method: "POST", headers, body: JSON.stringify({ stage: "identity" }),
      });
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body).toMatchObject({ item: { status: "failed", failureCode: "open-mapping" } });
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
  });

  it("ambiguous logical continuity retains its refusal without creating a legacy decision task", async () => {
    const previous = `/dts-v1/;\n/ { bus { dev@10 { reg = <0x10>; }; }; };\n`;
    const next = `/dts-v1/;\n/ { bus { left@10 { reg = <0x10>; }; right@10 { reg = <0x10>; }; }; };\n`;
    const seeded = await fixture(previous);
    await ingest(seeded);
    await uploadProjectParameterFile(api, storage, auth, {
      projectId: seeded.projectId, fileName: "board.dts", bytes: Buffer.from(next),
    });
    expect((await latestRevision(seeded.projectId, seeded.configSetId)).status).toBe("needs_mapping");
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
  });

  it("candidate governance is read-only for legacy identity tasks and remains fail-closed", async () => {
    const seeded = await fixture();
    const revision = await ingest(seeded);
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const counts = await loadCandidateSemanticGateCounts(api, {
      organizationId, projectId: seeded.projectId, configRevisionId: revision.id,
    });
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    expect(counts.openIdentityMappings).toBeGreaterThan(0);
  });

  it("source-bound no-compatible continuity ambiguity retains decision evidence in the canonical Queue without choosing identity", async () => {
    const previous = `/dts-v1/;\n/ { bus { dev@10 { reg = <0x10>; }; }; };\n`;
    const next = `/dts-v1/;\n/ { bus { left@10 { reg = <0x10>; }; right@10 { reg = <0x10>; }; }; };\n`;
    const seeded = await fixture(previous);
    await upload(seeded.projectId, previous);
    const before = await reviewQueue();
    const activated = await upload(seeded.projectId, next);
    const revision = await latestRevision(seeded.projectId, seeded.configSetId);
    expect(revision.status).toBe("needs_mapping");
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const diagnostic = (await listRevisionDiagnostics(api, revision.id))
      .find((item) => item.code === "logical-continuity-decision-needed");
    expect(diagnostic).toBeDefined();
    const relation = JSON.parse(diagnostic!.guidance!) as {
      previous: { logicalNodeId: string; nodeLocator: string };
      continuity: { candidates: { logicalNodeId: string; nodeLocator: string }[]; evidence: string[] };
    };
    expect(relation.previous.nodeLocator).toBe("/bus/dev@10");
    const previousNodes = await listPreviousLogicalNodeSnapshots(api, {
      configSetId: seeded.configSetId, beforeRevisionNumber: revision.revisionNumber,
    });
    expect(relation.previous.logicalNodeId).toBe(previousNodes.find((node) => node.nodeLocator === "/bus/dev@10")?.logicalNodeId);
    expect(relation.continuity.candidates.map((item) => item.nodeLocator).sort())
      .toEqual(["/bus/left@10", "/bus/right@10"]);
    expect(relation.continuity.candidates.every((item) => item.logicalNodeId !== relation.previous.logicalNodeId)).toBe(true);
    expect(relation.continuity.evidence.length).toBeGreaterThan(0);
    const queue = await reviewQueue();
    const created = queue.items.filter((item) => !before.items.some((existing) => existing.id === item.id));
    expect(created).toContainEqual(expect.objectContaining({ reason: "ambiguous", status: "open" }));
    const provenCandidates: string[] = [];
    for (const item of created) {
      const detail = await requestJson(harness.server,
        `/api/v2/organizations/${organizationId}/parameter-review-items/${item.id}`, { headers });
      expect(detail.status, detail.bodyText).toBe(200);
      const canonical = detail.body as { item: typeof item };
      expect(canonical.item).toEqual(item);
      expect(canonical.item.observation?.sourceRef.kind).toBe("review-evidence");
      const persisted = await loadDtsReviewEvidenceSourceFixture(api, {
        organizationId, projectId: seeded.projectId,
        reviewEvidenceId: canonical.item.observation!.sourceRef.id,
      });
      expect(persisted).toMatchObject({ configRevisionId: revision.id, fileId: seeded.fileId,
        configSetId: seeded.configSetId, logicalNodeId: expect.any(String), sourceOccurrenceId: expect.any(String) });
      const evidence = persisted.evidence;
      expect(evidence).toMatchObject({ reason: "ambiguous", payload: {
        kind: "logical-continuity-decision-needed", priorNodeEquivalent: false, relations: [relation],
        sourceProof: { configRevisionId: revision.id, fileId: seeded.fileId,
          fileVersionId: activated.version.id, logicalNodeId: persisted.logicalNodeId,
          propertyName: "reg", nodeOccurrenceId: expect.any(String), propertyOccurrenceId: expect.any(String),
          sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          revisionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          sourceSpan: { start: expect.any(Number), end: expect.any(Number) } },
      } });
      const proof = evidence!.payload.sourceProof as { nodeLocator: string; sourceSpan: { start: number; end: number } };
      expect(next.slice(proof.sourceSpan.start, proof.sourceSpan.end)).toBe("<0x10>");
      expect(persisted.logicalNodeId).not.toBe(relation.previous.logicalNodeId);
      expect(relation.continuity.candidates).toContainEqual(expect.objectContaining({
        logicalNodeId: persisted.logicalNodeId, nodeLocator: proof.nodeLocator,
      }));
      provenCandidates.push(proof.nodeLocator);
    }
    expect(provenCandidates.sort()).toEqual(["/bus/left@10", "/bus/right@10"]);
  });

  it("ambiguous published DTS compatibles enter the canonical Review Queue through assembled file activation", async () => {
    const ambiguousSource = `/dts-v1/;\n/ { device_${randomBytes(5).toString("hex")} { compatible = "arm,amba-bus", "arm,gic-v3"; }; };\n`;
    const seeded = await fixture(ambiguousSource);
    const before = await reviewQueue();
    await upload(seeded.projectId, ambiguousSource);
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const queue = await reviewQueue();
    const created = queue.items.filter((item) => !before.items.some((existing) => existing.id === item.id));
    expect(created).toContainEqual(expect.objectContaining({
      reason: "ambiguous", status: "open", candidateState: expect.objectContaining({ status: "current" }),
      observation: expect.objectContaining({ sourceRef: expect.objectContaining({ kind: "review-evidence" }) }),
    }));
  });

  it("refuses unrepresentable propertyless continuity without committing source or task changes", async () => {
    const previous = `/dts-v1/; / { bus@0 { reg = <0>; dev@10 {}; }; };`;
    const next = `/dts-v1/; / { bus@0 { reg = <0>; left@10 {}; right@10 {}; }; };`;
    const seeded = await fixture(previous);
    await upload(seeded.projectId, previous);
    const beforeRevision = await latestRevision(seeded.projectId, seeded.configSetId);
    const filesPath = `/api/v1/projects/${seeded.projectId}/parameter-files`;
    const beforeFiles = await requestJson(harness.server, filesPath, { headers });
    expect(beforeFiles.status).toBe(200);
    const beforeQueue = await reviewQueue();
    const response = await requestJson(harness.server, filesPath, {
      method: "POST", headers, body: JSON.stringify({ fileName: "board.dts", contentBase64: Buffer.from(next).toString("base64") }),
    });
    expect(response.status, response.bodyText).toBe(409);
    expect(response.body).toMatchObject({ error: { code: "CONFLICT", details: { reason: "source-proof-invalid" } } });
    expect((await requestJson(harness.server, filesPath, { headers })).body).toEqual(beforeFiles.body);
    expect(await latestRevision(seeded.projectId, seeded.configSetId)).toEqual(beforeRevision);
    expect(await reviewQueue()).toEqual(beforeQueue);
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
  });

  it("bounds selected continuity anchors rather than all properties on ambiguous candidates", async () => {
    const previous = `/dts-v1/; / { bus { dev@10 { reg = <0x10>; }; }; };`;
    const properties = Array.from({ length: 100 }, (_, index) => `value_${index} = <${index}>;`).join(" ");
    const next = `/dts-v1/; / { bus { left@10 { reg = <0x10>; ${properties} }; right@10 { reg = <0x10>; ${properties} }; }; };`;
    const seeded = await fixture(previous);
    await upload(seeded.projectId, previous);
    const beforeQueue = await reviewQueue();
    await upload(seeded.projectId, next);
    expect((await latestRevision(seeded.projectId, seeded.configSetId)).status).toBe("needs_mapping");
    expect(await legacyTasks(seeded.projectId)).toEqual([]);
    const created = (await reviewQueue()).items.filter((item) => !beforeQueue.items.some((existing) => existing.id === item.id));
    expect(created).toHaveLength(2);
    expect(created.every((item) => item.reason === "ambiguous" && item.status === "open")).toBe(true);
  });
});
