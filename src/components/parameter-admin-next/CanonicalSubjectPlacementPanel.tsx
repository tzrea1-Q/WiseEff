import { SelectControl } from "@/components/common/SelectControl";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

import {
  isCatalogActionEnabled,
  catalogActionsForSession,
  type CatalogActorKind
} from "@/application/parameter-catalog/authority";
import {
  deriveCatalogDomainState,
  catalogStateFromFailure,
  type CatalogDomainState
} from "@/application/parameter-catalog/states";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";
import {
  RegistrationDialog,
  type RegistrationModuleOption,
  type RegistrationSubjectImpact
} from "@/features/parameter-catalog-governance/RegistrationDialog";
import { RegistrationLifecycleDialog } from "@/features/parameter-catalog-governance/RegistrationLifecycleDialog";
import { SharedDtsiSubjectCreation } from "@/features/shared-dtsi/SharedDtsiSubjectCreation";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "@/features/parameter-catalog-governance/publicationSurface";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type {
  CatalogDefinitionListResponse,
  CatalogPlacementResponse,
  CatalogRegistrationListResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import type { CatalogResponseWithEtag } from "@/infrastructure/http/parameterCatalogClient";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { presentError } from "@/infrastructure/http/presentError";
import { buildCatalogHref, EMPTY_CATALOG_URL_ANCHOR } from "@/application/parameter-catalog/urlAnchor";
import { collectSubtreeModuleIds } from "@/domain/modules/moduleTree";
import { toAttributionFlatNodes } from "@/components/parameter-topology/moduleAttributionTreeUtils";
import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";

const SUBJECT_KIND_LABEL: Record<CatalogSubjectResponse["item"]["type"], string> = {
  driver: "驱动",
  "node-type": "节点类型",
  "configuration-schema": "配置规范"
};

const SUBJECT_KIND_MODULE_KIND: Record<
  CatalogSubjectResponse["item"]["type"],
  ParameterModule["kind"]
> = {
  driver: "driver-group",
  "node-type": "node-type",
  "configuration-schema": "business"
};

const SUBJECTS_PER_PAGE = 10;

export { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";

function subjectTypeLabel(type: CatalogSubjectResponse["item"]["type"]): string {
  return SUBJECT_KIND_LABEL[type];
}

type CatalogPlacementResponseWithEtag = CatalogResponseWithEtag<CatalogPlacementResponse>;

function placementEtag(response: CatalogPlacementResponseWithEtag): string | null {
  return response.etag?.trim() || null;
}

type SubjectRow = CatalogSubjectResponse["item"];
type RegistrationRow = CatalogRegistrationListResponse["items"][number];

type DefinitionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: CatalogDefinitionListResponse["items"] }
  | { status: "empty" }
  | { status: "error"; message: string };

export type CanonicalSubjectPlacementPanelProps = {
  apiClient?: ApiClient;
  currentPersonId?: string;
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  organizationId: string;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  canAdmin?: boolean;
  modules?: readonly ParameterModule[];
  onChanged?: () => void | Promise<void>;
  selectedModuleId?: string | null;
  refreshKey?: number;
  managedRefresh?: boolean;
  onNavigate?: (path: string) => void;
  search?: string;
  visibleModuleIds?: readonly string[] | null;
  onCreateBusinessModule?: () => void;
};

/**
 * Canonical subject/placement read surface for the module administration page.
 * The public parameter-module tree remains a separate shared surface below it;
 * this panel never uses the legacy driver registry as a subject identity.
 */
export function CanonicalSubjectPlacementPanel({
  apiClient,
  currentPersonId = "",
  catalog,
  governance,
  organizationId,
  actor,
  sessionPermissions,
  canAdmin = false,
  modules = [],
  onChanged,
  selectedModuleId,
  refreshKey = 0,
  managedRefresh = false,
  onNavigate,
  search: searchProp,
  visibleModuleIds,
  onCreateBusinessModule
}: CanonicalSubjectPlacementPanelProps) {
  const [domainState, setDomainState] = useState<CatalogDomainState>({
    kind: "loading",
    catalogReleaseId: null,
    stale: false,
    writesEnabled: false
  });
  const [catalogReleaseId, setCatalogReleaseId] = useState("");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryComplete, setInventoryComplete] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const params = useMemo(() => new URLSearchParams(searchProp ?? localSearch), [searchProp, localSearch]);
  const [createSubjectOpen, setCreateSubjectOpen] = useState(false);
  const [publicationSurface, setPublicationSurface] = useState<PublicationSurfaceItem | null>(null);
  const [publicationError, setPublicationError] = useState("");
  const canAuthorSubject = canAdmin && catalogActionsForSession({ actor, permissions: sessionPermissions }).includes("preview-publication");
  const canCreateSubject = canAuthorSubject && isCatalogActionEnabled(actor, "preview-publication", domainState, sessionPermissions);
  useEffect(() => {
    let cancelled = false;
    setPublicationSurface(null);
    setPublicationError("");
    if (!canAuthorSubject) return;
    void catalog.getPublicationSurface().then(({ item }) => {
      if (!cancelled) setPublicationSurface(item);
    }).catch(() => { if (!cancelled) setPublicationError("无法读取目录编写状态，请刷新规范数据后重试。"); });
    return () => { cancelled = true; };
  }, [catalog, organizationId, canAuthorSubject, refreshKey]);
  const subjectCreationRequested = createSubjectOpen || params.get("createSubject") === "1";
  const publicationAdvisory = publicationSurface ? publicationSurfaceAdvisory(publicationSurface) : null;
  const closeSubjectCreation = () => {
    setCreateSubjectOpen(false);
    const sourceReturn=params.get("sourceReturn");
    if(params.has("sourceResource") && sourceReturn?.startsWith("/parameter-admin/sources?") && onNavigate){onNavigate(sourceReturn);return;}
    if (params.has("createSubject")) updateQuery({ createSubject: null, returnTo: null });
  };
  const search = params.get("subjectQ") ?? "";
  const requestedKind = params.get("subjectKind") ?? "all";
  const typeFilter = Object.hasOwn(SUBJECT_KIND_LABEL, requestedKind) ? requestedKind : "all";
  const registrationFilter = ["registered", "unregistered", "retired", "all-statuses"].includes(params.get("subjectRegistration") ?? "") ? params.get("subjectRegistration")! : "all";
  const definitionsFilter = ["with", "without"].includes(params.get("subjectDefinitions") ?? "") ? params.get("subjectDefinitions")! : "all";
  const pageParameter = Number(params.get("subjectPage"));
  const requestedPage = Number.isSafeInteger(pageParameter) && pageParameter > 0 ? pageParameter - 1 : 0;
  const expandedSubjectId = params.get("expandedSubject");
  const updateQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    if (searchProp !== undefined && onNavigate) onNavigate(`/parameter-admin/modules${next.size ? `?${next}` : ""}`);
    else setLocalSearch(next.toString());
  };
  const readGeneration = useRef(0);
  const placementGeneration = useRef(0);
  const [openingSubjectId, setOpeningSubjectId] = useState<string | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<{ intent: "retire-registration" | "restore-registration"; subject: SubjectRow; registrationId?: string } | null>(null);
  const [lifecycleNotice, setLifecycleNotice] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [definitionRefresh, setDefinitionRefresh] = useState(0);
  const [definitionStates, setDefinitionStates] = useState<Map<string, DefinitionState>>(
    () => new Map()
  );
  const [placementDialog, setPlacementDialog] = useState<{
    intent: "register-subject" | "update-placement";
    subject: SubjectRow;
    registrationId?: string;
    ifMatch?: string;
    subjectImpact?: RegistrationSubjectImpact;
    currentModuleName?: string;
    currentModuleId?: string;
  } | null>(null);

  const loadCanonical = useCallback(async () => {
    const generation = ++readGeneration.current;
    let failed = false;
    let subjectsReceived = false;
    let registrationsReceived = false;
    const isCancelled = () => failed || generation !== readGeneration.current;
    const revealFirstBatch = () => {
      if (subjectsReceived && registrationsReceived) setLoading(false);
    };
    const subjectPages = new Map<string, SubjectRow[]>();
    const publishSubjects = (lifecycle: string, items: SubjectRow[]) => {
      subjectPages.set(lifecycle, items);
      const inventory = [...new Map([...subjectPages.values()].flat().map(item => [item.id, item])).values()];
      setSubjects(inventory);
      subjectsReceived = true;
      revealFirstBatch();
    };
    setLoading(true);
    setInventoryComplete(false);
    setLoadError(null);
    setSubjects([]);
    setRegistrations([]);
    setDefinitionStates(new Map());
    setDomainState({
      kind: "loading",
      catalogReleaseId: null,
      stale: false,
      writesEnabled: false
    });
    try {
      const document = await catalog.getCatalog();
      if (generation !== readGeneration.current) return null;
      const nextState = deriveCatalogDomainState({ document });
      setDomainState(nextState);
      if (!document.item) {
        setCatalogReleaseId("");
        setSubjects([]);
        setRegistrations([]);
        return null;
      }

      const release = document.item.catalogReleaseId;
      setCatalogReleaseId(release);
      const [activeSubjects, retiredSubjects, nextRegistrations] = await Promise.all([
        listAllCanonicalPages(
          (query) => catalog.listSubjects(query),
          { catalogReleaseId: release, limit: 100 },
          { isCancelled, onPage: (items) => publishSubjects("active", items) }
        ),
        listAllCanonicalPages(
          (query) => catalog.listSubjects(query),
          { catalogReleaseId: release, lifecycle: "retired", limit: 100 },
          { isCancelled, onPage: (items) => publishSubjects("retired", items) }
        ),
        listAllCanonicalPages(
          (query) => governance.listRegistrations(organizationId, query),
          { catalogReleaseId: release, limit: 100 },
          { isCancelled, onPage: (items) => { setRegistrations(items); registrationsReceived = true; revealFirstBatch(); } }
        )
      ]);
      if (generation !== readGeneration.current) return null;
      const nextSubjects = [...new Map([...activeSubjects, ...retiredSubjects].map(item => [item.id, item])).values()];
      setCatalogReleaseId(release);
      setSubjects(nextSubjects);
      setRegistrations(nextRegistrations);
      setInventoryComplete(true);
      return { subjects: nextSubjects, registrations: nextRegistrations, releaseId: release };
    } catch (error) {
      if (generation !== readGeneration.current) return null;
      failed = true;
      const nextState = catalogStateFromFailure(error);
      setDomainState(nextState);
      setLoadError(presentError(error, "无法加载规范主体归属，请稍后重试。"));
      return null;
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, [catalog, governance, organizationId]);

  useEffect(() => {
    void loadCanonical();
    return () => { readGeneration.current += 1; };
  }, [loadCanonical, refreshKey]);
  useEffect(() => () => { readGeneration.current += 1; placementGeneration.current += 1; }, []);

  const registrationBySubjectId = useMemo(() => {
    const map = new Map<string, RegistrationRow>();
    for (const registration of registrations) {
      map.set(registration.subjectId, registration);
    }
    return map;
  }, [registrations]);

  const selectedModuleIds = useMemo(() => {
    if (!selectedModuleId) return null;
    return collectSubtreeModuleIds(toAttributionFlatNodes(modules), [selectedModuleId]);
  }, [modules, selectedModuleId]);
  const filteredSubjects = useMemo(() => {
    const token = search.trim().toLowerCase();
    return subjects.filter((subject) => {
      const registration = registrationBySubjectId.get(subject.id);
      const placement = registration?.status === "active" ? registration.placement
        : subject.registration.status !== "unregistered" ? subject.registration.placement : undefined;
      if (selectedModuleIds && (!placement?.moduleId || !selectedModuleIds.has(placement.moduleId))) return false;
      if (visibleModuleIds && (!placement?.moduleId || !visibleModuleIds.includes(placement.moduleId))) return false;
      if (typeFilter !== "all" && subject.type !== typeFilter) return false;
      const registered = (registration?.status ?? subject.registration.status) === "active";
      const retired = (registration?.status ?? subject.registration.status) === "retired";
      if (registrationFilter === "all" && retired) return false;
      if (registrationFilter === "registered" && !registered) return false;
      if (registrationFilter === "retired" && !retired) return false;
      if (registrationFilter === "unregistered" && (registration?.status ?? subject.registration.status) !== "unregistered") return false;
      if (definitionsFilter === "with" && subject.definitionCounts.active === 0) return false;
      if (definitionsFilter === "without" && subject.definitionCounts.active !== 0) return false;
      if (!token) return true;
      return [subject.canonicalName, subject.id, ...subject.aliases]
        .join(" ")
        .toLowerCase()
        .includes(token);
    });
  }, [search, subjects, typeFilter, registrationBySubjectId, selectedModuleIds, registrationFilter, definitionsFilter, visibleModuleIds]);
  const subjectPageCount = Math.max(1, Math.ceil(filteredSubjects.length / SUBJECTS_PER_PAGE));
  const subjectPage = Math.min(requestedPage, subjectPageCount - 1);
  const visibleSubjects = filteredSubjects.slice(
    subjectPage * SUBJECTS_PER_PAGE,
    (subjectPage + 1) * SUBJECTS_PER_PAGE
  );
  const moduleLabels = useMemo(() => {
    const flat = toAttributionFlatNodes(modules);
    return new Map(flat.map((module) => [module.id, modulePathSegments(module, flat).join(" / ")]));
  }, [modules]);

  const moduleImpactById = useMemo(() => {
    const summary = new Map<string, { subjects: number; definitions: number }>();
    for (const subject of subjects) {
      const registration = registrationBySubjectId.get(subject.id);
      if (registration?.status !== "active") continue;
      const moduleId = registration.placement.moduleId;
      if (!moduleId) continue;
      const current = summary.get(moduleId) ?? { subjects: 0, definitions: 0 };
      current.subjects += 1;
      current.definitions += subject.definitionCounts.active;
      summary.set(moduleId, current);
    }
    return summary;
  }, [registrationBySubjectId, subjects]);

  const moduleOptionsByType = useMemo(() => {
    const result = new Map<SubjectRow["type"], RegistrationModuleOption[]>();
    const occupants = new Map(registrations.filter((item) => item.placement.moduleId)
      .map((item) => [item.placement.moduleId!, item]));
    for (const type of Object.keys(SUBJECT_KIND_MODULE_KIND) as SubjectRow["type"][]) {
      const expectedKind = SUBJECT_KIND_MODULE_KIND[type];
      result.set(
        type,
        modules
          .filter((module) => module.kind === expectedKind)
          .map((module) => {
            const impact = moduleImpactById.get(module.id);
            const registration = occupants.get(module.id);
            const owner = registration ? subjects.find((item) => item.id === registration.subjectId) : undefined;
            return {
              id: module.id,
              displayName: moduleLabels.get(module.id) ?? module.name,
              kind: module.kind,
              impactSummary: impact
                ? `当前 ${impact.subjects} 个主体、${impact.definitions} 个有效定义`
                : registration ? (registration.status === "retired" ? "保留已停用主体的归属" : "已有主体登记，定义统计暂不可用") : "当前无主体",
              ...(registration ? { occupant: {
                registrationId: registration.id, subjectId: registration.subjectId,
                displayName: owner?.canonicalName ?? registration.subjectId,
                status: registration.status,
                activeDefinitionCount: owner?.definitionCounts.active ?? null
              } } : {})
            };
          })
          .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans"))
      );
    }
    return result;
  }, [moduleImpactById, modules, moduleLabels, registrations, subjects]);

  const activeSubjectCount = useMemo(
    () => filteredSubjects.filter((subject) => subject.membership.status === "active" &&
      (registrationBySubjectId.get(subject.id)?.status ?? subject.registration.status) !== "retired").length,
    [filteredSubjects, registrationBySubjectId]
  );
  const expandedSubject = subjects.find((subject) => subject.id === expandedSubjectId);

  useEffect(() => {
    if (!expandedSubjectId || !catalogReleaseId || loading || !expandedSubject) return;
    let cancelled = false;
    const generation = readGeneration.current;
    setDefinitionStates((current) => new Map(current).set(expandedSubjectId, { status: "loading" }));
    void (async () => { try {
      const items = await listAllCanonicalPages(
        (query) => catalog.listDefinitions(query),
        {
          subjectId: expandedSubjectId,
          lifecycle: "active",
          catalogReleaseId,
          limit: 100
        }
      );
      if (cancelled || generation !== readGeneration.current) return;
      setDefinitionStates((current) =>
        new Map(current).set(
          expandedSubjectId,
          items.length > 0 ? { status: "ready", items } : { status: "empty" }
        )
      );
    } catch (error) {
      if (cancelled || generation !== readGeneration.current) return;
      setDefinitionStates((current) =>
        new Map(current).set(expandedSubjectId, {
          status: "error",
          message: presentError(error, "无法加载该主体的有效定义。")
        })
      );
    } })();
    return () => { cancelled = true; };
  }, [catalog, catalogReleaseId, expandedSubjectId, loading, expandedSubject, definitionRefresh]);

  const openRegistration = (subject: SubjectRow) => {
    if (!inventoryComplete) return;
    placementGeneration.current += 1;
    setOpeningSubjectId(null);
    setPlacementDialog({
      intent: "register-subject",
      subject,
      subjectImpact: {
        activeDefinitionCount: subject.definitionCounts.active,
        bindingCount: null,
        projectCount: null
      }
    });
  };

  const openPlacement = async (subject: SubjectRow, registrationId: string) => {
    if (!inventoryComplete || openingSubjectId === subject.id) return;
    const generation = ++placementGeneration.current;
    setOpeningSubjectId(subject.id);
    setRowErrors((current) => ({ ...current, [subject.id]: "" }));
    try {
      const [registration, placement] = await Promise.all([
        governance.getRegistration(organizationId, registrationId),
        governance.getPlacement(organizationId, registrationId)
      ]);
      if (generation !== placementGeneration.current) return;
      const ifMatch = placementEtag(placement);
      if (!ifMatch) {
        setRowErrors((current) => ({ ...current, [subject.id]: "当前归属缺少可用版本条件，无法安全调整；请刷新后重试。" }));
        return;
      }
      const placementModuleId = placement.item.moduleId;
      const placementDisplayName = placement.item.displayName;
      const currentModuleName =
        moduleLabels.get(placementModuleId ?? "") ??
        placementDisplayName ??
        placementModuleId;
      const impact = registration.item.impact;
      if (!impact) {
        setRowErrors((current) => ({ ...current, [subject.id]: "当前主体缺少影响数据，无法安全调整归属；请刷新后重试。" }));
        return;
      }
      setPlacementDialog({
        intent: "update-placement",
        subject,
        registrationId,
        ifMatch,
        subjectImpact: {
          activeDefinitionCount: subject.definitionCounts.active,
          bindingCount: impact.bindingCount,
          projectCount: impact.projectCount
        },
        currentModuleName,
        currentModuleId: placementModuleId ?? undefined
      });
    } catch (error) {
      if (generation === placementGeneration.current) setRowErrors((current) => ({ ...current, [subject.id]: presentError(error, "无法读取当前主体归属，请刷新后重试。") }));
    } finally {
      if (generation === placementGeneration.current) setOpeningSubjectId(null);
    }
  };

  const refreshPlacementEvidence = async () => {
    if (!placementDialog) return;
    const source = placementDialog;
    const generation = ++placementGeneration.current;
    const refreshed = await loadCanonical();
    if (!refreshed) throw new Error("规范数据刷新失败，请重试。");
    const subject = refreshed.subjects.find((item) => item.id === source.subject.id);
    if (!subject) throw new Error("当前发布中找不到该主体，请关闭后重新选择。");
    if (!source.registrationId) {
      if (generation === placementGeneration.current) setPlacementDialog((current) => current ? { ...current, subject,
        subjectImpact: { activeDefinitionCount: subject.definitionCounts.active, bindingCount: null, projectCount: null } } : null);
      return;
    }
      const [registration, placement] = await Promise.all([
        governance.getRegistration(organizationId, source.registrationId), governance.getPlacement(organizationId, source.registrationId)
      ]);
      if (generation !== placementGeneration.current) return;
      const ifMatch = placementEtag(placement);
      if (!ifMatch) {
        throw new Error("刷新后仍缺少归属版本条件，未发送写入。");
      }
      const impact = registration.item.impact;
      if (!impact) throw new Error("刷新后缺少主体影响数据，未发送写入。");
      setPlacementDialog((current) => current ? { ...current, subject, ifMatch,
        currentModuleId: placement.item.moduleId ?? undefined,
        currentModuleName: moduleLabels.get(placement.item.moduleId ?? "") ?? placement.item.displayName,
        subjectImpact: { activeDefinitionCount: subject.definitionCounts.active, ...impact } } : null);
  };

  const selectedRegistration = placementDialog
    ? registrationBySubjectId.get(placementDialog.subject.id)
    : undefined;
  const selectedModuleOptions = placementDialog
    ? moduleOptionsByType.get(placementDialog.subject.type) ?? []
    : [];
  const newDestinationParents = modules.filter((module) => module.kind === "business")
    .map((module) => ({ id: module.id, displayName: moduleLabels.get(module.id) ?? module.name, kind: module.kind }));
  const selectedDestinationModuleId =
    placementDialog?.currentModuleId ??
    selectedRegistration?.placement.moduleId ??
    (placementDialog?.subject.registration.status === "unregistered"
      ? undefined
      : placementDialog?.subject.registration.placement?.moduleId) ??
    (placementDialog?.intent === "update-placement" ? "" : undefined);

  const handleCompleted = async () => {
    setPlacementDialog(null);
    await loadCanonical();
    await onChanged?.();
  };

  return (
    <section
      className="parameter-module-mapping-panel__grid parameter-canonical-subject-panel"
      aria-label="规范主体归属"
      data-canonical-subject-panel="true"
      id="canonical-subject-placement"
      tabIndex={-1}
    >
      <section>
        <header className="parameter-module-mapping-panel__section-head">
          <div>
            <h4>{selectedModuleId ? `${modules.find((module) => module.id === selectedModuleId)?.name ?? "所选模块"} · 主体与归属` : "规范主体与归属"}</h4>
            <p>
              {!loading && inventoryComplete ? `${activeSubjectCount} 个有效主体。` : ""}查看参数定义，或维护主体的模块归属。
            </p>
          </div>
          {canCreateSubject ? <button type="button" className="button primary sm"
            disabled={!publicationSurface?.authoringAllowed}
            title={publicationSurface?.authoringAllowed ? undefined : publicationError || "目录当前不可编写"}
            onClick={() => setCreateSubjectOpen(true)}>新增主体</button> : null}
          {!managedRefresh ? <button
            type="button"
            className="button subtle"
            onClick={() => void loadCanonical()}
            disabled={loading}
          >
            <RefreshCw
              className={loading ? "dts-status-icon dts-status-icon--spin" : undefined}
              size={14}
              aria-hidden="true"
            />
            刷新规范数据
          </button> : null}
        </header>
        {lifecycleNotice ? <p role="status">{lifecycleNotice}</p> : null}
        {publicationError ? <p role="alert">{publicationError}</p> : null}
        {canCreateSubject && publicationAdvisory ? <p role="status">{publicationAdvisory.message}
          {onNavigate ? <button type="button" className="button ghost sm" onClick={() => onNavigate("/parameter-admin/specs")}>查看目录发布状态</button> : null}</p> : null}

        {loading ? (
          <p role="status">
            <LoaderCircle className="dts-status-icon dts-status-icon--spin" size={16} aria-hidden="true" />
            正在加载规范主体…
          </p>
        ) : null}
        {loadError ? (
          <p className="parameter-module-mapping-panel__error" role="alert">
            <AlertCircle size={15} aria-hidden="true" /> {loadError}
          </p>
        ) : null}
        {!loading && !inventoryComplete && domainState.kind !== "unpublished" ? <p role="status">
          已加载 {subjects.length} 个主体、{registrations.length} 条登记。{loadError ? "后续记录读取失败。" : "仍在读取后续记录。"}搜索与筛选仅覆盖已加载记录；完整读取前暂不能登记或调整归属。
          {loadError ? <button type="button" className="button subtle sm" onClick={() => void loadCanonical()}>重新读取完整目录</button> : null}
        </p> : null}
        {!loading && !loadError && (!canAdmin || !domainState.writesEnabled) ? <p className="parameter-module-mapping-panel__notice" role="status">
          {!canAdmin ? "此页仅可查看；登记主体和调整归属需要组织管理员权限。" : "当前目录状态暂不允许修改，请刷新规范数据后重试。"}
        </p> : null}
        {!loading && !loadError && domainState.kind === "unpublished" ? (
          <p className="parameter-module-mapping-panel__notice" role="status">
            当前没有可读取的目录发布，规范主体暂不可用。
          </p>
        ) : null}
        {!loading && (!loadError || subjects.length > 0) && domainState.kind !== "unpublished" ? (
          <>
            <div className="parameter-module-mapping-panel__form canonical-subject-toolbar">
              <label>
                筛选规范主体
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    updateQuery({ subjectQ: event.target.value, subjectPage: null });
                  }}
                  placeholder="搜索名称或别名"
                  aria-label="筛选规范主体"
                />
              </label>
              <label>
                主体身份
                <SelectControl
                  className="compact-filter-control"
                  ariaLabel="筛选主体身份"
                  value={typeFilter}
                  onValueChange={(value) => {
                    updateQuery({ subjectKind: value, subjectPage: null });
                  }}
                  size="filter"
                  options={[{ value: "all", label: "全部" }, ...Object.entries(SUBJECT_KIND_LABEL).map(([value, label]) => ({ value, label }))]}
                />
              </label>
              <label>登记状态<SelectControl ariaLabel="筛选登记状态" value={registrationFilter} size="filter"
                onValueChange={(value) => updateQuery({ subjectRegistration: value, subjectPage: null })}
                options={[{ value: "all", label: "当前主体" }, { value: "registered", label: "已登记" }, { value: "unregistered", label: "未登记" }, { value: "retired", label: "已停用" }, { value: "all-statuses", label: "全部（含已停用）" }]} /></label>
              <label>定义数量<SelectControl ariaLabel="筛选有效定义" value={definitionsFilter} size="filter"
                onValueChange={(value) => updateQuery({ subjectDefinitions: value, subjectPage: null })}
                options={[{ value: "all", label: "全部定义数量" }, { value: "with", label: "有有效定义" }, { value: "without", label: "无有效定义" }]} /></label>
              {search || typeFilter !== "all" || registrationFilter !== "all" || definitionsFilter !== "all" ? <button type="button" className="button subtle sm"
                onClick={() => updateQuery({ subjectQ: null, subjectKind: null, subjectRegistration: null, subjectDefinitions: null, subjectPage: null })}>清除主体筛选</button> : null}
            </div>
            {filteredSubjects.length === 0 ? (
              <p className="muted" role="status">
                {!inventoryComplete ? "已加载记录中暂无匹配主体，完整目录尚未读取完成。" : subjects.length === 0 ? "当前目录没有规范主体。" : "没有匹配的规范主体。"}
              </p>
            ) : (
              <ul aria-label="规范主体列表" className="canonical-subject-list">
                {visibleSubjects.map((subject) => {
                  const registration = registrationBySubjectId.get(subject.id);
                  const placement =
                    registration?.placement ??
                    (subject.registration.status !== "unregistered"
                      ? subject.registration.placement
                      : undefined);
                  const definitionState = definitionStates.get(subject.id) ?? { status: "idle" };
                  const modulesForSubject = moduleOptionsByType.get(subject.type) ?? [];
                  const registrationId =
                    registration?.id ??
                    (subject.registration.status === "unregistered"
                      ? undefined
                      : subject.registration.id);
                  const registrationAllowed =
                    canAdmin &&
                    subject.membership.status === "active" &&
                    isCatalogActionEnabled(actor, "register-subject", domainState, sessionPermissions) &&
                    (modulesForSubject.length > 0 || newDestinationParents.length > 0);
                  const placementAllowed =
                    canAdmin &&
                    subject.membership.status === "active" &&
                    registration?.status === "active" &&
                    Boolean(registrationId) &&
                    isCatalogActionEnabled(actor, "update-placement", domainState, sessionPermissions);
                  const registrationStatus = registration?.status ?? subject.registration.status;
                  const lifecycleIntent = registrationStatus === "retired" ? "restore-registration" : "retire-registration";
                  const lifecycleAllowed = canAdmin && (registrationStatus === "unregistered" ? subject.membership.status === "active" : Boolean(registrationId)) &&
                    isCatalogActionEnabled(actor, lifecycleIntent, domainState, sessionPermissions);
                  const subjectLabel = subjectTypeLabel(subject.type);
                  return (
                    <li
                      key={subject.id}
                      className="canonical-subject-row"
                      aria-label={`${subject.canonicalName}（${subjectTypeLabel(subject.type)}）`}
                      data-canonical-subject-id={subject.id}
                      data-canonical-subject-kind={subject.type}
                    >
                      <div className="parameter-module-mapping-panel__tree-label canonical-subject-identity">
                        <strong>{subject.canonicalName}</strong>
                        <span className="parameter-module-mapping-panel__auto-tag">
                          {subjectTypeLabel(subject.type)}
                        </span>
                      </div>
                      <span className="canonical-subject-meta">
                        {subject.definitionCounts.active} 个有效定义{subject.definitionCounts.deprecated > 0 ? ` · ${subject.definitionCounts.deprecated} 个已废弃定义` : ""}
                      </span>
                      <span className="canonical-subject-meta">
                        {registrationStatus === "retired" ? <span className="parameter-catalog__badge" data-tone="warning">已停用 · </span> : null}
                        {placement && !placement.moduleId ? <span className="parameter-catalog__badge" data-tone="warning">未分配模块</span> : placement
                          ? `归属：${moduleLabels.get(placement.moduleId ?? "") ?? placement.displayName}`
                          : "未登记"}
                      </span>
                      <div className="parameter-module-mapping-panel__actions canonical-subject-actions">
                        {subject.definitionCounts.active > 0 ? <button
                          type="button"
                          className="button subtle"
                          aria-expanded={expandedSubjectId === subject.id}
                          onClick={() => updateQuery({ expandedSubject: expandedSubjectId === subject.id ? null : subject.id })}
                        >
                          {expandedSubjectId === subject.id ? "收起参数" : "查看参数"}
                        </button> : canCreateSubject && onNavigate && subject.membership.status === "active" && registrationStatus !== "retired" ? <button
                          type="button" className="button subtle" aria-label={`新增定义：${subject.canonicalName}`}
                          onClick={() => onNavigate(`${buildCatalogHref({ ...EMPTY_CATALOG_URL_ANCHOR, subjectId: subject.id })}&createDefinition=1`)}>新增定义</button> : null}
                        {registrationAllowed && subject.registration.status === "unregistered" ? (
                          <button
                            type="button"
                            className="button primary"
                            aria-label={`登记主体：${subject.canonicalName}`}
                            disabled={!inventoryComplete}
                            onClick={() => openRegistration(subject)}
                          >
                            登记主体
                          </button>
                        ) : null}
                        {canAdmin &&
                        subject.registration.status === "unregistered" &&
                        modulesForSubject.length === 0 && newDestinationParents.length === 0 ? (
                          <span className="muted">请先新建业务分类，再创建目标模块并登记。
                            {onCreateBusinessModule ? <button type="button" className="button subtle sm" onClick={onCreateBusinessModule}>新建业务分类</button> : null}
                          </span>
                        ) : null}
                        {placementAllowed ? (
                          <button
                            type="button"
                            className="button subtle"
                            aria-label={`调整归属：${subject.canonicalName}`}
                            disabled={!inventoryComplete}
                            aria-disabled={openingSubjectId === subject.id}
                            aria-busy={openingSubjectId === subject.id}
                            onClick={() =>
                              void openPlacement(subject, registrationId ?? "")
                            }
                          >
                            {openingSubjectId === subject.id ? "读取归属…" : "调整归属"}
                          </button>
                        ) : null}
                        {lifecycleAllowed ? <button type="button" className="button subtle"
                          aria-label={`${registrationStatus === "retired" ? "恢复" : "移除"}${subjectLabel}：${subject.canonicalName}`}
                          disabled={!inventoryComplete || (registrationStatus === "retired" && subject.membership.status !== "active")}
                          title={registrationStatus === "retired" && subject.membership.status !== "active" ? "平台主体已退役，当前无法恢复登记" : undefined}
                          onClick={() => setLifecycleDialog({ intent: lifecycleIntent, subject, registrationId })}>
                          {registrationStatus === "retired" ? `恢复${subjectLabel}` : `移除${subjectLabel}`}
                        </button> : null}
                      </div>
                      {rowErrors[subject.id] ? <div className="canonical-subject-row-error" role="alert">
                        {rowErrors[subject.id]}<button type="button" className="button subtle sm" onClick={() => void openPlacement(subject, registrationId ?? "")}>重试读取归属</button>
                      </div> : null}
                      {expandedSubjectId === subject.id ? (
                        <div role="region" className="canonical-subject-definitions" aria-label={`${subject.canonicalName} 的有效参数`}>
                          {definitionState.status === "loading" ? <p role="status">正在加载有效参数…</p> : null}
                          {definitionState.status === "error" ? (
                            <p className="parameter-module-mapping-panel__error" role="alert">
                              {definitionState.message}
                              <button type="button" className="button subtle sm" onClick={() => setDefinitionRefresh((value) => value + 1)}>重试读取参数</button>
                            </p>
                          ) : null}
                          {definitionState.status === "empty" ? (
                            <p className="muted">当前主体没有有效参数定义。</p>
                          ) : null}
                          {definitionState.status === "ready" ? (
                            <ul>
                              {definitionState.items.map((definition) => (
                                <li key={definition.id}>
                                  <a href={buildCatalogHref({ ...EMPTY_CATALOG_URL_ANCHOR, subjectId: subject.id, definitionId: definition.id, catalogReleaseId })}
                                    onClick={onNavigate ? (event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); onNavigate(event.currentTarget.href.replace(window.location.origin, "")); } } : undefined}>
                                    <strong>{definition.currentRevision.displayName || definition.propertyKey}</strong>
                                  </a>
                                  <code>{definition.propertyKey}</code>
                                  <span>{definition.usageSummary.currentValueCount} 个当前值</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {filteredSubjects.length > SUBJECTS_PER_PAGE ? (
              <nav className="parameter-module-mapping-panel__actions" aria-label="规范主体分页">
                <button
                  type="button"
                  className="button subtle"
                  disabled={subjectPage === 0}
                  onClick={() => updateQuery({ subjectPage: subjectPage === 1 ? null : String(subjectPage) })}
                >
                  上一页
                </button>
                <span>第 {subjectPage + 1} / {subjectPageCount} 页 · {inventoryComplete ? "共" : "已加载匹配"} {filteredSubjects.length} 个主体</span>
                <button
                  type="button"
                  className="button subtle"
                  disabled={subjectPage + 1 >= subjectPageCount}
                  onClick={() => updateQuery({ subjectPage: String(subjectPage + 2) })}
                >
                  下一页
                </button>
              </nav>
            ) : null}
          </>
        ) : null}
      </section>

      {subjectCreationRequested && (params.get("sourceProposal")==="1" ? catalogActionsForSession({actor,permissions:sessionPermissions}).some(action=>action==="create-proposal"||action==="accept-proposal") : canAuthorSubject) && catalogReleaseId ? <SharedDtsiSubjectCreation apiClient={apiClient}
        sourceQuery={params.has("sourceResource") ? params.toString() : null} publicationProps={{
        open: true, intent:"create-subject", actor, sessionPermissions,
        domainState, catalog, governance, organizationId,
        currentPersonId, catalogReleaseId, publicationSurface,
        onCompleted: () => void handleCompleted(), onRefreshEvidence: async () => { await loadCanonical(); },
        onOpenChange: (open) => { if (!open) closeSubjectCreation(); },
        onAddDefinition: onNavigate ? (subjectId) => {
          closeSubjectCreation();
          onNavigate(`${buildCatalogHref({ ...EMPTY_CATALOG_URL_ANCHOR, subjectId })}&createDefinition=1`);
        } : undefined }} /> : null}
      {placementDialog && catalogReleaseId ? (
        <RegistrationDialog
          open
          intent={placementDialog.intent}
          actor={actor}
          domainState={inventoryComplete ? domainState : { kind: "loading", catalogReleaseId, stale: false, writesEnabled: false }}
          repository={governance}
          organizationId={organizationId}
          subjectId={placementDialog.subject.id}
          subjectName={placementDialog.subject.canonicalName}
          catalogReleaseId={catalogReleaseId}
          registrationId={placementDialog.registrationId}
          ifMatch={placementDialog.ifMatch}
          moduleOptions={selectedModuleOptions}
          newDestinationParents={newDestinationParents}
          initialDestinationModuleId={selectedDestinationModuleId}
          subjectImpact={placementDialog.subjectImpact}
          currentModuleName={placementDialog.currentModuleName}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onOpenChange={(open) => {
            if (!open) { placementGeneration.current += 1; setPlacementDialog(null); }
          }}
          onCompleted={() => void handleCompleted()}
          onRefreshEvidence={refreshPlacementEvidence}
        />
      ) : null}
      {lifecycleDialog ? <RegistrationLifecycleDialog key={`${organizationId}:${lifecycleDialog.subject.id}:${lifecycleDialog.intent}`}
        {...lifecycleDialog} actor={actor} catalog={catalog} governance={governance} organizationId={organizationId} modules={modules}
        onClose={() => setLifecycleDialog(null)} onCompleted={() => {
          setLifecycleNotice(lifecycleDialog.intent === "retire-registration"
            ? `已移除 ${lifecycleDialog.subject.canonicalName}，可在“已停用”中恢复。`
            : `已恢复 ${lifecycleDialog.subject.canonicalName}。`);
          setLifecycleDialog(null);
          void handleCompleted();
        }} /> : null}
    </section>
  );
}
