import { useEffect, useMemo, useState } from "react";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogResponseWithEtag } from "@/infrastructure/http/parameterCatalogClient";
import { presentError } from "@/infrastructure/http/presentError";

export type PlacementOccupant = {
  registrationId: string;
  subjectId: string;
  displayName: string;
  status: "active" | "retired";
  activeDefinitionCount: number | null;
};

export type PlacementReplacementEvidence = {
  registrationId: string;
  placementEtag: string;
  registrationEtag: string;
  subjectId: string;
  status: "active" | "retired";
  bindingCount: number;
  projectCount: number;
};

type PreviewState =
  | { request: object; key: string; status: "error"; message: string }
  | { request: object; key: string; status: "ready"; evidence: PlacementReplacementEvidence };

export function usePlacementReplacementPreview(input: {
  active: boolean;
  repository: ParameterCatalogGovernanceRepository;
  organizationId: string;
  catalogReleaseId: string;
  sourceRegistrationId?: string;
  sourceIfMatch?: string;
  destinationModuleId: string;
  occupant?: PlacementOccupant;
  refreshKey: number;
}) {
  const { active, repository, organizationId, catalogReleaseId, sourceRegistrationId,
    sourceIfMatch, destinationModuleId, occupant, refreshKey } = input;
  const occupantId = occupant?.registrationId;
  const occupantSubjectId = occupant?.subjectId;
  const key = JSON.stringify([organizationId, catalogReleaseId, sourceRegistrationId,
    sourceIfMatch, destinationModuleId, occupantId, occupantSubjectId, refreshKey]);
  const request = useMemo(() => ({ key, active, repository }), [active, repository, key]);
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!active || !occupantId || !occupantSubjectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [registration, placement] = await Promise.all([
          repository.getRegistration(organizationId, occupantId),
          repository.getPlacement(organizationId, occupantId)
        ]);
        const registrationEtag = (registration as CatalogResponseWithEtag<typeof registration>).etag?.trim();
        const placementEtag = (placement as CatalogResponseWithEtag<typeof placement>).etag?.trim();
        const record = registration.item;
        if (record.id !== occupantId || record.subjectId !== occupantSubjectId ||
          record.organizationId !== organizationId || record.catalogReleaseId !== catalogReleaseId ||
          record.placement.moduleId !== destinationModuleId || placement.item.moduleId !== destinationModuleId ||
          record.placement.id !== placement.item.id) {
          throw new Error("目标模块的归属已变化，请刷新双方归属后重新核对。");
        }
        if (!registrationEtag || !placementEtag || !record.impact) {
          throw new Error("缺少目标主体的影响数据或版本条件，无法安全替换；请重试读取。");
        }
        if (!cancelled) setState({ request, key, status: "ready", evidence: {
          registrationId: record.id, subjectId: record.subjectId, status: record.status,
          placementEtag, registrationEtag, bindingCount: record.impact.bindingCount,
          projectCount: record.impact.projectCount
        } });
      } catch (error) {
        if (!cancelled) setState({ request, key, status: "error", message: presentError(error, "无法读取替换影响，请重试。") });
      }
    })();
    return () => { cancelled = true; };
  }, [active, repository, organizationId, catalogReleaseId, occupantId, occupantSubjectId,
    sourceRegistrationId, sourceIfMatch, destinationModuleId, refreshKey, key, request]);

  // A changed selection cannot reuse evidence from the previous render, even
  // before the effect's loading state is committed.
  return { key, state: active ? (state?.request === request ? state : { key, status: "loading" as const }) : null };
}
