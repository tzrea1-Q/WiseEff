import { useState } from "react";
import type {
  DtsSearchBy,
  DtsSearchHit,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";

export type DtsSearchPanelProps = {
  projectId: string;
  repository: DtsStructuredRepository;
  onSelectHit?: (hit: DtsSearchHit) => void;
};

const SEARCH_BY_OPTIONS: { value: DtsSearchBy; label: string }[] = [
  { value: "path", label: "节点路径" },
  { value: "address", label: "@地址" },
  { value: "label", label: "标签" },
  { value: "compatible", label: "compatible" },
  { value: "value", label: "属性值" }
];

export function DtsSearchPanel({ projectId, repository, onSelectHit }: DtsSearchPanelProps) {
  const [q, setQ] = useState("");
  const [by, setBy] = useState<DtsSearchBy>("path");
  const [hits, setHits] = useState<DtsSearchHit[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function runSearch() {
    setLoading(true);
    setError("");
    try {
      const result = await repository.search(projectId, { q, by });
      setHits(result.hits);
      setSearched(true);
    } catch (searchError) {
      setHits([]);
      setSearched(true);
      setError(searchError instanceof Error ? searchError.message : "结构化检索失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dts-search-panel" aria-label="DTS 结构化检索">
      <div className="dts-search-panel__head">
        <h3>结构化检索</h3>
        <p>按路径、@地址、标签、compatible 或属性值检索当前版本的 dts_* 节点。</p>
      </div>
      <form
        className="dts-search-panel__form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <label className="dts-search-panel__field">
          <span>检索关键词</span>
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="例如 chip@6E"
            aria-label="检索关键词"
          />
        </label>
        <label className="dts-search-panel__field">
          <span>检索维度</span>
          <select
            value={by}
            onChange={(event) => setBy(event.target.value as DtsSearchBy)}
            aria-label="检索维度"
          >
            {SEARCH_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button" disabled={loading}>
          {loading ? "检索中…" : "检索"}
        </button>
      </form>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {searched && !error && hits.length === 0 ? (
        <p className="dts-search-panel__empty">无命中结果。</p>
      ) : null}
      {hits.length > 0 ? (
        <ul className="dts-search-panel__hits">
          {hits.map((item) => {
            const key = `${item.fileId}:${item.versionId}:${item.nodePath}:${item.propertyName ?? ""}`;
            return (
              <li key={key} className="dts-search-panel__hit">
                <button
                  type="button"
                  className="dts-search-panel__hit-button"
                  aria-label={`跳转到节点 ${item.nodePath}`}
                  onClick={() => onSelectHit?.(item)}
                >
                  <code className="dts-search-panel__path">{item.nodePath}</code>
                  <span className="dts-search-panel__meta">
                    {item.fileName}
                    {item.propertyName ? ` · ${item.propertyName}` : ""}
                    {item.snippet ? ` · ${item.snippet}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
