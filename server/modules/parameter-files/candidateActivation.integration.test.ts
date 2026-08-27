import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { seedCoreGraph } from "../../testing/fixtures";
import type { AuthContext } from "../auth/types";
import { createSystemInvocation } from "../auth/trustedInvocation";
import {
  activateCandidate,
  abandonCandidate,
  createCandidate,
  recomputeCandidateImpact
} from "./candidateService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { getFileConfigSetMembership } from "./configSetRepository";
import { getParameterFileCandidateById } from "./candidateRepository";
import { getProjectParameterFileById, insertFileVersion, setCurrentVersion } from "./repository";
import { uploadProjectParameterFile } from "./service";

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-act-int",
      organizationId: "org-act-int",
      name: "Activation Admin",
      email: "act-int@example.com",
      organizationName: "Activation Org",
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
    }),
    ...overrides
  };
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await seedCoreGraph(db, {
    organization: { id: "org-act-int", name: "Activation Org" },
    users: [{ id: "user-act-int", name: "Activation Admin", email: "act-int@example.com" }],
    projects: [{ id: "project-act-int", name: "Activation Project", code: "ACT" }]
  });
}

const v1 = `/dts-v1/;
/ {
	board {
		model = "ActV1";
		compatible = "wiseeff,act";
	};
};
`;

const v2 = `/dts-v1/;
/ {
	board {
		model = "ActV2";
		compatible = "wiseeff,act";
	};
};
`;

