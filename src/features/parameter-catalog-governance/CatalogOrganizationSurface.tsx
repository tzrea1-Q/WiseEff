import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  catalogActorForRole,
  catalogActionsForSession,
  type CatalogActorKind,
  type CatalogAuthorizedAction,
  type CatalogDomainState
} from "@/application/parameter-catalog";
import { buildCatalogHref, parseCatalogUrlAnchor } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { CatalogPage } from "@/features/parameter-catalog";
import { onDefinitionImportHandoff, takeDefinitionImportHandoff } from "@/features/agent/definitionImportHandoff";

import { CatalogHistoryBody } from "../parameter-catalog/CatalogPage";
import { DefinitionEditorBody } from "./DefinitionEditorBody";
import { DefinitionLifecycleDialog, type DefinitionLifecycleIntent } from "./DefinitionLifecycleDialog";

import { createGovernanceIdempotencyKey } from "./governanceState";
import { PublicationDialog } from "./PublicationDialog";
import { DefinitionImportDialog } from "./DefinitionImportDialog";
import { BatchRegistrationTable, type BatchRegistrationEntry } from "./BatchRegistrationTable";
import { onBatchRegistrationHandoff, takeBatchRegistrationHandoff } from "./batchRegistrationHandoff";
import {
  publicationSurfaceAllowsAuthoring,
  publicationSurfaceAllowsPublishing,
  publicationSurfaceCopy,
  publicationSurfaceAdvisory,
  type PublicationSurfaceItem
} from "./publicationSurface";
import { catalogPendingWorkLabel } from "../parameter-catalog/copy";
import { RegistrationDialog, type RegistrationModuleOption } from "./RegistrationDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { listAllCanonicalPages } from "@/components/parameter-admin-next/CanonicalSubjectPlacementPanel";
import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";
import { toAttributionFlatNodes } from "@/components/parameter-topology/moduleAttributionTreeUtils";

