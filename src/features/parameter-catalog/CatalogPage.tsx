import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { DataTable, type Column } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { WorkbenchSheet } from "@/components/WorkbenchSheet";
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
  catalogDefinitionsLabel,
  catalogDetailCloseLabel,
  catalogDetailLabel,
  catalogHistoryCloseLabel,
  catalogHistoryLabel,
  catalogHistoryOpenLabel,
  catalogListLabel,
  catalogLoadingLabel,
  catalogModuleScopeClear,
  catalogModuleScopeHint,
  catalogNavigatorLabel,
  catalogNextPageLabel,
  catalogPageLabel,
  catalogPageSizeLabel,
  catalogPaginationLabel,
  catalogPendingWorkLabel,
  catalogPreviousPageLabel,
  catalogReleaseLabel,
  catalogResultCountLabel,
  catalogSearchClearLabel,
  catalogSearchLabel,
  catalogSearchSubmitLabel,
  catalogSelectDefinitionHint,
  catalogSheetTabs,
  catalogStateBadges,
  catalogTimelineLabel
} from "./copy";
import "./parameter-catalog.css";

type DefinitionItem = CatalogDefinitionResponse["item"];
type SubjectItem = CatalogSubjectResponse["item"];
type RevisionItem = CatalogDefinitionRevisionResponse["item"];
type TimelineItem = CatalogDefinitionTimelineResponse["items"][number];

export type CatalogPageProps = {
  repository: ParameterCatalogRepository;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  search?: string;
  onAnchorChange?: (href: string, mode: "push" | "replace") => void;
  onDomainStateChange?: (state: CatalogDomainState) => void;
  onOpenPendingWork?: () => void;
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
    definition: DefinitionItem
  ) => void;
  /**
   * Whether the server's publication surface actually permits entity authoring
   * and publication for this session. The row actions must mirror the server:
   * a visible control that the server would refuse is not a security boundary.
   */
  definitionAuthoringAllowed?: boolean;
  definitionPublishingAllowed?: boolean;
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
  review: CatalogReviewItemListResponse | null;
};

