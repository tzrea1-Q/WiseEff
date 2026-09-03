import { describe, expect, it } from "vitest";

import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogProposalResponseSchema,
  catalogRegistrationResponseSchema,
  catalogReviewItemListResponseSchema,
  catalogReviewResolutionResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  ReviewEvidenceId,
  ReviewItemEtag,
  ReviewItemId,
  ReviewResolutionId,
  SubjectPlacementId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";
import type { RegistrationResult } from "../../parameter-governance/registration/result";
import type { ReviewQueueItem } from "../../parameter-governance/review/types";
import type { ReviewResolutionResult } from "../../parameter-governance/resolveReviewItem/result";
import type { ProposalResult } from "../../parameter-governance/proposals/result";

import { handleCatalogGovernance, matchCatalogGovernanceRoute } from "./handlers";
import { catalogGovernanceCommandByRouteId, catalogGovernanceRoutes } from "./mapping";
import type {
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  TrustedGovernanceScope,
} from "./types";

const digest = CatalogReleaseDigest(`sha256:${"a".repeat(64)}`);
const pin = { id: CatalogReleaseId("crel_acme_1"), digest };

const orgAdmin: TrustedGovernanceScope = {
  principalId: "user-org-admin",
  organizationId: "org-s8-gov",
  actorKind: "org-admin",
  canReadGovernance: true,
  canMutateOrganization: true,
  canReviewProposals: false,
  defaultDestinationModuleId: "pmod-s8-gov-driver",
  defaultSubjectKind: "driver",
};

const platformAdmin: TrustedGovernanceScope = {
  ...orgAdmin,
  principalId: "user-platform-admin",
  actorKind: "platform-admin",
  canMutateOrganization: false,
  canReviewProposals: true,
};

const agent: TrustedGovernanceScope = {
  ...orgAdmin,
  principalId: "agent-1",
  actorKind: "agent",
  canMutateOrganization: false,
  canReviewProposals: false,
};

const registrationResult: RegistrationResult = {
  outcome: "committed",
  registrationId: SubjectRegistrationId("sreg_s8_gov"),
  placementId: SubjectPlacementId("spla_s8_gov"),
  organizationId: orgAdmin.organizationId,
  subjectId: CatalogSubjectId("csub_acme_power"),
  registrationStatus: "active",
  registrationMethod: "explicit",
  placementOrigin: "curated",
  moduleId: orgAdmin.defaultDestinationModuleId,
  release: pin,
  idempotencyKey: "idem-1",
  fingerprint: `sha256:${"b".repeat(64)}`,
};

const reviewItem: ReviewQueueItem = {
  id: ReviewItemId("prit_s8_gov"),
  organizationId: orgAdmin.organizationId,
  status: "open",
  reason: "unknown",
  rClass: null,
  identityKey: "property:iin_max",
  matcherRevision: "matcher-1",
  catalogReleaseId: pin.id,
  groupingFingerprint: `sha256:${"c".repeat(64)}`,
  etag: ReviewItemEtag(`sha256:${"d".repeat(64)}`),
  candidateState: { status: "current", capturedRelease: pin },
  evidenceCount: 1,
  evidenceRefs: [
    {
      id: ReviewEvidenceId("prev_s8_gov"),
      candidateSafeDigest: `sha256:${"e".repeat(64)}`,
      reason: "unknown",
      rClass: null,
    },
  ],
  allowedResolutions: ["register-subject", "open-definition-proposal", "mark-out-of-scope"],
};

const resolutionResult: ReviewResolutionResult = {
  outcome: "committed",
  reviewItemId: reviewItem.id,
  resolutionId: ReviewResolutionId("prsl_s8_gov"),
  resolutionType: "register-subject",
  organizationId: orgAdmin.organizationId,
  status: "resolved",
  etag: ReviewItemEtag(`sha256:${"f".repeat(64)}`),
  beforeEtag: reviewItem.etag,
  release: pin,
  idempotencyKey: "resolve-1",
  fingerprint: `sha256:${"1".repeat(64)}`,
  successAuditRef: "aud_s8_gov",
  registrationId: registrationResult.registrationId,
  placementId: registrationResult.placementId,
  subjectId: registrationResult.subjectId,
};

const proposalResult: ProposalResult = {
  outcome: "committed",
  proposalId: DefinitionProposalId("dprop_s8_gov"),
  proposalRevisionId: DefinitionProposalRevisionId("dprev_s8_gov"),
  revisionNumber: 1,
  status: "submitted",
  etagVersion: 1,
  organizationId: orgAdmin.organizationId,
  baseCatalogReleaseId: pin.id,
  baseDefinitionRevisionId: "drev_acme_power_iin_max_1",
  fingerprint: `sha256:${"2".repeat(64)}`,
  idempotencyKey: "prop-1",
  publicationIntent: null,
};

