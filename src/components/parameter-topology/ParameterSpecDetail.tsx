import { presentError } from "@/infrastructure/http/presentError";
import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";

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
  link?: {
    search: (q: string) => Promise<{ entryId: string; title: string }[]>;
    add: (entryId: string, definitionId: string) => Promise<void>;
  };
};

export function SpecRelatedKnowledgeSection({
  specId,
  source,
  allowLink = false,
}: {
  specId: string;
  source: SpecRelatedKnowledgeSource;
  allowLink?: boolean;
}) {
  const [items, setItems] = useState<SpecRelatedKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

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
  }, [source, specId, refresh]);

  return (
    <fieldset className="def-group" data-testid="spec-related-knowledge">
      <legend>相关知识</legend>
      <div className="def-group-fields def-group-fields--stack">
        {allowLink && source.link ? <button type="button" className="btn-secondary" onClick={() => setPickerOpen(true)}>关联已有知识</button> : null}
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
      {pickerOpen && source.link ? <ExistingKnowledgePicker link={source.link} definitionId={specId}
        onClose={() => setPickerOpen(false)} onLinked={() => { setPickerOpen(false); setRefresh((value) => value + 1); }} /> : null}
    </fieldset>
  );
}

function ExistingKnowledgePicker({ link, definitionId, onClose, onLinked }: {
  link: NonNullable<SpecRelatedKnowledgeSource["link"]>;
  definitionId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState({ q: "" });
  const [items, setItems] = useState<{ entryId: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    link.search(search.q).then((loaded) => { if (!cancelled) setItems(loaded); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "知识条目加载失败，请重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [link, search]);
  async function add(entryId: string) {
    setPending(true);
    setError("");
    try {
      await link.add(entryId, definitionId);
      onLinked();
    } catch (failure) {
      setError(presentError(failure, "关联失败，请重试。"));
    } finally {
      setPending(false);
    }
  }
  return <ModalDialog open onDismiss={pending ? undefined : onClose} backdropClassName="knowledge-modal-backdrop"
    className="flex max-h-[calc(100dvh-48px)] w-[min(560px,calc(100vw-48px))] flex-col gap-4 overflow-hidden rounded-xl bg-card p-5 shadow-xl" describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>关联已有知识</h2>
      <p id={descriptionId} className="muted small">选择你可管理的未归档条目。关联草稿后，发布才会显示在相关知识中。</p>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearch({ q: q.trim() }); }}>
        <input type="search" aria-label="搜索已有知识" value={q} onChange={(event) => setQ(event.target.value)} disabled={pending} />
        <button type="submit" className="btn-secondary" disabled={pending}>搜索</button>
      </form>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="min-h-0 overflow-y-auto" aria-busy={loading || pending}>
        {loading ? <p>正在加载知识条目…</p> : items.length === 0 ? <p>没有可关联的知识条目，请调整搜索条件。</p> :
          <ul className="param-admin-related-knowledge-list">{items.map((item) => <li key={item.entryId}>
            <button type="button" className="param-admin-related-knowledge-item" disabled={pending} onClick={() => void add(item.entryId)}>
              <span className="param-admin-related-knowledge-item__title">{item.title}</span>
            </button>
          </li>)}</ul>}
      </div>
      <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>取消</button>
    </>}
  </ModalDialog>;
}
