import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  catalogWritesEnabled,
  deriveCatalogDomainState,
  type CatalogCollectionSnapshot,
  type CatalogDomainState,
  type CatalogEmptyReason
} from "@/application/parameter-catalog/states";
import {
  buildCatalogHref,
  parseCatalogUrlAnchor,
  readLegacyCatalogBookmark,
  withCatalogReleasePin,
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
  catalogDetailLabel,
  catalogListLabel,
  catalogLoadingLabel,
  catalogPageLabel,
  catalogRefreshLabel,
  catalogReviewWorkLabel,
  catalogSearchClearLabel,
  catalogSearchLabel,
  catalogSearchSubmitLabel,
  catalogSelectDefinitionHint,
  catalogSheetTabs,
  catalogSubjectsLabel,
  catalogTimelineLabel,
  catalogReleaseLabel,
  catalogStateBadges
} from "./copy";
import "./parameter-catalog.css";

type DefinitionItem = CatalogDefinitionResponse["item"];
type SubjectItem = CatalogSubjectResponse["item"];
type RevisionItem = CatalogDefinitionRevisionResponse["item"];
type TimelineItem = CatalogDefinitionTimelineResponse["items"][number];

export type CatalogPageProps = {
  repository: ParameterCatalogRepository;
  actor: CatalogActorKind;
  search?: string;
  onAnchorChange?: (href: string, mode: "push" | "replace") => void;
  onDomainStateChange?: (state: CatalogDomainState) => void;
  onAction?: (
    action: CatalogAuthorizedAction,
    context?: { subjectId?: string | null; registrationId?: string | null }
  ) => void;
  layoutMode?: CatalogLayoutMode;
  organizationId?: string;
  listReviewItems?: (
    organizationId: string,
    query?: CatalogListQuery
  ) => Promise<CatalogReviewItemListResponse>;
};

type CatalogSnapshot = {
  document: CatalogDocumentResponse;
  subjects: CatalogSubjectListResponse;
  definitions: CatalogDefinitionListResponse;
  subject: SubjectItem | null;
  definition: DefinitionItem | null;
  revisions: RevisionItem[];
  timeline: CatalogDefinitionTimelineResponse | null;
  review: CatalogReviewItemListResponse | null;
};

type InspectorTab = "detail" | "timeline";

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

