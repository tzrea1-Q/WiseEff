import { SelectControl } from "@/components/common/SelectControl";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CircleX } from "lucide-react";
import { SearchField } from "@/components/common/SearchField";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { Badge } from "@/components/ui/badge";
import { DefinitionExamples } from "@/components/parameter-topology/DefinitionExamples";

import {
  catalogWritesEnabled,
  deriveCatalogDomainState,
  type CatalogCollectionSnapshot,
  type CatalogDomainState,
  type CatalogEmptyReason
} from "@/application/parameter-catalog/states";
import {
  CATALOG_DEFAULT_PAGE_SIZE,
  CATALOG_PAGE_SIZES,
  CATALOG_READ_PAGE_PATH,
  buildCatalogHref,
  parseCatalogUrlAnchor,
  parseCatalogPageSize,
  readLegacyCatalogBookmark,
  serializeCatalogUrlAnchor,
  type CatalogPageSize,
  type CatalogUrlAnchor
} from "@/application/parameter-catalog/urlAnchor";
import type { CatalogActorKind, CatalogAuthorizedAction } from "@/application/parameter-catalog/authority";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { type Column } from "@/components/admin";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import { useCatalogNavigator, type CatalogNavigatorRead } from "./useCatalogNavigator";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { DefinitionDocumentation, definitionDocumentationExcerpt } from "@/components/parameters/DefinitionDocumentation";
import { toggleFilterValue } from "@/components/tableFilterUtils";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type {
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogListQuery,
  CatalogReviewItemListResponse,
  CatalogSubjectListResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { useCatalogLayoutMode, type CatalogLayoutMode } from "./catalogLayout";
import { CatalogModuleNavigator } from "./CatalogModuleNavigator";
import { DefinitionDeletionDialog } from "./DefinitionDeletionDialog";
import { DefinitionTable } from "./DefinitionTable";
import { DefinitionBatchBar } from "./DefinitionBatchBar";
import { ProjectConfigurations } from "./ProjectConfigurations";
import { ProjectComparison } from "./ProjectComparison";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { CatalogNavigatorNode } from "./catalogModuleScope";
import {
  buildCatalogModuleTree,
  subjectIdsForModule
} from "./catalogModuleScope";
import {
  catalogActionAffordances,
  catalogEmptyMessage,
  catalogLifecycleLabel,
  catalogRegistrationLabel,
  catalogStateMessage,
  catalogSubjectTypeLabel,
  catalogTimelineChangeLabel,
  catalogTimelineKindLabel,
  catalogValueShapeLabel
} from "./catalogPresentation";
import {
  catalogAuthoringAccessHint,
  catalogDetailCloseLabel,
  catalogDetailLabel,
  catalogHistoryCloseLabel,
  catalogHistoryLabel,
  catalogHistoryOpenLabel,
  catalogListLabel,
  catalogLoadingLabel,
  catalogNavigatorLabel,
  catalogNextPageLabel,
  catalogPageLabel,
  catalogPageSizeLabel,
  catalogPaginationLabel,
  catalogPendingWorkLabel,
  catalogPreviousPageLabel,
  catalogResultCountLabel,
  catalogSearchLabel,
  catalogSelectDefinitionHint,
  catalogTimelineLabel
} from "./copy";
import "./parameter-catalog.css";

function libraryAnchor(value: CatalogUrlAnchor): CatalogUrlAnchor {
  const lifecycle = value.lifecycle?.split(",").filter((item) => item !== "retired").join(",") || null;
  const resetCursor = Boolean(value.catalogReleaseId || value.includeRetiredSubjects || value.registration === "retired" || lifecycle !== value.lifecycle);
  return { ...value, catalogReleaseId: null, includeRetiredSubjects: false,
    registration: value.registration === "retired" ? null : value.registration, lifecycle,
    ...(resetCursor ? { cursor: null, cursorTrail: null } : {}) };
}

type DefinitionItem = CatalogDefinitionResponse["item"];
type SubjectItem = CatalogSubjectResponse["item"];
type RevisionItem = CatalogDefinitionRevisionResponse["item"];
type TimelineItem = CatalogDefinitionTimelineResponse["items"][number];

export type CatalogPageProps = {
  libraryMode?: boolean;
  projectRepository?: Pick<ParameterRepository, "listProjects">;
  pageKey?: string;
  refreshEpoch?: number;
  notice?: ReactNode;
  taskContent?: ReactNode;
  navigatorRead?: CatalogNavigatorRead;
  repository: ParameterCatalogRepository;
  moduleRegistry?: Pick<ParameterModuleRegistryRepository, "getRegistry">;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  search?: string;
  onAnchorChange?: (href: string, mode: "push" | "replace") => void;
  onOpenProject?: (href: string) => void;
  onDomainStateChange?: (state: CatalogDomainState) => void;
  onOpenPendingWork?: () => void;
  reviewCountOverride?: number | null;
  /**
   * Editor body for the definition dialog. The page owns the dialog and the
   * loaded history; the organization surface owns the governed write command.
   */
  /** Called on close with whether the editor completed a change. */
  onEditorClosed?: (changed: boolean) => void;
  onDefinitionDeleted?: (definitionId: string) => void;
  renderDefinitionEditor?: (
    definition: DefinitionItem,
    history: {
      domainState: CatalogDomainState;
      revisions: RevisionItem[];
      timeline: CatalogDefinitionTimelineResponse | null;
      onHistoryOpenChange: (open: boolean) => void;
      /** Close the editor dialog and clear selection from URL. */
      onClose?: () => void;
      onChanged?: () => void;
      onEditorStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
      historyHasMore?: boolean;
      historyPending?: boolean;
      historyError?: string | null;
      onLoadMoreHistory?: () => void;
    }
  ) => ReactNode;
  onAction?: (
    action: CatalogAuthorizedAction,
    context?: { subjectId?: string | null; registrationId?: string | null }
  ) => void;
  /**
   * Definition-scoped governance commands that need the selected definition.
   * The surface owns the dialogs so one row action opens one wide editor.
   */
  onDefinitionCommand?: (
    command: "retire-definition" | "restore-definition" | "correct-identity",
    definition: DefinitionItem,
    ownerState: CatalogDomainState
  ) => void;
  onBatchDefinitionCommand?: (
    command: "retire-definition" | "restore-definition",
    definitions: DefinitionItem[],
    ownerState: CatalogDomainState
  ) => void;
  /**
   * Whether the server's publication surface actually permits entity authoring
   * and publication for this session. The row actions must mirror the server:
   * a visible control that the server would refuse is not a security boundary.
   */
  definitionPublishingAllowed?: boolean;
  definitionAuthoringAllowed?: boolean;
  onImportDefinitions?: () => void;
  onPublishClaimedOwners?: () => void;
  onOpenUnregisteredSubjects?: () => void;
  definitionDeletionAllowed?: boolean;
  definitionAuthoringDisabledReason?: string;
  layoutMode?: CatalogLayoutMode;
  organizationId?: string;
  listReviewItems?: (
    organizationId: string,
    query?: CatalogListQuery
  ) => Promise<CatalogReviewItemListResponse>;
};

type HistoryData = {
  revisions: RevisionItem[];
  timeline: CatalogDefinitionTimelineResponse;
  revisionCursor: string | null;
  timelineCursor: string | null;
};

function useCatalogRead<T>(scope: object, load: ((isCurrent: () => boolean) => Promise<T>) | null) {
  const [result, setResult] = useState<{ scope: object; load: typeof load; data?: T; error?: unknown }>();
  useEffect(() => {
    if (!load) return;
    let current = true;
    void Promise.resolve().then(async () => {
      if (!current) return;
      try {
        const data = await load(() => current);
        if (current) setResult({ scope, load, data });
      } catch (error) {
        if (current) setResult(previous => ({ scope, load, error, data: previous?.scope === scope ? previous.data : undefined }));
      }
    });
    return () => { current = false; };
  }, [load, scope]);
  const matching = result?.scope === scope ? result : undefined;
  const settled = Boolean(load && matching?.load === load);
  return { data: matching?.data, pending: Boolean(load && !settled), error: settled ? matching?.error : undefined };
}

function searchFromHref(href: string): string {
  const queryIndex = href.indexOf("?");
  return queryIndex >= 0 ? href.slice(queryIndex) : "";
}

function emptyCollectionReason(
  collection: { items: readonly unknown[]; emptyReason?: string } | null | undefined
): CatalogEmptyReason | null {
  if (!collection || collection.items.length > 0) return null;
  const reason = collection.emptyReason;
  if (
    reason === "no-registrations" ||
    reason === "no-definitions" ||
    reason === "no-review-work" ||
    reason === "no-filter-match"
  ) {
    return reason;
  }
  return null;
}

function pickCollection(
  subjects: CatalogSubjectListResponse,
  definitions: CatalogDefinitionListResponse
): CatalogCollectionSnapshot {
  const subjectReason = emptyCollectionReason(subjects);
  if (subjectReason) {
    return subjects;
  }
  const definitionReason = emptyCollectionReason(definitions);
  if (definitionReason) {
    return definitions;
  }
  if (definitions.items.length > 0) {
    return definitions;
  }
  return subjects;
}

/**
 * Restored organization definition workspace (issue #847).
 *
 * The definition table owns the main work area: a module navigator sits beside
 * it and every collection control (search, lifecycle and module filters, page
 * size, pagination, truthful count) narrows the complete result set before it is
 * paged. Definition history and pending governance work open on demand instead
 * of occupying the workspace by default.
 */
export function CatalogPage({
  projectRepository,
  libraryMode = false,
  pageKey = "catalog-definitions",
  refreshEpoch = 0,
  notice,
  taskContent,
  navigatorRead,
  repository,
  moduleRegistry,
  actor,
  sessionPermissions,
  search,
  onAnchorChange,
  onOpenProject,
  onDomainStateChange,
  onAction,
  onOpenPendingWork,
  reviewCountOverride,
  onEditorClosed,
  onDefinitionDeleted,
  renderDefinitionEditor,
  onDefinitionCommand,
  onBatchDefinitionCommand,
  definitionPublishingAllowed = false,
  definitionAuthoringAllowed = false,
  onImportDefinitions,
  onPublishClaimedOwners,
  onOpenUnregisteredSubjects,
  definitionDeletionAllowed = false,
  definitionAuthoringDisabledReason = catalogAuthoringAccessHint,
  layoutMode: layoutOverride,
  organizationId,
  listReviewItems
}: CatalogPageProps) {
  const layoutMode = useCatalogLayoutMode(layoutOverride);
  const [internalSearch, setInternalSearch] = useState(
    () => search ?? (typeof window === "undefined" ? "" : window.location.search)
  );
  const resolvedSearch = search ?? internalSearch;
  const [projectOptions, setProjectOptions] = useState<{ organizationId?: string; items: { id: string; name: string }[] } | null>(null);
  const [projectOptionsError, setProjectOptionsError] = useState(false);
  const [projectOptionsRetry, setProjectOptionsRetry] = useState(0);
  useEffect(() => {
    if (!libraryMode || !projectRepository) return;
    let active = true;
    setProjectOptions(null);
    setProjectOptionsError(false);
    void projectRepository.listProjects().then((items) => {
      if (active) setProjectOptions({ organizationId, items });
    }).catch(() => { if (active) setProjectOptionsError(true); });
    return () => { active = false; };
  }, [libraryMode, organizationId, projectRepository, projectOptionsRetry]);
  const anchor = useMemo(() => {
    const value = parseCatalogUrlAnchor(resolvedSearch);
    return libraryMode ? libraryAnchor(value) : value;
  }, [libraryMode, resolvedSearch]);
  const pageSize: CatalogPageSize =
    parseCatalogPageSize(anchor.pageSize === null ? null : String(anchor.pageSize)) ??
    CATALOG_DEFAULT_PAGE_SIZE;
  const activeLifecycles = useMemo(
    () => (anchor.lifecycle ? anchor.lifecycle.split(",").filter(Boolean) : []),
    [anchor.lifecycle]
  );

  const [searchInput, setSearchInput] = useState(anchor.q ?? "");
  const searchPending = useRef(false);
  const [searchComposing, setSearchComposing] = useState(false);
  const [editorState, setEditorState] = useState({ dirty: false, pending: false });
  const [leaveEditorOpen, setLeaveEditorOpen] = useState(false);
  const [deletingDefinition, setDeletingDefinition] = useState<DefinitionItem | null>(null);
  const [selectedDefinitions, setSelectedDefinitions] = useState<DefinitionItem[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const [selectingSubject, setSelectingSubject] = useState(false);
  const selectionGeneration = useRef(0);
  useEffect(() => { if (!definitionPublishingAllowed || !onBatchDefinitionCommand) setSelectedDefinitions([]); }, [definitionPublishingAllowed, onBatchDefinitionCommand]);
  const closingEditor = useRef(false);
  const changedDefinition = useRef<object | null>(null);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const finishEditorLeave = (allowed: boolean) => {
    leaveDecision.current?.resolve(allowed);
    leaveDecision.current = null;
    setLeaveEditorOpen(false);
  };
  useEffect(() => {
    if (!editorState.dirty && !editorState.pending) return;
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented || closingEditor.current) return;
      event.preventDefault();
      if (editorState.pending) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setLeaveEditorOpen(true);
    };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      leaveDecision.current?.resolve(false);
      leaveDecision.current = null;
    };
  }, [editorState.dirty, editorState.pending]);
  /** Cursors already traversed, so Previous is exact rather than guessed. */
  const [cursorTrail, setCursorTrail] = useState<readonly string[]>([]);
  useEffect(() => {
    try {
      const value: unknown = anchor.cursorTrail ? JSON.parse(anchor.cursorTrail) : [];
      setCursorTrail(Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []);
    } catch { setCursorTrail([]); }
  }, [anchor.cursorTrail]);
  const listReviewItemsRef = useRef(listReviewItems);
  useEffect(() => { listReviewItemsRef.current = listReviewItems; }, [listReviewItems]);
  const reviewItemsAvailable = Boolean(listReviewItems);
  const onAnchorChangeRef = useRef(onAnchorChange);
  useEffect(() => { onAnchorChangeRef.current = onAnchorChange; }, [onAnchorChange]);

  const commitAnchor = useCallback(
    (next: CatalogUrlAnchor, mode: "push" | "replace") => {
      const href = buildCatalogHref(next);
      const nextSearch = searchFromHref(href);
      if (onAnchorChangeRef.current) {
        onAnchorChangeRef.current(href, mode);
        return;
      }
      if (typeof window !== "undefined") {
        if (mode === "push") {
          window.history.pushState(null, "", href);
        } else {
          window.history.replaceState(null, "", href);
        }
      }
      setInternalSearch(nextSearch);
    },
    []
  );

  useEffect(() => {
    if (search !== undefined) {
      return undefined;
    }
    const onPopState = () => setInternalSearch(window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [search]);

  useEffect(() => {
    searchPending.current = false;
    setSearchInput(anchor.q ?? "");
  }, [anchor.q]);

  useEffect(() => {
    if (!searchPending.current || searchComposing) return;
    const q = searchInput.trim() || null;
    if (q === anchor.q) return;
    const timer = window.setTimeout(() => {
      if (!searchPending.current) return;
      searchPending.current = false;
      setCursorTrail([]);
      commitAnchor({ ...anchor, q, cursor: null, cursorTrail: null }, "replace");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchComposing, anchor, commitAnchor]);

  const scope = useMemo(() => ({ repository, organizationId, libraryMode }), [repository, organizationId, libraryMode]);
  const latestAnchor = useRef(anchor);
  useEffect(() => { latestAnchor.current = anchor; }, [anchor]);
  const legacy = !anchor.definitionId && !anchor.subjectId ? readLegacyCatalogBookmark(resolvedSearch) : null;
  const legacyType = legacy?.legacyType;
  const legacyId = legacy?.legacyId;
  const [retryEpoch, setRetryEpoch] = useState(0);
  const loadLegacy = useMemo(() => legacyType && legacyId ? async (isCurrent: () => boolean) => {
    const { item: { target } } = await repository.getLegacyIdentifier(legacyType, legacyId);
    if (isCurrent()) commitAnchor({
      ...latestAnchor.current,
      subjectId: target.kind === "catalog-subject" ? target.id : null,
      definitionId: target.kind === "parameter-definition" ? target.id : null
    }, "replace");
  } : null, [legacyType, legacyId, repository, commitAnchor, retryEpoch]);
  const legacyRead = useCatalogRead(scope, loadLegacy);

  const localNavigator = useCatalogNavigator({
    repository, moduleRegistry, organizationId, libraryMode, releaseId: anchor.catalogReleaseId,
    refreshEpoch, enabled: !navigatorRead && !legacy
  });
  const navigator = navigatorRead ?? localNavigator;
  const navigatorData = legacy ? undefined : navigator.data;
  const document = navigatorData?.document;
  const release = document?.item;
  const unpublished = document?.item === null && !navigator.pending && navigator.error === undefined;
  const subjects = navigatorData?.subjects?.items ?? [];
  const modules = navigatorData?.modules ?? [];
  const { definitionId, subjectId, q, lifecycle, moduleNodeId, cursor, type, registration, usageProjectId } = anchor;
  const workspaceSubject = subjectId ? subjects.find(item => item.id === subjectId) : undefined;
  const restoreRetiredBookmark = !anchor.includeRetiredSubjects && Boolean(workspaceSubject &&
    (workspaceSubject.membership.status === "retired" || (!libraryMode && workspaceSubject.registration.status === "retired")));
  const includesRetiredSubjects = anchor.includeRetiredSubjects || restoreRetiredBookmark;
  const listCursor = restoreRetiredBookmark ? null : cursor;

  useEffect(() => {
    if (!release || navigator.pending || navigator.error !== undefined || libraryMode) return;
    if (anchor.catalogReleaseId && !restoreRetiredBookmark) return;
    commitAnchor({
      ...anchor,
      catalogReleaseId: release.catalogReleaseId,
      ...(restoreRetiredBookmark ? { includeRetiredSubjects: true, cursor: null, cursorTrail: null } : {})
    }, "replace");
  }, [anchor, commitAnchor, libraryMode, navigator.pending, navigator.error, release, restoreRetiredBookmark]);

  const releaseId = release?.catalogReleaseId;
  // The initial URL pin and explicit pin for the same release use the same queries.
  const pinnedReleaseId = ((!anchor.catalogReleaseId && !navigator.pending) || anchor.catalogReleaseId === releaseId)
    ? releaseId : undefined;
  const readPin = useMemo<(CatalogListQuery & { catalogReleaseId: string }) | null>(() => pinnedReleaseId
    ? { catalogReleaseId: pinnedReleaseId, ...(libraryMode ? { view: "library" } : {}) } : null,
  [pinnedReleaseId, libraryMode]);
  const navigatorReady = !navigator.pending && navigator.error === undefined;
  const listPin = navigatorReady ? readPin : null;
  const noRegistrations = emptyCollectionReason(navigatorData?.subjects) === "no-registrations";
  const libraryType = libraryMode && (type === "driver" || type === "node-type" || type === "configuration-schema") ? type : null;
  const libraryRegistration = libraryMode ? registration : null;
  const libraryUsageProjectId = libraryMode ? usageProjectId : null;
  const loadList = useMemo(() => listPin ? async () => {
    const query: CatalogListQuery = {
      ...listPin,
      ...(!includesRetiredSubjects ? { subjectLifecycle: "active", ...(!libraryMode ? { registration: "not-retired" } : {}) } : {}),
      limit: pageSize,
      ...(q ? { search: q } : {}),
      ...(lifecycle ? { lifecycle } : {}),
      ...(listCursor ? { cursor: listCursor } : {}),
      ...(moduleNodeId ? { placementModuleId: moduleNodeId, ...(libraryMode ? { placementScope: "library" } : {}) } : {}),
      ...(libraryType ? { type: libraryType } : {}),
      ...(libraryRegistration ? { registration: libraryRegistration } : {}),
      ...(libraryUsageProjectId ? { usageProjectId: libraryUsageProjectId } : {})
    };
    const result: CatalogDefinitionListResponse = subjectId
      ? await repository.listSubjectDefinitions(subjectId, query)
      : noRegistrations ? {
        items: [], nextCursor: null, catalogReleaseId: listPin.catalogReleaseId, totalCount: 0,
        hasMore: false, emptyReason: "no-registrations"
      } : await repository.listDefinitions(query);
    return { result, refreshEpoch, pin: listPin };
  } : null, [listPin, includesRetiredSubjects, libraryMode, pageSize, q, lifecycle, listCursor, moduleNodeId,
    libraryType, libraryRegistration, libraryUsageProjectId, subjectId, noRegistrations, repository, refreshEpoch, retryEpoch]);
  const [deletionEpoch, setDeletionEpoch] = useState(0);
  const listScope = useMemo(() => ({ scope, deletionEpoch }), [scope, deletionEpoch]);
  const list = useCatalogRead(listScope, loadList);
  const definitionList = unpublished ? undefined : list.data?.result;
  const listPending = list.pending;
  const detailScope = useMemo(() => ({ scope, definitionId }), [scope, definitionId]);
  const [detailRetryEpoch, setDetailRetryEpoch] = useState(0);
  const retryDetail = () => setDetailRetryEpoch(epoch => epoch + 1);
  const loadDetail = useMemo(() => readPin && definitionId ? async (isCurrent: () => boolean) => {
    const { item: definition } = await repository.getDefinition(definitionId, readPin);
    const subject = isCurrent() ? (await repository.getSubject(definition.subject.id, readPin)).item : null;
    return { definition, subject, pin: readPin, refreshEpoch };
  } : null, [readPin, definitionId, repository, refreshEpoch, detailRetryEpoch]);
  const detail = useCatalogRead(detailScope, loadDetail);
  const definition = unpublished || !definitionId ? null : detail.data?.definition ?? null;
  const subject = definition ? detail.data?.subject ?? null : workspaceSubject ?? null;
  const readingHeading = useRef<HTMLHeadingElement>(null);
  const readingDefinitionId = definition?.id;
  useEffect(() => {
    if (libraryMode && readingDefinitionId) readingHeading.current?.focus();
  }, [libraryMode, readingDefinitionId]);

  const [historySelection, setHistorySelection] = useState<typeof detailScope | null>(null);
  const historyOpen = libraryMode ? anchor.history === "true" : historySelection === detailScope;
  const [historyRetryEpoch, setHistoryRetryEpoch] = useState(0);
  const detailIsCurrent = detail.data?.pin === readPin && detail.data?.refreshEpoch === refreshEpoch && !detail.pending && detail.error === undefined;
  const historyPin = detailIsCurrent ? readPin : null;
  const loadHistory = useMemo(() => historyOpen && historyPin && definitionId ? async (): Promise<HistoryData> => {
    const query = { ...historyPin, limit: 50 };
    const [revisionList, timeline] = await Promise.all([
      repository.listDefinitionRevisions(definitionId, query),
      repository.listDefinitionTimeline(definitionId, query)
    ]);
    return {
      revisions: revisionList.items, timeline,
      revisionCursor: revisionList.hasMore ? revisionList.nextCursor : null,
      timelineCursor: timeline.hasMore ? timeline.nextCursor : null
    };
  } : null, [historyOpen, historyPin, definitionId, repository, historyRetryEpoch]);
  const history = useCatalogRead(detailScope, loadHistory);
  const [historyPage, setHistoryPage] = useState<{ source: HistoryData; data: HistoryData; pending?: boolean; error?: string }>();
  const historyGeneration = useRef(0);
  useEffect(() => () => { historyGeneration.current += 1; }, [loadHistory]);
  const historySource = loadHistory && !history.pending && history.error === undefined ? history.data : undefined;
  const currentHistoryPage = historyPage?.source === historySource ? historyPage : undefined;
  const historyData = currentHistoryPage?.data ?? historySource;
  const historyPending = historyOpen && (detail.pending || history.pending || Boolean(currentHistoryPage?.pending));
  const historyError = history.error !== undefined ? "修订历史读取失败，请重试。" : currentHistoryPage?.error ?? null;
  const retryHistory = () => setHistoryRetryEpoch(epoch => epoch + 1);

  const loadReview = useMemo(() => readPin && organizationId && reviewItemsAvailable ? async () => {
    try {
      return await listReviewItemsRef.current?.(organizationId, readPin) ?? null;
    } catch {
      return null;
    }
  } : null, [readPin, organizationId, reviewItemsAvailable]);
  const reviewScope = useMemo(() => ({ scope, readPin, refreshEpoch }), [scope, readPin, refreshEpoch]);
  const review = useCatalogRead(reviewScope, loadReview).data;
  const reviewItemCount = reviewCountOverride !== undefined ? reviewCountOverride
    : review?.totalCount ?? (review?.nextCursor ? null : review?.items.length ?? 0);

  useEffect(() => { setSelectedDefinitions([]); setSelectionError(""); }, [organizationId, refreshEpoch, releaseId]);
  useEffect(() => {
    setSelectingSubject(false);
    return () => { selectionGeneration.current += 1; };
  }, [organizationId, subjectId, releaseId, refreshEpoch]);

  const retryWorkspace = () => {
    if (!legacy && navigator.error !== undefined) void navigator.reload();
    else setRetryEpoch(epoch => epoch + 1);
  };
  const collection = navigatorData?.subjects && definitionList ? pickCollection(navigatorData.subjects, definitionList) : undefined;
  const workspaceError = legacy ? legacyRead.error : navigator.error ?? list.error;
  const inFlight = legacy ? legacyRead.pending : navigator.pending ||
    (listPending && (!definitionList || list.data?.refreshEpoch !== refreshEpoch || list.data.pin !== readPin));
  const workspaceInput = {
    inFlight,
    previousReleaseId: releaseId ?? null,
    document,
    collection: listPending || workspaceError !== undefined ? undefined : collection,
    error: workspaceError
  };
  const workspaceState = deriveCatalogDomainState({ ...workspaceInput, subject: workspaceSubject });
  const error = detail.error ?? workspaceError;
  const domainState = deriveCatalogDomainState({
    ...workspaceInput,
    inFlight: inFlight || detail.pending,
    subject: subject ?? undefined,
    definition: definition ?? undefined,
    error
  });
  const writesEnabled = catalogWritesEnabled(domainState);
  /**
   * Actions that no longer have a surface on this page are not offered as toolbar
   * buttons: review work is processed through the single pending-work dialog, and
   * the definition-proposal panel was removed from the workspace.
   */
  const actions = catalogActionAffordances(actor, workspaceState, sessionPermissions).filter(
    (action) => action.action === "preview-publication" ||
      (action.action === "register-subject" && workspaceSubject?.registration.status === "unregistered") ||
      (action.action === "update-placement" && workspaceSubject?.registration.status === "active")
  );
  const onDomainStateChangeRef = useRef(onDomainStateChange);
  onDomainStateChangeRef.current = onDomainStateChange;
  const lastNotifiedDomainState = useRef("");

  useEffect(() => {
    const key = JSON.stringify(workspaceState);
    if (lastNotifiedDomainState.current === key) {
      return;
    }
    lastNotifiedDomainState.current = key;
    onDomainStateChangeRef.current?.(workspaceState);
  }, [workspaceState]);

  const statusMessage = catalogStateMessage(domainState);
  const workspaceMessage = libraryMode && workspaceState.kind === "loading" ? "正在加载参数库"
    : libraryMode && workspaceState.kind === "unpublished" ? "参数库暂无可阅读的定义。"
      : libraryMode && workspaceState.kind === "unregistered" ? "该主体尚未登记。"
      : libraryMode && workspaceState.kind === "retired" ? "该内容当前不可用。"
          : workspaceState.kind === "retired" && workspaceState.target === "subject"
            ? "当前主体已退役，参数定义仅供查看。" : catalogStateMessage(workspaceState);
  const readOnlyLabel = domainState.kind !== "retired" ? null
    : domainState.target === "subject" ? "主体已退役 · 只读"
      : domainState.target === "registration" ? "登记已停用 · 只读"
        : definition?.lifecycle === "deprecated" ? "定义已弃用 · 只读" : "定义已退役 · 只读";
  const reviewEmptyReason = emptyCollectionReason(review);
  const listEmptyReason = emptyCollectionReason(definitionList);
  const definitions = definitionList?.items ?? [];
  const navigationSubjects = useMemo(() => includesRetiredSubjects ? subjects
    : subjects.filter((item) => item.membership.status === "active" && (libraryMode || item.registration.status !== "retired")), [subjects, includesRetiredSubjects, libraryMode]);
  const subjectsById = useMemo(() => new Map([
    ...subjects.map((item) => [item.id, item] as const),
    ...(subject && detailIsCurrent ? [[subject.id, subject] as const] : [])
  ]), [subjects, subject, detailIsCurrent]);
  const ownerWritable = (item: DefinitionItem) => {
    const owner = subjectsById.get(item.subject.id);
    return owner?.membership.status === "active" && owner.registration.status !== "retired" &&
      item.registration.status !== "retired";
  };
  const canPublishDefinitions = !libraryMode && definitionPublishingAllowed;
  const canEditDefinition = (item: DefinitionItem) => !libraryMode && definitionAuthoringAllowed &&
    Boolean(renderDefinitionEditor) && !inFlight && workspaceError === undefined &&
    (actor === "platform-admin"
      ? item.lifecycle !== "retired" && subjectsById.get(item.subject.id)?.membership.status === "active"
      : item.lifecycle === "active" && ownerWritable(item));
  const definitionEditable = definition ? detailIsCurrent && canEditDefinition(definition) : false;
  const canDeleteDefinition = !libraryMode && definitionDeletionAllowed && Boolean(repository.previewDefinitionDeletion && repository.deleteDefinition);
  const definitionActionLabel = definitionEditable ? "编辑" : "查看";
  const ownerStatusLabel = (item: DefinitionItem) => subjectsById.get(item.subject.id)?.membership.status === "retired"
    ? "主体已退役"
    : item.registration.status === "retired" || subjectsById.get(item.subject.id)?.registration.status === "retired"
      ? "登记已停用" : null;
  const describeSubject = useCallback(
    (item: (typeof subjects)[number]) =>
      `${catalogSubjectTypeLabel(item.type)} · ${item.membership.status === "retired" ? "主体已退役" : catalogRegistrationLabel(item.registration.status)}`,
    []
  );
  const navigatorNodes = useMemo(
    () => {
      const nodes = buildCatalogModuleTree(navigationSubjects, describeSubject, modules, { nestOwnedNodeTypes: libraryMode });
      return libraryMode ? nodes.filter(node => node.id !== "group:unset" && !modules.some(module => module.id === node.id && module.kind === "unclassified")) : nodes;
    },
    [navigationSubjects, describeSubject, modules, libraryMode]
  );
  const totalCount = definitionList?.totalCount ?? null;
  const findModuleCount = (nodes: CatalogNavigatorNode[], id: string): number | undefined => {
    for (const node of nodes) {
      if (node.kind === "module" && node.id === id) return node.subjectCount;
      const count = findModuleCount(node.children, id);
      if (count !== undefined) return count;
    }
    return undefined;
  };
  const scopedSubjectCount = anchor.moduleNodeId
    ? libraryMode ? findModuleCount(navigatorNodes, anchor.moduleNodeId) ?? 0 : subjectIdsForModule(navigationSubjects, anchor.moduleNodeId, modules).size
    : navigationSubjects.length;
  const filterEmptyReason: CatalogEmptyReason | null =
    definitions.length === 0 &&
    (activeLifecycles.length > 0 || Boolean(anchor.q) || Boolean(anchor.moduleNodeId))
      ? "no-filter-match"
      : listEmptyReason;
  const compactList = layoutMode === "mobile";
  const noOrgRegistrations = !libraryMode &&
    !anchor.subjectId &&
    subjects.length > 0 &&
    subjects.every((item) => item.registration.status === "unregistered");
  const pageEmptyReason =
    domainState.kind === "empty"
      ? domainState.emptyReason
      : filterEmptyReason && definitions.length === 0
        ? filterEmptyReason
        : noOrgRegistrations
          ? "no-registrations"
          : null;

  const selectModuleNode = (moduleId: string | null) => {
    setCursorTrail([]);
    commitAnchor(
      {
        ...anchor,
        moduleNodeId: moduleId,
        cursor: null,
        cursorTrail: null,
        subjectId: null,
        definitionId: null
      },
      "push"
    );
  };

  const selectNavigatorNode = (node: CatalogNavigatorNode) => {
    if (node.subjectId) {
      selectSubject(node.subjectId === anchor.subjectId ? null : node.subjectId);
      return;
    }
    selectModuleNode(node.id === anchor.moduleNodeId && !anchor.subjectId ? null : node.id);
  };

  const selectSubject = (subjectId: string | null) => {
    // An exact subject replaces the module selection, including one in another branch.
    commitAnchor({ ...anchor, subjectId, moduleNodeId: null, definitionId: null, cursor: null, cursorTrail: null }, "push");
  };

  const selectDefinition = (item: DefinitionItem) => {
    commitAnchor(
      {
        ...anchor,
        definitionId: item.id,
        history: null, tab: null, instance: null, instanceCursor: null, baseline: null, target: null
      },
      "push"
    );
    setHistorySelection(null);
  };

  const submitSearch = () => {
    if (searchComposing) return;
    searchPending.current = false;
    const q = searchInput.trim() || null;
    if (q === anchor.q) return;
    setCursorTrail([]);
    commitAnchor({ ...anchor, q, cursor: null, cursorTrail: null }, "replace");
  };

  const toggleLifecycleFilter = (value: string) => {
    const next = toggleFilterValue(activeLifecycles, value);
    setCursorTrail([]);
    commitAnchor(
      { ...anchor, lifecycle: next.length > 0 ? [...next].sort().join(",") : null, cursor: null, cursorTrail: null },
      "push"
    );
  };

  const clearLifecycleFilter = () => {
    setCursorTrail([]);
    commitAnchor({ ...anchor, lifecycle: null, cursor: null, cursorTrail: null }, "push");
  };

  const toggleRetiredSubjects = (include: boolean) => {
    setCursorTrail([]);
    const retiredSelection = subjects.some((item) => item.id === anchor.subjectId && (item.membership.status === "retired" || (!libraryMode && item.registration.status === "retired")));
    commitAnchor({ ...anchor, includeRetiredSubjects: include, cursor: null, cursorTrail: null,
      subjectId: !include && retiredSelection ? null : anchor.subjectId, definitionId: null }, "push");
  };

  const changePageSize = (size: CatalogPageSize) => {
    setCursorTrail([]);
    commitAnchor({ ...anchor, pageSize: size, cursor: null, cursorTrail: null }, "push");
  };

  const goToNextPage = () => {
    const next = definitionList?.nextCursor ?? null;
    if (!next) return;
    setCursorTrail((trail) => [...trail, anchor.cursor ?? ""]);
    commitAnchor({ ...anchor, cursor: next, cursorTrail: JSON.stringify([...cursorTrail, anchor.cursor ?? ""]) }, "push");
  };

  const goToPreviousPage = () => {
    if (cursorTrail.length === 0) return;
    const trail = [...cursorTrail];
    const previous = trail.pop() ?? "";
    setCursorTrail(trail);
    commitAnchor({ ...anchor, cursor: previous || null, cursorTrail: trail.length ? JSON.stringify(trail) : null }, "push");
  };

  const columns: Column<DefinitionItem>[] = [
    {
      key: "propertyKey",
      header: "属性键",
      render: (row) => <code>{row.propertyKey}</code>,
      sortAccessor: (row) => row.propertyKey
    },
    {
      key: "displayName",
      header: "显示名",
      render: (row) => row.currentRevision.displayName || "—",
      sortAccessor: (row) => row.currentRevision.displayName ?? ""
    },
    {
      key: "subject",
      header: "主体",
      render: (row) => <>{row.subject.canonicalName}{ownerStatusLabel(row) ? (
        <span className="parameter-catalog__subject-meta">{` · ${ownerStatusLabel(row)}`}</span>
      ) : null}</>,
      sortAccessor: (row) => row.subject.canonicalName
    },
    {
      key: "module",
      header: "所属模块",
      render: (row) =>
        row.registration.status === "unregistered"
          ? "未登记"
          : row.registration.placement && !row.registration.placement.moduleId
            ? <span className="parameter-catalog__badge" data-tone="warning">unset（未分配）</span>
            : row.registration.placement?.displayName ?? "未建立",
      sortAccessor: (row) =>
        row.registration.status === "unregistered" ? "" : row.registration.placement?.displayName ?? "",
      headerFilter: {
        label: "所属模块",
        groupLabel: "所属模块筛选",
        values: modules.map(module => module.id),
        selectedValues: anchor.moduleNodeId ? [anchor.moduleNodeId] : [],
        renderLabel: (value) => modules.find(module => module.id === value)?.name ?? value,
        onToggle: (value) => selectModuleNode(value === anchor.moduleNodeId ? null : value),
        onClear: () => selectModuleNode(null),
        // The server already scopes the paged collection to the selected subtree.
        getValue: (row) =>
          anchor.moduleNodeId ?? (row.registration.status === "unregistered"
            ? ""
            : row.registration.placement?.moduleId ?? "")
      }
    },
    {
      key: "lifecycle",
      header: "生命周期",
      className: "parameter-catalog__lifecycle",
      render: (row) => (
        <span className="parameter-catalog__badge" data-tone={row.lifecycle === "active" ? undefined : "retired"}>
          {catalogLifecycleLabel(row.lifecycle)}
        </span>
      ),
      sortAccessor: (row) => row.lifecycle,
      headerFilter: {
        label: "生命周期",
        values: libraryMode ? ["active", "deprecated"] : ["active", "deprecated", "retired"],
        selectedValues: activeLifecycles,
        renderLabel: catalogLifecycleLabel,
        onToggle: toggleLifecycleFilter,
        onClear: clearLifecycleFilter,
        getValue: (row) => row.lifecycle
      }
    }
  ];

  const closeEditor = useCallback(() => {
    setLeaveEditorOpen(false);
    setEditorState({ dirty: false, pending: false });
    setHistorySelection(null);
    // Clear only the detail selection; the host's data refresh must preserve
    // the surrounding collection and navigator state.
    closingEditor.current = true;
    try {
      if (anchor.definitionId) commitAnchor({ ...anchor, definitionId: null }, "replace");
    } finally {
      closingEditor.current = false;
    }
    onEditorClosed?.(changedDefinition.current === detailScope);
    changedDefinition.current = null;
  }, [anchor, commitAnchor, detailScope, onEditorClosed]);
  const requestCloseEditor = () => {
    if (editorState.pending) return;
    if (editorState.dirty) setLeaveEditorOpen(true);
    else closeEditor();
  };
  const loadMoreHistory = async () => {
    if (!historySource || !historyData || !definitionId || !historyPin || historyPending) return;
    const generation = historyGeneration.current;
    const { revisionCursor, timelineCursor } = historyData;
    const query = { ...historyPin, limit: 50 };
    setHistoryPage({ source: historySource, data: historyData, pending: true });
    try {
      const [revisionPage, timelinePage] = await Promise.all([
        revisionCursor ? repository.listDefinitionRevisions(definitionId, { ...query, cursor: revisionCursor }) : null,
        timelineCursor ? repository.listDefinitionTimeline(definitionId, { ...query, cursor: timelineCursor }) : null
      ]);
      if (generation !== historyGeneration.current) return;
      if ((revisionPage?.hasMore && (!revisionPage.nextCursor || revisionPage.nextCursor === revisionCursor)) ||
          (timelinePage?.hasMore && (!timelinePage.nextCursor || timelinePage.nextCursor === timelineCursor))) {
        throw new Error("Invalid history cursor");
      }
      setHistoryPage({ source: historySource, data: {
        revisions: revisionPage ? [...historyData.revisions, ...revisionPage.items] : historyData.revisions,
        revisionCursor: revisionPage?.hasMore ? revisionPage.nextCursor : null,
        timeline: timelinePage ? { ...timelinePage, items: [...historyData.timeline.items, ...timelinePage.items] } : historyData.timeline,
        timelineCursor: timelinePage?.hasMore ? timelinePage.nextCursor : null
      } });
    } catch {
      if (generation === historyGeneration.current) {
        setHistoryPage({ source: historySource, data: historyData, error: "历史记录加载失败，已保留当前记录，请重试。" });
      }
    }
  };
  const editorOpen = Boolean(definition && definitionId);
  const showListEmptyState =
    pageEmptyReason !== null &&
    pageEmptyReason !== "no-review-work" &&
    !(pageEmptyReason === "no-registrations" && subjects.length > 0);

  const detailBody = (
    <CatalogDetailBody
      definition={definition}
      subject={subject}
      revisions={historyData?.revisions ?? []}
      historyOpen={historyOpen}
      onToggleHistory={() => setHistorySelection(historyOpen ? null : detailScope)}
    />
  );

  if (libraryMode && anchor.definitionId) {
    const reading = definition?.id === anchor.definitionId ? definition : null;
    const revision = reading?.currentRevision;
    const constraintLabels: Record<string, string> = { minimum: "最小值", maximum: "最大值", exclusiveMinimum: "大于", exclusiveMaximum: "小于", multipleOf: "倍数", enum: "可选值", minLength: "最短长度", maxLength: "最长长度", pattern: "格式", minItems: "最少项目", maxItems: "最多项目" };
    const constraints = Object.entries(revision?.valueShape.schema ?? {}).filter(([key]) => key in constraintLabels);
    const detailPending = !reading && (navigator.pending || detail.pending);
    const detailError = detail.error ?? navigator.error;
    const activeTab = anchor.tab === "configurations" || anchor.tab === "compare" ? anchor.tab : "definition";
    return <div className="parameter-catalog parameter-library-detail" role="region" aria-label="参数定义目录"
      data-catalog-page="true" data-catalog-state={domainState.kind} data-catalog-release={releaseId ?? ""}
      data-runtime-state={detailError && !reading ? "error" : detailPending ? "loading" : "ready"} aria-busy={detailPending}>
      <div className="parameter-library-detail__top"><button type="button" className="button subtle sm" onClick={() => {
        commitAnchor({ ...anchor, definitionId: null, history: null, tab: null, instance: null, instanceCursor: null, baseline: null, target: null }, "push");
      }}><ArrowLeft size={14} aria-hidden="true" />返回参数库</button>
      </div>
      {detailPending ? <SectionSkeleton label={catalogLoadingLabel} />
        : detailError ? (detailError instanceof WiseEffApiError && detailError.code === "NOT_FOUND"
          ? <p role="status">该定义当前不可用。</p>
          : <SectionError message="定义或修订历史读取失败，请重试。" onRetry={navigator.error !== undefined ? retryWorkspace : retryDetail} />)
          : reading && revision ? <article role="region" aria-label="定义详情" className="parameter-library-detail__body">
            <header className="parameter-library-detail__header">
              <div className="parameter-library-detail__identity">
                <div className="parameter-library-detail__title">
                  <h1 ref={readingHeading} tabIndex={-1}>{revision.displayName || reading.propertyKey}</h1>
                  <Badge variant="secondary">{catalogLifecycleLabel(reading.lifecycle)}</Badge>
                  <Badge variant="outline">{catalogRegistrationLabel(reading.registration.status)}</Badge>
                </div>
                <code className="parameter-library-detail__key">{reading.propertyKey}</code>
                <p className="parameter-library-detail__subject"><span>{catalogSubjectTypeLabel(reading.subject.type)}</span><span>{reading.subject.canonicalName}</span></p>
              </div>
              <p className="parameter-library-detail__release">当前发布 · 修订 #{revision.revisionNumber}</p>
            </header>
            <div className="parameter-library-detail__tabs">
            <ViewSwitch variant="tabs" ariaLabel="参数详情" value={activeTab}
              onValueChange={(value) => commitAnchor({ ...anchor, tab: value === "definition" ? null : value }, "push")}
              items={[{ value: "definition", label: "定义", id: "library-tab-definition", panelId: "library-panel-definition" },
                { value: "configurations", label: "当前项目配置", id: "library-tab-configurations", panelId: "library-panel-configurations" },
                { value: "compare", label: "对比", id: "library-tab-compare", panelId: "library-panel-compare" }]} />
            <span className="parameter-library-detail__hint">视图按当前可查看范围读取，数据可能已变化。</span>
            </div>
            {(["configurations", "compare"] as const).map((tab) => <TabPanel key={tab} className="parameter-library-detail__panel" hidden={activeTab !== tab}
              id={`library-panel-${tab}`} aria-labelledby={`library-tab-${tab}`}>
            {activeTab === tab ? <>
              <div className="parameter-library-detail__section-heading">
                <h2>{tab === "compare" ? "跨项目对比" : "当前项目配置"}</h2>
                <span className="parameter-catalog__muted">{`最新定义修订 #${revision.revisionNumber}`}</span>
              </div>
              {tab === "compare" ? <ProjectComparison key={`${organizationId ?? ""}:${reading.id}`} repository={repository} organizationId={organizationId} definitionId={reading.id}
                baselineId={anchor.baseline} targetId={anchor.target}
                onChange={(update, mode = "push") => commitAnchor({ ...anchor, ...update }, mode)}
                onOpenProject={onOpenProject ? (row) => {
                  const returnPath = `${CATALOG_READ_PAGE_PATH}${serializeCatalogUrlAnchor({ ...anchor, sourceReturn: undefined, createDefinition: false, reviewItemId: null })}`;
                  const params = new URLSearchParams({ project: row.projectId, bindingId: row.bindingId, definitionId: reading.id, configSetId: row.configSetId, returnTo: returnPath });
                  onOpenProject(`/parameters?${params}`);
                } : undefined} /> : <ProjectConfigurations key={`${organizationId ?? ""}:${reading.id}`} repository={repository} organizationId={organizationId} definitionId={reading.id}
                cursor={anchor.instanceCursor} selectedId={anchor.instance}
                projectId={anchor.configProjectId} configSetId={anchor.configSetId} search={anchor.configSearch} includeUnconfigured={anchor.includeUnconfigured}
                onOpenProject={onOpenProject ? (row) => {
                  const returnPath = `${CATALOG_READ_PAGE_PATH}${serializeCatalogUrlAnchor({ ...anchor, sourceReturn: undefined, createDefinition: false, reviewItemId: null })}`;
                  const params = new URLSearchParams({ project: row.projectId, bindingId: row.bindingId, definitionId: reading.id, configSetId: row.configSetId, returnTo: returnPath });
                  onOpenProject(`/parameters?${params}`);
                } : undefined}
                onChange={(update) => commitAnchor({ ...anchor, ...update }, "push")} />}
            </> : null}</TabPanel>)}
            <TabPanel className="parameter-library-detail__panel" hidden={activeTab !== "definition"} id="library-panel-definition" aria-labelledby="library-tab-definition">
            {activeTab === "definition" ? <>
            <div className="parameter-library-detail__definition">
              <div className="parameter-library-detail__reading">
                <section className="parameter-library-detail__section"><h2>定义说明</h2>
                  {reading.recommendedDefinition ? <p>此定义已弃用。推荐使用 <a
                    href={withOrganizationScope(`${CATALOG_READ_PAGE_PATH}?${new URLSearchParams({ definitionId: reading.recommendedDefinition.id })}`, organizationId)}>
                    {reading.recommendedDefinition.displayName}</a>。</p> : null}
                  <DefinitionDocumentation documentation={revision.documentation} empty={<p className="parameter-catalog__muted">该定义暂未提供说明。</p>} />
                </section>
                <section className="parameter-library-detail__section"><h2>{revision.dtsExamples?.length ? "DTS 示例" : "示例"}</h2>
                  <p className="parameter-catalog__muted">仅用于理解定义，并非默认配置或推荐值。</p>
                  {revision.dtsExamples?.length || revision.examples?.length ? <DefinitionExamples {...revision} showLabel={false} /> : <p className="parameter-library-detail__empty">该定义暂未提供示例。</p>}
                </section>
              </div>
            <section className="parameter-library-detail__facts"><h2>类型与约束</h2>
              <dl className="parameter-catalog__dl"><dt>类型</dt><dd>{catalogValueShapeLabel(revision.valueShape.schema as { type?: unknown })}</dd>
                <dt>单位</dt><dd>{revision.unit?.symbol ?? "未说明"}</dd>
                <dt>约束</dt><dd>{constraints.length ? <ul>{constraints.map(([key, value]) => <li key={key}>{constraintLabels[key]}：{JSON.stringify(value)}</li>)}</ul> : "未说明"}</dd></dl>
            </section>
            </div>
            <details className="parameter-library-detail__technical"><summary>技术身份与完整 schema</summary><dl className="parameter-catalog__dl">
              <dt>定义编号</dt><dd>{reading.id}</dd><dt>主体编号</dt><dd>{reading.subject.id}</dd>
              <dt>当前修订</dt><dd>#{revision.revisionNumber} · {revision.id}</dd><dt>发布</dt><dd>{revision.publishedInCatalogReleaseId}</dd>
              <dt>Schema</dt><dd><pre className="parameter-library-code">{JSON.stringify(revision.valueShape, null, 2)}</pre></dd></dl></details>
            <section className="parameter-library-detail__history">
            <div className="parameter-library-detail__section-heading"><div><h2>修订历史</h2><p className="parameter-catalog__muted">查看定义变更与发布记录</p></div>
            <button type="button" className="button subtle" aria-expanded={historyOpen} onClick={() => commitAnchor({ ...anchor, history: historyOpen ? null : "true" }, "push")}>
              {historyOpen ? catalogHistoryCloseLabel : catalogHistoryOpenLabel}
            </button>
            </div>
            {historyOpen ? <div role="region" aria-label={catalogTimelineLabel}>
              {history.pending ? <SectionSkeleton label="正在加载修订历史" /> : history.error !== undefined && historyError ? <SectionError message={historyError} onRetry={retryHistory} /> : <CatalogHistoryBody timeline={historyData?.timeline ?? null}
                revisions={historyData?.revisions ?? []} currentRevision={revision} hasMore={Boolean(historyData?.revisionCursor || historyData?.timelineCursor)}
                pending={historyPending} error={historyError} onLoadMore={() => void loadMoreHistory()} />}
            </div> : null}</section></> : null}</TabPanel>
          </article> : <SectionError message="定义不可用。" onRetry={retryDetail} />}
    </div>;
  }

  return (
    <div
      className={`parameter-catalog${libraryMode ? " parameter-library-list" : ""}`}
      role="region"
      aria-label={catalogPageLabel}
      data-catalog-page="true"
      data-catalog-state={domainState.kind}
      data-catalog-layout={layoutMode}
      data-catalog-release={release?.catalogReleaseId ?? domainState.catalogReleaseId ?? ""}
      data-empty-reason={pageEmptyReason ?? reviewEmptyReason ?? undefined}
      data-writes-enabled={writesEnabled ? "true" : "false"}
    >
      <NavigatorWorkbench
        pageKey={pageKey}
        navigatorLabel={libraryMode ? "模块导航" : catalogNavigatorLabel}
        resizableNavigator
        taskLabel={catalogListLabel}
        toolbar={<>
          {!libraryMode && anchor.sourceReturn ? <a href={anchor.sourceReturn}>{anchor.sourceReturn.startsWith("/parameter-admin/projects/")?"返回项目来源":"返回来源识别"}</a> : null}
          <form
            className="parameter-catalog__search"
            onCompositionStart={() => setSearchComposing(true)}
            onCompositionEnd={() => setSearchComposing(false)}
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <SearchField
              value={searchInput}
              onValueChange={(value) => { searchPending.current = true; setSearchInput(value); }}
              ariaLabel={catalogSearchLabel}
              placeholder={catalogSearchLabel}
            />
          </form>
          {libraryMode ? <>
            <SelectControl ariaLabel="主体类型" size="filter" value={anchor.type ?? ""} onValueChange={(value) => {
              setCursorTrail([]); commitAnchor({ ...anchor, type: value || null, subjectId: null, cursor: null, cursorTrail: null }, "push");
            }} options={[{ value: "", label: "全部类型" }, { value: "driver", label: "驱动" }, { value: "node-type", label: "节点类型" }, { value: "configuration-schema", label: "配置模型" }]} />
            <SelectControl ariaLabel="登记状态" size="filter" value={anchor.registration ?? ""} onValueChange={(value) => {
              setCursorTrail([]); commitAnchor({ ...anchor, registration: value || null, cursor: null, cursorTrail: null }, "push");
            }} options={[{ value: "", label: "全部登记状态" }, { value: "unregistered", label: "未登记" }, { value: "active", label: "已登记" }]} />
            <button type="button" className="button subtle sm" onClick={() => {
              setSearchInput(""); setCursorTrail([]);
              commitAnchor({ ...anchor, q: null, type: null, registration: null, lifecycle: null,
                subjectId: null, moduleNodeId: null, includeRetiredSubjects: false, cursor: null, cursorTrail: null }, "push");
            }}>重置筛选</button>
          </> : null}
          {!libraryMode ? <label className="parameter-catalog__historical-filter">
            <input type="checkbox" checked={includesRetiredSubjects}
              onChange={(event) => toggleRetiredSubjects(event.target.checked)} />
            包含已停用和退役主体
          </label> : null}
          {!libraryMode && (actions.length > 0 || onOpenPendingWork || onImportDefinitions || onPublishClaimedOwners || onOpenUnregisteredSubjects) ? (
            <div className="parameter-catalog__actions" role="group" aria-label="目录动作">
              {onOpenUnregisteredSubjects ? <button type="button" className="button subtle sm" onClick={onOpenUnregisteredSubjects}>待登记主体</button> : null}
              {onImportDefinitions ? <button type="button" className="button subtle sm" onClick={onImportDefinitions}>批量导入定义</button> : null}
              {onPublishClaimedOwners ? <button type="button" className="button subtle sm" onClick={onPublishClaimedOwners}>发布已认领归属</button> : null}
              {onOpenPendingWork ? (
                <button
                  type="button"
                  className="button subtle sm"
                  data-catalog-action="open-pending-work"
                  onClick={onOpenPendingWork}
                >
                  {catalogPendingWorkLabel}
                  {reviewItemCount !== null && reviewItemCount > 0 ? (
                    <span className="parameter-catalog__badge" data-tone="warning">
                      {reviewItemCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {actions.map((action) => (
                <button
                  key={action.action}
                  type="button"
                  className={action.action === "preview-publication" ? "button primary sm" : "button subtle sm"}
                  data-catalog-action={action.action}
                  disabled={!action.enabled}
                  title={action.disabledReason ?? undefined}
                  aria-disabled={!action.enabled}
                  onClick={() =>
                    onAction?.(action.action, {
                      subjectId: workspaceSubject?.id ?? anchor.subjectId,
                      registrationId:
                        workspaceSubject?.registration.status && workspaceSubject.registration.status !== "unregistered"
                          ? workspaceSubject.registration.id
                          : null
                    })
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </>}
        notice={notice || (workspaceMessage && workspaceState.kind !== "ready") ? <>
          {notice}
          {workspaceMessage && workspaceState.kind !== "ready" ? (
            <div
              className="parameter-catalog__banner"
              data-tone={workspaceState.kind === "error" || workspaceState.kind === "conflict" ? "danger" : "warning"}
              data-catalog-banner={workspaceState.kind}
              role={workspaceState.kind === "error" ? "alert" : "status"}
            >
              <p>{workspaceMessage}</p>
              {workspaceState.kind === "error" && definitionList ? <button type="button" className="button subtle sm" onClick={retryWorkspace}>重试</button> : null}
            </div>
          ) : null}
        </> : undefined}
        navigator={!unpublished && navigatorData?.subjects ? <>
          <CatalogModuleNavigator
            searchLabel={libraryMode ? "搜索模块或主体" : undefined}
            defaultExpandDepth={libraryMode ? 1 : 0}
            nodes={navigatorNodes}
            selectedId={anchor.subjectId ? `subject:${anchor.subjectId}` : anchor.moduleNodeId}
            onSelectNode={selectNavigatorNode}
          />
          {anchor.moduleNodeId ? (
            <p className="parameter-catalog__muted" data-catalog-module-scope="true">
              {`已选模块子树 · ${scopedSubjectCount} 个主体`}
            </p>
          ) : null}
        </> : null}
      >

        {(libraryMode ? null : taskContent) ?? (inFlight && !definitionList ? (
          <SectionSkeleton label={catalogLoadingLabel} />
        ) : workspaceState.kind === "error" && !definitionList ? (
          <><SectionError message={statusMessage ?? "目录加载失败，请稍后重试。"} onRetry={retryWorkspace} />
            {libraryMode && anchor.usageProjectId ? <button type="button" className="button subtle sm" onClick={() => commitAnchor({ ...anchor, usageProjectId: null, cursor: null, cursorTrail: null }, "push")}>重置项目使用筛选</button> : null}</>
        ) : unpublished ? (
          <div
            data-catalog-unpublished-workspace="true"
          />
        ) : (
          <div className="parameter-catalog__list" aria-busy={listPending}>
            {detail.error !== undefined ? <SectionError message="定义读取失败，请重试。" onRetry={retryDetail} /> : null}
            <header className="parameter-catalog__list-head">
              <h2 className="parameter-catalog__pane-title">{catalogListLabel}</h2>
              <p
                className="parameter-catalog__count"
                data-catalog-count="true"
                role="status"
                aria-label={catalogResultCountLabel}
              >
                {totalCount === null
                  ? "结果计数不可用"
                  : `共 ${totalCount} 项${listPending ? "" : ` · 第 ${cursorTrail.length + 1} 页`}`}
              </p>
              {listPending && definitionList ? <span className="parameter-catalog__muted">{catalogLoadingLabel}</span> : null}
            </header>
            {libraryMode ? <div className="parameter-library-filters">
              <div className="parameter-library-filter"><span>项目使用</span><SelectControl ariaLabel="项目使用" size="filter" value={anchor.usageProjectId ?? ""} disabled={!projectOptions || projectOptions.organizationId !== organizationId} onValueChange={(value) => commitAnchor({ ...anchor, usageProjectId: value || null, cursor: null, cursorTrail: null }, "push")}
                options={[{ value: "", label: "全部项目" }, ...(projectOptions && projectOptions.organizationId === organizationId ? projectOptions.items.map((project) => ({ value: project.id, label: project.name })) : [])]} /></div>
              {projectOptionsError ? <button type="button" className="button subtle sm" onClick={() => setProjectOptionsRetry((value) => value + 1)}>项目读取失败，重试</button> : null}
              {anchor.usageProjectId ? <button type="button" className="button subtle sm" onClick={() => commitAnchor({ ...anchor, usageProjectId: null, cursor: null, cursorTrail: null }, "push")}>重置使用筛选</button> : null}
              <span className="parameter-catalog__muted">数量为{anchor.usageProjectId ? "所选项目" : "当前可查看范围"}已配置数量</span>
            </div> : null}
            {canPublishDefinitions && onBatchDefinitionCommand ? <>
              {anchor.subjectId && release ? <button type="button" className="button subtle sm" disabled={selectingSubject}
                onClick={() => {
                  const generation = selectionGeneration.current;
                  setSelectingSubject(true);
                  setSelectionError("");
                  void listAllCanonicalPages((query) => repository.listSubjectDefinitions(anchor.subjectId!, query),
                    { catalogReleaseId: release.catalogReleaseId }).then((items) => {
                    if (generation === selectionGeneration.current) setSelectedDefinitions((current) => [
                      ...current.filter((item) => !items.some((row) => row.id === item.id)), ...items
                    ]);
                  }).catch(() => { if (generation === selectionGeneration.current) setSelectionError("无法读取该主体的全部定义，请重试。"); })
                    .finally(() => { if (generation === selectionGeneration.current) setSelectingSubject(false); });
                }}>选中该主体下全部定义</button> : null}
              <DefinitionBatchBar selected={selectedDefinitions} clear={() => setSelectedDefinitions([])} ownerWritable={ownerWritable}
                disabled={inFlight || selectingSubject} releaseId={release?.catalogReleaseId} repository={repository}
                ownerState={workspaceState} onCommand={onBatchDefinitionCommand}
                resetKey={`${organizationId}:${refreshEpoch}:${anchor.subjectId}:${release?.catalogReleaseId}`} />
              {selectionError ? <span role="alert">{selectionError}</span> : null}
            </> : null}
            {showListEmptyState ? (
              <div data-catalog-empty={pageEmptyReason}>
                <SectionEmpty message={catalogEmptyMessage(pageEmptyReason)} />
              </div>
            ) : (
              <DefinitionTable rows={definitions} columns={libraryMode ? [
                { key: "name", header: "名称 / 属性键", headerFilter: columns[4]?.headerFilter, render: (row) => <><strong>{row.currentRevision.displayName || row.propertyKey}</strong><br /><code>{row.propertyKey}</code>{row.lifecycle !== "active" ? <span className="parameter-catalog__badge">{catalogLifecycleLabel(row.lifecycle)}</span> : null}</> },
                { key: "subject", header: "主体 / 类型", headerFilter: columns[3]?.headerFilter, render: (row) => <>{row.subject.canonicalName}<br /><span className="parameter-catalog__muted">{catalogSubjectTypeLabel(row.subject.type)} · <span data-row-status>{catalogRegistrationLabel(row.registration.status)}</span></span></> },
                { key: "documentation", header: "说明", render: (row) => <span className="parameter-library-preview">{definitionDocumentationExcerpt(row.currentRevision.documentation) || "未说明"}</span> },
                { key: "shape", header: "类型 / 单位", render: (row) => <>{catalogValueShapeLabel(row.currentRevision.valueShape.schema as { type?: unknown })} · {row.currentRevision.unit?.symbol ?? "未说明"}</> },
                { key: "configuredProjects", header: "项目数", align: "right", render: (row) => row.configurationSummary?.configuredProjectCount ?? "不可用" },
                { key: "configuredInstances", header: "实例数", align: "right", render: (row) => row.configurationSummary?.configuredInstanceCount ?? "不可用" }
              ] : columns} compact={compactList}
                selectedDefinitionId={definition?.id} onOpen={selectDefinition} canEdit={canEditDefinition}
                ownerStatusLabel={ownerStatusLabel} selectedIds={selectedDefinitions.map((item) => item.id)}
                onSelectionChange={canPublishDefinitions && onBatchDefinitionCommand ? (item, checked) => {
                  setSelectedDefinitions((current) => checked ? [...current.filter((row) => row.id !== item.id), item] : current.filter((row) => row.id !== item.id));
                } : undefined}
                renderActions={(row) => <span className="parameter-catalog__row-actions">
                  {!compactList ? <button type="button" className="button subtle sm"
                    aria-label={`${canEditDefinition(row) ? "编辑" : "查看"} ${row.propertyKey}`}
                    data-catalog-row-action={canEditDefinition(row) ? "edit" : "read"}
                    onClick={() => selectDefinition(row)}>{canEditDefinition(row) ? "编辑" : "查看"}</button> : null}
                  {canDeleteDefinition ? <button type="button" className="button subtle sm"
                    aria-label={`彻底删除 ${row.propertyKey}`} disabled={inFlight || workspaceError !== undefined}
                    onClick={() => setDeletingDefinition(row)}>彻底删除</button> : null}
                  {!compactList && canPublishDefinitions && onDefinitionCommand && !inFlight && workspaceError === undefined && ownerWritable(row) ? (
                    <button type="button" className="button subtle sm"
                      aria-label={`${row.lifecycle === "retired" ? "恢复" : "退役"} ${row.propertyKey}`}
                      data-catalog-row-action={row.lifecycle === "retired" ? "restore-definition" : "retire-definition"}
                      onClick={() => onDefinitionCommand(row.lifecycle === "retired" ? "restore-definition" : "retire-definition", row,
                        deriveCatalogDomainState({ document, subject: subjectsById.get(row.subject.id), inFlight, error: workspaceError }))}>
                      {row.lifecycle === "retired" ? "恢复" : "退役"}
                    </button>) : null}
                </span>}
                emptyState={filterEmptyReason ? <div data-catalog-empty={filterEmptyReason}>
                  <SectionEmpty message={catalogEmptyMessage(filterEmptyReason)} /></div> : undefined} />
            )}
            <nav className="parameter-catalog__pagination" aria-label={catalogPaginationLabel}>
              <label className="parameter-catalog__page-size">
                <span>{catalogPageSizeLabel}</span>
                <SelectControl
                  className="compact-filter-control"
                  value={String(pageSize)}
                  ariaLabel={catalogPageSizeLabel}
                  onValueChange={(value) =>
                    changePageSize(parseCatalogPageSize(value) ?? CATALOG_DEFAULT_PAGE_SIZE)
                  }
                  size="filter"
                  compactControl="pagination"
                  options={CATALOG_PAGE_SIZES.map((size) => ({ value: String(size), label: size }))}
                />
              </label>
              <div className="parameter-catalog__page-buttons">
                <button
                  type="button"
                  className="button subtle"
                  data-compact-control="pagination"
                  aria-label={catalogPreviousPageLabel}
                  disabled={cursorTrail.length === 0 || listPending || inFlight || workspaceError !== undefined}
                  onClick={goToPreviousPage}
                >
                  {catalogPreviousPageLabel}
                </button>
                <button
                  type="button"
                  className="button subtle"
                  data-compact-control="pagination"
                  aria-label={catalogNextPageLabel}
                  disabled={!definitionList?.hasMore || listPending || inFlight || workspaceError !== undefined}
                  onClick={goToNextPage}
                >
                  {catalogNextPageLabel}
                </button>
              </div>
            </nav>
          </div>
        ))}
      </NavigatorWorkbench>

      {!libraryMode && definition && editorOpen ? (
        <ModalDialog
          open={editorOpen}
          onDismiss={editorState.pending ? undefined : requestCloseEditor}
          className="confirm-dialog parameter-catalog__editor-dialog"
        >
          {({ titleId }) => (
            <>
              <div className="parameter-catalog__editor-dialog-head">
                <h2 id={titleId}>{`${definitionActionLabel} ${definition.propertyKey}`.trim()}</h2>
                <button
                  type="button"
                  className="audit-dialog-close-icon"
                  onClick={requestCloseEditor}
                  disabled={editorState.pending}
                  aria-label="关闭"
                >
                  <CircleX size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>

              <div className="confirm-dialog__scroll parameter-catalog__editor-dialog-scroll">
                {!definitionEditable && readOnlyLabel ? (
                  <p className="parameter-catalog__read-only" role="status">{readOnlyLabel}</p>
                ) : !definitionEditable && domainState.kind !== "ready" && statusMessage ? (
                  <p className="parameter-catalog__muted">{statusMessage}</p>
                ) : null}
                {!definitionAuthoringAllowed ? (
                  <p className="parameter-catalog__muted">{definitionAuthoringDisabledReason}</p>
                ) : null}
                {renderDefinitionEditor ? (
                  <div data-definition-editor="true">
                    {renderDefinitionEditor(definition, {
                      domainState,
                      revisions: historyData?.revisions ?? [],
                      timeline: historyData?.timeline ?? null,
                      onHistoryOpenChange: (open) => setHistorySelection(open ? detailScope : null),
                      onClose: requestCloseEditor,
                      onChanged: () => { changedDefinition.current = detailScope; },
                      onEditorStateChange: setEditorState,
                      historyHasMore: Boolean(historyData?.revisionCursor || historyData?.timelineCursor),
                      historyPending,
                      historyError,
                      onLoadMoreHistory: history.error !== undefined ? retryHistory : () => void loadMoreHistory()
                    })}
                  </div>
                ) : (
                  <>
                    <div role="region" aria-label={catalogDetailLabel} data-catalog-detail-region="true">
                      {detailBody}
                    </div>
                    {historyOpen ? (
                      <section aria-label={catalogTimelineLabel} data-catalog-history-region="true">
                        <CatalogHistoryBody
                          timeline={historyData?.timeline ?? null}
                          revisions={historyData?.revisions ?? []}
                          currentRevision={definition.currentRevision}
                          hasMore={Boolean(historyData?.revisionCursor || historyData?.timelineCursor)}
                          pending={historyPending}
                          error={historyError}
                          onLoadMore={history.error !== undefined ? retryHistory : () => void loadMoreHistory()}
                        />
                      </section>
                    ) : null}
                    <div className="dialog-actions">
                      <button type="button" className="button subtle" onClick={closeEditor}>
                        {catalogDetailCloseLabel}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </ModalDialog>
      ) : null}
      {deletingDefinition && canDeleteDefinition ? <DefinitionDeletionDialog
        definition={deletingDefinition} repository={repository} onCancel={() => setDeletingDefinition(null)}
        onDeleted={() => {
          onDefinitionDeleted?.(deletingDefinition.id);
          setDeletingDefinition(null);
          setDeletionEpoch(epoch => epoch + 1);
          setHistorySelection(null);
          setEditorState({ dirty: false, pending: false });
          setCursorTrail([]);
          closingEditor.current = true;
          try {
            commitAnchor({ ...anchor, definitionId: null, catalogReleaseId: null, cursor: null, cursorTrail: null }, "replace");
          } finally { closingEditor.current = false; }
          if (!onEditorClosed) void navigator.reload();
          onEditorClosed?.(true);
        }} /> : null}
      <ConfirmDialog open={leaveEditorOpen} title="放弃未保存的修改？"
        description="当前修改尚未提交，关闭后将丢失。" confirmLabel="放弃修改" cancelLabel="继续编辑"
        onConfirm={() => { if (leaveDecision.current) finishEditorLeave(true); else closeEditor(); }}
        onCancel={() => finishEditorLeave(false)} />
    </div>
  );
}

function CatalogDetailBody({
  definition,
  subject,
  revisions,
  historyOpen,
  onToggleHistory
}: {
  definition: DefinitionItem | null;
  subject: SubjectItem | null;
  revisions: RevisionItem[];
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  if (!definition) {
    return <p className="parameter-catalog__muted">{catalogSelectDefinitionHint}</p>;
  }

  const registration = definition.registration;
  const placement = registration.status === "unregistered" ? null : registration.placement;
  const revision = definition.currentRevision;
  const schema = revision.valueShape.schema as { type?: unknown } | undefined;

  return (
    <div className="parameter-catalog__identity">
      <p className="parameter-catalog__subject-name">{definition.propertyKey}</p>
      <span
        className="parameter-catalog__badge"
        data-tone={definition.lifecycle === "active" ? undefined : "retired"}
      >
        {catalogLifecycleLabel(definition.lifecycle)}
      </span>
      <dl className="parameter-catalog__dl">
        <dt>主体</dt>
        <dd>{definition.subject.canonicalName}</dd>
        <dt>主体编号</dt>
        <dd>{definition.subject.id}</dd>
        <dt>定义编号</dt>
        <dd>{definition.id}</dd>
        <dt>显示名</dt>
        <dd>{revision.displayName || "未设置"}</dd>
        <dt>当前修订</dt>
        <dd>{`修订 #${revision.revisionNumber}`}</dd>
        <dt>纳入发布</dt>
        <dd>{revision.publishedInCatalogReleaseId}</dd>
        <dt>取值形状</dt>
        <dd>{catalogValueShapeLabel(schema)}</dd>
        <dt>单位</dt>
        <dd>{revision.unit?.symbol ?? "未设置"}</dd>
        <dt>说明</dt>
        <dd><DefinitionDocumentation documentation={revision.documentation} empty="无" /></dd>
        {revision.dtsExamples?.length || revision.examples?.length ? <>
          <dt>{revision.dtsExamples?.length ? "DTS 示例" : "示例"}</dt>
          <dd><DefinitionExamples {...revision} showLabel={false} /></dd>
        </> : null}
        <dt>使用</dt>
        <dd>
          {definition.usageSummary.policyCount === null
            ? "策略使用量暂不可用"
            : `策略 ${definition.usageSummary.policyCount}`} · 项目 {definition.usageSummary.projectCount} · 当前值{" "}
          {definition.usageSummary.currentValueCount}
        </dd>
        <dt>登记</dt>
        <dd>
          {catalogRegistrationLabel(registration.status)}
          {registration.status !== "unregistered" && registration.id ? ` · ${registration.id}` : ""}
        </dd>
        <dt>放置</dt>
        <dd>{registration.status === "unregistered" ? "未建立" : placement && !placement.moduleId ? "unset（未分配）" : placement?.displayName ?? "未建立"}</dd>
        {subject?.aliases?.length ? (
          <>
            <dt>别名</dt>
            <dd>{subject.aliases.join("、")}</dd>
          </>
        ) : null}
      </dl>
      <button
        type="button"
        className="button subtle sm"
        data-catalog-history-toggle="true"
        aria-expanded={historyOpen}
        onClick={onToggleHistory}
      >
        {historyOpen ? catalogHistoryCloseLabel : catalogHistoryOpenLabel}
        {revisions.length > 0 ? <span className="parameter-catalog__badge">{revisions.length}</span> : null}
      </button>
    </div>
  );
}

export function CatalogHistoryBody({
  timeline,
  revisions,
  currentRevision,
  hasMore = false,
  pending = false,
  error,
  onLoadMore
}: {
  timeline: CatalogDefinitionTimelineResponse | null;
  revisions: RevisionItem[];
  currentRevision?: RevisionItem;
  hasMore?: boolean;
  pending?: boolean;
  error?: string | null;
  onLoadMore?: () => void;
}) {
  return (
    <div className="parameter-catalog__history-body" aria-busy={pending}>
      <h3 className="parameter-catalog__muted">{catalogHistoryLabel}</h3>
      {revisions.length === 0 ? (
        pending ? <p className="parameter-catalog__muted">正在加载历史…</p>
          : !error ? <p className="parameter-catalog__muted">暂无历史修订。</p> : null
      ) : (
        <ol className="parameter-catalog__revisions">
          {revisions.map((item) => (
            <li key={item.id} className="parameter-catalog__revision">
              <details>
                <summary>{`修订 #${item.revisionNumber} · 查看内容${currentRevision ? "与当前比较" : ""}`}</summary>
                <table className="definition-editor__table" aria-label={`修订 #${item.revisionNumber} 内容比较`}>
                  <thead><tr><th>字段</th><th>该修订</th>{currentRevision ? <th>当前修订</th> : null}</tr></thead>
                  <tbody>{revisionFields(item).map(([label, value], index) => {
                    const currentValue = currentRevision ? revisionFields(currentRevision)[index][1] : undefined;
                    const renderValue = (text: string | undefined) => label === "说明"
                      ? <DefinitionDocumentation documentation={text} empty="无" /> : <pre>{text}</pre>;
                    return <tr key={label} data-changed={currentValue !== undefined && value !== currentValue ? "true" : undefined}>
                      <th scope="row">{label}</th><td>{renderValue(value)}</td>{currentRevision ? <td>{renderValue(currentValue)}</td> : null}
                    </tr>;
                  })}
                    <tr data-changed={currentRevision && JSON.stringify(revisionExamples(item)) !== JSON.stringify(revisionExamples(currentRevision)) ? "true" : undefined}>
                      <th scope="row">示例</th>
                      <td>{renderRevisionExamples(item)}</td>
                      {currentRevision ? <td>{renderRevisionExamples(currentRevision)}</td> : null}
                    </tr>
                  </tbody>
                </table>
                <p className="parameter-catalog__muted">历史修订 <code>{item.id}</code> · 发布记录 <code>{item.publishedInCatalogReleaseId}</code></p>
              </details>
            </li>
          ))}
        </ol>
      )}
      {timeline ? (
        <>
          <h3 className="parameter-catalog__muted">{catalogTimelineLabel}</h3>
          <CatalogTimelineBody timeline={timeline} />
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && !timeline && onLoadMore ? <button type="button" className="button subtle sm" onClick={onLoadMore}>重试</button> : null}
      {hasMore && onLoadMore ? <button type="button" className="button subtle sm" disabled={pending} onClick={onLoadMore}>
        {pending ? "正在加载历史…" : "加载更多历史"}
      </button> : null}
    </div>
  );
}

function revisionFields(revision: RevisionItem): [string, string][] {
  return [
    ["显示名", revision.displayName || "未设置"],
    ["说明", revision.documentation ?? ""],
    ["单位", revision.unit?.symbol ?? "未设置"],
    ["取值约束", JSON.stringify(revision.valueShape.schema, null, 2)]
  ];
}

function revisionExamples(revision: RevisionItem) {
  return revision.dtsExamples?.length ? { dtsExamples: revision.dtsExamples } : { examples: revision.examples ?? [] };
}

function renderRevisionExamples(revision: RevisionItem) {
  return revision.dtsExamples?.length || revision.examples?.length
    ? <DefinitionExamples {...revision} showLabel={Boolean(revision.dtsExamples?.length)} /> : "未说明";
}

function CatalogTimelineBody({ timeline }: { timeline: CatalogDefinitionTimelineResponse | null }) {
  if (!timeline || timeline.items.length === 0) {
    return <p className="parameter-catalog__muted">选择定义后可阅读目录发布事实与授权历史。</p>;
  }

  return (
    <ol className="parameter-catalog__timeline" aria-label={catalogTimelineLabel}>
      {timeline.items.map((item: TimelineItem) => (
        <li key={item.id} className="parameter-catalog__fact">
          <strong>{catalogTimelineKindLabel(item.kind)}</strong>
          <span className="parameter-catalog__muted" title={formatAbsolute(item.publishedAt)}>
            {formatRelativeOrAbsolute(item.publishedAt)}
          </span>
          {item.revisionNumber ? <span>{`修订 #${item.revisionNumber}`}</span> : null}
          {item.catalogReleaseId ? (
            <span className="parameter-catalog__anchor-id">{item.catalogReleaseId}</span>
          ) : null}
          {item.changes?.length ? (
            <span className="parameter-catalog__muted">
              {item.changes.map(catalogTimelineChangeLabel).join("、")}
            </span>
          ) : null}
          {item.summary ? <p>{item.summary}</p> : null}
        </li>
      ))}
    </ol>
  );
}