function createHarness(
  options: {
    readonly scope?: TrustedGovernanceScope;
    readonly pin?: typeof pin | null;
    readonly authenticate?: CatalogGovernancePorts["authenticate"];
  } = {},
) {
  const calls: string[] = [];
  const commands: unknown[] = [];
  const seenHeaders: Array<CatalogGovernanceRequest["headers"]> = [];
  const ports: CatalogGovernancePorts = {
    authenticate: async (request) => {
      seenHeaders.push(request.headers);
      if (options.authenticate) {
        return options.authenticate(request);
      }
      return { ok: true, scope: options.scope ?? orgAdmin };
    },
    currentRelease: async () => (options.pin === undefined ? pin : options.pin),
    executeRegistration: async (command) => {
      calls.push("executeRegistration");
      commands.push(command);
      return { ok: true, value: { ...registrationResult, idempotencyKey: command.idempotencyKey } };
    },
    resolveReviewItem: async (command) => {
      calls.push("resolveReviewItem");
      commands.push(command);
      return { ok: true, value: { ...resolutionResult, idempotencyKey: command.idempotencyKey } };
    },
    executeProposal: async (command) => {
      calls.push("executeProposal");
      commands.push(command);
      return { ok: true, value: { ...proposalResult, idempotencyKey: command.idempotencyKey } };
    },
    listReviewQueue: async (query) => {
      calls.push("listReviewQueue");
      commands.push(query);
      return { ok: true, value: { items: [reviewItem], catalogRelease: pin } };
    },
    getReviewItem: async (query) => {
      calls.push("getReviewItem");
      commands.push(query);
      return { ok: true, value: reviewItem };
    },
    listRegistrations: async () => {
      calls.push("listRegistrations");
      return [];
    },
    getRegistration: async () => {
      calls.push("getRegistration");
      return null;
    },
    getPlacement: async () => {
      calls.push("getPlacement");
      return null;
    },
    listObservations: async () => {
      calls.push("listObservations");
      return [];
    },
    getObservation: async () => {
      calls.push("getObservation");
      return null;
    },
    listProposals: async () => {
      calls.push("listProposals");
      return [];
    },
    getProposal: async () => {
      calls.push("getProposal");
      return null;
    },
  };
  return { ports, calls, commands, seenHeaders };
}

function request(
  method: string,
  path: string,
  init: Partial<CatalogGovernanceRequest> = {},
): CatalogGovernanceRequest {
  return {
    method,
    path,
    params: {},
    query: {},
    headers: {},
    requestId: "req-s8-gov",
    body: undefined,
    ...init,
  };
}

const writeHeaders = {
  [CATALOG_RELEASE_HEADER]: pin.id,
  [CATALOG_IDEMPOTENCY_HEADER]: "idem-s8-gov",
  [CATALOG_IF_MATCH_HEADER]: `"${reviewItem.etag}"`,
};

