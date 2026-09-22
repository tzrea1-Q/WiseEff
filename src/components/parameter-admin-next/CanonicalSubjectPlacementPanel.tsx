import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

import {
  isCatalogActionEnabled,
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
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type {
  CatalogDefinitionListResponse,
  CatalogListQuery,
  CatalogPlacementResponse,
  CatalogRegistrationListResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import type { CatalogResponseWithEtag } from "@/infrastructure/http/parameterCatalogClient";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { presentError } from "@/infrastructure/http/presentError";

const SUBJECT_KIND_LABEL: Record<CatalogSubjectResponse["item"]["type"], string> = {
  driver: "Driver",
  "node-type": "NodeType",
  "configuration-schema": "ConfigurationSchema"
};

const SUBJECT_KIND_MODULE_KIND: Record<
  CatalogSubjectResponse["item"]["type"],
  ParameterModule["kind"]
> = {
  driver: "driver-group",
  "node-type": "node-type",
  "configuration-schema": "business"
};

type CatalogPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Read a complete canonical collection without allowing a broken cursor to
 * spin forever.  The API's page size is capped at 100, so this is also the
 * one place where the UI handles organizations larger than one page.
 */
export async function listAllCanonicalPages<T>(
  fetchPage: (query: CatalogListQuery) => Promise<CatalogPage<T>>,
  query: CatalogListQuery = {}
): Promise<T[]> {
  const result: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const page = await fetchPage({
      ...query,
      limit: query.limit ?? 100,
      ...(cursor ? { cursor } : {})
    });
    result.push(...page.items);
    if (!page.hasMore) return result;
    const nextCursor = page.nextCursor?.trim() ?? "";
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("规范目录返回了无效分页游标，已停止继续读取。");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error("规范目录分页超过安全上限，已停止继续读取。");
}

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
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  organizationId: string;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  canAdmin?: boolean;
  modules?: readonly ParameterModule[];
  onChanged?: () => void | Promise<void>;
};

/**
 * Canonical subject/placement read surface for the module administration page.
 * The public parameter-module tree remains a separate shared surface below it;
 * this panel never uses the legacy driver registry as a subject identity.
 */
export function CanonicalSubjectPlacementPanel({
  catalog,
  governance,
  organizationId,
  actor,
  sessionPermissions,
  canAdmin = false,
  modules = [],
  onChanged
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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | SubjectRow["type"]>("all");
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);
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
  } | null>(null);

  const loadCanonical = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setDomainState({
      kind: "loading",
      catalogReleaseId: null,
      stale: false,
      writesEnabled: false
    });
    try {
      const document = await catalog.getCatalog();
      const nextState = deriveCatalogDomainState({ document });
      setDomainState(nextState);
      if (!document.item) {
        setCatalogReleaseId("");
        setSubjects([]);
        setRegistrations([]);
        return;
      }

      const release = document.item.catalogReleaseId;
      const [nextSubjects, nextRegistrations] = await Promise.all([
        listAllCanonicalPages(
          (query) => catalog.listSubjects(query),
          { catalogReleaseId: release, limit: 100 }
        ),
        listAllCanonicalPages(
          (query) => governance.listRegistrations(organizationId, query),
          { catalogReleaseId: release, limit: 100 }
        )
      ]);
      setCatalogReleaseId(release);
      setSubjects(nextSubjects);
      setRegistrations(nextRegistrations);
    } catch (error) {
      const nextState = catalogStateFromFailure(error);
      setDomainState(nextState);
      setLoadError(presentError(error, "无法加载规范主体归属，请稍后重试。"));
      setSubjects([]);
      setRegistrations([]);
    } finally {
      setLoading(false);
    }
  }, [catalog, governance, organizationId]);

  useEffect(() => {
    void loadCanonical();
  }, [loadCanonical]);

  const registrationBySubjectId = useMemo(() => {
    const map = new Map<string, RegistrationRow>();
    for (const registration of registrations) {
      map.set(registration.subjectId, registration);
    }
    return map;
  }, [registrations]);

  const filteredSubjects = useMemo(() => {
    const token = search.trim().toLowerCase();
    return subjects.filter((subject) => {
      if (typeFilter !== "all" && subject.type !== typeFilter) return false;
      if (!token) return true;
      return [subject.canonicalName, subject.id, ...subject.aliases]
        .join(" ")
        .toLowerCase()
        .includes(token);
    });
  }, [search, subjects, typeFilter]);

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
    for (const type of Object.keys(SUBJECT_KIND_MODULE_KIND) as SubjectRow["type"][]) {
      const expectedKind = SUBJECT_KIND_MODULE_KIND[type];
      result.set(
        type,
        modules
          .filter((module) => module.kind === expectedKind)
          .map((module) => {
            const impact = moduleImpactById.get(module.id);
            return {
              id: module.id,
              displayName: module.name,
              kind: module.kind,
              impactSummary: impact
                ? `当前 ${impact.subjects} 个主体、${impact.definitions} 个有效定义`
                : "当前无主体"
            };
          })
          .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans"))
      );
    }
    return result;
  }, [moduleImpactById, modules]);

  const activeSubjectCount = useMemo(
    () => subjects.filter((subject) => subject.membership.status === "active").length,
    [subjects]
  );

  const loadDefinitions = async (subject: SubjectRow) => {
    if (expandedSubjectId === subject.id) {
      setExpandedSubjectId(null);
      return;
    }
    setExpandedSubjectId(subject.id);
    setDefinitionStates((current) => new Map(current).set(subject.id, { status: "loading" }));
    try {
      const items = await listAllCanonicalPages(
        (query) => catalog.listDefinitions(query),
        {
          subjectId: subject.id,
          lifecycle: "active",
          catalogReleaseId,
          limit: 100
        }
      );
      setDefinitionStates((current) =>
        new Map(current).set(
          subject.id,
          items.length > 0 ? { status: "ready", items } : { status: "empty" }
        )
      );
    } catch (error) {
      setDefinitionStates((current) =>
        new Map(current).set(subject.id, {
          status: "error",
          message: presentError(error, "无法加载该主体的有效定义。")
        })
      );
    }
  };

  const openRegistration = (subject: SubjectRow) => {
    setPlacementDialog({
      intent: "register-subject",
      subject,
      subjectImpact: {
        activeDefinitionCount: subject.definitionCounts.active,
        bindingCount: 0,
        projectCount: 0
      }
    });
  };

  const openPlacement = async (subject: SubjectRow, registrationId: string) => {
    setLoadError(null);
    try {
      const [registration, placement] = await Promise.all([
        governance.getRegistration(organizationId, registrationId),
        governance.getPlacement(organizationId, registrationId)
      ]);
      const ifMatch = placementEtag(placement);
      if (!ifMatch) {
        setLoadError("当前归属缺少可用版本条件，无法安全调整；请刷新后重试。");
        return;
      }
      const placementModuleId = placement.item.moduleId;
      const placementDisplayName = placement.item.displayName;
      const currentModuleName =
        modules.find((module) => module.id === placementModuleId)?.name ??
        placementDisplayName ??
        placementModuleId;
      const impact = registration.item.impact;
      if (!impact) {
        setLoadError("当前主体缺少影响数据，无法安全调整归属；请刷新后重试。");
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
        currentModuleName
      });
    } catch (error) {
      setLoadError(presentError(error, "无法读取当前主体归属，请刷新后重试。"));
    }
  };

  const refreshPlacementEvidence = async () => {
    if (!placementDialog?.registrationId) {
      await loadCanonical();
      return;
    }
    try {
      const placement = await governance.getPlacement(
        organizationId,
        placementDialog.registrationId
      );
      const ifMatch = placementEtag(placement);
      if (!ifMatch) {
        setLoadError("刷新后仍缺少归属版本条件，未发送写入。");
        return;
      }
      setPlacementDialog((current) => (current ? { ...current, ifMatch } : current));
    } catch (error) {
      setLoadError(presentError(error, "无法刷新当前主体归属，请稍后重试。"));
    }
  };

  const selectedRegistration = placementDialog
    ? registrationBySubjectId.get(placementDialog.subject.id)
    : undefined;
  const selectedModuleOptions = placementDialog
    ? moduleOptionsByType.get(placementDialog.subject.type) ?? []
    : [];
  const selectedModuleId =
    selectedRegistration?.placement.moduleId ??
    (placementDialog?.subject.registration.status === "unregistered"
      ? undefined
      : placementDialog?.subject.registration.placement?.moduleId) ??
    (placementDialog?.intent === "update-placement" ? "" : undefined);
  const moduleSummary = moduleImpactById;

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
    >
      <section>
        <header className="parameter-module-mapping-panel__section-head">
          <div>
            <h4>规范主体与归属</h4>
            <p>
              目录发布 {catalogReleaseId || "未就绪"}
              {!loading && !loadError ? ` · ${activeSubjectCount} 个有效主体` : ""}。Driver、NodeType、
              ConfigurationSchema 是独立身份；DTS 覆盖只表示解析能力。
            </p>
          </div>
          <button
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
          </button>
        </header>

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
        {!loading && !loadError && domainState.kind === "unpublished" ? (
          <p className="parameter-module-mapping-panel__notice" role="status">
            当前没有可读取的目录发布，规范主体暂不可用。
          </p>
        ) : null}
        {!loading && !loadError && domainState.kind !== "unpublished" ? (
          <>
            <div className="parameter-module-mapping-panel__form">
              <label>
                筛选规范主体
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="名称、别名或主体 ID"
                  aria-label="筛选规范主体"
                />
              </label>
              <label>
                主体身份
                <select
                  aria-label="筛选主体身份"
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as "all" | SubjectRow["type"])
                  }
                >
                  <option value="all">全部</option>
                  <option value="driver">Driver</option>
                  <option value="node-type">NodeType</option>
                  <option value="configuration-schema">ConfigurationSchema</option>
                </select>
              </label>
            </div>
            {moduleSummary.size > 0 ? (
              <ul aria-label="规范模块统计">
                {[...moduleSummary.entries()].map(([moduleId, summary]) => {
                  const module = modules.find((item) => item.id === moduleId);
                  return (
                    <li key={moduleId}>
                      <strong>{module?.name ?? moduleId}</strong>
                      <span>
                        {summary.subjects} 个主体 · {summary.definitions} 个有效定义
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {filteredSubjects.length === 0 ? (
              <p className="muted" role="status">
                {subjects.length === 0 ? "当前目录没有规范主体。" : "没有匹配的规范主体。"}
              </p>
            ) : (
              <ul aria-label="规范主体列表">
                {filteredSubjects.map((subject) => {
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
                    modulesForSubject.length > 0;
                  const placementAllowed =
                    canAdmin &&
                    subject.membership.status === "active" &&
                    registration?.status === "active" &&
                    Boolean(registrationId) &&
                    isCatalogActionEnabled(actor, "update-placement", domainState, sessionPermissions);
                  return (
                    <li
                      key={subject.id}
                      aria-label={`${subject.canonicalName}（${subjectTypeLabel(subject.type)}）`}
                      data-canonical-subject-id={subject.id}
                      data-canonical-subject-kind={subject.type}
                    >
                      <div className="parameter-module-mapping-panel__tree-label">
                        <strong>{subject.canonicalName}</strong>
                        <span className="parameter-module-mapping-panel__auto-tag">
                          {subjectTypeLabel(subject.type)}
                        </span>
                        <small>{subject.id}</small>
                      </div>
                      <span>
                        {subject.definitionCounts.active} 个有效定义 · {subject.definitionCounts.deprecated} 个已废弃定义
                      </span>
                      <span>
                        {placement
                          ? `归属：${modules.find((item) => item.id === placement?.moduleId)?.name ?? placement.moduleId ?? placement.displayName}`
                          : "未登记"}
                      </span>
                      <div className="parameter-module-mapping-panel__actions">
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() => void loadDefinitions(subject)}
                        >
                          {expandedSubjectId === subject.id ? "收起参数" : "查看参数"}
                        </button>
                        {registrationAllowed && subject.registration.status === "unregistered" ? (
                          <button
                            type="button"
                            className="button primary"
                            aria-label={`登记主体：${subject.canonicalName}`}
                            onClick={() => openRegistration(subject)}
                          >
                            登记主体
                          </button>
                        ) : null}
                        {canAdmin &&
                        subject.registration.status === "unregistered" &&
                        modulesForSubject.length === 0 ? (
                          <span className="muted">没有可用的共享目标模块，暂不能登记。</span>
                        ) : null}
                        {placementAllowed ? (
                          <button
                            type="button"
                            className="button subtle"
                            aria-label={`调整归属：${subject.canonicalName}`}
                            onClick={() =>
                              void openPlacement(subject, registrationId ?? "")
                            }
                          >
                            调整归属
                          </button>
                        ) : null}
                      </div>
                      {expandedSubjectId === subject.id ? (
                        <div role="region" aria-label={`${subject.canonicalName} 的有效参数`}>
                          {definitionState.status === "loading" ? <p role="status">正在加载有效参数…</p> : null}
                          {definitionState.status === "error" ? (
                            <p className="parameter-module-mapping-panel__error" role="alert">
                              {definitionState.message}
                            </p>
                          ) : null}
                          {definitionState.status === "empty" ? (
                            <p className="muted">当前主体没有有效参数定义。</p>
                          ) : null}
                          {definitionState.status === "ready" ? (
                            <ul>
                              {definitionState.items.map((definition) => (
                                <li key={definition.id}>
                                  <strong>{definition.propertyKey}</strong>
                                  <span>{definition.currentRevision.displayName || "未命名定义"}</span>
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
          </>
        ) : null}
      </section>

      {placementDialog && catalogReleaseId ? (
        <RegistrationDialog
          open
          intent={placementDialog.intent}
          actor={actor}
          domainState={domainState}
          repository={governance}
          organizationId={organizationId}
          subjectId={placementDialog.subject.id}
          catalogReleaseId={catalogReleaseId}
          registrationId={placementDialog.registrationId}
          ifMatch={placementDialog.ifMatch}
          moduleOptions={selectedModuleOptions}
          initialDestinationModuleId={selectedModuleId}
          subjectImpact={placementDialog.subjectImpact}
          currentModuleName={placementDialog.currentModuleName}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onOpenChange={(open) => {
            if (!open) setPlacementDialog(null);
          }}
          onCompleted={() => void handleCompleted()}
          onRefreshEvidence={() => void refreshPlacementEvidence()}
        />
      ) : null}
    </section>
  );
}
