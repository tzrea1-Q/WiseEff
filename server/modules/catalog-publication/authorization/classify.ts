import type {
  ImpactFacts,
  PublicationAuthorizationFailure,
  PublicationAuthorizationResult,
  PublicationRiskClass,
} from "./types";

const fail = (
  reason: PublicationAuthorizationFailure["reason"],
  detail?: string,
): PublicationAuthorizationResult<never> => ({
  ok: false,
  error: detail ? { reason, detail } : { reason },
});

/**
 * Server-side classifier. Source kind never implies low. Unknown impact is
 * blocked rather than treated as an approvable high-risk change.
 */
export const classifyImpact = (
  facts: ImpactFacts,
): PublicationAuthorizationResult<PublicationRiskClass> => {
  if (facts.unknownImpact) {
    return fail(
      "unsupported-catalog-capability",
      "unknown impact cannot be classified as low or approved as high",
    );
  }
  if (facts.operations.length === 0) {
    return fail("unsupported-catalog-capability", "impact operations are required");
  }
  if (facts.authorPrincipalId.trim().length === 0) {
    return fail("publication-not-authorized", "authorPrincipalId is required");
  }

  let onlySupportedCreateDefinition = true;
  for (const operation of facts.operations) {
    if (operation.op === "unknown") {
      return fail(
        "unsupported-catalog-capability",
        `unsupported impact operation ${operation.tag}`,
      );
    }
    if (operation.op === "create-definition") {
      if (!operation.supported) {
        return fail(
          "unsupported-catalog-capability",
          "unsupported create-definition content is blocked",
        );
      }
      continue;
    }
    if (operation.op === "revise-definition" && operation.class === "documentation") {
      continue;
    }
    onlySupportedCreateDefinition = false;
  }

  const highImpactSignals =
    facts.introducesNewSubject ||
    facts.changesSelector ||
    facts.changesAlias ||
    facts.changesFallback ||
    facts.tightensExistingContract ||
    facts.changesUnitOrSemantic ||
    facts.retiresIdentity ||
    !onlySupportedCreateDefinition;

  if (highImpactSignals) {
    return { ok: true, value: "high" };
  }

  return { ok: true, value: "low" };
};

export const lowRiskCreateDefinitionFacts = (
  authorPrincipalId: string,
  sourceKind: ImpactFacts["sourceKind"] = "typed-changeset",
): ImpactFacts => ({
  authorPrincipalId,
  operations: [{ op: "create-definition", supported: true }],
  introducesNewSubject: false,
  changesSelector: false,
  changesAlias: false,
  changesFallback: false,
  tightensExistingContract: false,
  changesUnitOrSemantic: false,
  retiresIdentity: false,
  unknownImpact: false,
  sourceKind,
});