describe("S8-GOV one-command HTTP mapping", () => {
  it("matches every frozen governance route and refuses legacy lookup", () => {
    for (const route of catalogGovernanceRoutes) {
      const filled = route.path
        .replace(":organizationId", "org-s8-gov")
        .replace(":registrationId", "sreg_s8_gov")
        .replace(":observationId", "pobs_s8_gov")
        .replace(":reviewItemId", "prit_s8_gov")
        .replace(":proposalId", "dprop_s8_gov");
      expect(matchCatalogGovernanceRoute(route.method, filled)?.id).toBe(route.id);
    }
    expect(
      matchCatalogGovernanceRoute("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-1"),
    ).toBeNull();
    expect(Object.keys(catalogGovernanceCommandByRouteId)).toHaveLength(19);
  });

  it("invokes exactly one executeRegistration command for create", async () => {
    const { ports, calls, commands } = createHarness();
    const response = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/organizations/org-s8-gov/subject-registrations", {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: "idem-create",
        },
        body: {
          subjectId: "csub_acme_power",
          placement: { mode: "use-default" },
          reason: "adopt published subject",
        },
      }),
    );
    expect(calls).toEqual(["executeRegistration"]);
    expect(commands[0]).toMatchObject({
      kind: "register",
      method: "explicit",
      destinationModuleId: orgAdmin.defaultDestinationModuleId,
      context: { actorKind: "org-admin", principalId: orgAdmin.principalId },
    });
    expect(response.status).toBe(201);
    expect(response.headers[CATALOG_RELEASE_HEADER]).toBe(pin.id);
    expect(response.headers.ETag).toBeDefined();
    catalogRegistrationResponseSchema.parse(response.body);
  });

  it("refuses a missing Idempotency-Key or If-Match before any domain command", async () => {
    const { ports, calls } = createHarness();
    const missingKey = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/organizations/org-s8-gov/subject-registrations", {
        headers: { [CATALOG_RELEASE_HEADER]: pin.id },
        body: { subjectId: "csub_acme_power", placement: { mode: "use-default" } },
      }),
    );
    expect(missingKey.status).toBe(409);
    expect((missingKey.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "revision-conflict",
    );
    expect(calls).toEqual([]);

    const missingMatch = await handleCatalogGovernance(
      ports,
      request(
        "POST",
        "/api/v2/organizations/org-s8-gov/parameter-review-items/prit_s8_gov/resolve",
        {
          headers: {
            [CATALOG_RELEASE_HEADER]: pin.id,
            [CATALOG_IDEMPOTENCY_HEADER]: "idem-resolve",
          },
          body: {
            resolution: {
              type: "register-subject",
              subjectId: "csub_acme_power",
              placement: { mode: "use-default" },
            },
            reason: "unknown",
          },
        },
      ),
    );
    expect(missingMatch.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("strips spoofed role/org/agent headers before authentication", async () => {
    const { ports, seenHeaders } = createHarness();
    await handleCatalogGovernance(
      ports,
      request("GET", "/api/v2/organizations/org-s8-gov/subject-registrations", {
        headers: {
          "X-WiseEff-Role": "platform-admin",
          "X-WiseEff-Organization": "org-attacker",
          "X-WiseEff-Actor-Kind": "agent",
          "X-WiseEff-Agent": "true",
        },
      }),
    );
    const headers = seenHeaders[0] ?? {};
    expect(headers["X-WiseEff-Role"] ?? headers["x-wiseeff-role"]).toBeUndefined();
    expect(headers["X-WiseEff-Organization"] ?? headers["x-wiseeff-organization"]).toBeUndefined();
    expect(headers["X-WiseEff-Actor-Kind"] ?? headers["x-wiseeff-actor-kind"]).toBeUndefined();
    expect(headers["X-WiseEff-Agent"] ?? headers["x-wiseeff-agent"]).toBeUndefined();
  });

  it("keeps Agent read-only and maps one listReviewQueue command", async () => {
    const { ports, calls } = createHarness({ scope: agent });
    const listed = await handleCatalogGovernance(
      ports,
      request("GET", "/api/v2/organizations/org-s8-gov/parameter-review-items"),
    );
    expect(calls).toEqual(["listReviewQueue"]);
    expect(listed.status).toBe(200);
    catalogReviewItemListResponseSchema.parse(listed.body);

    const write = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/organizations/org-s8-gov/subject-registrations", {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: "agent-write",
        },
        body: { subjectId: "csub_acme_power", placement: { mode: "use-default" } },
      }),
    );
    expect(write.status).toBe(403);
    expect(calls).toEqual(["listReviewQueue"]);
  });

  it("resolves a review item through exactly one resolveReviewItem command", async () => {
    const { ports, calls, commands } = createHarness();
    const response = await handleCatalogGovernance(
      ports,
      request(
        "POST",
        "/api/v2/organizations/org-s8-gov/parameter-review-items/prit_s8_gov/resolve",
        {
          headers: writeHeaders,
          body: {
            resolution: {
              type: "register-subject",
              subjectId: "csub_acme_power",
              placement: { mode: "use-default" },
            },
            reason: "unknown",
          },
        },
      ),
    );
    expect(calls).toEqual(["resolveReviewItem"]);
    expect(commands[0]).toMatchObject({
      resolution: "register-subject",
      destinationModuleId: orgAdmin.defaultDestinationModuleId,
    });
    expect(response.status).toBe(200);
    catalogReviewResolutionResponseSchema.parse(response.body);
  });

  it("creates a proposal through exactly one executeProposal command", async () => {
    const { ports, calls, commands } = createHarness();
    const response = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/catalog/definition-proposals", {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: "idem-proposal",
        },
        body: {
          base: {
            catalogReleaseId: pin.id,
            definitionRevisionId: "drev_acme_power_iin_max_1",
          },
          requestedChange: { kind: "revise-definition" },
          reason: "clarify contract",
        },
      }),
    );
    expect(calls).toEqual(["executeProposal"]);
    expect(commands[0]).toMatchObject({ kind: "submit" });
    expect(response.status).toBe(201);
    catalogProposalResponseSchema.parse(response.body);
  });

  it("refuses platform-admin Organization mutation and accepts distinct reviewer accept", async () => {
    const { ports, calls } = createHarness({ scope: platformAdmin });
    const register = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/organizations/org-s8-gov/subject-registrations", {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: "platform-reg",
        },
        body: { subjectId: "csub_acme_power", placement: { mode: "use-default" } },
      }),
    );
    expect(register.status).toBe(403);
    expect(calls).toEqual([]);

    const accepted = await handleCatalogGovernance(
      ports,
      request("POST", "/api/v2/catalog/definition-proposals/dprop_s8_gov/accept", {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: "accept-1",
          [CATALOG_IF_MATCH_HEADER]: '"dprop_s8_gov-v1"',
        },
        body: { repositoryReference: "repo://wiseeff-catalog/acme-power.yaml" },
      }),
    );
    expect(calls).toEqual(["executeProposal"]);
    expect(accepted.status).toBe(200);
  });

  it("returns catalog-not-ready instead of an empty write when the pin is missing", async () => {
    const { ports, calls } = createHarness({ pin: null });
    const response = await handleCatalogGovernance(
      ports,
      request("GET", "/api/v2/organizations/org-s8-gov/subject-registrations"),
    );
    expect(response.status).toBe(503);
    expect((response.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "catalog-not-ready",
    );
    expect(calls).toEqual([]);
  });
});
