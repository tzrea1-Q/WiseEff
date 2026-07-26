import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { LibrarySelectFilter } from "@/components/admin/LibrarySelectFilter";
import {
  isStructuralPropertyKey,
  paginateItems
} from "@/domain/parameter-topology/moduleProvenance";
import { ParameterSpecDetail, type ParameterSpecDetailView } from "./ParameterSpecDetail";
import { DraftSpecActivatePanel, type ActivateDraftSpecInput } from "./DraftSpecActivatePanel";

const SPEC_LIBRARY_PAGE_SIZE = 25;

export type ParameterSpecLibraryRow = {
  id: string;
  /** Null means platform-global; org admins must not activate/modify. */
  organizationId: string | null;
  propertyKey: string;
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
    reviewState: "needs_review",
    usageCount: 1
  })
];

export type ParameterSpecLibraryFilters = {
  q: string;
  driverModule: string;
  compatible: string;
  businessCategory: string;
  schemaSource: string;
  lifecycle: string;
};

const EMPTY_FILTERS: ParameterSpecLibraryFilters = {
  q: "",
  driverModule: "all",
  compatible: "all",
  businessCategory: "all",
  schemaSource: "all",
  lifecycle: "all"
};

const LIFECYCLE_OPTIONS = [
  { value: "all", label: "全部生命周期" },
  { value: "draft", label: "draft" },
  { value: "active", label: "active" },
  { value: "deprecated", label: "deprecated" },
  { value: "needs_review", label: "needs_review" }
] as const;

function uniqueOptions(values: Array<string | null | undefined>, allLabel: string) {
  const items = Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())))).sort();
  return [{ value: "all", label: allLabel }, ...items.map((value) => ({ value, label: value }))];
}

