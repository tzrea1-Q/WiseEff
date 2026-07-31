import { Check, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ColumnFilter } from "@/components/ColumnFilter";
import {
  formatParameterSpecLifecycle,
  PARAMETER_ADMIN_UI
} from "@/application/parameters/parameterAdminUiCopy";
import { paginateItems } from "@/domain/parameter-topology/moduleProvenance";
import { isStructuralPropertyKey } from "@/domain/parameter-topology/parameterSurface";
import type { SpecAttributionModule } from "@/domain/parameter-topology/types";
import type { ParameterSpecDetailView } from "./ParameterSpecDetail";
import type { SpecEditorSavePayload } from "./ParameterSpecDetail";
import { ParameterSpecDetailDialog } from "./ParameterSpecDetailDialog";
import type { ActivateDraftSpecInput } from "./DraftSpecActivatePanel";

const SPEC_LIBRARY_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_SPEC_LIBRARY_PAGE_SIZE: (typeof SPEC_LIBRARY_PAGE_SIZE_OPTIONS)[number] = 50;

export type ParameterSpecLibraryRow = {
  id: string;
  /** Null means platform-global catalog; Admins may still update via PATCH. */
  organizationId: string | null;
  propertyKey: string;
  /** Distinct attribution units from project bindings; empty = not yet observed. */
  attributionModules: SpecAttributionModule[];
  driverModule: string | null;
  compatible: string | null;
  valueType: string;
  /** Full inferred/API value shape; activate must not collapse to kind-only. */
  valueShape: Record<string, unknown> | null;
  schemaSource: string;
  schemaVersion: string | number | null;
  exampleValue: unknown;
  businessCategory: string | null;
  reviewState: string;
  usageCount: number;
};

/** Maps topology API / mock payloads into library rows. Never uses path as identity. */
export function mapParameterSpecToLibraryRow(input: {
  id: string;
  organizationId?: string | null;
  propertyKey?: string | null;
  specificationKey?: string | null;
  driverModule?: string | null;
  lifecycle?: string | null;
  currentVersion?: number | null;
  compatiblePatterns?: string[] | null;
  valueShape?: unknown;
  exampleValue?: unknown;
  schemaNamespace?: string | null;
  schemaSource?: string | null;
  businessCategory?: string | null;
  usageCount?: number | null;
  reviewState?: string | null;
  attributionModules?: SpecAttributionModule[] | null;
}): ParameterSpecLibraryRow {
  const propertyKey =
    input.propertyKey?.trim() ||
    input.specificationKey?.split("/").filter(Boolean).at(-1) ||
    input.id;
  const valueShape = input.valueShape;
  let valueType = "unknown";
  let preservedShape: Record<string, unknown> | null = null;
  if (typeof valueShape === "string") {
    valueType = valueShape;
  } else if (valueShape && typeof valueShape === "object" && !Array.isArray(valueShape) && "kind" in valueShape) {
    preservedShape = { ...(valueShape as Record<string, unknown>) };
    valueType = String((valueShape as { kind: unknown }).kind);
  }

  const schemaSource =
    input.schemaSource?.trim() ||
    (input.schemaNamespace?.includes("vendor")
      ? "vendor"
      : input.schemaNamespace?.includes("linux")
        ? "linux"
        : "manual");

  return {
    id: input.id,
    organizationId: input.organizationId ?? null,
    propertyKey,
    attributionModules: input.attributionModules ?? [],
    driverModule: input.driverModule ?? null,
    compatible: input.compatiblePatterns?.[0] ?? null,
    valueType,
    valueShape: preservedShape,
    schemaSource,
    schemaVersion: input.currentVersion ?? null,
    exampleValue: input.exampleValue ?? null,
    businessCategory: input.businessCategory ?? null,
    reviewState: input.reviewState ?? input.lifecycle ?? "draft",
    usageCount: input.usageCount ?? 0
  };
}

/** Filter/search labels for the attribution column. */
export function specAttributionFilterValues(spec: ParameterSpecLibraryRow): string[] {
  if (spec.attributionModules.length > 0) {
    return spec.attributionModules.map((module) => module.name);
  }
  if (spec.driverModule?.trim()) {
    return [spec.driverModule.trim()];
  }
  return ["未归类"];
}

