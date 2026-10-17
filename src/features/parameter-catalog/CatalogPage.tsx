import { SelectControl } from "@/components/common/SelectControl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleX } from "lucide-react";
import { SearchField } from "@/components/common/SearchField";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";

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
  buildCatalogHref,
  parseCatalogUrlAnchor,
  parseCatalogPageSize,
  readLegacyCatalogBookmark,
  withCatalogReleasePin,
  type CatalogPageSize,
  type CatalogUrlAnchor
} from "@/application/parameter-catalog/urlAnchor";
import type { CatalogActorKind, CatalogAuthorizedAction } from "@/application/parameter-catalog/authority";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { DataTable, type Column } from "@/components/admin";
import { listAllCanonicalPages } from "@/components/parameter-admin-next/CanonicalSubjectPlacementPanel";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { toggleFilterValue } from "@/components/tableFilterUtils";
import type {
  CatalogDefinitionListResponse,
  CatalogDefinitionResponse,
  CatalogDefinitionRevisionResponse,
  CatalogDefinitionTimelineResponse,
  CatalogDocumentResponse,
  CatalogListQuery,
  CatalogReviewItemListResponse,
  CatalogSubjectListResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { useCatalogLayoutMode, type CatalogLayoutMode } from "./catalogLayout";
import { CatalogModuleNavigator } from "./CatalogModuleNavigator";
import type { CatalogNavigatorNode } from "./catalogModuleScope";
import {
  buildCatalogModuleTree,
  filterDefinitionIdsByModule,
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
  catalogDefinitionsLabel,
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

type DefinitionItem = CatalogDefinitionResponse["item"];
type SubjectItem = CatalogSubjectResponse["item"];
type RevisionItem = CatalogDefinitionRevisionResponse["item"];
type TimelineItem = CatalogDefinitionTimelineResponse["items"][number];

export type CatalogPageProps = {
  pageKey?: string;
  refreshEpoch?: number;
  notice?: ReactNode;
  taskContent?: ReactNode;
  repository: ParameterCatalogRepository;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  search?: string;
  onAnchorChange?: (href: string, mode: "push" | "replace") => void;
  onDomainStateChange?: (state: CatalogDomainState) => void;
  onOpenPendingWork?: () => void;
  reviewCountOverride?: number | null;
  /**
   * Editor body for the definition dialog. The page owns the dialog and the
   * loaded history; the organization surface owns the governed write command.
   */
  /** Called when the editor dialog closes, so the host can refresh its evidence. */
  onEditorClosed?: () => void;
  renderDefinitionEditor?: (
    definition: DefinitionItem,
    history: {
      domainState: CatalogDomainState;
      revisions: RevisionItem[];
      timeline: CatalogDefinitionTimelineResponse | null;
      /** Ask the page to load revisions and the timeline. */
      onRequestHistory: () => void;
      /** Close the editor dialog and clear selection from URL. */
      onClose?: () => void;
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
  /**
   * Whether the server's publication surface actually permits entity authoring
   * and publication for this session. The row actions must mirror the server:
   * a visible control that the server would refuse is not a security boundary.
   */
  definitionPublishingAllowed?: boolean;
  definitionAuthoringAllowed?: boolean;
  definitionAuthoringDisabledReason?: string;
  layoutMode?: CatalogLayoutMode;
  organizationId?: string;
  listReviewItems?: (
    organizationId: string,
    query?: CatalogListQuery
  ) => Promise<CatalogReviewItemListResponse>;
};

type CatalogSnapshot = {
  document: Exclude<CatalogDocumentResponse, { item: null }>;
  subjects: CatalogSubjectListResponse;
  definitions: CatalogDefinitionListResponse;
  subject: SubjectItem | null;
  definition: DefinitionItem | null;
  revisions: RevisionItem[];
  timeline: CatalogDefinitionTimelineResponse | null;
  revisionCursor: string | null;
  timelineCursor: string | null;
  review: CatalogReviewItemListResponse | null;
};


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
  pageKey = "catalog-definitions",
  refreshEpoch = 0,
  notice,
  taskContent,
  repository,
  actor,
  sessionPermissions,
  search,
  onAnchorChange,
  onDomainStateChange,
  onAction,
  onOpenPendingWork,
  reviewCountOverride,
  onEditorClosed,
  renderDefinitionEditor,
  onDefinitionCommand,
  definitionPublishingAllowed = false,
  definitionAuthoringAllowed = false,
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
  const catalogReadSearch = useMemo(() => {
    const params = new URLSearchParams(resolvedSearch);
    params.delete("review");
    params.delete("reviewItemId");
    return params.toString();
  }, [resolvedSearch]);
  const anchor = useMemo(() => parseCatalogUrlAnchor(resolvedSearch), [resolvedSearch]);
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
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [error, setError] = useState<unknown>();
  const [unpublished, setUnpublished] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [editorState, setEditorState] = useState({ dirty: false, pending: false });
  const [leaveEditorOpen, setLeaveEditorOpen] = useState(false);
  const closingEditor = useRef(false);
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
  const listReviewItemsRef = useRef(listReviewItems);
  listReviewItemsRef.current = listReviewItems;
  const reviewItemsAvailable = Boolean(listReviewItems);
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
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
      commitAnchor({ ...anchor, q, cursor: null }, "replace");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchComposing, anchor, commitAnchor]);

  const reviewItemCount = reviewCountOverride !== undefined ? reviewCountOverride
    : snapshot?.review?.totalCount ?? (snapshot?.review?.nextCursor ? null : snapshot?.review?.items.length ?? 0);


  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setInFlight(true);
    setUnpublished(false);
    setHistoryPending(false);
    setHistoryError(null);
    try {
      const catalog = repositoryRef.current;
      const currentAnchor = parseCatalogUrlAnchor(catalogReadSearch);
      const legacyBookmark = readLegacyCatalogBookmark(catalogReadSearch);
      if (legacyBookmark && !currentAnchor.definitionId && !currentAnchor.subjectId) {
        const mapped = await catalog.getLegacyIdentifier(legacyBookmark.legacyType, legacyBookmark.legacyId);
        if (generation !== loadGeneration.current) return;
        const target = mapped.item.target;
        commitAnchor(
          {
            ...currentAnchor,
            subjectId: target.kind === "catalog-subject" ? target.id : currentAnchor.subjectId,
            definitionId: target.kind === "parameter-definition" ? target.id : currentAnchor.definitionId
          },
          "replace"
        );
        return;
      }
      const requestedPin = withCatalogReleasePin(undefined, currentAnchor.catalogReleaseId);
      const document = await catalog.getCatalog(requestedPin);
      if (generation !== loadGeneration.current) return;
      if (document.item === null) {
        setSnapshot(null);
        setError(undefined);
        setUnpublished(true);
        return;
      }
      const pin = { catalogReleaseId: document.item.catalogReleaseId };
      const listQuery: CatalogListQuery = {
        ...pin,
        ...(!currentAnchor.includeRetiredSubjects ? { subjectLifecycle: "active" as const } : {}),
        limit: currentAnchor.pageSize ?? CATALOG_DEFAULT_PAGE_SIZE
      };
      if (currentAnchor.q) {
        listQuery.search = currentAnchor.q;
      }
      if (currentAnchor.lifecycle) {
        listQuery.lifecycle = currentAnchor.lifecycle;
      }
      if (currentAnchor.cursor) {
        listQuery.cursor = currentAnchor.cursor;
      }
      if (currentAnchor.moduleNodeId) {
        listQuery.placementModuleId = currentAnchor.moduleNodeId;
      }
      // The navigator needs every organization placement, so the subject
      // inventory is complete while the definition table stays paged.
      let firstSubjectPage: CatalogSubjectListResponse | undefined;
      const inventories = await Promise.all([
        listAllCanonicalPages(async (query) => {
          const page = await catalog.listSubjects(query);
          firstSubjectPage ??= page;
          return page;
        }, { ...pin, limit: 100 }),
        listAllCanonicalPages((query) => catalog.listSubjects(query), { ...pin, lifecycle: "retired", limit: 100 })
      ]);
      const subjectItems = [...new Map(inventories.flat().map((item) => [item.id, item])).values()];
      if (generation !== loadGeneration.current) return;
      // Historical subject bookmarks opt into history without losing their scope.
      if (!currentAnchor.includeRetiredSubjects && subjectItems.some((item) =>
        item.id === currentAnchor.subjectId && item.membership.status === "retired")) {
        delete listQuery.subjectLifecycle;
        commitAnchor({ ...currentAnchor, includeRetiredSubjects: true, cursor: null }, "replace");
      }
      const subjects: CatalogSubjectListResponse = {
        ...firstSubjectPage!, items: subjectItems, totalCount: subjectItems.length, hasMore: false, nextCursor: null
      };
      let subject: SubjectItem | null = null;
      let definition: DefinitionItem | null = null;
      let revisions: RevisionItem[] = [];
      let timeline: CatalogDefinitionTimelineResponse | null = null;
      let revisionCursor: string | null = null;
      let timelineCursor: string | null = null;

      if (currentAnchor.definitionId) {
        const definitionResponse = await catalog.getDefinition(currentAnchor.definitionId, pin);
        definition = definitionResponse.item;
        if (historyOpen) {
          const revisionList = await catalog.listDefinitionRevisions(currentAnchor.definitionId, {
            ...pin,
            limit: 50
          });
          revisions = revisionList.items;
          revisionCursor = revisionList.hasMore ? revisionList.nextCursor : null;
          timeline = await catalog.listDefinitionTimeline(currentAnchor.definitionId, {
            ...pin,
            limit: 50
          });
          timelineCursor = timeline.hasMore ? timeline.nextCursor : null;
        }
      }

      const subjectsEmptyReason = emptyCollectionReason(subjects);
      // Only an explicit navigator selection scopes the collection. Opening a
      // definition keeps the surrounding list and navigation unchanged. The subject
      // route is used rather than the `subjectIds` query so the scope is a
      // scope, not a filter: an empty result reports "no-definitions" instead of
      // "no-filter-match".
      const scopedSubjectId = currentAnchor.subjectId ?? null;
      let definitions: CatalogDefinitionListResponse;
      if (subjectsEmptyReason === "no-registrations" && !currentAnchor.subjectId && !definition) {
        definitions = {
          items: [],
          nextCursor: null,
          catalogReleaseId: document.item.catalogReleaseId,
          totalCount: 0,
          hasMore: false,
          emptyReason: "no-registrations"
        };
      } else if (scopedSubjectId) {
        definitions = await catalog.listSubjectDefinitions(scopedSubjectId, listQuery);
      } else {
        definitions = await catalog.listDefinitions(listQuery);
      }

      const subjectId = definition?.subject.id ?? scopedSubjectId;
      if (subjectId) {
        const subjectResponse = await catalog.getSubject(subjectId, pin);
        subject = subjectResponse.item;
      }

      let review: CatalogReviewItemListResponse | null = null;
      const reviewLoader = listReviewItemsRef.current;
      if (reviewLoader && organizationId) {
        try {
          review = await reviewLoader(organizationId, pin);
        } catch {
          review = null;
        }
      }

      if (generation !== loadGeneration.current) return;
      setSnapshot({
        document,
        subjects,
        definitions,
        subject,
        definition,
        revisions,
        timeline,
        revisionCursor,
        timelineCursor,
        review
      });
      setError(undefined);
    } catch (loadError) {
      if (generation === loadGeneration.current) setError(loadError);
    } finally {
      if (generation === loadGeneration.current) setInFlight(false);
    }
  }, [commitAnchor, historyOpen, organizationId, catalogReadSearch]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load, reviewItemsAvailable, refreshEpoch]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (anchor.catalogReleaseId) {
      return;
    }
    commitAnchor(
      { ...anchor, catalogReleaseId: snapshot.document.item.catalogReleaseId },
      "replace"
    );
  }, [anchor, commitAnchor, snapshot]);

  const collection = snapshot ? pickCollection(snapshot.subjects, snapshot.definitions) : undefined;
  const domainState: CatalogDomainState = deriveCatalogDomainState({
    inFlight,
    previousReleaseId: snapshot?.document.item.catalogReleaseId ?? null,
    document: unpublished ? { item: null, publicationState: "unpublished" } : snapshot?.document,
    subject: snapshot?.subject ?? undefined,
    definition: snapshot?.definition ?? undefined,
    collection: inFlight || error !== undefined ? undefined : collection,
    error
  });
  const writesEnabled = catalogWritesEnabled(domainState);
  const workspaceSubject = anchor.subjectId
    ? snapshot?.subjects.items.find((item) => item.id === anchor.subjectId) : undefined;
  const workspaceState = deriveCatalogDomainState({
    inFlight,
    previousReleaseId: snapshot?.document.item.catalogReleaseId ?? null,
    document: unpublished ? { item: null, publicationState: "unpublished" } : snapshot?.document,
    subject: workspaceSubject,
    collection: inFlight || error !== undefined ? undefined : collection,
    error
  });
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
  const workspaceMessage = workspaceState.kind === "retired" && workspaceState.target === "subject"
    ? "当前主体已退役，参数定义仅供查看。" : catalogStateMessage(workspaceState);
  const readOnlyLabel = domainState.kind !== "retired" ? null
    : domainState.target === "subject" ? "主体已退役 · 只读"
      : domainState.target === "registration" ? "登记已停用 · 只读"
        : snapshot?.definition?.lifecycle === "deprecated" ? "定义已弃用 · 只读" : "定义已退役 · 只读";
  const reviewEmptyReason = emptyCollectionReason(snapshot?.review ?? null);
  const listEmptyReason = emptyCollectionReason(snapshot?.definitions ?? null);
  const definitions = snapshot?.definitions.items ?? [];
  const subjects = snapshot?.subjects.items ?? [];
  const includesRetiredSubjects = Boolean(anchor.includeRetiredSubjects || subjects.some((item) =>
    item.id === anchor.subjectId && item.membership.status === "retired"));
  const navigationSubjects = useMemo(() => includesRetiredSubjects ? subjects
    : subjects.filter((item) => item.membership.status === "active"), [subjects, includesRetiredSubjects]);
  const subjectsById = useMemo(() => new Map([
    ...subjects.map((item) => [item.id, item] as const),
    ...(snapshot?.subject ? [[snapshot.subject.id, snapshot.subject] as const] : [])
  ]), [snapshot]);
  const ownerWritable = (item: DefinitionItem) => {
    const owner = subjectsById.get(item.subject.id);
    return owner?.membership.status === "active" && owner.registration.status !== "retired" &&
      item.registration.status !== "retired";
  };
  const canEditDefinition = (item: DefinitionItem) => definitionAuthoringAllowed &&
    Boolean(renderDefinitionEditor) && !inFlight && error === undefined && item.lifecycle === "active" && ownerWritable(item);
  const definitionEditable = snapshot?.definition ? canEditDefinition(snapshot.definition) : false;
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
    () => buildCatalogModuleTree(navigationSubjects, describeSubject),
    [navigationSubjects, describeSubject]
  );
  // Client scope mirrors the server traversal so visible rows always agree with
  // the reported count for the same query.
  const visibleDefinitions = useMemo(() => {
    if (!anchor.moduleNodeId) {
      return definitions;
    }
    const scoped = filterDefinitionIdsByModule(subjects, anchor.moduleNodeId);
    return definitions.filter((item) => scoped.has(item.subject.id));
  }, [anchor.moduleNodeId, definitions, subjects]);
  const totalCount = snapshot?.definitions.totalCount ?? null;
  const scopedSubjectCount = anchor.moduleNodeId
    ? subjectIdsForModule(navigationSubjects, anchor.moduleNodeId).size
    : navigationSubjects.length;
  const filterEmptyReason: CatalogEmptyReason | null =
    visibleDefinitions.length === 0 &&
    (activeLifecycles.length > 0 || Boolean(anchor.q) || Boolean(anchor.moduleNodeId))
      ? "no-filter-match"
      : listEmptyReason;
  const compactList = layoutMode === "mobile";
  const noOrgRegistrations =
    !anchor.subjectId &&
    subjects.length > 0 &&
    subjects.every((item) => item.registration.status === "unregistered");
  const pageEmptyReason =
    domainState.kind === "empty"
      ? domainState.emptyReason
      : filterEmptyReason && visibleDefinitions.length === 0
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
    commitAnchor({ ...anchor, subjectId, definitionId: null, cursor: null }, "push");
    setInspectorOpen(false);
  };

  const selectDefinition = (item: DefinitionItem) => {
    commitAnchor(
      {
        ...anchor,
        definitionId: item.id
      },
      "push"
    );
    setHistoryOpen(false);
    setInspectorOpen(true);
  };

  const submitSearch = () => {
    if (searchComposing) return;
    searchPending.current = false;
    const q = searchInput.trim() || null;
    if (q === anchor.q) return;
    setCursorTrail([]);
    commitAnchor({ ...anchor, q, cursor: null }, "replace");
  };

  const toggleLifecycleFilter = (value: string) => {
    const next = toggleFilterValue(activeLifecycles, value);
    setCursorTrail([]);
    commitAnchor(
      { ...anchor, lifecycle: next.length > 0 ? [...next].sort().join(",") : null, cursor: null },
      "push"
    );
  };

  const clearLifecycleFilter = () => {
    setCursorTrail([]);
    commitAnchor({ ...anchor, lifecycle: null, cursor: null }, "push");
  };

  const toggleRetiredSubjects = (include: boolean) => {
    setCursorTrail([]);
    const retiredSelection = subjects.some((item) => item.id === anchor.subjectId && item.membership.status === "retired");
    commitAnchor({ ...anchor, includeRetiredSubjects: include, cursor: null,
      subjectId: !include && retiredSelection ? null : anchor.subjectId, definitionId: null }, "push");
  };

  const changePageSize = (size: CatalogPageSize) => {
    setCursorTrail([]);
    commitAnchor({ ...anchor, pageSize: size, cursor: null }, "push");
  };

  const goToNextPage = () => {
    const next = snapshot?.definitions.nextCursor ?? null;
    if (!next) return;
    setCursorTrail((trail) => [...trail, anchor.cursor ?? ""]);
    commitAnchor({ ...anchor, cursor: next }, "push");
  };

  const goToPreviousPage = () => {
    if (cursorTrail.length === 0) return;
    const trail = [...cursorTrail];
    const previous = trail.pop() ?? "";
    setCursorTrail(trail);
    commitAnchor({ ...anchor, cursor: previous || null }, "push");
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
          : row.registration.placement?.displayName ?? "未建立",
      sortAccessor: (row) =>
        row.registration.status === "unregistered" ? "" : row.registration.placement?.displayName ?? "",
      headerFilter: {
        label: "所属模块",
        groupLabel: "所属模块筛选",
        values: moduleFilterValues(subjects),
        selectedValues: anchor.moduleNodeId ? [anchor.moduleNodeId] : [],
        renderLabel: (value) => moduleFilterLabel(subjects, value),
        onToggle: (value) => selectModuleNode(value === anchor.moduleNodeId ? null : value),
        onClear: () => selectModuleNode(null),
        // visibleDefinitions already applies the selected module's full subtree.
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
        values: ["active", "deprecated", "retired"],
        selectedValues: activeLifecycles,
        renderLabel: catalogLifecycleLabel,
        onToggle: toggleLifecycleFilter,
        onClear: clearLifecycleFilter,
        getValue: (row) => row.lifecycle
      }
    }
  ];

  const definition = snapshot?.definition ?? null;
  const closeEditor = useCallback(() => {
    setLeaveEditorOpen(false);
    setEditorState({ dirty: false, pending: false });
    setInspectorOpen(false);
    // Clear only the detail selection; the host's data refresh must preserve
    // the surrounding collection and navigator state.
    closingEditor.current = true;
    try {
      if (anchor.definitionId) commitAnchor({ ...anchor, definitionId: null }, "replace");
    } finally {
      closingEditor.current = false;
    }
    onEditorClosed?.();
  }, [anchor, commitAnchor, onEditorClosed]);
  const requestCloseEditor = () => {
    if (editorState.pending) return;
    if (editorState.dirty) setLeaveEditorOpen(true);
    else closeEditor();
  };
  const loadMoreHistory = async () => {
    if (!snapshot?.definition || historyPending) return;
    const source = snapshot;
    const generation = loadGeneration.current;
    const selectedId = source.definition!.id;
    const pin = { catalogReleaseId: source.document.item.catalogReleaseId, limit: 50 };
    setHistoryPending(true);
    setHistoryError(null);
    try {
      const [revisionPage, timelinePage] = await Promise.all([
        source.revisionCursor ? repository.listDefinitionRevisions(selectedId, { ...pin, cursor: source.revisionCursor }) : null,
        source.timelineCursor ? repository.listDefinitionTimeline(selectedId, { ...pin, cursor: source.timelineCursor }) : null
      ]);
      if (generation !== loadGeneration.current) return;
      if ((revisionPage?.hasMore && (!revisionPage.nextCursor || revisionPage.nextCursor === source.revisionCursor)) ||
          (timelinePage?.hasMore && (!timelinePage.nextCursor || timelinePage.nextCursor === source.timelineCursor))) {
        throw new Error("Invalid history cursor");
      }
      setSnapshot((current) => current?.definition?.id !== selectedId ||
        current.document.item.catalogReleaseId !== source.document.item.catalogReleaseId ? current : {
        ...current,
        revisions: revisionPage ? [...current.revisions, ...revisionPage.items] : current.revisions,
        revisionCursor: revisionPage?.hasMore ? revisionPage.nextCursor : null,
        timeline: timelinePage ? { ...timelinePage, items: [...(current.timeline?.items ?? []), ...timelinePage.items] } : current.timeline,
        timelineCursor: timelinePage?.hasMore ? timelinePage.nextCursor : null
      });
    } catch {
      if (generation === loadGeneration.current) setHistoryError("历史记录加载失败，已保留当前记录，请重试。");
    } finally {
      if (generation === loadGeneration.current) setHistoryPending(false);
    }
  };
  /**
   * A deep link (and Back/Forward onto one) opens the editor for the definition
   * it names; closing it clears that selection from the URL.
   */
  const editorOpen =
    definition !== null &&
    (inspectorOpen ||
      (Boolean(anchor.definitionId) && snapshot?.definition?.id === anchor.definitionId));
  const subject = snapshot?.subject ?? null;
  const release = snapshot?.document.item;
  const showListEmptyState =
    pageEmptyReason !== null &&
    pageEmptyReason !== "no-review-work" &&
    !(pageEmptyReason === "no-registrations" && subjects.length > 0);

  const detailBody = (
    <CatalogDetailBody
      definition={definition}
      subject={subject}
      revisions={snapshot?.revisions ?? []}
      historyOpen={historyOpen}
      onToggleHistory={() => setHistoryOpen((value) => !value)}
    />
  );

  return (
    <div
      className="parameter-catalog"
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
        navigatorLabel={catalogNavigatorLabel}
        taskLabel={catalogListLabel}
        toolbar={<>
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
          <label className="parameter-catalog__historical-filter">
            <input type="checkbox" checked={includesRetiredSubjects}
              onChange={(event) => toggleRetiredSubjects(event.target.checked)} />
            包含退役主体
          </label>
          {actions.length > 0 || onOpenPendingWork ? (
            <div className="parameter-catalog__actions" role="group" aria-label="目录动作">
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
            </div>
          ) : null}
        </> : undefined}
        navigator={!unpublished && snapshot ? <>
          <CatalogModuleNavigator
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

        {taskContent ?? (inFlight && !snapshot ? (
          <SectionSkeleton label={catalogLoadingLabel} />
        ) : domainState.kind === "error" && !snapshot ? (
          <SectionError message={statusMessage ?? "目录加载失败，请稍后重试。"} onRetry={() => void load()} />
        ) : unpublished ? (
          <div
            data-catalog-unpublished-workspace="true"
          />
        ) : (
          <div className="parameter-catalog__list">
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
                  : `共 ${totalCount} 项 · 第 ${cursorTrail.length + 1} 页`}
              </p>
            </header>
            {showListEmptyState ? (
              <div data-catalog-empty={pageEmptyReason}>
                <SectionEmpty message={catalogEmptyMessage(pageEmptyReason)} />
              </div>
            ) : compactList ? (
              <div className="parameter-catalog__cards parameter-catalog__table-wrap--mobile">
                {visibleDefinitions.map((item) => (
                  <div key={item.id} className="parameter-catalog__card-row">
                    <button
                      type="button"
                      className="parameter-catalog__card"
                      aria-pressed={item.id === definition?.id}
                      onClick={() => selectDefinition(item)}
                    >
                      <code className="parameter-catalog__subject-name">{item.propertyKey}</code>
                      <span>{item.currentRevision.displayName || "—"}</span>
                      <span className="parameter-catalog__subject-meta">
                        {item.subject.canonicalName} · {catalogLifecycleLabel(item.lifecycle)}{ownerStatusLabel(item) ? ` · ${ownerStatusLabel(item)}` : ""}
                      </span>
                    </button>
                    {/* Narrow screens keep the same editor entry as the desktop table. */}
                    <button
                      type="button"
                      className="button subtle sm"
                      aria-label={`${canEditDefinition(item) ? "编辑" : "查看"} ${item.propertyKey}`}
                      data-catalog-row-action={canEditDefinition(item) ? "edit" : "read"}
                      onClick={() => selectDefinition(item)}
                    >
                      {canEditDefinition(item) ? "编辑" : "查看"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="parameter-catalog__table-wrap--desktop">
                <DataTable
                  rows={visibleDefinitions}
                  rowKey={(row) => row.id}
                  columns={columns}
                  tableClassName="parameter-catalog__table"
                  selectedRowKey={definition?.id}
                  onRowClick={selectDefinition}
                  aria-label={catalogDefinitionsLabel}
                  pageSize={Math.max(visibleDefinitions.length, 1)}
                  renderRowActions={(row) => (
                    <span className="parameter-catalog__row-actions">
                      <button
                        type="button"
                        className="button subtle sm"
                        aria-label={`${canEditDefinition(row) ? "编辑" : "查看"} ${row.propertyKey}`}
                        data-catalog-row-action={canEditDefinition(row) ? "edit" : "read"}
                        onClick={() => selectDefinition(row)}
                      >
                        {canEditDefinition(row) ? "编辑" : "查看"}
                      </button>
                      {definitionPublishingAllowed && onDefinitionCommand && !inFlight && error === undefined && ownerWritable(row) ? (
                        <button
                          type="button"
                          className="button subtle sm"
                          aria-label={`${row.lifecycle === "retired" ? "恢复" : "弃用"} ${row.propertyKey}`}
                          data-catalog-row-action={
                            row.lifecycle === "retired" ? "restore-definition" : "retire-definition"
                          }
                          onClick={() =>
                            onDefinitionCommand(
                              row.lifecycle === "retired" ? "restore-definition" : "retire-definition",
                              row,
                              deriveCatalogDomainState({
                                document: snapshot?.document,
                                subject: subjectsById.get(row.subject.id),
                                inFlight,
                                error
                              })
                            )
                          }
                        >
                          {row.lifecycle === "retired" ? "恢复" : "弃用"}
                        </button>
                      ) : null}
                    </span>
                  )}
                  emptyState={
                    filterEmptyReason ? (
                      <div data-catalog-empty={filterEmptyReason}>
                        <SectionEmpty message={catalogEmptyMessage(filterEmptyReason)} />
                      </div>
                    ) : undefined
                  }
                />
              </div>
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
                  disabled={cursorTrail.length === 0 || inFlight}
                  onClick={goToPreviousPage}
                >
                  {catalogPreviousPageLabel}
                </button>
                <button
                  type="button"
                  className="button subtle"
                  data-compact-control="pagination"
                  aria-label={catalogNextPageLabel}
                  disabled={!snapshot?.definitions.hasMore || inFlight}
                  onClick={goToNextPage}
                >
                  {catalogNextPageLabel}
                </button>
              </div>
            </nav>
          </div>
        ))}
      </NavigatorWorkbench>

      {definition && editorOpen ? (
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
                      revisions: snapshot?.revisions ?? [],
                      timeline: snapshot?.timeline ?? null,
                      onRequestHistory: () => setHistoryOpen(true),
                      onClose: requestCloseEditor,
                      onEditorStateChange: setEditorState,
                      historyHasMore: Boolean(snapshot?.revisionCursor || snapshot?.timelineCursor),
                      historyPending,
                      historyError,
                      onLoadMoreHistory: () => void loadMoreHistory()
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
                          timeline={snapshot?.timeline ?? null}
                          revisions={snapshot?.revisions ?? []}
                          currentRevision={definition.currentRevision}
                          hasMore={Boolean(snapshot?.revisionCursor || snapshot?.timelineCursor)}
                          pending={historyPending}
                          error={historyError}
                          onLoadMore={() => void loadMoreHistory()}
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
      <ConfirmDialog open={leaveEditorOpen} title="放弃未保存的修改？"
        description="当前修改尚未提交，关闭后将丢失。" confirmLabel="放弃修改" cancelLabel="继续编辑"
        onConfirm={() => { if (leaveDecision.current) finishEditorLeave(true); else closeEditor(); }}
        onCancel={() => finishEditorLeave(false)} />
    </div>
  );
}

function moduleFilterValues(subjects: readonly SubjectItem[]): string[] {
  const ids = new Set<string>();
  for (const subject of subjects) {
    const placement =
      subject.registration.status === "unregistered" ? undefined : subject.registration.placement;
    if (placement?.moduleId) {
      ids.add(placement.moduleId);
    }
  }
  return [...ids];
}

function moduleFilterLabel(subjects: readonly SubjectItem[], moduleId: string): string {
  for (const subject of subjects) {
    const placement =
      subject.registration.status === "unregistered" ? undefined : subject.registration.placement;
    if (placement?.moduleId === moduleId) {
      return placement.displayName;
    }
  }
  return moduleId;
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
        <dd>{revision.documentation ?? "无"}</dd>
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
        <dd>{registration.status === "unregistered" ? "未建立" : placement?.displayName ?? "未建立"}</dd>
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
    <div className="parameter-catalog__history-body">
      <h3 className="parameter-catalog__muted">{catalogHistoryLabel}</h3>
      {revisions.length === 0 ? (
        <p className="parameter-catalog__muted">暂无历史修订。</p>
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
                    return <tr key={label} data-changed={currentValue !== undefined && value !== currentValue ? "true" : undefined}>
                      <th scope="row">{label}</th><td><pre>{value}</pre></td>{currentRevision ? <td><pre>{currentValue}</pre></td> : null}
                    </tr>;
                  })}</tbody>
                </table>
                <p className="parameter-catalog__muted">发布记录 <code>{item.publishedInCatalogReleaseId}</code></p>
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
      {hasMore && onLoadMore ? <button type="button" className="button subtle sm" disabled={pending} onClick={onLoadMore}>
        {pending ? "正在加载历史…" : "加载更多历史"}
      </button> : null}
    </div>
  );
}

function revisionFields(revision: RevisionItem): [string, string][] {
  return [
    ["显示名", revision.displayName || "未设置"],
    ["说明", revision.documentation || "无"],
    ["单位", revision.unit?.symbol ?? "未设置"],
    ["取值约束", JSON.stringify(revision.valueShape.schema, null, 2)]
  ];
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
