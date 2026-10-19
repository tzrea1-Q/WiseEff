import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { getAuthContext } from "../auth/repository";
import type { Database } from "../../shared/database/client";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { getProjectById } from "../projects/repository";
import { recordCanonicalPermissionRefusal, requireCanonicalUserInvocation } from "./canonicalSource";
import { commitSourceRevision } from "./sourceRevisionCommit";
import { sourceRevisionDigest } from "./sourceRevisionService";
import { registerSourceRevisionRoutes } from "./sourceRevisionRoutes";

vi.mock("../audit/trustedRefusalSink", () => ({ assertTrustedRefusalAuditSink: vi.fn(), createTrustedRefusalAuditSink: vi.fn() }));
vi.mock("../auth/repository", () => ({ getAuthContext: vi.fn() }));
vi.mock("./canonicalSource", () => ({ recordCanonicalPermissionRefusal: vi.fn(), requireCanonicalUserInvocation: vi.fn() }));
vi.mock("./sourceRevisionCommit", () => ({ commitSourceRevision: vi.fn() }));
vi.mock("../parameter-topology/governanceAudit", () => ({ writeTrustedGovernanceAudit: vi.fn() }));
vi.mock("../parameters/reviewWorkflowRepository", () => ({ hasCurrentCanonicalReviewRole: vi.fn(), hasEligibleWorkflowAssignee: vi.fn() }));
vi.mock("../projects/repository", () => ({ getProjectById: vi.fn() }));
vi.mock("../parameter-bindings/catalogProjectValueSync", () => ({ loadPublishedCatalog: vi.fn().mockResolvedValue(null) }));
vi.mock("../../shared/database/client", async (original) => ({ ...await original<typeof import("../../shared/database/client")>(), getRootPostgresPool: () => ({}), isRootDatabase: () => false }));

const before = Buffer.from('\ufeff/dts-v1/;\r\n/ { names = ""; };\r\n');
const after = Buffer.from('\ufeff/dts-v1/;\r\n/ { names = "", "same", "same"; };\r\n');
const proofFacts = { kind: "source_revision", organizationId: "org", projectId: "project", candidateId: "candidate",
  fileId: "file", configSetId: "set", baseVersionId: "v1", baseConfigRevisionId: "revision",
  baseDigest: sourceRevisionDigest(before), proposedDigest: sourceRevisionDigest(after), members: [], cohort: [],
  continuity: { baseConfigRevisionId: "revision", nodes: [] }, entryFile: "board.dts", includeSearchPaths: [], overlayOrder: [],
  catalogRelease: null, registrations: [], targets: [], newProperties: [] };
const proof = { ...proofFacts, proofDigest: sourceRevisionDigest(proofFacts) };
function row() {
  return { id: "request", project_id: "project", candidate_id: "candidate", source_file_id: "file", source_file_name: "board.dts",
    source_revision_config_set_id: "set", source_revision_proof_digest: proof.proofDigest, source_revision_context: structuredClone(proof),
    status: "pending", reason: "source only", submitter_user_id: "author", assigned_to_user_id: "reviewer", reviewer_user_id: null as string | null,
    submitter_name: "Author", assigned_to_name: "Reviewer", reviewer_name: null, reviewer_note: null, created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z", applied_source_result: null, before_storage_key: "before", after_storage_key: "after",
    before_checksum: proof.baseDigest, after_checksum: proof.proposedDigest, node_removals: 0 };
}
function fixture(userId = "reviewer", override: { dbRole?: boolean; admin?: boolean; active?: boolean; projectScope?: string } = {}) {
  const auth = makeTestAuthContext({ organizationId: "org", userId, isActive: override.active ?? true,
    roles: [{ projectId: override.projectScope ?? "project", roleId: override.admin === false ? "software-committer" : "admin" }],
    permissions: override.admin === false ? ["parameter:view", "parameter:edit", "parameter:review"] : undefined });
  const state = row();
  const db: Database = { query: vi.fn(async (query, values) => {
    if (query.includes("select distinct catalog_release_id")) return { rows: [], rowCount: 0 };
    if (query.startsWith("update public.project_parameter_value_change_requests")) {
      state.status = query.includes("status='rejected'") ? "rejected" : "withdrawn";
      state.reviewer_user_id = values?.[3] as string;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [state], rowCount: 1 };
  }) as Database["query"], transaction: vi.fn(async (callback) => callback(db)) };
  const storage = { getBounded: vi.fn(async (key) => key === "before" ? before : after) } as unknown as ObjectStore;
  const router = createRouter();
  const sink = { write: vi.fn() } as unknown as TrustedRefusalAuditSink;
  registerSourceRevisionRoutes(router, { db, objectStore: storage, refusalAuditSink: sink, getCurrentAuthContext: () => auth });
  vi.mocked(hasCurrentCanonicalReviewRole).mockResolvedValue(override.dbRole ?? true);
  vi.mocked(getAuthContext).mockResolvedValue(auth);
  const request = async (suffix = "/request", method: "GET" | "POST" = "GET", body?: unknown, query = {}) => {
    const response = await router.handle({ method, path: `/api/v2/projects/project/source-revision-requests${suffix}`,
      params: {}, query, headers: {}, requestId: "http-trace", body });
    if (!("body" in response)) throw new Error("Expected a JSON source request response.");
    return response;
  };
  return { request, db, state, storage, auth, sink };
}