const v3 = `/dts-v1/;
/ {
	board {
		model = "ActV3";
		compatible = "wiseeff,act";
	};
};
`;

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter file candidate activation", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("activates an existing-file candidate and preserves prior version in history", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `act-${randomUUID()}.dts`;

    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });
    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-act-int",
      name: `act-set-${randomUUID()}`
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: uploaded.file.id,
      role: "base",
      sortOrder: 0
    });

    const candidate = await createCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from(v2, "utf8")
    });
    expect(candidate.status).toBe("ready");

    await expect(
      activateCandidate(
        db!,
        objectStore,
        auth,
        {
          projectId: "project-act-int",
          candidateId: candidate.id,
          expectedCurrentVersionId: uploaded.version.id
        },
        {
          invocation: createSystemInvocation({ kind: "job", name: "candidate-activation" }),
          requestId: "candidate-activation-system"
        } as never
      )
    ).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(
      (await getParameterFileCandidateById(db!, {
        organizationId: auth.organization.id,
        projectId: "project-act-int",
        candidateId: candidate.id
      }))?.status
    ).toBe("ready");
    expect(
      (await getProjectParameterFileById(db!, {
        organizationId: auth.organization.id,
        fileId: uploaded.file.id
      }))?.currentVersionId
    ).toBe(uploaded.version.id);

    const result = await activateCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      candidateId: candidate.id,
      expectedCurrentVersionId: uploaded.version.id
    });

    expect(result.candidate.status).toBe("active");
    expect(result.file.currentVersionId).toBe(result.version.id);
    expect(result.version.id).not.toBe(uploaded.version.id);

    const file = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(file?.currentVersionId).toBe(result.version.id);

    const versions = await db!.query<{ id: string }>(
      `select id from project_parameter_file_versions where file_id = $1 order by version_number`,
      [uploaded.file.id]
    );
    expect(versions.rows.map((row) => row.id)).toEqual([uploaded.version.id, result.version.id]);

    const membership = await getFileConfigSetMembership(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(membership?.configSetId).toBe(configSet.id);

    const audits = await db!.query<{ kind: string; action: string }>(
      `select kind, action from audit_events where target_id = $1 and kind = 'parameter-file-candidate-activate'`,
      [candidate.id]
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.action).toBe("activate");
  });

  it("requires config set + role for new-file activation and does not invent membership", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `act-new-${randomUUID()}.dts`;
    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-act-int",
      name: `act-new-set-${randomUUID()}`
    });

    const candidate = await createCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });
    expect(candidate.fileId).toBeUndefined();
    expect(candidate.status).toBe("ready");

    await expect(
      activateCandidate(db!, objectStore, auth, {
        projectId: "project-act-int",
        candidateId: candidate.id,
        expectedCurrentVersionId: null
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const result = await activateCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      candidateId: candidate.id,
      expectedCurrentVersionId: null,
      configSetId: configSet.id,
      role: "overlay"
    });

    expect(result.candidate.status).toBe("active");
    expect(result.file.fileName).toBe(fileName);
    const membership = await getFileConfigSetMembership(db!, {
      organizationId: auth.organization.id,
      fileId: result.file.id
    });
    expect(membership?.configSetId).toBe(configSet.id);
    expect(membership?.configSetRole).toBe("overlay");
  });

  it("marks candidate stale on CAS mismatch and preserves Working configuration", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `act-stale-${randomUUID()}.dts`;

    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });

    const candidate = await createCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from(v2, "utf8")
    });

    const raced = await insertFileVersion(db!, {
      id: randomUUID(),
      fileId: uploaded.file.id,
      versionNumber: 2,
      storageKey: uploaded.version.storageKey,
      checksum: uploaded.version.checksum,
      sizeBytes: uploaded.version.sizeBytes,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: auth.user.id
    });
    // Overwrite storage for raced tip so content differs; reuse object for simplicity.
    await objectStore.put({
      organizationId: auth.organization.id,
      fileName,
      contentType: "text/plain",
      bytes: Buffer.from(v3, "utf8")
    });
    await setCurrentVersion(db!, { fileId: uploaded.file.id, versionId: raced.id });

    let caught: ApiError | undefined;
    try {
      await activateCandidate(db!, objectStore, auth, {
        projectId: "project-act-int",
        candidateId: candidate.id,
        expectedCurrentVersionId: uploaded.version.id
      });
    } catch (error) {
      caught = error as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(409);
    expect(caught?.details).toMatchObject({ reason: "stale-base" });
    expect((caught?.details as { candidate?: { status?: string } })?.candidate?.status).toBe("stale");

    // The stale transition must survive the aborted activation transaction:
    // the DB row itself is stale (not just the response payload)...
    const staleRow = await getParameterFileCandidateById(db!, {
      organizationId: auth.organization.id,
      projectId: "project-act-int",
      candidateId: candidate.id
    });
    expect(staleRow?.status).toBe("stale");

    // ...and the promised parameter-file-candidate-stale audit is committed.
    const staleAudits = await db!.query<{ kind: string }>(
      `select kind from audit_events where organization_id = $1 and kind = 'parameter-file-candidate-stale'`,
      [auth.organization.id]
    );
    expect(staleAudits.rows).toHaveLength(1);

    const file = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(file?.currentVersionId).toBe(raced.id);

    const recomputed = await recomputeCandidateImpact(db!, objectStore, auth, {
      projectId: "project-act-int",
      candidateId: candidate.id
    });
    expect(["ready", "blocked"]).toContain(recomputed.status);
    expect(recomputed.baseVersionId).toBe(raced.id);
  });

  it("rejects activation without admin capability while leaving candidate readable", async () => {
    const admin = makeAuth();
    const viewer = makeAuth({
      user: {
        id: "user-act-viewer",
        organizationId: "org-act-int",
        name: "Viewer",
        email: "viewer@example.com",
        title: "Viewer",
        isActive: true
      },
      roles: [{ projectId: null, roleId: "viewer" }],
      permissions: ["parameter:view"]
    });
    await db!.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ('user-act-viewer', 'org-act-int', 'Viewer', 'viewer@example.com', 'Viewer', true)
      on conflict (id) do nothing
      `
    );
    const objectStore = createMemoryObjectStore();
    const fileName = `act-authz-${randomUUID()}.dts`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, admin, {
      projectId: "project-act-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });
    const candidate = await createCandidate(db!, objectStore, admin, {
      projectId: "project-act-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from(v2, "utf8")
    });

    await expect(
      activateCandidate(db!, objectStore, viewer, {
        projectId: "project-act-int",
        candidateId: candidate.id,
        expectedCurrentVersionId: uploaded.version.id
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const still = await db!.query<{ status: string; current_version_id: string | null }>(
      `
      select c.status, f.current_version_id
      from project_parameter_file_candidates c
      join project_parameter_files f on f.id = c.file_id
      where c.id = $1
      `,
      [candidate.id]
    );
    expect(still.rows[0]?.status).toBe("ready");
    expect(still.rows[0]?.current_version_id).toBe(uploaded.version.id);
  });

  it("rejects blocked candidates and does not change Working configuration", async () => {
    const auth = makeAuth();
    const objectStore = createMemoryObjectStore();
    const fileName = `act-block-${randomUUID()}.dts`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileName,
      bytes: Buffer.from(v1, "utf8")
    });
    const candidate = await createCandidate(db!, objectStore, auth, {
      projectId: "project-act-int",
      fileId: uploaded.file.id,
      fileName,
      bytes: Buffer.from(v2, "utf8")
    });

    await db!.query(
      `
      update project_parameter_file_candidates
      set status = 'blocked',
          blockers = $2::jsonb
      where id = $1
      `,
      [candidate.id, JSON.stringify([{ code: "open-conflict", message: "open conflict" }])]
    );

    await expect(
      activateCandidate(db!, objectStore, auth, {
        projectId: "project-act-int",
        candidateId: candidate.id,
        expectedCurrentVersionId: uploaded.version.id
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const file = await getProjectParameterFileById(db!, {
      organizationId: auth.organization.id,
      fileId: uploaded.file.id
    });
    expect(file?.currentVersionId).toBe(uploaded.version.id);

    // abandon still works for blocked
    const abandoned = await abandonCandidate(db!, auth, {
      projectId: "project-act-int",
      candidateId: candidate.id
    });
    expect(abandoned.status).toBe("abandoned");
  });
});
