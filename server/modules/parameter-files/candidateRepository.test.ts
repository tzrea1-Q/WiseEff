import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createAgentInvocation, trustedDomainAttribution } from "../auth/trustedInvocation";
import { insertParameterFileCandidate, listParameterFileCandidates } from "./candidateRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter-file candidate public projection", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("does not serialize trusted Agent correlation in the lifecycle DTO", async () => {
    const attribution = trustedDomainAttribution(
      createAgentInvocation(
        {
          user: {
            id: "user-1",
            organizationId: "org-1",
            name: "Riley Chen",
            email: "riley@example.com",
            title: "Engineer",
            isActive: true
          },
          organization: { id: "org-1", name: "ChargeLab" },
          roles: [],
          permissions: ["parameter:view"]
        },
        {
          sessionId: "candidate-public-session",
          toolCallId: "candidate-public-tool",
          approval: { required: true, approvalId: "candidate-public-approval" }
        }
      )
    );

    const candidate = await insertParameterFileCandidate(db, {
      id: "candidate-public-agent",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "agent-public.dtsi",
      format: "dts",
      status: "ready",
      parsedIndex: {},
      attribution
    });

    expect(candidate).toMatchObject({
      id: "candidate-public-agent",
      status: "ready",
      createdByUserId: "user-1"
    });
    expect(candidate).not.toHaveProperty("initiatorType");
    expect(candidate).not.toHaveProperty("initiatorSessionId");
    expect(candidate).not.toHaveProperty("initiatorToolCallId");
    expect(candidate).not.toHaveProperty("initiatorApprovalId");

    const [listed] = await listParameterFileCandidates(db, {
      organizationId: "org-1",
      projectId: "project-1"
    });
    expect(listed).not.toHaveProperty("initiatorSessionId");
    expect(listed).not.toHaveProperty("initiatorToolCallId");
    expect(listed).not.toHaveProperty("initiatorApprovalId");
    expect(JSON.stringify(listed)).not.toContain("candidate-public-session");
    expect(JSON.stringify(listed)).not.toContain("candidate-public-tool");
    expect(JSON.stringify(listed)).not.toContain("candidate-public-approval");
  });
});
