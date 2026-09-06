import { describe, it } from "vitest";

import { CATALOG_AUTHOR_PERSON_ID, CATALOG_DEFINITION_ID, CATALOG_RELEASE_ID, CATALOG_REVISION_ID } from "./fixtures";
import { createMockCatalogPorts, type CatalogMockSession } from "./mockAdapter";
import { proposalContractVectors } from "./proposalContractVectors";

describe("R2 Proposal shared operation vectors: product mock adapter", () => {
  for (const vector of proposalContractVectors) {
    it(`${vector.id}: ${vector.name}`, async () => {
      let session: CatalogMockSession = { personId: CATALOG_AUTHOR_PERSON_ID, organizationId: "org_acme", actorKind: "org-admin", isActive: true };
      const options = { currentPersonId: CATALOG_AUTHOR_PERSON_ID, getSession: () => session };
      await vector.run({
        governance: createMockCatalogPorts(options).governance,
        setActor: async (actor) => {
          session = { organizationId: actor === "other-org" ? "org_other" : "org_acme", isActive: actor !== "inactive", personId: actor === "other-author" ? "user_other_author" : actor === "reviewer" ? "user_reviewer" : CATALOG_AUTHOR_PERSON_ID, actorKind: actor === "guest" ? "user" : actor === "reviewer" || actor === "self-reviewer" ? "platform-admin" : "org-admin" };
        },
        authorId: CATALOG_AUTHOR_PERSON_ID,
        releaseId: CATALOG_RELEASE_ID,
        definitionId: CATALOG_DEFINITION_ID,
        revisionId: CATALOG_REVISION_ID
      });
    });
  }
});