import { ReviewQueue } from "./ReviewQueue";
import type { CatalogDefinitionResponse, CatalogDefinitionErasureListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { SpecRelatedKnowledgeSource } from "@/components/parameter-topology/ParameterSpecDetail";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export type CatalogOrganizationSurfaceProps = {
  catalog: ParameterCatalogRepository;
  runtimeMode?: WiseEffRuntimeMode;
  governance: ParameterCatalogGovernanceRepository;
  actor?: CatalogActorKind;
  roleId?: string;
  sessionPermissions?: readonly string[] | null;
  sessionRoles?: readonly AuthContextDto["roles"][number][] | null;
  search: string;
  onAnchorChange: (href: string, mode: "push" | "replace") => void;
  organizationId?: string;
  currentPersonId: string;
  relatedKnowledge?: SpecRelatedKnowledgeSource;
  projects?: readonly { id: string; name: string }[];
  moduleRegistry?: Pick<ParameterModuleRegistryRepository, "getRegistry">;
  taskContent?: ReactNode;
};

export function CatalogOrganizationSurface({
  catalog,
  runtimeMode,
  governance,
  actor: actorProp,
  roleId,
  sessionPermissions,
  sessionRoles,
  search,
  onAnchorChange,
  organizationId,
  currentPersonId,
  relatedKnowledge,
  projects,
  moduleRegistry,
  taskContent
}: CatalogOrganizationSurfaceProps) {
  const actor = actorProp ?? catalogActorForRole(roleId ?? "");
  const definitionDeletionAllowed = Boolean(sessionRoles?.some((role) => role.roleId === "platform-admin" && role.projectId === null));
  const cleanupKey = JSON.stringify([currentPersonId, organizationId]);
  const [cleanupState, setCleanupState] = useState<{ key: string; entries: CatalogDefinitionErasureListResponse["items"]; error: string }>({ key: "", entries: [], error: "" });
  const [cleanupRetry, setCleanupRetry] = useState<{ key: string; definitionId: string; error: string }>({ key: "", definitionId: "", error: "" });
  const [cleanupEpoch, setCleanupEpoch] = useState(0);
  const cleanupGeneration = useRef(0);
  const pendingCleanup = definitionDeletionAllowed && cleanupState.key === cleanupKey ? cleanupState.entries : [];
  const cleanupError = definitionDeletionAllowed && cleanupState.key === cleanupKey ? cleanupState.error : "";
  useEffect(() => {
    const generation = ++cleanupGeneration.current;
    setCleanupRetry({ key: cleanupKey, definitionId: "", error: "" });
    if (definitionDeletionAllowed && catalog.listDefinitionErasures) {
      void catalog.listDefinitionErasures().then(({ items }) => {
        if (generation === cleanupGeneration.current) setCleanupState({ key: cleanupKey, entries: items, error: "" });
      }).catch(() => {
        if (generation === cleanupGeneration.current) setCleanupState({ key: cleanupKey, entries: [], error: "无法读取待完成存储清理。" });
      });
    }
    return () => { cleanupGeneration.current += 1; };
  }, [catalog, cleanupKey, definitionDeletionAllowed, cleanupEpoch]);
  const reviewActor = sessionRoles === undefined ? actor
    : sessionRoles?.some((role) => role.roleId === "platform-admin" && role.projectId === null) ? "platform-admin"
      : sessionRoles?.some((role) => role.roleId === "admin" && role.projectId === null) ? "org-admin" : "user";
  const reviewQueueAllowed = catalogActionsForSession({ actor: reviewActor, permissions: sessionPermissions }).includes("resolve-review-item");
  const registrationAllowed = actor !== "agent" && catalogActionsForSession({ actor: reviewActor, permissions: sessionPermissions }).includes("register-subject");
  const [batchEntry, setBatchEntry] = useState<BatchRegistrationEntry | null>(null);
  const [batchEpoch, setBatchEpoch] = useState(0);
  const [batchHandoffEpoch, setBatchHandoffEpoch] = useState(0);
  useEffect(() => onBatchRegistrationHandoff(() => setBatchHandoffEpoch((value) => value + 1)), []);
  useEffect(() => {
    if (!registrationAllowed || !organizationId) return;
    const handoff = takeBatchRegistrationHandoff(organizationId, currentPersonId);
    if (handoff) { setBatchEntry(handoff); setBatchEpoch((value) => value + 1); }
  }, [batchHandoffEpoch, registrationAllowed, organizationId, currentPersonId]);
  const anchor = parseCatalogUrlAnchor(search);
  const reviewQueueRequested = new URLSearchParams(search).get("review") === "open";
  const [domainState, setDomainState] = useState<CatalogDomainState | null>(null);
  const [action, setAction] = useState<CatalogAuthorizedAction | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importDocument, setImportDocument] = useState<string | undefined>();
  const [handoffEpoch, setHandoffEpoch] = useState(0);
  useEffect(() => onDefinitionImportHandoff(() => setHandoffEpoch((value) => value + 1)), []);
  const [actionRegistrationId, setActionRegistrationId] = useState<string | null>(null);
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);
  const [pendingWorkOpen, setPendingWorkOpen] = useState(Boolean(anchor.reviewItemId) || reviewQueueRequested);
  const [reviewEditorActive, setReviewEditorActive] = useState(false);
  const [reviewCount, setReviewCount] = useState<number | null | undefined>(undefined);
  const reviewLeaveGuard = useRef<(() => boolean) | null>(null);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (pendingWorkOpen) reviewTitle.current?.focus(); }, [pendingWorkOpen, reviewEditorActive]);
  const setReviewLeaveGuard = useCallback((guard: (() => boolean) | null) => { reviewLeaveGuard.current = guard; }, []);
  const [publicationSurface, setPublicationSurface] = useState<PublicationSurfaceItem | null>(null);
  const [publicationSurfaceLoad, setPublicationSurfaceLoad] = useState<"loading" | "ready" | "error">("loading");
  const definitionCreationRequested = anchor.createDefinition === true;
  useEffect(() => {
    if (definitionCreationRequested && publicationSurface?.authoringAllowed && domainState) setAction("preview-publication");
  }, [definitionCreationRequested, publicationSurface?.authoringAllowed, domainState]);
  const [lifecycle, setLifecycle] = useState<{
    intent: DefinitionLifecycleIntent;
    definition: CatalogDefinitionResponse["item"];
    ownerState: CatalogDomainState;
  } | null>(null);
  const catalogReleaseId = domainState?.catalogReleaseId ?? anchor.catalogReleaseId ?? "";
  const canImportDefinitions = Boolean(actor !== "agent" && sessionPermissions?.includes("catalog:author")
    && publicationSurfaceAllowsAuthoring(publicationSurface) && domainState && organizationId && catalogReleaseId);
  useEffect(() => {
    if (importOpen || !canImportDefinitions || !organizationId) return;
    const document = takeDefinitionImportHandoff(organizationId, currentPersonId);
    if (document !== undefined) { setImportDocument(document); setImportOpen(true); }
  }, [handoffEpoch, importOpen, canImportDefinitions, organizationId, currentPersonId]);
  useEffect(() => { setReviewCount(undefined); }, [organizationId, catalogReleaseId]);

  useEffect(() => {
    if (anchor.reviewItemId || reviewQueueRequested) setPendingWorkOpen(true);
  }, [anchor.reviewItemId, reviewQueueRequested]);
  const subjectId = anchor.subjectId ?? "";
  const [catalogSubjects, setCatalogSubjects] = useState<
    Awaited<ReturnType<ParameterCatalogRepository["listSubjects"]>>["items"]
  >([]);
  const [subjectLoad, setSubjectLoad] = useState<"loading" | "ready" | "error">("loading");
  const [subjectReadEpoch, setSubjectReadEpoch] = useState(0);
  const [reviewModules, setReviewModules] = useState<RegistrationModuleOption[]>([]);
  const [reviewModulesError, setReviewModulesError] = useState(false);
  const [reviewModulesEpoch, setReviewModulesEpoch] = useState(0);
  const reviewContextGeneration = useRef(0);
  useEffect(() => () => { reviewContextGeneration.current += 1; },
    [catalog, moduleRegistry, organizationId, catalogReleaseId, pendingWorkOpen]);

  useEffect(() => {
    let cancelled = false;
    setReviewModules([]);
    setReviewModulesError(false);
    if (!pendingWorkOpen || !reviewQueueAllowed || !moduleRegistry) return;
    void moduleRegistry.getRegistry().then((registry) => {
      if (!cancelled) {
        const nodes = toAttributionFlatNodes(registry.modules);
        setReviewModules(registry.modules.map((module) => ({
          id: module.id, displayName: modulePathSegments(module, nodes).join(" / "), kind: module.kind,
          impactSummary: `该模块已有 ${module.definitionCount ?? 0} 条定义。`
        })));
      }
    }).catch(() => { if (!cancelled) setReviewModulesError(true); });
    return () => { cancelled = true; };
  }, [moduleRegistry, organizationId, pendingWorkOpen, reviewModulesEpoch, reviewQueueAllowed, surfaceEpoch]);

  const handleAction = useCallback(
    (next: CatalogAuthorizedAction, context?: { subjectId?: string | null; registrationId?: string | null }) => {
      if (
        next === "register-subject" ||
        next === "update-placement" ||
        next === "preview-publication" ||
        next === "publish-publication"
      ) {
        setAction(next);
        setActionRegistrationId(context?.registrationId ?? null);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    setCatalogSubjects([]);
    setSubjectLoad("loading");
    void (async () => {
      try {
        const subjects = await listAllCanonicalPages((query) => catalog.listSubjects(query));
        if (!cancelled) {
          setCatalogSubjects(subjects);
          setSubjectLoad("ready");
        }
      } catch {
        if (!cancelled) {
          setCatalogSubjects([]);
          setSubjectLoad("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, surfaceEpoch, subjectReadEpoch]);


  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const surface = await catalog.getPublicationSurface();
        if (cancelled) return;
        setPublicationSurface(surface.item);
        setPublicationSurfaceLoad("ready");
      } catch {
        if (!cancelled) {
          setPublicationSurface(null);
          setPublicationSurfaceLoad("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, surfaceEpoch]);

  const handleSelectReviewItem = useCallback(
    (id: string | null) => {
      onAnchorChange(
        buildCatalogHref({
          ...anchor,
          reviewItemId: id
        }),
        "push"
      );
    },
    [anchor, onAnchorChange]
  );

  const surfaceStatus = publicationSurface ? publicationSurfaceAdvisory(publicationSurface) : null;
  const refreshCurrentCatalog = useCallback(async () => {
    const latest = await catalog.getCatalog();
    if (!latest.item) throw new Error("Catalog is not published");
    onAnchorChange(buildCatalogHref({ ...parseCatalogUrlAnchor(search),
      catalogReleaseId: latest.item.catalogReleaseId, cursor: null }), "replace");
    setSurfaceEpoch((value) => value + 1);
    return latest.item.catalogReleaseId;
  }, [catalog, search, onAnchorChange]);
  const dismissReview = () => {
    if (reviewEditorActive) {
      if (reviewLeaveGuard.current?.() !== false) handleSelectReviewItem(null);
      return;
    }
    setPendingWorkOpen(false);
    setReviewCount(undefined);
    onAnchorChange(buildCatalogHref({ ...anchor, reviewItemId: null }), "replace");
  };
  const adoptionNotice = publicationSurface?.blockers.includes("catalog-not-adopted");
  const operatorAudience = sessionRoles === undefined
    ? actor === "platform-admin" || roleId === "operator"
    : sessionRoles?.some((role) => role.projectId === null && ["platform-admin", "operator"].includes(role.roleId));
  const retryCleanup = async (definitionId: string) => {
    if (!definitionDeletionAllowed || !catalog.retryDefinitionCleanup || (cleanupRetry.key === cleanupKey && cleanupRetry.definitionId)) return;
    const generation = cleanupGeneration.current;
    setCleanupRetry({ key: cleanupKey, definitionId, error: "" });
    try {
      await catalog.retryDefinitionCleanup(definitionId);
      if (generation !== cleanupGeneration.current) return;
      setCleanupRetry({ key: cleanupKey, definitionId: "", error: "" });
      setCleanupEpoch(value => value + 1);
    } catch (reason) {
      if (generation === cleanupGeneration.current) setCleanupRetry({ key: cleanupKey, definitionId: "",
        error: `存储清理未完成，请重试。${reason instanceof Error ? reason.message : ""}` });
    }
  };

  return (
    <div className="parameter-catalog-organization">
      <CatalogPage
        refreshEpoch={surfaceEpoch}
        reviewCountOverride={reviewCount}
        taskContent={taskContent}
        notice={publicationSurfaceLoad === "error" || surfaceStatus || pendingCleanup.length > 0 || cleanupError ? <>
          {definitionDeletionAllowed && (pendingCleanup.length > 0 || cleanupError) ? (
            <section className="parameter-catalog__banner" data-tone="warning" aria-label="待完成存储清理">
              <p>待完成存储清理（{pendingCleanup.length}）</p>
              {pendingCleanup.map(entry => <div key={entry.definitionId}>
                <span>{entry.definitionId} · {new Date(entry.deletedAt).toLocaleString("zh-CN")} · {entry.pendingObjectCount} 个对象</span>
                <button type="button" className="button subtle" aria-label={`继续清理 ${entry.definitionId}`}
                  disabled={cleanupRetry.key === cleanupKey && Boolean(cleanupRetry.definitionId)}
                  onClick={() => void retryCleanup(entry.definitionId)}>
                  {cleanupRetry.key === cleanupKey && cleanupRetry.definitionId === entry.definitionId ? "正在清理…" : "继续清理"}
                </button>
              </div>)}
              {cleanupError ? <><p role="alert">{cleanupError}</p><button type="button" className="button subtle"
                onClick={() => setCleanupEpoch(value => value + 1)}>重试读取</button></> : null}
              {cleanupRetry.key === cleanupKey && cleanupRetry.error ? <p role="alert">{cleanupRetry.error}</p> : null}
            </section>
          ) : null}
          {publicationSurfaceLoad === "error" ? (
            <section className="parameter-catalog__banner" data-tone="danger" aria-label={publicationSurfaceCopy.title}>
              <p>{publicationSurfaceCopy.fetchFailed}</p>
              <p>{publicationSurfaceCopy.nextStep}：刷新页面后重试。不要把超时当成已生效。</p>
            </section>
          ) : surfaceStatus ? (
            <section
              className="parameter-catalog__banner"
              data-tone={surfaceStatus.tone}
              aria-label={publicationSurfaceCopy.title}
            >
              <p>{surfaceStatus.message}</p>
              {adoptionNotice ? (
                <details>
                  <summary>{publicationSurfaceCopy.adoptionDetails}</summary>
                  <p>{surfaceStatus.next}</p>
                  {operatorAudience ? <>
                    <p>{publicationSurfaceCopy.adoptionOperator}</p>
                    <p>{publicationSurfaceCopy.adoptionHandbook}</p>
                  </> : null}
                </details>
              ) : <p>{publicationSurfaceCopy.nextStep}：{surfaceStatus.next}</p>}
            </section>
          ) : null}
        </> : undefined}
        repository={catalog}
        moduleRegistry={moduleRegistry}
        actor={actor}
        sessionPermissions={sessionPermissions}
        search={search}
        onAnchorChange={onAnchorChange}
        onDomainStateChange={setDomainState}
        onAction={handleAction}
        onImportDefinitions={canImportDefinitions ? () => { setImportDocument(undefined); setImportOpen(true); } : undefined}
        onOpenUnregisteredSubjects={registrationAllowed && organizationId && catalogReleaseId ? () => { setBatchEntry({}); setBatchEpoch((value) => value + 1); } : undefined}
        onOpenPendingWork={reviewQueueAllowed ? () => setPendingWorkOpen(true) : undefined}
        onEditorClosed={() => setSurfaceEpoch((value) => value + 1)}
        onDefinitionDeleted={() => setCleanupEpoch(value => value + 1)}
        organizationId={organizationId}
        listReviewItems={
          organizationId && reviewQueueAllowed ? (orgId, query) => governance.listReviewItems(orgId, query) : undefined
        }
        definitionPublishingAllowed={publicationSurfaceAllowsPublishing(publicationSurface)}
        definitionAuthoringAllowed={publicationSurfaceAllowsAuthoring(publicationSurface)}
        definitionDeletionAllowed={definitionDeletionAllowed}
        definitionAuthoringDisabledReason={publicationSurfaceLoad === "error"
          ? publicationSurfaceCopy.fetchFailed
          : publicationSurfaceLoad === "loading"
            ? "正在确认目录编写状态，请稍候。"
            : surfaceStatus?.message}
        onDefinitionCommand={(command, definition, ownerState) => {
          // Identity correction now lives inside the definition's own 编辑 dialog
          // (renderDefinitionEditor below); the row only offers that one action.
          if (command === "correct-identity") return;
          setLifecycle({ intent: command, definition, ownerState });
        }}
        renderDefinitionEditor={
          domainState
            ? (definition, history) => (
          <>
          {subjectLoad === "loading" ? <SectionSkeleton label="正在读取主体列表" /> : null}
          {subjectLoad === "error" ? (
            <SectionError
              message="无法读取主体列表，请重试。"
              onRetry={() => setSubjectReadEpoch((value) => value + 1)}
            />
          ) : null}
          <DefinitionEditorBody
            actor={actor}
            sessionPermissions={sessionPermissions}
            domainState={history.domainState}
            catalog={catalog}
            catalogReleaseId={catalogReleaseId}
            definition={definition}
            relatedKnowledge={relatedKnowledge}
            subjects={catalogSubjects}
            projects={projects}
            onEditorStateChange={history.onEditorStateChange}
            createIdempotencyKey={createGovernanceIdempotencyKey}
            // Refresh the release anchor after activation, keeping the result
            // panel mounted while subsequent reads use the applied revision.
            onCompleted={() => undefined}
            onRefreshEvidence={async () => { await refreshCurrentCatalog(); }}
            authoringAllowed={publicationSurfaceAllowsAuthoring(publicationSurface)}
            publishingAllowed={publicationSurfaceAllowsPublishing(publicationSurface)}
            onRequestHistory={history.onRequestHistory}
            onClose={history.onClose}
            onRetireDefinition={() => {
              history.onClose?.();
              setLifecycle({ intent: "retire-definition", definition, ownerState: history.domainState });
            }}
            history={
              <CatalogHistoryBody
                timeline={history.timeline}
                revisions={history.revisions}
                currentRevision={definition.currentRevision}
                hasMore={history.historyHasMore}
                pending={history.historyPending}
                error={history.historyError}
                onLoadMore={history.onLoadMoreHistory}
              />
            }
          />
          </>
              )
            : undefined
        }
      />
      {batchEntry && organizationId && catalogReleaseId ? <BatchRegistrationTable key={batchEpoch} repository={governance}
        organizationId={organizationId} catalogReleaseId={catalogReleaseId} initial={batchEntry}
        onCompleted={() => setSurfaceEpoch((value) => value + 1)} onRefreshEvidence={refreshCurrentCatalog}
        onClose={() => setBatchEntry(null)} /> : null}
      {reviewQueueAllowed && domainState && catalogReleaseId && organizationId ? (
        <ModalDialog
          open={pendingWorkOpen}
          onDismiss={dismissReview}
          className="confirm-dialog governance-confirm-dialog parameter-catalog__pending-dialog review-workbench-dialog"
          describedBy
        >
          {({ titleId, descriptionId }) => (
            <>
              <h2 ref={reviewTitle} tabIndex={-1} id={titleId}>{reviewEditorActive ? "处理审核" : catalogPendingWorkLabel}</h2>
              <div id={descriptionId} className="confirm-dialog__scroll">
                {subjectLoad === "error" ? <SectionError message="主体信息读取失败，登记前请重新读取。" onRetry={() => setSubjectReadEpoch((value) => value + 1)} /> : null}
                {reviewModulesError ? <SectionError message="目标模块读取失败，已禁止默认选择。" onRetry={() => setReviewModulesEpoch((value) => value + 1)} /> : null}
                <ReviewQueue
                  embedded
                  onEditorActiveChange={setReviewEditorActive}
                  onLeaveGuardChange={setReviewLeaveGuard}
                  onCountChange={setReviewCount}
                  onResolved={() => setSurfaceEpoch((value) => value + 1)}
                  actor={reviewActor}
                  domainState={domainState}
                  repository={governance}
                  organizationId={organizationId}
                  catalogReleaseId={catalogReleaseId}
                  selectedReviewItemId={anchor.reviewItemId ?? undefined}
                  moduleOptions={reviewModules}
                  subjects={catalogSubjects}
                  onContinueDefinition={(context) => {
                    setPendingWorkOpen(false);
                    setReviewCount(undefined);
                    const targetSubject = catalogSubjects.find((subject) => subject.id === context.subjectId);
                    onAnchorChange(buildCatalogHref({ ...anchor,
                      reviewItemId: null, definitionId: null, subjectId: targetSubject?.id ?? null,
                      q: targetSubject && context.propertyKey !== "compatible" ? context.propertyKey ?? null : null,
                      cursor: null, catalogReleaseId
                    }), "push");
                  }}
                  onSelectReviewItem={handleSelectReviewItem}
                  onRefreshEvidence={async () => {
                    const request = ++reviewContextGeneration.current;
                    const [document, subjects, registry] = await Promise.all([
                      catalog.getCatalog(),
                      listAllCanonicalPages((query) => catalog.listSubjects({ ...query, catalogReleaseId })),
                      moduleRegistry?.getRegistry()
                    ]);
                    if (request !== reviewContextGeneration.current || document.item?.catalogReleaseId !== catalogReleaseId) throw new Error("审核上下文或目录发布已变化");
                    setCatalogSubjects(subjects);
                    setSubjectLoad("ready");
                    if (registry) {
                      const nodes = toAttributionFlatNodes(registry.modules);
                      setReviewModules(registry.modules.map((module) => ({
                        id: module.id, displayName: modulePathSegments(module, nodes).join(" / "), kind: module.kind,
                        impactSummary: `该模块已有 ${module.definitionCount ?? 0} 条定义。`
                      })));
                      setReviewModulesError(false);
                    }
                  }}
                />
              </div>
              {!reviewEditorActive ? <div className="dialog-actions">
                <button
                  type="button"
                  className="button subtle"
                  onClick={dismissReview}
                >
                  关闭
                </button>
              </div> : null}
            </>
          )}
        </ModalDialog>
      ) : null}
      {organizationId &&
      catalogReleaseId &&
      domainState &&
      subjectId &&
      (action === "register-subject" || action === "update-placement") ? (
        <RegistrationDialog
          open
          intent={action}
          actor={actor}
          domainState={domainState}
          repository={governance}
          organizationId={organizationId}
          subjectId={subjectId}
          catalogReleaseId={catalogReleaseId}
          registrationId={actionRegistrationId ?? undefined}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              setActionRegistrationId(null);
            }
          }}
        />
      ) : null}
      {catalogReleaseId && domainState && organizationId && importOpen ? <DefinitionImportDialog key={`markdown-import-${organizationId}-${currentPersonId}`}
        open initialDocument={importDocument} runtimeMode={runtimeMode} actor={actor} sessionPermissions={sessionPermissions} domainState={domainState} catalog={catalog} governance={governance} moduleRegistry={moduleRegistry}
        catalogReleaseId={catalogReleaseId} currentPersonId={currentPersonId} organizationId={organizationId}
        publicationSurface={publicationSurface} createIdempotencyKey={createGovernanceIdempotencyKey}
        onCompleted={() => setSurfaceEpoch((value) => value + 1)} onRefreshEvidence={async () => { await refreshCurrentCatalog(); }}
        onOpenChange={setImportOpen} /> : null}
      {catalogReleaseId &&
      domainState &&
      organizationId &&
      (action === "preview-publication" || action === "publish-publication") ? (
        <PublicationDialog
          open
          initialSubjectId={subjectId}
          actor={actor}
          sessionPermissions={sessionPermissions}
          domainState={domainState}
          catalog={catalog}
          governance={governance}
          catalogReleaseId={catalogReleaseId}
          currentPersonId={currentPersonId}
          organizationId={organizationId}
          publicationSurface={publicationSurface}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={async () => { await refreshCurrentCatalog(); }}
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              if (definitionCreationRequested) onAnchorChange(buildCatalogHref({ ...anchor, createDefinition: false }), "replace");
            }
          }}
        />
      ) : null}
      {lifecycle && catalogReleaseId && domainState ? (
        <DefinitionLifecycleDialog
          open
          intent={lifecycle.intent}
          actor={actor}
          sessionPermissions={sessionPermissions}
          domainState={lifecycle.ownerState}
          catalog={catalog}
          catalogReleaseId={catalogReleaseId}
          definition={lifecycle.definition}
          createIdempotencyKey={createGovernanceIdempotencyKey}
          onCompleted={() => setSurfaceEpoch((value) => value + 1)}
          onRefreshEvidence={() => setSurfaceEpoch((value) => value + 1)}
          onOpenChange={(open) => {
            if (!open) {
              setLifecycle(null);
            }
          }}
        />
      ) : null}

    </div>
  );
}
