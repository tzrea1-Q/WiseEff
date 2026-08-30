import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { seedCoreGraph } from "../../testing/fixtures";
import type { AuthContext } from "../auth/types";
import { createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createCandidate, abandonCandidate, getCandidateImpact } from "./candidateService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { getFileConfigSetMembership } from "./configSetRepository";
import { getProjectParameterFileById } from "./repository";
import { uploadProjectParameterFile } from "./service";

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-cand-int",
    organizationId: "org-cand-int",
    name: "Candidate Admin",
    email: "cand-int@example.com",
    organizationName: "Candidate Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await seedCoreGraph(db, {
    organization: { id: "org-cand-int", name: "Candidate Org" },
    users: [{ id: "user-cand-int", name: "Candidate Admin", email: "cand-int@example.com" }],
    projects: [{ id: "project-cand-int", name: "Candidate Project", code: "CND" }]
  });
}

const v1 = `/dts-v1/;
/ {
	board {
		model = "CandV1";
		compatible = "wiseeff,cand";
	};
};
`;

const v2 = `/dts-v1/;
/ {
	board {
		model = "CandV2";
		compatible = "wiseeff,cand";
	};
};
`;

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter file candidate non-activation invariant", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("create/inspect/abandon never change active version or config-set membership", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `cand-${randomUUID()}.dts`;

    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-cand-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });

    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-cand-int",
      name: `cand-set-${randomUUID()}`,
      description: "candidate invariant"
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: uploaded.file.id,
      role: "base",
      sortOrder: 0
    });

    const beforeFile = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    const beforeMembership = await getFileConfigSetMembership(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(beforeFile?.currentVersionId).toBe(uploaded.version.id);
    expect(beforeMembership?.configSetId).toBe(configSet.id);

    const candidate = await createCandidate(db!, objectStore, auth, {
      projectId: "project-cand-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from(v2, "utf8")
    });
    expect(["ready", "blocked"]).toContain(candidate.status);
    expect(candidate.baseVersionId).toBe(uploaded.version.id);

    const impact = await getCandidateImpact(db!, auth, {
      projectId: "project-cand-int",
      candidateId: candidate.id
    });
    expect(impact.impact.textDiff).toContain("CandV2");
    expect(impact.impact.structuralDiff?.length).toBeGreaterThan(0);

    const midFile = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    const midMembership = await getFileConfigSetMembership(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(midFile?.currentVersionId).toBe(beforeFile?.currentVersionId);
    expect(midMembership).toEqual(beforeMembership);

    const otherPrincipal = makeTestAuthContext({
      userId: "other-candidate-user",
      organizationId: auth.organization.id,
      name: "Other Candidate User",
      email: "other-candidate@example.com",
      organizationName: auth.organization.name,
      permissions: auth.permissions
    });
    await expect(
      abandonCandidate(
        db!,
        auth,
        { projectId: "project-cand-int", candidateId: candidate.id },
        { invocation: createUserInvocation(otherPrincipal), requestId: "candidate-abandon-cross-user" } as never
      )
    ).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(
      (await getCandidateImpact(db!, auth, {
        projectId: "project-cand-int",
        candidateId: candidate.id
      })).candidate.status
    ).toBe(candidate.status);

    await expect(
      abandonCandidate(
        db!,
        auth,
        { projectId: "project-cand-int", candidateId: candidate.id },
        {
          invocation: createSystemInvocation({ kind: "service", name: "candidate-maintenance" }),
          requestId: "candidate-abandon-system"
        } as never
      )
    ).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(
      (await getCandidateImpact(db!, auth, {
        projectId: "project-cand-int",
        candidateId: candidate.id
      })).candidate.status
    ).toBe(candidate.status);

    const abandoned = await abandonCandidate(db!, auth, {
      projectId: "project-cand-int",
      candidateId: candidate.id
    });
    expect(abandoned.status).toBe("abandoned");

    const afterFile = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    const afterMembership = await getFileConfigSetMembership(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(afterFile?.currentVersionId).toBe(beforeFile?.currentVersionId);
    expect(afterFile?.currentVersionNumber).toBe(beforeFile?.currentVersionNumber);
    expect(afterMembership).toEqual(beforeMembership);

    const versionCount = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_file_versions where file_id = $1`,
      [uploaded.file.id]
    );
    expect(Number(versionCount.rows[0].count)).toBe(1);
  });

  it("parse failure leaves active source untouched and exposes diagnostics", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `cand-fail-${randomUUID()}.json`;

    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-cand-int",
      fileName,
      bytes: Buffer.from('{"ok":true}', "utf8")
    });

    const failed = await createCandidate(db!, objectStore, auth, {
      projectId: "project-cand-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from("{not-json", "utf8")
    });
    expect(failed.status).toBe("failed");
    expect(failed.diagnostics.some((item) => item.code === "parse-failed")).toBe(true);

    const file = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(file?.currentVersionId).toBe(uploaded.version.id);

    const abandoned = await abandonCandidate(db!, auth, {
      projectId: "project-cand-int",
      candidateId: failed.id
    });
    expect(abandoned.status).toBe("abandoned");
  });
});