describe("whole-source request HTTP boundaries (mocked database)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectById).mockResolvedValue({ id: "project", name: "Project", code: "P" });
  });

  it("returns exact immutable source diff to the submitter with zero affected parameters", async () => {
    const f = fixture("author");
    const response = await f.request();
    expect(response.body).toMatchObject({ item: { id: "request", before: before.toString("utf8"), after: after.toString("utf8"), impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0 } } });
    expect(f.db.query).toHaveBeenCalledWith(expect.stringContaining("request.organization_id=$1 and request.project_id=$2"), ["org", "project", "request"]);
    expect(f.storage.getBounded).toHaveBeenCalledTimes(2);
    expect(commitSourceRevision).not.toHaveBeenCalled();
  });

  it.each(["unassigned", "viewer"])("conceals source from an unrelated user (%s)", async (user) => {
    const f = fixture(user);
    await expect(f.request()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.storage.getBounded).not.toHaveBeenCalled();
  });

  it("reads immutable source when historical version checksums use the supported sha256 prefix", async () => {
    const f = fixture("author");
    f.state.before_checksum = `sha256:${proof.baseDigest}`;
    f.state.after_checksum = `sha256:${proof.proposedDigest}`;
    expect((await f.request()).body).toMatchObject({ item: { before: before.toString("utf8"), after: after.toString("utf8") } });
  });

  it("conceals source after the assigned review role is revoked", async () => {
    const f = fixture("reviewer", { dbRole: false });
    await expect(f.request()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.storage.getBounded).not.toHaveBeenCalled();
  });

  it("does not read another tenant's or inaccessible project's ledger", async () => {
    const otherTenant = fixture("author");
    vi.mocked(getProjectById).mockResolvedValue(null);
    await expect(otherTenant.request()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(otherTenant.db.query).not.toHaveBeenCalled();
    const otherProject = fixture("author", { admin: false, projectScope: "other-project" });
    await expect(otherProject.request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otherProject.db.query).not.toHaveBeenCalled();
  });

  it("restricts list SQL by tenant, project, ownership/assignment and mine flag without loading bytes", async () => {
    const f = fixture("reviewer");
    await f.request("", "GET", undefined, { mine: "true", status: "pending" });
    expect(f.db.query).toHaveBeenCalledWith(expect.stringContaining("request.submitter_user_id=$4 or ($5::boolean and request.assigned_to_user_id=$4)"), ["org", "project", "pending", "reviewer", false]);
    expect(f.storage.getBounded).not.toHaveBeenCalled();
    await expect(f.request("", "GET", undefined, { mine: "malformed" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects altered frozen context or mismatched stored bytes", async () => {
    const f = fixture("author");
    f.state.source_revision_context.baseVersionId = "forged";
    await expect(f.request()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.storage.getBounded).not.toHaveBeenCalled();
    f.state.source_revision_context = structuredClone(proof);
    vi.mocked(f.storage.getBounded!).mockResolvedValue(Buffer.from("corrupt bytes"));
    await expect(f.request()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([{ user: "author" }, { user: "unassigned" }, { user: "reviewer", dbRole: false }, { user: "reviewer", admin: false }])("refuses self-review, unassigned or revoked/insufficient authority: %o", async ({ user, ...options }) => {
    const f = fixture(user, options);
    await expect(f.request("/request/review", "POST", { decision: "approve", proofDigest: proof.proofDigest })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(recordCanonicalPermissionRefusal).toHaveBeenCalled();
    expect(commitSourceRevision).not.toHaveBeenCalled();
  });

  it("rejects a stale proof or client-supplied invocation before mutation", async () => {
    const f = fixture();
    await expect(f.request("/request/review", "POST", { decision: "approve", proofDigest: "0".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.request("/request/review", "POST", { decision: "approve", proofDigest: proof.proofDigest, invocation: { userId: "author" } })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(commitSourceRevision).not.toHaveBeenCalled();
  });

  it("rechecks current admin capability even when request authentication still carries an old admin role", async () => {
    const f = fixture();
    vi.mocked(getAuthContext).mockResolvedValue(makeTestAuthContext({ organizationId: "org", userId: "reviewer",
      roles: [{ projectId: "project", roleId: "software-committer" }], permissions: ["parameter:view", "parameter:edit", "parameter:review"] }));
    await expect(f.request("/request/review", "POST", { decision: "approve", proofDigest: proof.proofDigest })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.db.transaction).not.toHaveBeenCalled();
    expect(commitSourceRevision).not.toHaveBeenCalled();
    expect(recordCanonicalPermissionRefusal).toHaveBeenCalled();
  });

  it("passes approval to the authoritative owner without pre-locking its request row", async () => {
    const f = fixture();
    vi.mocked(commitSourceRevision).mockImplementationOnce(async () => { f.state.status = "approved"; return { requestId: "request", status: "approved", sourceRevisionProofDigest: proof.proofDigest }; });
    const result = await f.request("/request/review", "POST", { decision: "approve", proofDigest: proof.proofDigest, note: "Review complete" });
    expect(result.body).toMatchObject({ item: { status: "approved" } });
    expect(commitSourceRevision).toHaveBeenCalledWith(f.db, f.storage, f.auth, null, expect.objectContaining({ projectId: "project", requestId: "request", traceId: "http-trace", refusalSink: f.sink, note: "Review complete" }));
    const snapshotsQuery = vi.mocked(f.db.query).mock.calls.findIndex(([query]) => query.includes("select distinct catalog_release_id"));
    expect(vi.mocked(f.db.query).mock.invocationCallOrder[snapshotsQuery]).toBeLessThan(vi.mocked(f.db.transaction).mock.invocationCallOrder[0]);
    expect(vi.mocked(commitSourceRevision).mock.calls[0]?.[4].catalogSnapshots).toBeInstanceOf(Map);
    expect(requireCanonicalUserInvocation).toHaveBeenCalled();
    expect(vi.mocked(f.db.query).mock.calls[0]?.[0]).not.toContain("for update of request");
  });

  it("makes rejection and withdrawal retries idempotent and prevents crossing terminal states", async () => {
    const reviewer = fixture();
    const reject = () => reviewer.request("/request/review", "POST", { decision: "reject", proofDigest: proof.proofDigest });
    expect((await reject()).body).toMatchObject({ item: { status: "rejected" } });
    const lockIndex = vi.mocked(reviewer.db.query).mock.calls.findIndex(([query]) => query.includes("for update of request"));
    expect(vi.mocked(hasCurrentCanonicalReviewRole).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(reviewer.db.query).mock.invocationCallOrder[lockIndex]);
    const firstUpdates = vi.mocked(reviewer.db.query).mock.calls.filter(([query]) => query.startsWith("update ")).length;
    expect((await reject()).body).toMatchObject({ item: { status: "rejected" } });
    expect(vi.mocked(reviewer.db.query).mock.calls.filter(([query]) => query.startsWith("update ")).length).toBe(firstUpdates);
    const author = fixture("author");
    expect((await author.request("/request/withdraw", "POST", {})).body).toMatchObject({ item: { status: "withdrawn" } });
    expect((await author.request("/request/withdraw", "POST", {})).body).toMatchObject({ item: { status: "withdrawn" } });
    author.state.status = "approved";
    await expect(author.request("/request/withdraw", "POST", {})).rejects.toMatchObject({ code: "CONFLICT" });
    const notAuthor = fixture();
    await expect(notAuthor.request("/request/withdraw", "POST", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
