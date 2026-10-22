import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { createCandidate } from "./candidateService";
import { previewSourceRevisionCandidate } from "./sourceRevisionService";
import { applySourceRevisionCandidate } from "./sourceRevisionCommit";
import type { DtsToolchainRunner } from "./dtsToolchain";

// These cases qualify PostgreSQL identity/receipt behavior, not native compiler
// acceptance. Existing native-toolchain suites keep their real runner unchanged.
export const sourceAdminToolchain: DtsToolchainRunner = {
  async validate(_configuration, options) {
    if (options?.mode !== "release") throw new Error("Expected release validation");
    return { ok: true, mode: "release", compiler: { dtc: null, fdtoverlay: null, dtschema: null }, diagnostics: [], artifacts: {} };
  },
  async probe() { return { dtc: { path: null, version: null }, fdtoverlay: { path: null, version: null }, dtschema: { path: null, version: null } }; }
};
export const sourceAdminText = '/dts-v1/; / { compatible = "test,board"; model = "source administration"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';

export async function createSourceAdminFixture(label: string, invocationForAuth: (auth: AuthContext) => TrustedInvocationContext) {
  const lane = await createEphemeralTestDatabase(label), db = createPostgresDatabase(lane.url);
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-source-admin-")), storage = createLocalObjectStore(directory);
  const organizationId = `org-${label}`, projectId = `project-${label}`, userId = `user-${label}`, token = `${label}_${process.pid}`;
  const auth = makeTestAuthContext({ organizationId, userId, roles: [{ roleId: "admin", projectId: null }] });
  await db.query("insert into organizations(id,name) values ($1,'Source administration')", [organizationId]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Source administrator','Admin',true)", [userId, organizationId]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Source administration','SOURCEADMIN','initialized')", [projectId, organizationId]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`role-${label}`, userId, organizationId]);
  await installDriverSourceFixture(db, auth, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Source administration",
    driverName: "Power", idempotencyKey: `registration-${label}`, reason: "Source administration integration" });
  const configSetId = (await createConfigSet(db, auth, { projectId, name: "Source administration" })).id;
  const uploaded = await uploadProjectParameterFile(db, storage, auth, { projectId, fileName: "board.dts", bytes: Buffer.from(sourceAdminText) });
  const fileId = uploaded.file.id;
  await addConfigSetFile(db, auth, { configSetId, fileId, role: "base", sortOrder: 0 });
  const revision = await ingestConfigRevision(db, { organizationId, projectId, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
    members: [{ fileId, fileVersionId: uploaded.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: sourceAdminText }] }, auth);
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Missing source administration catalog");
  await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId, projectId, configSetId, configRevisionId: revision.id }));
  const login = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
  const api = createPostgresDatabase(login.apiUrl);
  const security = { invocation: invocationForAuth(auth), requestId: `trace-${label}`, refusalSink: createTrustedRefusalAuditSink(db) };
  async function stage(text: string, key: string) {
    const file = (await api.query<{ current_version_id: string }>("select current_version_id from public.project_parameter_files where id=$1", [fileId])).rows[0]!;
    const current = (await api.query<{ id: string }>("select id from public.dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1", [configSetId])).rows[0]!;
    const candidate = await createCandidate(api, storage, auth, { projectId, fileId, fileName: "board.dts", bytes: Buffer.from(text), intent: "source_revision",
      expectedCurrentVersionId: file.current_version_id, expectedConfigRevisionId: current.id, clientMutationId: key });
    const preview = await previewSourceRevisionCandidate(api, storage, auth, { projectId, candidateId: candidate.id }, { toolchain: sourceAdminToolchain });
    const input = { projectId, candidateId: candidate.id, expectedCurrentVersionId: file.current_version_id,
      expectedProofToken: preview.proofToken, reason: "Exercise exact source restoration", clientMutationId: `${key}-apply` };
    return { preview, input, apply: () => applySourceRevisionCandidate(api, storage, auth, input, security, { toolchain: sourceAdminToolchain }) };
  }
  return { db, api, storage, auth, security, organizationId, projectId, configSetId, fileId, stage,
    close: async () => { await api.close(); await dropLabRuntimeLogins(lane.url, token); await db.close(); await lane.drop(); await rm(directory, { recursive: true, force: true }); } };
}
