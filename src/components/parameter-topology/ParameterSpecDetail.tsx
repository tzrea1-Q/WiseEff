import { presentError } from "@/infrastructure/http/presentError";
import { useEffect, useState } from "react";

/** Published knowledge entry referencing this definition (相关知识). */
export type SpecRelatedKnowledgeItem = {
  entryId: string;
  title: string;
  excerpt: string;
  updatedAt: string;
};

/**
 * Injected only when the caller holds `knowledge:view`; the section is hidden
 * otherwise. The list is published-only server-side (drafts never appear).
 */
export type SpecRelatedKnowledgeSource = {
  load: (specId: string) => Promise<SpecRelatedKnowledgeItem[]>;
  onOpenEntry: (entryId: string) => void;
};

export function SpecRelatedKnowledgeSection({
  specId,
  source,
}: {
  specId: string;
  source: SpecRelatedKnowledgeSource;
}) {
  const [items, setItems] = useState<SpecRelatedKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    source
      .load(specId)
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(presentError(loadError, "相关知识加载失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, specId]);

  return (
    <fieldset className="def-group" data-testid="spec-related-knowledge">
      <legend>相关知识</legend>
      <div className="def-group-fields def-group-fields--stack">
        {loading ? (
          <p className="muted small">正在加载相关知识…</p>
        ) : error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="muted small">暂无引用该定义的已发布知识条目。</p>
        ) : (
          <ul className="param-admin-related-knowledge-list">
            {items.map((item) => (
              <li key={item.entryId}>
                <button
                  type="button"
                  className="param-admin-related-knowledge-item"
                  onClick={() => source.onOpenEntry(item.entryId)}
                >
                  <span className="param-admin-related-knowledge-item__title">{item.title}</span>
                  {item.excerpt ? (
                    <span className="param-admin-related-knowledge-item__excerpt">{item.excerpt}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">仅显示已发布条目；草稿与已归档不出现。</p>
      </div>
    </fieldset>
  );
}
