/**
 * T1.3 ConfigurationSchema successor. Vendor YAML import stays vendor-only;
 * this composer is the peer that carries wiseeff.power-config through
 * buildCompleteSuccessor with productPath m2-core.
 */
import { CatalogArtifactId, CatalogCandidateId, CatalogReleaseId, CatalogReleaseVersion } from "../../parameter-catalog-contract/index";
import type { ImpactFacts } from "../authorization/types";
import { buildCompleteSuccessor } from "../builder/completeSuccessor";
import type {
  BuildCompleteSuccessorInput,
  FrozenPublicationIdentity,
} from "../builder/types";
import { SEED_POWER_CONFIG_SCHEMA_ID } from "../../parameter-bindings/seedInitialization/powerConfig";
import { vendorImpactFacts } from "./vendorAdapter";

export const powerConfigChangeSet = [
  {
    op: "create-subject-with-definitions" as const,
    kind: "configuration-schema" as const,
    canonicalKey: SEED_POWER_CONFIG_SCHEMA_ID,
    selector: { kind: "configuration-schema-id" as const, value: SEED_POWER_CONFIG_SCHEMA_ID },
    definitions: [
      {
        propertyKey: "charger.cv.limitMv",
        content: {
          displayName: "Charge voltage limit",
          documentation:
            "恒压阶段的充电电压上限。用于控制电池进入恒压补电时的目标电压，决定补电效率与热负荷上限。",
          unit: "mV",
          valueSchema: { type: "integer" as const, minimum: 4200, maximum: 4500 },
          examples: [4300],
        },
      },
      {
        propertyKey: "battery.thermal.targetTempC",
        content: {
          displayName: "Battery thermal target",
          documentation:
            "电池快充过程中的目标温度区间。配合散热策略控制电芯温度，目标过高会触发降额，过低则拉长充电周期。",
          unit: "°C",
          valueSchema: { type: "integer" as const, minimum: 30, maximum: 42 },
          examples: [36],
        },
      },
    ],
  },
];

export const powerConfigImpactFacts = (authorPrincipalId: string): ImpactFacts => ({
  ...vendorImpactFacts(authorPrincipalId, powerConfigChangeSet),
  sourceKind: "typed-changeset",
});

export async function buildPowerConfigSuccessor(
  input: {
    readonly predecessorArtifact: BuildCompleteSuccessorInput["predecessorArtifact"];
    readonly frozenIdentity: FrozenPublicationIdentity;
    readonly persist?: BuildCompleteSuccessorInput["persist"];
  },
) {
  return buildCompleteSuccessor({
    predecessorArtifact: input.predecessorArtifact,
    changeSet: powerConfigChangeSet,
    frozenIdentity: input.frozenIdentity,
    productPath: "m2-core",
    persist: input.persist,
  });
}

export const powerConfigFrozenIdentity = (allocate: {
  readonly candidateId: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly publishedAt: string;
  readonly toolchain: FrozenPublicationIdentity["toolchain"];
  readonly subjectId: string;
  readonly cvDefinitionId: string;
  readonly cvRevisionId: string;
  readonly thermalDefinitionId: string;
  readonly thermalRevisionId: string;
}): FrozenPublicationIdentity => ({
  candidateId: CatalogCandidateId(allocate.candidateId),
  artifactId: CatalogArtifactId(allocate.artifactId),
  releaseId: CatalogReleaseId(allocate.releaseId),
  releaseVersion: CatalogReleaseVersion(allocate.releaseVersion),
  publishedAt: allocate.publishedAt,
  toolchain: allocate.toolchain,
  subjects: [{ canonicalKey: SEED_POWER_CONFIG_SCHEMA_ID, subjectId: allocate.subjectId }],
  definitions: [
    {
      subjectId: allocate.subjectId,
      propertyKey: "charger.cv.limitMv",
      definitionId: allocate.cvDefinitionId,
      revisionId: allocate.cvRevisionId,
    },
    {
      subjectId: allocate.subjectId,
      propertyKey: "battery.thermal.targetTempC",
      definitionId: allocate.thermalDefinitionId,
      revisionId: allocate.thermalRevisionId,
    },
  ],
});
