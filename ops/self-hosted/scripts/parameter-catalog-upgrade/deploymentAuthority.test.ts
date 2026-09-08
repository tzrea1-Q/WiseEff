import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, link, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDeploymentAuthority, isIncidentRestoreConfirmation, type DeploymentAuthorityAssignment } from "./deploymentAuthority";
import { canonicalJson, sha256Prefixed } from "./journal";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it("refuses a non-private assignment before opening any authentication pool", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "authority-unit-"))); directories.push(root);
  const custody = path.join(root, "custody"); await mkdir(custody, { mode: 0o700 });
  const assignmentPath = path.join(custody, "assignment.json"); await writeFile(assignmentPath, "{}", { mode: 0o644 });
  await expect(openDeploymentAuthority({ custodyRoot: custody, custodianUid: process.getuid!(), assignmentPath,
    expectedAssignmentDigest: `sha256:${"0".repeat(64)}`, runId: "run-1", target: {
      deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "redis",
    }, sourceDatabase: { databaseName: "source", databaseOid: "1", serverAddress: "192.0.2.1", serverPort: 5432 }, authConnectionString: "postgres://not-used" }))
    .rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-ASSIGNMENT-REJECTED" });
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "authority-unit-"))); directories.push(root);
  const custodyRoot = path.join(root, "custody"); await mkdir(custodyRoot, { mode: 0o700 });
  const assignmentPath = path.join(custodyRoot, "assignment.json");
  const target = { deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "redis" };
  const assignment: DeploymentAuthorityAssignment = { format: "wiseeff-deployment-authority-v1", runId: "run-1", target,
    expiresAt: new Date(Date.now() + 60000).toISOString(), authentication: { databaseName: "control", databaseOid: "2", serverAddress: "192.0.2.2", serverPort: 5432 },
    principals: [{ kind: "operator", userId: "operator", organizationId: "org" }, { kind: "platform-owner", userId: "owner", organizationId: "org" }, { kind: "incident-owner", userId: "incident", organizationId: "org" }],
    verifierPrincipals: [{ userId: "verifier", organizationId: "org" }], reports: [], restore: null };
  const options = { custodyRoot, assignmentPath, custodianUid: process.getuid!(), target, runId: "run-1", expectedAssignmentDigest: "",
    sourceDatabase: { databaseName: "source", databaseOid: "1", serverAddress: "192.0.2.1", serverPort: 5432 }, authConnectionString: "invalid-and-never-connected" };
  const save = async () => { await writeFile(assignmentPath, JSON.stringify(assignment), { mode: 0o600 }); options.expectedAssignmentDigest = sha256Prefixed(canonicalJson(assignment)); };
  await save(); return { root, assignment, options, save };
}

it("accepts only the private assignment shape without turning it into a confirmation", async () => {
  const { assignment, options } = await fixture();
  expect(isIncidentRestoreConfirmation(assignment)).toBe(false);
  await expect(openDeploymentAuthority(options)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-UNAVAILABLE" });
});

it.each(["run", "target", "expired", "digest", "duplicate-principal", "verifier-self-approval", "missing-principal", "wrong-purpose", "wrong-custodian", "public-directory", "linked-file", "symlink-file"])("rejects %s assignment before any authentication", async fault => {
  const { root, assignment, options, save } = await fixture();
  if (fault === "run") assignment.runId = "other-run";
  if (fault === "target") assignment.target = { ...assignment.target, deploymentId: "other" };
  if (fault === "expired") assignment.expiresAt = "2000-01-01T00:00:00Z";
  if (fault === "duplicate-principal") assignment.principals[1].userId = "operator";
  if (fault === "verifier-self-approval") assignment.principals[1].userId = "verifier";
  if (fault === "missing-principal") assignment.principals.pop();
  if (fault === "wrong-purpose") assignment.reports.push({ purpose: "isolated-candidate-acceptance", reportDigest: `sha256:${"a".repeat(64)}` });
  await save();
  if (fault === "digest") options.expectedAssignmentDigest = `sha256:${"0".repeat(64)}`;
  if (fault === "wrong-custodian") options.custodianUid++;
  if (fault === "public-directory") await chmod(options.custodyRoot, 0o755);
  if (fault === "linked-file") await link(options.assignmentPath, path.join(root, "extra-link"));
  if (fault === "symlink-file") { await link(options.assignmentPath, path.join(root, "original")); await rm(options.assignmentPath); await symlink(path.join(root, "original"), options.assignmentPath); }
  await expect(openDeploymentAuthority(options)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-ASSIGNMENT-REJECTED" });
});