type InspectorTab = "detail" | "history";

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
  repository,
  actor,
  sessionPermissions,
  search,
  onAnchorChange,
  onDomainStateChange,
  onAction,
  onOpenPendingWork,
  onDefinitionCommand,
  definitionAuthoringAllowed = false,
  definitionPublishingAllowed = false,
  layoutMode: layoutOverride,
  organizationId,
  listReviewItems
}: CatalogPageProps) {
  const layoutMode = useCatalogLayoutMode(layoutOverride);
  const [internalSearch, setInternalSearch] = useState(
    () => search ?? (typeof window === "undefined" ? "" : window.location.search)
  );
  const resolvedSearch = search ?? internalSearch;
  const anchor = useMemo(() => parseCatalogUrlAnchor(resolvedSearch), [resolvedSearch]);
  const pageSize: CatalogPageSize =
    parseCatalogPageSize(anchor.pageSize === null ? null : String(anchor.pageSize)) ??
    CATALOG_DEFAULT_PAGE_SIZE;
  const activeLifecycles = useMemo(
    () => (anchor.lifecycle ? anchor.lifecycle.split(",").filter(Boolean) : []),
    [anchor.lifecycle]
  );

  const [searchInput, setSearchInput] = useState(anchor.q ?? "");
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [error, setError] = useState<unknown>();
  const [unpublished, setUnpublished] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("detail");
  const historyOpen = inspectorTab === "history";
  /** Cursors already traversed, so Previous is exact rather than guessed. */
  const [cursorTrail, setCursorTrail] = useState<readonly string[]>([]);
  const listReviewItemsRef = useRef(listReviewItems);
  listReviewItemsRef.current = listReviewItems;
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  const commitAnchor = useCallback(
    (next: CatalogUrlAnchor, mode: "push" | "replace") => {
      const href = buildCatalogHref(next);
      const nextSearch = searchFromHref(href);
      if (onAnchorChange) {
        onAnchorChange(href, mode);
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
    [onAnchorChange]
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
    setSearchInput(anchor.q ?? "");
  }, [anchor.q]);

  const reviewItemCount = snapshot?.review?.items.length ?? 0;


  const load = useCallback(async () => {
    setInFlight(true);
    setUnpublished(false);
    try {
      const catalog = repositoryRef.current;
      const currentAnchor = parseCatalogUrlAnchor(resolvedSearch);
      const legacyBookmark = readLegacyCatalogBookmark(resolvedSearch);
      if (legacyBookmark && !currentAnchor.definitionId && !currentAnchor.subjectId) {
        const mapped = await catalog.getLegacyIdentifier(legacyBookmark.legacyType, legacyBookmark.legacyId);
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
      const pin = withCatalogReleasePin(undefined, currentAnchor.catalogReleaseId);
      const listQuery: CatalogListQuery = {
        ...pin,
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
      const document = await catalog.getCatalog(pin);
      if (document.item === null) {
        setSnapshot(null);
        setError(undefined);
        setUnpublished(true);
        return;
      }
      // The navigator needs every organization placement, so the subject
      // inventory is complete while the definition table stays paged.
      const subjects = await catalog.listSubjects({ ...pin, limit: 100 });
      let subject: SubjectItem | null = null;
      let definition: DefinitionItem | null = null;
      let revisions: RevisionItem[] = [];
      let timeline: CatalogDefinitionTimelineResponse | null = null;

      if (currentAnchor.definitionId) {
        const definitionResponse = await catalog.getDefinition(currentAnchor.definitionId, pin);
        definition = definitionResponse.item;
        if (historyOpen) {
          const revisionList = await catalog.listDefinitionRevisions(currentAnchor.definitionId, {
            ...pin,
            limit: 50
          });
          revisions = revisionList.items;
          timeline = await catalog.listDefinitionTimeline(currentAnchor.definitionId, {
            ...pin,
            limit: 50
          });
        }
      }

      const subjectsEmptyReason = emptyCollectionReason(subjects);
      // A selected subject (from the navigator) or a selected definition scopes
      // the table to that subject server-side, before pagination. The subject
      // route is used rather than the `subjectIds` query so the scope is a
      // scope, not a filter: an empty result reports "no-definitions" instead of
      // "no-filter-match".
      const scopedSubjectId = currentAnchor.subjectId ?? definition?.subject.id ?? null;
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

      const subjectId = scopedSubjectId;
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

      setSnapshot({
        document,
        subjects,
        definitions,
        subject,
        definition,
        revisions,
        timeline,
        review
      });
      setError(undefined);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setInFlight(false);
    }
  }, [commitAnchor, historyOpen, organizationId, resolvedSearch]);

  /** A deep link opens the detail dialog once for the definition it names. */
  const autoOpenedDefinitionId = useRef<string | null>(null);
  useEffect(() => {
    const selectedId = snapshot?.definition?.id ?? null;
    if (!anchor.definitionId || !selectedId || selectedId !== anchor.definitionId) return;
    if (autoOpenedDefinitionId.current === selectedId) return;
    autoOpenedDefinitionId.current = selectedId;
    setInspectorTab("detail");
    setInspectorOpen(true);
  }, [anchor.definitionId, snapshot?.definition?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  useEffect(() => {
    if (layoutMode === "desktop") {
      setInspectorOpen(false);
      return;
    }
    if (anchor.definitionId) {
      setInspectorOpen(true);
    }
  }, [anchor.definitionId, layoutMode]);

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
  /**
   * Actions that no longer have a surface on this page are not offered as toolbar
   * buttons: review work is processed through the single pending-work dialog, and
   * the definition-proposal panel was removed from the workspace.
   */
  const retiredActions = new Set<string>([
    "resolve-review-item",
    "create-proposal",
    "submit-proposal",
    "withdraw-proposal"
  ]);
  const actions = catalogActionAffordances(actor, domainState, sessionPermissions).filter(
    (action) => !retiredActions.has(action.action)
  );
  const onDomainStateChangeRef = useRef(onDomainStateChange);
  onDomainStateChangeRef.current = onDomainStateChange;
  const lastNotifiedDomainState = useRef("");

  useEffect(() => {
    const emptyReason = domainState.kind === "empty" ? domainState.emptyReason : "";
    const key = `${domainState.kind}:${domainState.catalogReleaseId ?? ""}:${emptyReason}`;
    if (lastNotifiedDomainState.current === key) {
      return;
    }
    lastNotifiedDomainState.current = key;
    onDomainStateChangeRef.current?.(domainState);
  }, [domainState]);

  const statusMessage = catalogStateMessage(domainState);
  const reviewEmptyReason = emptyCollectionReason(snapshot?.review ?? null);
  const listEmptyReason = emptyCollectionReason(snapshot?.definitions ?? null);
  const definitions = snapshot?.definitions.items ?? [];
  const subjects = snapshot?.subjects.items ?? [];
  const describeSubject = useCallback(
    (item: (typeof subjects)[number]) =>
      `${catalogSubjectTypeLabel(item.type)} · ${catalogRegistrationLabel(item.registration.status)}`,
    []
  );
  const navigatorNodes = useMemo(
    () => buildCatalogModuleTree(subjects, describeSubject),
    [subjects, describeSubject]
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
    ? subjectIdsForModule(subjects, anchor.moduleNodeId).size
    : subjects.length;
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
      selectSubject(node.subjectId);
      return;
    }
    selectModuleNode(node.id);
  };

  const selectSubject = (subjectId: string) => {
    commitAnchor({ ...anchor, subjectId, definitionId: null, cursor: null }, "push");
    setInspectorOpen(false);
  };

  const selectDefinition = (item: DefinitionItem) => {
    commitAnchor(
      {
        ...anchor,
        subjectId: item.subject.id || anchor.subjectId,
        definitionId: item.id
      },
      "push"
    );
    setInspectorTab("detail");
    setInspectorOpen(true);
  };

  const submitSearch = () => {
    setCursorTrail([]);
    commitAnchor({ ...anchor, q: searchInput.trim() || null, cursor: null }, "push");
  };

  const clearSearch = () => {
    setSearchInput("");
    setCursorTrail([]);
    commitAnchor({ ...anchor, q: null, cursor: null }, "replace");
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
      render: (row) => row.propertyKey,
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
      render: (row) => row.subject.canonicalName,
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
        getValue: (row) =>
          row.registration.status === "unregistered"
            ? ""
            : row.registration.placement?.moduleId ?? ""
      }
    },
    {
      key: "lifecycle",
      header: "生命周期",
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
      state={domainState}
      revisions={snapshot?.revisions ?? []}
      historyOpen={historyOpen}
      onToggleHistory={() => setInspectorTab((tab) => (tab === "history" ? "detail" : "history"))}
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
      <section className="parameter-catalog__anchor" aria-label={catalogReleaseLabel}>
        <span className="parameter-catalog__anchor-label">{catalogReleaseLabel}</span>
        <span className="parameter-catalog__anchor-value">{release?.releaseName ?? "尚未捕获"}</span>
        {release ? (
          <span className="parameter-catalog__anchor-id">{release.catalogReleaseId}</span>
        ) : null}
        <span className="parameter-catalog__badge" data-tone={domainState.kind === "ready" ? undefined : "warning"}>
          {catalogStateBadges[domainState.kind]}
        </span>
      </section>

      <div className="parameter-catalog__toolbar">
        <form
          className="parameter-catalog__search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label={catalogSearchLabel}
            placeholder={catalogSearchLabel}
          />
          <button type="submit" className="button sm">
            {catalogSearchSubmitLabel}
          </button>
          {anchor.q ? (
            <button type="button" className="button ghost sm" onClick={clearSearch}>
              {catalogSearchClearLabel}
            </button>
          ) : null}
        </form>
        <div className="parameter-catalog__actions" aria-label="目录动作">
          {actions.map((action) => (
            <button
              key={action.action}
              type="button"
              className="button sm"
              data-catalog-action={action.action}
              disabled={!action.enabled}
              title={action.disabledReason ?? undefined}
              aria-disabled={!action.enabled}
              onClick={() =>
                onAction?.(action.action, {
                  subjectId: subject?.id ?? anchor.subjectId,
                  registrationId:
                    subject?.registration.status && subject.registration.status !== "unregistered"
                      ? subject.registration.id
                      : null
                })
              }
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className="button subtle sm"
            data-catalog-action="open-pending-work"
            onClick={() => onOpenPendingWork?.()}
          >
            {catalogPendingWorkLabel}
            {reviewItemCount > 0 ? (
              <span className="parameter-catalog__badge" data-tone="warning">
                {reviewItemCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {statusMessage && domainState.kind !== "ready" ? (
        <div
          className="parameter-catalog__banner"
          data-tone={domainState.kind === "error" || domainState.kind === "conflict" ? "danger" : "warning"}
          data-catalog-banner={domainState.kind}
          role={domainState.kind === "error" ? "alert" : "status"}
        >
          <p>{statusMessage}</p>
        </div>
      ) : null}

      {inFlight && !snapshot ? (
        <SectionSkeleton label={catalogLoadingLabel} />
      ) : domainState.kind === "error" && !snapshot ? (
        <SectionError message={statusMessage ?? "目录加载失败，请稍后重试。"} onRetry={() => void load()} />
      ) : unpublished ? null : (
        <div className="parameter-catalog__workspace">
          <section className="parameter-catalog__navigator" aria-label={catalogNavigatorLabel}>
            <div className="parameter-catalog__navigator-head">
              <h2 className="parameter-catalog__pane-title">{catalogNavigatorLabel}</h2>
              {anchor.moduleNodeId || subject ? (
                <button type="button" className="button ghost sm" onClick={() => selectModuleNode(null)}>
                  {catalogModuleScopeClear}
                </button>
              ) : null}
            </div>
            <p className="parameter-catalog__muted">{catalogModuleScopeHint}</p>
            <CatalogModuleNavigator
              nodes={navigatorNodes}
              selectedId={subject ? `subject:${subject.id}` : anchor.moduleNodeId}
              onSelectNode={selectNavigatorNode}
            />
            {anchor.moduleNodeId ? (
              <p className="parameter-catalog__muted" data-catalog-module-scope="true">
                {`已选模块子树 · ${scopedSubjectCount} 个主体`}
              </p>
            ) : null}
          </section>

          <section className="parameter-catalog__pane parameter-catalog__pane--list" aria-label={catalogListLabel}>
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
                  <button
                    key={item.id}
                    type="button"
                    className="parameter-catalog__card"
                    aria-pressed={item.id === definition?.id}
                    onClick={() => selectDefinition(item)}
                  >
                    <span className="parameter-catalog__subject-name">{item.propertyKey}</span>
                    <span className="parameter-catalog__subject-meta">
                      {item.subject.canonicalName} · {catalogLifecycleLabel(item.lifecycle)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="parameter-catalog__table-wrap--desktop">
                <DataTable
                  rows={visibleDefinitions}
                  rowKey={(row) => row.id}
                  columns={columns}
                  selectedRowKey={definition?.id}
                  onRowClick={selectDefinition}
                  aria-label={catalogDefinitionsLabel}
                  pageSize={Math.max(visibleDefinitions.length, 1)}
                  renderRowActions={(row) => (
                    <span className="parameter-catalog__row-actions">
                      <button
                        type="button"
                        className="button subtle sm"
                        aria-label={`编辑 ${row.propertyKey}`}
                        data-catalog-row-action="edit"
                        onClick={() => selectDefinition(row)}
                      >
                        编辑
                      </button>
                      {definitionAuthoringAllowed && onDefinitionCommand ? (
                        <button
                          type="button"
                          className="button subtle sm"
                          aria-label={`纠错 ${row.propertyKey}`}
                          data-catalog-row-action="correct-identity"
                          onClick={() => onDefinitionCommand("correct-identity", row)}
                        >
                          身份纠错
                        </button>
                      ) : null}
                      {definitionPublishingAllowed && onDefinitionCommand ? (
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
                              row
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
                <select
                  value={pageSize}
                  aria-label={catalogPageSizeLabel}
                  onChange={(event) =>
                    changePageSize(parseCatalogPageSize(event.target.value) ?? CATALOG_DEFAULT_PAGE_SIZE)
                  }
                >
                  {CATALOG_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="parameter-catalog__page-buttons">
                <button
                  type="button"
                  className="button subtle sm"
                  aria-label={catalogPreviousPageLabel}
                  disabled={cursorTrail.length === 0 || inFlight}
                  onClick={goToPreviousPage}
                >
                  {catalogPreviousPageLabel}
                </button>
                <button
                  type="button"
                  className="button subtle sm"
                  aria-label={catalogNextPageLabel}
                  disabled={!snapshot?.definitions.hasMore || inFlight}
                  onClick={goToNextPage}
                >
                  {catalogNextPageLabel}
                </button>
              </div>
            </nav>
          </section>

        </div>
      )}

      {definition ? (
        <WorkbenchSheet
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          closeLabel={catalogDetailCloseLabel}
          title={definition.propertyKey || catalogDetailLabel}
        >
          <div className="parameter-catalog__sheet-tabs" role="tablist" aria-label="详情与历史">
            <button
              type="button"
              className="button ghost sm"
              role="tab"
              aria-selected={inspectorTab === "detail"}
              onClick={() => setInspectorTab("detail")}
            >
              {catalogSheetTabs.detail}
            </button>
            <button
              type="button"
              className="button ghost sm"
              role="tab"
              aria-selected={inspectorTab === "history"}
              onClick={() => {
                setInspectorTab("history");
              }}
            >
              {catalogSheetTabs.timeline}
            </button>
          </div>
          <div role="region" aria-label={catalogDetailLabel} data-catalog-detail-region="true">
            {inspectorTab === "detail" ? (
              detailBody
            ) : (
              <section aria-label={catalogTimelineLabel} data-catalog-history-region="true">
                <CatalogHistoryBody
                  timeline={snapshot?.timeline ?? null}
                  revisions={snapshot?.revisions ?? []}
                />
              </section>
            )}
          </div>
        </WorkbenchSheet>
      ) : null}
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
  state,
  revisions,
  historyOpen,
  onToggleHistory
}: {
  definition: DefinitionItem | null;
  subject: SubjectItem | null;
  state: CatalogDomainState;
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
      {state.kind === "retired" ? (
        <p className="parameter-catalog__muted">{catalogStateMessage(state)}</p>
      ) : null}
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
          策略 {definition.usageSummary.policyCount} · 项目 {definition.usageSummary.projectCount} · 当前值{" "}
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

function CatalogHistoryBody({
  timeline,
  revisions
}: {
  timeline: CatalogDefinitionTimelineResponse | null;
  revisions: RevisionItem[];
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
              <strong>{`修订 #${item.revisionNumber}`}</strong>
              <span className="parameter-catalog__anchor-id">{item.publishedInCatalogReleaseId}</span>
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
    </div>
  );
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