/** User-facing attribution cell / detail text (full tree path when available). */
export function formatSpecAttributionLabel(spec: ParameterSpecLibraryRow): string {
  if (spec.attributionModules.length > 0) {
    return spec.attributionModules
      .map((module) =>
        module.path && module.path.length > 0 ? module.path.join(" / ") : module.name
      )
      .join("、");
  }
  if (spec.driverModule?.trim()) {
    return `${spec.driverModule.trim()}（未实测）`;
  }
  return "未归类";
}

/** Primary library/detail label: attribution subject + property key. */
export function formatSpecPrimaryLabel(
  spec: Pick<ParameterSpecLibraryRow, "propertyKey" | "attributionModules" | "driverModule">
): string {
  const subject =
    spec.attributionModules.length > 0
      ? spec.attributionModules
          .map((module) =>
            module.path && module.path.length > 0 ? module.path.join(" / ") : module.name
          )
          .join("、")
      : "未归类";
  return `${subject} · ${spec.propertyKey}`;
}

/** Secondary driver-module label for library scan (compat hint only). */
export function formatSpecDriverModuleLabel(
  spec: Pick<ParameterSpecLibraryRow, "driverModule">
): string {
  return spec.driverModule?.trim() || "—";
}

/** Review binding may pick active specs or org-owned activatable drafts — never deprecated. */
export function isSpecSelectableForReview(
  spec: Pick<ParameterSpecLibraryRow, "reviewState" | "organizationId">
): boolean {
  if (spec.reviewState === "deprecated") return false;
  if (spec.reviewState === "active") return true;
  return spec.reviewState === "draft" && spec.organizationId != null;
}

/** Small semantic mock for demos — property-key identity, not path names. */
export const SEMANTIC_MOCK_PARAMETER_SPECS: ParameterSpecLibraryRow[] = [
  mapParameterSpecToLibraryRow({
    id: "mock-spec-sc8562-gpio-int",
    organizationId: "org-mock",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatiblePatterns: ["vendor,sc8562"],
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
    schemaSource: "vendor",
    currentVersion: 3,
    exampleValue: "<&gpio13 29 0>",
    businessCategory: "Charge Pump IC",
    attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }],
    lifecycle: "active",
    usageCount: 2
  }),
  mapParameterSpecToLibraryRow({
    id: "mock-spec-mt5788-gpio-int",
    organizationId: "org-mock",
    propertyKey: "gpio_int",
    driverModule: "mt5788",
    compatiblePatterns: ["mediatek,mt5788"],
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
    schemaSource: "linux",
    currentVersion: 1,
    exampleValue: "<&gpio6 15 0>",
    businessCategory: "Wireless Charging",
    attributionModules: [],
    reviewState: "draft",
    usageCount: 1
  })
];

export type ParameterSpecLibraryFilters = {
  q: string;
  /** Empty = no filter (show all). */
  driverModules: string[];
  compatibles: string[];
  businessCategories: string[];
  schemaSources: string[];
  lifecycles: string[];
  moduleNames: string[];
};

const EMPTY_FILTERS: ParameterSpecLibraryFilters = {
  q: "",
  driverModules: [],
  compatibles: [],
  businessCategories: [],
  schemaSources: [],
  lifecycles: [],
  moduleNames: []
};

const LIFECYCLE_VALUES = ["draft", "active", "deprecated"] as const;

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN")
  );
}

function matchesSelected(selected: readonly string[], value: string | null | undefined): boolean {
  if (selected.length === 0) return true;
  return value != null && selected.includes(value);
}

function toggleSelected(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}