function matchesLifecycle(reviewState: string, lifecycle: string) {
  if (lifecycle === "all") {
    return true;
  }
  return reviewState === lifecycle;
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
    if (filters.driverModule !== "all" && spec.driverModule !== filters.driverModule) {
      return false;
    }
    if (filters.compatible !== "all" && spec.compatible !== filters.compatible) {
      return false;
    }
    if (filters.businessCategory !== "all" && spec.businessCategory !== filters.businessCategory) {
      return false;
    }
    if (filters.schemaSource !== "all" && spec.schemaSource !== filters.schemaSource) {
      return false;
    }
    if (!matchesLifecycle(spec.reviewState, filters.lifecycle)) {
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
  /** When both are provided, filters are controlled by the parent (URL SoT). */
  filters?: ParameterSpecLibraryFilters;
  onFiltersChange?: (filters: ParameterSpecLibraryFilters) => void;
  onSelectSpec: (specId: string) => void;
  onActivateDraftSpec?: (input: ActivateDraftSpecInput) => void;
  activatePending?: boolean;
};

export function ParameterSpecLibrary({
  specs,
  selectedSpecId = null,
  detail = null,
  reviewQueueSlot = null,
  loading = false,
  filters: controlledFilters,
  onFiltersChange,
  onSelectSpec,
  onActivateDraftSpec,
  activatePending = false
}: ParameterSpecLibraryProps) {
  const [uncontrolledFilters, setUncontrolledFilters] = useState<ParameterSpecLibraryFilters>(EMPTY_FILTERS);
  const [showStructural, setShowStructural] = useState(false);
  const [page, setPage] = useState(1);
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
    () =>
      showStructural
        ? specs
        : specs.filter((spec) => !isStructuralPropertyKey(spec.propertyKey)),
    [showStructural, specs]
  );
  const filtered = useMemo(() => filterParameterSpecLibrary(scopedSpecs, filters), [scopedSpecs, filters]);
  const pagination = useMemo(
    () => paginateItems(filtered, page, SPEC_LIBRARY_PAGE_SIZE),
    [filtered, page]
  );

  const driverOptions = useMemo(
    () => uniqueOptions(
      scopedSpecs.map((spec) => spec.driverModule),
      "全部驱动"
    ),
    [scopedSpecs]
  );

  const compatibleOptions = useMemo(
    () => uniqueOptions(
      scopedSpecs.map((spec) => spec.compatible),
      "全部 compatible"
    ),
    [scopedSpecs]
  );

  const structuralHiddenCount = specs.length - scopedSpecs.length;

  const filtersActive =
    filters.q.trim().length > 0 ||
    filters.driverModule !== "all" ||
    filters.compatible !== "all" ||
    filters.businessCategory !== "all" ||
    filters.schemaSource !== "all" ||
    filters.lifecycle !== "all";

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  return (
    <div className="parameter-spec-library-layout">
      <section className="parameters-table param-admin-library-table" aria-label="参数规格库">
        <div className="parameters-table-heading">
          <div>
            <h2>参数规格库</h2>
            <p>按属性键与驱动规格治理共享定义；同名属性按驱动/模块区分。路径仅作定位参考。</p>
          </div>
        </div>

        <div className="parameters-table-toolbar">
          <label className="parameters-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜索规格"
              type="search"
              value={filters.q}
              disabled={loading}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="搜索属性键，如 gpio_int"
            />
          </label>
          <div className="parameters-table-filters param-admin-library-filters">
            <LibrarySelectFilter
              ariaLabel="驱动模块"
              value={filters.driverModule}
              options={driverOptions}
              disabled={loading}
              onChange={(driverModule) => setFilters((current) => ({ ...current, driverModule }))}
            />
            <LibrarySelectFilter
              ariaLabel="compatible"
              value={filters.compatible}
              options={compatibleOptions}
              disabled={loading}
              onChange={(compatible) => setFilters((current) => ({ ...current, compatible }))}
            />
            <LibrarySelectFilter
              ariaLabel="生命周期"
              value={filters.lifecycle}
              options={[...LIFECYCLE_OPTIONS]}
              disabled={loading}
              onChange={(lifecycle) => setFilters((current) => ({ ...current, lifecycle }))}
            />
            <label className="parameters-table-checkbox">
              <input
                type="checkbox"
                checked={showStructural}
                onChange={(event) => {
                  setShowStructural(event.target.checked);
                  setPage(1);
                }}
              />
              显示结构属性
              {structuralHiddenCount > 0 && !showStructural
                ? `（已隐藏 ${structuralHiddenCount}）`
                : ""}
            </label>
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
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">属性键</th>
                <th scope="col">驱动模块</th>
                <th scope="col">审核状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((spec, index) => (
                <tr key={spec.id} data-selected={selectedSpecId === spec.id ? "true" : undefined}>
                  <td data-label="#">
                    {(pagination.page - 1) * pagination.pageSize + index + 1}
                  </td>
                  <td data-label="属性键">
                    <strong>{spec.propertyKey}</strong>
                  </td>
                  <td data-label="驱动模块">{spec.driverModule ?? "—"}</td>
                  <td data-label="审核状态">{spec.reviewState}</td>
                  <td data-label="操作">
                    <button
                      type="button"
                      className="button subtle param-admin-row-action"
                      aria-label={`查看 ${spec.propertyKey}`}
                      onClick={() => onSelectSpec(spec.id)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 ? (
          <div className="parameters-table-pagination param-admin-row-actions">
            <button
              type="button"
              className="button subtle"
              disabled={pagination.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="parameters-table-empty">
            <p>{loading ? "正在加载规格…" : "没有匹配的参数规格。"}</p>
            {filtersActive ? (
              <button type="button" className="button subtle" onClick={clearFilters}>
                清除筛选条件
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {detail ? <ParameterSpecDetail detail={detail} /> : null}
      {detail && onActivateDraftSpec && detail.organizationId != null ? (
        <DraftSpecActivatePanel detail={detail} onActivate={onActivateDraftSpec} pending={activatePending} />
      ) : detail && detail.reviewState === "draft" && detail.organizationId == null ? (
        <p className="form-hint" role="status">
          平台全局草稿规格不可由组织管理员激活；请通过平台治理入口维护。
        </p>
      ) : null}
      {reviewQueueSlot}
    </div>
  );
}