export function CatalogPage({
  repository,
  actor,
  search,
  onAnchorChange,
  onDomainStateChange,
  onAction,
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

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [error, setError] = useState<unknown>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("detail");
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

  const load = useCallback(async () => {
    setInFlight(true);
    try {
      const catalog = repositoryRef.current;
      const currentAnchor = parseCatalogUrlAnchor(resolvedSearch);
      const legacyBookmark = readLegacyCatalogBookmark(resolvedSearch);
      if (legacyBookmark && !currentAnchor.definitionId && !currentAnchor.subjectId) {
        const mapped = await catalog.getLegacyIdentifier(legacyBookmark.legacyType, legacyBookmark.legacyId);
        const target = mapped.item.target;
        commitAnchor(
          {
            subjectId: target.kind === "catalog-subject" ? target.id : currentAnchor.subjectId,
            definitionId: target.kind === "parameter-definition" ? target.id : currentAnchor.definitionId,
            catalogReleaseId: currentAnchor.catalogReleaseId,
            reviewItemId: currentAnchor.reviewItemId
          },
          "replace"
        );
        return;
      }
      const pin = withCatalogReleasePin(undefined, currentAnchor.catalogReleaseId);
      const query: CatalogListQuery = { ...pin };
      if (searchQuery.trim()) {
        query.search = searchQuery.trim();
      }
      const document = await catalog.getCatalog(pin);
      const subjects = await catalog.listSubjects(query);
      let subject: SubjectItem | null = null;
      let definition: DefinitionItem | null = null;
      let definitions: CatalogDefinitionListResponse = {
        items: [],
        nextCursor: null,
        catalogReleaseId: document.item.catalogReleaseId
      };
      let timeline: CatalogDefinitionTimelineResponse | null = null;
      let revisions: RevisionItem[] = [];
      const subjectsEmptyReason = emptyCollectionReason(subjects);

      if (currentAnchor.definitionId) {
        const definitionResponse = await catalog.getDefinition(currentAnchor.definitionId, pin);
        definition = definitionResponse.item;
        timeline = await catalog.listDefinitionTimeline(currentAnchor.definitionId, query);
        const revisionList = await catalog.listDefinitionRevisions(currentAnchor.definitionId, query);
        revisions = revisionList.items;
      }

      const subjectId = currentAnchor.subjectId ?? definition?.subject.id ?? null;
      if (subjectsEmptyReason === "no-registrations" && !subjectId) {
        definitions = {
          items: [],
          nextCursor: null,
          catalogReleaseId: document.item.catalogReleaseId,
          emptyReason: "no-registrations"
        };
      } else if (subjectId) {
        const subjectResponse = await catalog.getSubject(subjectId, pin);
        subject = subjectResponse.item;
        definitions = await catalog.listSubjectDefinitions(subjectId, query);
      } else {
        definitions = await catalog.listDefinitions(query);
      }

      let review: CatalogReviewItemListResponse | null = null;
      const reviewLoader = listReviewItemsRef.current;
      if (reviewLoader && organizationId) {
        try {
          review = await reviewLoader(organizationId, query);
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
  }, [commitAnchor, organizationId, resolvedSearch, searchQuery]);

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
    const catalogReleaseId = snapshot.document.item.catalogReleaseId;
    commitAnchor(
      {
        ...anchor,
        catalogReleaseId
      },
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
    document: snapshot?.document,
    subject: snapshot?.subject ?? undefined,
    definition: snapshot?.definition ?? undefined,
    collection: inFlight || error !== undefined ? undefined : collection,
    error
  });
  const writesEnabled = catalogWritesEnabled(domainState);
  const actions = catalogActionAffordances(actor, domainState);
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
  const listEmptyReason =
    emptyCollectionReason(snapshot?.definitions ?? null) ??
    emptyCollectionReason(snapshot?.subjects ?? null);
  const visibleDefinitions = useMemo(() => {
    const items = snapshot?.definitions.items ?? [];
    if (lifecycleFilter.length === 0) {
      return items;
    }
    return items.filter((item) => lifecycleFilter.includes(item.lifecycle));
  }, [lifecycleFilter, snapshot?.definitions.items]);
  const filterEmptyReason: CatalogEmptyReason | null =
    visibleDefinitions.length === 0 && (lifecycleFilter.length > 0 || Boolean(searchQuery.trim()))
      ? "no-filter-match"
      : listEmptyReason;
  const compactList = layoutMode === "mobile";

  const selectSubject = (subjectId: string) => {
    commitAnchor(
      {
        subjectId,
        definitionId: null,
        catalogReleaseId:
          snapshot?.document.item.catalogReleaseId ?? anchor.catalogReleaseId,
        reviewItemId: anchor.reviewItemId
      },
      "push"
    );
    setInspectorOpen(false);
  };

  const selectDefinition = (item: DefinitionItem) => {
    commitAnchor(
      {
        subjectId: item.subject.id || subject?.id || anchor.subjectId,
        definitionId: item.id,
        catalogReleaseId:
          snapshot?.document.item.catalogReleaseId ?? anchor.catalogReleaseId,
        reviewItemId: anchor.reviewItemId
      },
      "push"
    );
    setInspectorTab("detail");
    if (layoutMode !== "desktop") {
      setInspectorOpen(true);
    }
  };

  const submitSearch = () => {
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const columns: Column<DefinitionItem>[] = [
    {
      key: "propertyKey",
      header: "属性键",
      render: (row) => row.propertyKey,
      sortAccessor: (row) => row.propertyKey
    },
    {
      key: "subject",
      header: "主体",
      render: (row) => row.subject.canonicalName,
      sortAccessor: (row) => row.subject.canonicalName
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
        selectedValues: lifecycleFilter,
        renderLabel: catalogLifecycleLabel,
        onToggle: (value) => setLifecycleFilter((current) => toggleFilterValue(current, value)),
        onClear: () => setLifecycleFilter([]),
        getValue: (row) => row.lifecycle
      }
    },
    {
      key: "usage",
      header: "使用",
      render: (row) =>
        `策略 ${row.usageSummary.policyCount} · 项目 ${row.usageSummary.projectCount} · 当前值 ${row.usageSummary.currentValueCount}`
    }
  ];

  const definition = snapshot?.definition ?? null;
  const subject = snapshot?.subject ?? null;
  const release = snapshot?.document.item;
  const noOrgRegistrations =
    !anchor.subjectId &&
    (snapshot?.subjects.items.length ?? 0) > 0 &&
    (snapshot?.subjects.items.every((item) => item.registration.status === "unregistered") ?? false);
  const pageEmptyReason =
    domainState.kind === "empty"
      ? domainState.emptyReason
      : filterEmptyReason && visibleDefinitions.length === 0
        ? filterEmptyReason
        : noOrgRegistrations
          ? "no-registrations"
          : null;

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
          {searchQuery ? (
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
          <button type="button" className="button subtle sm" onClick={() => void load()}>
            {catalogRefreshLabel}
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

      {reviewEmptyReason ? (
        <div
          className="parameter-catalog__banner"
          data-catalog-empty={reviewEmptyReason}
          role="status"
        >
          <p>{catalogEmptyMessage(reviewEmptyReason)}</p>
        </div>
      ) : snapshot?.review && snapshot.review.items.length > 0 ? (
        <div className="parameter-catalog__banner" role="status">
          <p>
            {catalogReviewWorkLabel} {snapshot.review.items.length} 项
          </p>
        </div>
      ) : null}

      {inFlight && !snapshot ? (
        <SectionSkeleton label={catalogLoadingLabel} />
      ) : domainState.kind === "error" && !snapshot ? (
        <SectionError message={statusMessage ?? "目录加载失败，请稍后重试。"} onRetry={() => void load()} />
      ) : (
        <div className="parameter-catalog__workspace">
          <section className="parameter-catalog__pane parameter-catalog__pane--list" aria-label={catalogListLabel}>
            <h2 className="parameter-catalog__pane-title">{catalogListLabel}</h2>
            {pageEmptyReason && pageEmptyReason !== "no-review-work" ? (
              <div data-catalog-empty={pageEmptyReason}>
                <SectionEmpty message={catalogEmptyMessage(pageEmptyReason)} />
              </div>
            ) : (
              <>
                <h3 className="parameter-catalog__muted">{catalogSubjectsLabel}</h3>
                <ul className="parameter-catalog__subjects" aria-label={catalogSubjectsLabel}>
                  {(snapshot?.subjects.items ?? []).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="parameter-catalog__subject"
                        aria-pressed={item.id === subject?.id}
                        onClick={() => selectSubject(item.id)}
                      >
                        <span className="parameter-catalog__subject-name">{item.canonicalName}</span>
                        <span className="parameter-catalog__subject-meta">
                          {catalogSubjectTypeLabel(item.type)} · {catalogRegistrationLabel(item.registration.status)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <h3 className="parameter-catalog__muted">{catalogDefinitionsLabel}</h3>
                {filterEmptyReason && visibleDefinitions.length === 0 ? (
                  <div data-catalog-empty={filterEmptyReason}>
                    <SectionEmpty message={catalogEmptyMessage(filterEmptyReason)} />
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
              </>
            )}
          </section>

          <section className="parameter-catalog__pane parameter-catalog__pane--detail" aria-label={catalogDetailLabel}>
            <h2 className="parameter-catalog__pane-title">{catalogDetailLabel}</h2>
            <CatalogDetailBody
              definition={definition}
              subject={subject}
              state={domainState}
              revisions={snapshot?.revisions ?? []}
            />
          </section>

          <section className="parameter-catalog__pane parameter-catalog__pane--timeline" aria-label={catalogTimelineLabel}>
            <h2 className="parameter-catalog__pane-title">{catalogTimelineLabel}</h2>
            <CatalogTimelineBody timeline={snapshot?.timeline ?? null} />
          </section>
        </div>
      )}

      {layoutMode !== "desktop" ? (
        <WorkbenchSheet
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          title={definition?.propertyKey ?? catalogDetailLabel}
        >
          <div className="parameter-catalog__sheet-tabs" role="tablist" aria-label="详情与时间线">
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
              aria-selected={inspectorTab === "timeline"}
              onClick={() => setInspectorTab("timeline")}
            >
              {catalogSheetTabs.timeline}
            </button>
          </div>
          {inspectorTab === "detail" ? (
            <CatalogDetailBody
              definition={definition}
              subject={subject}
              state={domainState}
              revisions={snapshot?.revisions ?? []}
            />
          ) : (
            <CatalogTimelineBody timeline={snapshot?.timeline ?? null} />
          )}
        </WorkbenchSheet>
      ) : null}

    </div>
  );
}

function CatalogDetailBody({
  definition,
  subject,
  state,
  revisions
}: {
  definition: DefinitionItem | null;
  subject: SubjectItem | null;
  state: CatalogDomainState;
  revisions: RevisionItem[];
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
        <dt>主体类型</dt>
        <dd>{catalogSubjectTypeLabel(definition.subject.type)}</dd>
        <dt>主体编号</dt>
        <dd>{definition.subject.id}</dd>
        <dt>定义编号</dt>
        <dd>{definition.id}</dd>
        <dt>当前修订</dt>
        <dd>{`修订 #${revision.revisionNumber}${revisions.length > 0 ? ` · 共 ${revisions.length} 条` : ""}`}</dd>
        <dt>纳入发布</dt>
        <dd>{revision.publishedInCatalogReleaseId}</dd>
        <dt>取值形状</dt>
        <dd>{catalogValueShapeLabel(schema)}</dd>
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
        <dd>
          {registration.status === "unregistered"
            ? "未建立"
            : placement?.displayName ?? "未建立"}
        </dd>
        {subject?.aliases?.length ? (
          <>
            <dt>别名</dt>
            <dd>{subject.aliases.join("、")}</dd>
          </>
        ) : null}
      </dl>
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
