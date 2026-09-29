import { expect, it } from "vitest";

import type pg from "pg";

import type { Database } from "../../../shared/database/client";
import { writeModParameterCatalogComparisonCasesV2 } from "./caseResultV2Writer";

it("rejects caller-asserted identities without a server-branded user invocation", async () => {
  const forgedInvocation = Object.freeze({
    initiator: "user",
    principal: {
      user: { id: "forged-admin", organizationId: "forged-org" },
      organization: { id: "forged-org" },
    },
  });
  await expect(writeModParameterCatalogComparisonCasesV2({
    database: {} as Database,
    pool: {} as pg.Pool,
    runId: "forged-run",
    invocation: forgedInvocation as never,
    phase: "pre-activation",
  })).rejects.toMatchObject({ name: "TrustedInvocationContextError" });
});
