import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { LibrarySelectFilter } from "@/components/admin/LibrarySelectFilter";
import { ParameterSpecDetail, type ParameterSpecDetailView } from "./ParameterSpecDetail";
import { DraftSpecActivatePanel, type ActivateDraftSpecInput } from "./DraftSpecActivatePanel";

export type ParameterSpecLibraryRow = {
  id: string;
  propertyKey: string;
  driverModule: string | null;
  compatible: string | null;
  valueType: string;
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
  if (typeof valueShape === "string") {
    valueType = valueShape;
  } else if (valueShape && typeof valueShape === "object" && "kind" in valueShape) {
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
    propertyKey,
    driverModule: input.driverModule ?? null,
    compatible: input.compatiblePatterns?.[0] ?? null,
    valueType,
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
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatiblePatterns: ["vendor,sc8562"],
    valueShape: { kind: "phandle-list" },
    schemaSource: "vendor",
    currentVersion: 3,
    exampleValue: "<&gpio13 29 0>",
    businessCategory: "Charge Pump IC",
    lifecycle: "active",
    usageCount: 2
  }),
  mapParameterSpecToLibraryRow({
    id: "mock-spec-mt5788-gpio-int",
    propertyKey: "gpio_int",
    driverModule: "mt5788",
    compatiblePatterns: ["mediatek,mt5788"],
    valueShape: { kind: "phandle-list" },
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

function formatExample(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

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
  onSelectSpec,
  onActivateDraftSpec,
  activatePending = false
}: ParameterSpecLibraryProps) {
  const [filters, setFilters] = useState<ParameterSpecLibraryFilters>(EMPTY_FILTERS);
  const filtered = useMemo(() => filterParameterSpecLibrary(specs, filters), [specs, filters]);

  const driverOptions = useMemo(
    () => uniqueOptions(
      specs.map((spec) => spec.driverModule),
      "全部驱动"
    ),
    [specs]
  );
  const compatibleOptions = useMemo(
    () => uniqueOptions(
      specs.map((spec) => spec.compatible),
      "全部 compatible"
    ),
    [specs]
  );
  const categoryOptions = useMemo(
    () => uniqueOptions(
      specs.map((spec) => spec.businessCategory),
      "全部业务分类"
    ),
    [specs]
  );
  const schemaSourceOptions = useMemo(
    () => uniqueOptions(
      specs.map((spec) => spec.schemaSource),
      "全部 Schema 来源"
    ),
    [specs]
  );

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
            <p>按属性键与驱动规格治理共享定义；驱动与实例分离，路径仅作定位参考。</p>
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
              ariaLabel="业务分类"
              value={filters.businessCategory}
              options={categoryOptions}
              disabled={loading}
              onChange={(businessCategory) => setFilters((current) => ({ ...current, businessCategory }))}
            />
            <LibrarySelectFilter
              ariaLabel="Schema 来源"
              value={filters.schemaSource}
              options={schemaSourceOptions}
              disabled={loading}
              onChange={(schemaSource) => setFilters((current) => ({ ...current, schemaSource }))}
            />
            <LibrarySelectFilter
              ariaLabel="生命周期"
              value={filters.lifecycle}
              options={[...LIFECYCLE_OPTIONS]}
              disabled={loading}
              onChange={(lifecycle) => setFilters((current) => ({ ...current, lifecycle }))}
            />
            {filtersActive ? (
              <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
                清除筛选
              </button>
            ) : null}
          </div>
          <span className="parameters-table-count">
            {filtered.length} / {specs.length} 项
          </span>
        </div>

        <div className="parameters-table-scroll">
          <table className="parameters-table-grid param-admin-library-grid parameter-spec-library-grid">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">属性键</th>
                <th scope="col">驱动模块</th>
                <th scope="col">compatible</th>
                <th scope="col">值类型</th>
                <th scope="col">Schema 来源/版本</th>
                <th scope="col">示例值</th>
                <th scope="col">业务分类</th>
                <th scope="col">审核状态</th>
                <th scope="col">使用量</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((spec, index) => (
                <tr key={spec.id} data-selected={selectedSpecId === spec.id ? "true" : undefined}>
                  <td data-label="#">{index + 1}</td>
                  <td data-label="属性键">
                    <strong>{spec.propertyKey}</strong>
                  </td>
                  <td data-label="驱动模块">{spec.driverModule ?? "—"}</td>
                  <td data-label="compatible">{spec.compatible ?? "—"}</td>
                  <td data-label="值类型">{spec.valueType}</td>
                  <td data-label="Schema 来源/版本">
                    {spec.schemaSource}/{spec.schemaVersion ?? "—"}
                  </td>
                  <td data-label="示例值">
                    <code title="示例值">{formatExample(spec.exampleValue)}</code>
                  </td>
                  <td data-label="业务分类">{spec.businessCategory ?? "—"}</td>
                  <td data-label="审核状态">{spec.reviewState}</td>
                  <td data-label="使用量">{spec.usageCount}</td>
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
      {detail && onActivateDraftSpec ? (
        <DraftSpecActivatePanel detail={detail} onActivate={onActivateDraftSpec} pending={activatePending} />
      ) : null}
      {reviewQueueSlot}
    </div>
  );
}