export function filterParameterSpecLibrary(
  specs: readonly ParameterSpecLibraryRow[],
  filters: ParameterSpecLibraryFilters
): ParameterSpecLibraryRow[] {
  const q = filters.q.trim().toLowerCase();
  return specs.filter((spec) => {
    if (q) {
      const haystack = [
        spec.propertyKey,
        formatSpecAttributionLabel(spec),
        ...specAttributionFilterValues(spec),
        spec.driverModule,
        spec.compatible,
        spec.businessCategory,
        spec.schemaSource,
        spec.valueType
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    if (!matchesSelected(filters.driverModules, spec.driverModule)) return false;
    if (!matchesSelected(filters.compatibles, spec.compatible)) return false;
    if (!matchesSelected(filters.businessCategories, spec.businessCategory)) return false;
    if (!matchesSelected(filters.schemaSources, spec.schemaSource)) return false;
    if (
      filters.lifecycles.length === 0 &&
      spec.reviewState === "deprecated"
    ) {
      return false;
    }
    if (!matchesSelected(filters.lifecycles, spec.reviewState)) return false;
    if (
      filters.moduleNames.length > 0 &&
      !specAttributionFilterValues(spec).some((value) => filters.moduleNames.includes(value))
    ) {
      return false;
    }
    return true;
  });
}

export type ParameterSpecLibraryProps = {
  specs: readonly ParameterSpecLibraryRow[];
  selectedSpecId?: string | null;
  detail?: ParameterSpecDetailView | null;
  reviewQueueSlot?: ReactNode;
  loading?: boolean;
  /** Hide page heading when embedded in another dialog. */
  embedded?: boolean;
  /** When both are provided, filters are controlled by the parent (URL SoT). */
  filters?: ParameterSpecLibraryFilters;
  onFiltersChange?: (filters: ParameterSpecLibraryFilters) => void;
  onSelectSpec: (specId: string) => void;
  onCloseSpec?: () => void;
  onSaveSpec?: (payload: SpecEditorSavePayload) => void | Promise<void>;
  onDeprecateSpec?: (input: { specId: string; reason: string }) => void | Promise<void>;
  onRestoreSpec?: (input: { specId: string; reason: string }) => void | Promise<void>;
  onPrepareCutover?: (specId: string) => void | Promise<void>;
  onFinalizeCutover?: (input: { specId: string; reason: string }) => void | Promise<void>;
  savePending?: boolean;
  saveError?: string | null;
  onCreateSpec?: () => void;
  /** @deprecated Prefer onSaveSpec; kept for activate-only callers. */
  onActivateDraftSpec?: (input: ActivateDraftSpecInput) => void;
  activatePending?: boolean;
};

export function ParameterSpecLibrary({
  specs,
  selectedSpecId = null,
  detail = null,
  reviewQueueSlot = null,
  loading = false,
  embedded = false,
  filters: controlledFilters,
  onFiltersChange,
  onSelectSpec,
  onCloseSpec,
  onSaveSpec,
  onDeprecateSpec,
  onRestoreSpec,
  onPrepareCutover,
  onFinalizeCutover,
  savePending = false,
  saveError = null,
  onCreateSpec,
  onActivateDraftSpec,
  activatePending = false
}: ParameterSpecLibraryProps) {
  const [uncontrolledFilters, setUncontrolledFilters] = useState<ParameterSpecLibraryFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof SPEC_LIBRARY_PAGE_SIZE_OPTIONS)[number]>(
    DEFAULT_SPEC_LIBRARY_PAGE_SIZE
  );
  const isControlled = controlledFilters != null && onFiltersChange != null;
  const filters = isControlled ? controlledFilters : uncontrolledFilters;
  const setFilters = (next: ParameterSpecLibraryFilters | ((current: ParameterSpecLibraryFilters) => ParameterSpecLibraryFilters)) => {
    const resolved = typeof next === "function" ? next(filters) : next;
    setPage(1);
    if (isControlled) {
      onFiltersChange(resolved);
      return;
    }
    setUncontrolledFilters(resolved);
  };

  const scopedSpecs = useMemo(
    () => specs.filter((spec) => !isStructuralPropertyKey(spec.propertyKey)),
    [specs]
  );
  const filtered = useMemo(() => filterParameterSpecLibrary(scopedSpecs, filters), [scopedSpecs, filters]);
  const pagination = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const handlePageSizeChange = (nextSize: (typeof SPEC_LIBRARY_PAGE_SIZE_OPTIONS)[number]) => {
    setPageSize(nextSize);
    setPage(1);
  };

  const moduleValues = useMemo(
    () => uniqueValues(scopedSpecs.flatMap((spec) => specAttributionFilterValues(spec))),
    [scopedSpecs]
  );
  const lifecycleValues = useMemo(() => {
    const present = new Set(scopedSpecs.map((spec) => spec.reviewState));
    for (const selected of filters.lifecycles) present.add(selected);
    return LIFECYCLE_VALUES.filter((value) => present.has(value));
  }, [filters.lifecycles, scopedSpecs]);

  const filtersActive =
    filters.q.trim().length > 0 ||
    filters.driverModules.length > 0 ||
    filters.compatibles.length > 0 ||
    filters.businessCategories.length > 0 ||
    filters.schemaSources.length > 0 ||
    filters.lifecycles.length > 0 ||
    filters.moduleNames.length > 0;

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const patchFilterList = (
    key: keyof Pick<
      ParameterSpecLibraryFilters,
      "driverModules" | "compatibles" | "lifecycles" | "moduleNames" | "businessCategories" | "schemaSources"
    >,
    value: string
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: toggleSelected(current[key], value)
    }));
  };

  return (
    <div className={`parameter-spec-library-layout${embedded ? " is-embedded" : ""}`}>
      <section className="parameters-table param-admin-library-table" aria-label={PARAMETER_ADMIN_UI.specLibrary}>
        {embedded ? null : (
          <div className="parameters-table-heading">
            <div>
              <h2>{PARAMETER_ADMIN_UI.specLibrary}</h2>
              <p>{PARAMETER_ADMIN_UI.specLibraryBlurb}</p>
            </div>
          </div>
        )}

        <div className="parameters-table-toolbar">
          <label className="parameters-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label={PARAMETER_ADMIN_UI.specLibrarySearch}
              type="search"
              value={filters.q}
              disabled={loading}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="搜索属性键，如 gpio_int"
            />
          </label>
          <div className="parameters-table-filters param-admin-library-filters">
            {onCreateSpec ? (
              <button type="button" className="primary-button" disabled={loading} onClick={onCreateSpec}>
                新建定义
              </button>
            ) : null}
            {filtersActive ? (
              <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
                清除筛选
              </button>
            ) : null}
          </div>
          <span className="parameters-table-count">
            {filtered.length} / {scopedSpecs.length} 项 · 第 {pagination.page} / {pagination.totalPages} 页
          </span>
        </div>

        <div className="parameters-table-scroll">
          <table className="parameters-table-grid param-admin-library-grid parameter-spec-library-grid">
            <colgroup>
              <col className="parameter-spec-library-grid__col-index" />
              <col className="parameter-spec-library-grid__col-key" />
              <col className="parameter-spec-library-grid__col-driver" />
              <col className="parameter-spec-library-grid__col-type" />
              <col className="parameter-spec-library-grid__col-state" />
              <col className="parameter-spec-library-grid__col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">
                  <span className="param-admin-library-head-cell">
                    <span>参数定义</span>
                    <ColumnFilter
                      label={PARAMETER_ADMIN_UI.specAttributionModule}
                      groupLabel="归属模块筛选"
                      values={moduleValues}
                      selectedValues={filters.moduleNames}
                      onToggle={(value) => patchFilterList("moduleNames", value)}
                      onClear={() => setFilters((current) => ({ ...current, moduleNames: [] }))}
                    />
                  </span>
                </th>
                <th scope="col">{PARAMETER_ADMIN_UI.specDriverModule}</th>
                <th scope="col">值类型</th>
                <th scope="col">
                  <span className="param-admin-library-head-cell">
                    <span>审核状态</span>
                    <ColumnFilter
                      label="审核状态"
                      groupLabel="审核状态筛选"
                      values={[...lifecycleValues]}
                      selectedValues={filters.lifecycles}
                      onToggle={(value) => patchFilterList("lifecycles", value)}
                      onClear={() => setFilters((current) => ({ ...current, lifecycles: [] }))}
                    />
                  </span>
                </th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((spec, index) => {
                const isSelected = selectedSpecId === spec.id;
                return (
                <tr
                  key={spec.id}
                  data-selected={isSelected ? "true" : undefined}
                  className={embedded ? "parameter-spec-library-grid__row--selectable" : undefined}
                  tabIndex={embedded ? 0 : undefined}
                  aria-selected={embedded ? isSelected : undefined}
                  onClick={embedded ? () => onSelectSpec(spec.id) : undefined}
                  onKeyDown={
                    embedded
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectSpec(spec.id);
                          }
                        }
                      : undefined
                  }
                >
                  <td data-label="#">
                    {(pagination.page - 1) * pagination.pageSize + index + 1}
                  </td>
                  <td data-label="参数定义">
                    <strong>{formatSpecPrimaryLabel(spec)}</strong>
                  </td>
                  <td data-label={PARAMETER_ADMIN_UI.specDriverModule}>
                    {formatSpecDriverModuleLabel(spec)}
                  </td>
                  <td data-label="值类型">{spec.valueType}</td>
                  <td data-label="审核状态">{formatParameterSpecLifecycle(spec.reviewState)}</td>
                  <td data-label="操作">
                    {embedded ? (
                      <button
                        type="button"
                        className={`button ${isSelected ? "primary" : "subtle"} parameter-spec-library-grid__pick`}
                        aria-label={`选用 ${spec.propertyKey}`}
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectSpec(spec.id);
                        }}
                      >
                        <Check size={14} strokeWidth={2} aria-hidden="true" />
                        {isSelected ? "已选" : "选用"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button subtle dts-parameter-workbench-table__icon-action"
                        aria-label={`编辑 ${spec.propertyKey}`}
                        title="编辑"
                        onClick={() => onSelectSpec(spec.id)}
                      >
                        <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 ? (
          <div className="parameters-table-pagination param-admin-row-actions parameter-spec-library-pagination">
            <label className="parameter-spec-library-page-size">
              <span>每页</span>
              <select
                aria-label="每页条数"
                value={pageSize}
                onChange={(event) =>
                  handlePageSizeChange(
                    Number(event.target.value) as (typeof SPEC_LIBRARY_PAGE_SIZE_OPTIONS)[number]
                  )
                }
              >
                {SPEC_LIBRARY_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
            <div className="parameter-spec-library-page-nav" aria-label="翻页">
              <button
                type="button"
                className="parameter-spec-library-page-nav__btn"
                aria-label="上一页"
                disabled={pagination.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="parameter-spec-library-page-nav__current" aria-live="polite">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                className="parameter-spec-library-page-nav__btn"
                aria-label="下一页"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="parameters-table-empty">
            <p>{loading ? PARAMETER_ADMIN_UI.specLibraryLoading : PARAMETER_ADMIN_UI.specLibraryEmpty}</p>
            {filtersActive ? (
              <button type="button" className="button subtle" onClick={clearFilters}>
                清除筛选条件
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {detail ? (
        <ParameterSpecDetailDialog
          detail={detail}
          onClose={() => onCloseSpec?.()}
          pending={savePending || activatePending}
          error={saveError}
          onDeprecate={
            onDeprecateSpec
              ? ({ reason }) => onDeprecateSpec({ specId: detail.id, reason })
              : undefined
          }
          onRestore={
            onRestoreSpec
              ? ({ reason }) => onRestoreSpec({ specId: detail.id, reason })
              : undefined
          }
          onPrepareCutover={
            onPrepareCutover ? () => onPrepareCutover(detail.id) : undefined
          }
          onFinalizeCutover={
            onFinalizeCutover
              ? ({ reason }) => onFinalizeCutover({ specId: detail.id, reason })
              : undefined
          }
          onSave={
            onSaveSpec ??
            (onActivateDraftSpec
              ? async (payload) => {
                  if (payload.mode !== "activate") {
                    throw new Error("当前仅支持激活草稿定义。");
                  }
                  await onActivateDraftSpec({
                    specId: payload.specId,
                    valueShape: payload.valueShape,
                    constraints: payload.constraints,
                    documentation: payload.documentation,
                    reason: payload.reason
                  });
                }
              : undefined)
          }
        />
      ) : null}
      {reviewQueueSlot}
    </div>
  );
}
