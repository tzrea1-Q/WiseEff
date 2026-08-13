import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeRetrievalInfo, KnowledgeSearchResult } from "@/domain/knowledge/types";
import { knowledgeRetrievalModeLabels } from "@/domain/knowledge/types";
import { EmptyState, PanelHeader } from "@/workbenchUi";

/**
 * Related published knowledge for a completed log-analysis record. The parent
 * renders this only for completed analyses and `knowledge:view` holders; the
 * section itself owns loading/error/empty honesty and the citation deep links.
 */
export function RelatedKnowledgeSection({
  logId,
  repository,
  onNavigate
}: {
  logId: string;
  repository: Pick<KnowledgeRepository, "relatedToLog">;
  onNavigate: (path: string) => void;
}) {
  const [items, setItems] = useState<KnowledgeSearchResult[]>([]);
  const [retrieval, setRetrieval] = useState<KnowledgeRetrievalInfo | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrorMessage("");
    repository.relatedToLog(logId).then(
      (response) => {
        if (cancelled) return;
        setItems(response.items);
        setRetrieval(response.retrieval);
        setPhase("ready");
      },
      (error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error && error.message ? error.message : "相关知识加载失败,请稍后重试。");
        setPhase("error");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [logId, reloadToken, repository]);

  return (
    <section
      className="analysis-card logs-v2-analysis logs-related-knowledge"
      aria-label="相关知识"
      data-testid="related-knowledge-section"
    >
      <PanelHeader
        title="相关知识"
        meta={phase === "ready" && retrieval ? `检索模式:${knowledgeRetrievalModeLabels[retrieval.mode]}` : undefined}
      />
      {phase === "loading" ? (
        <p className="logs-related-knowledge__state" role="status">
          正在检索相关知识...
        </p>
      ) : phase === "error" ? (
        <div className="logs-related-knowledge__state logs-related-knowledge__state--error" role="alert">
          <span>{errorMessage}</span>
          <button className="button subtle" type="button" onClick={() => setReloadToken((token) => token + 1)}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState text="暂无相关知识" />
      ) : (
        <ul className="logs-related-knowledge__list">
          {items.map((item) => (
            <li key={item.entryId}>
              <button
                className="logs-related-knowledge__entry"
                type="button"
                onClick={() => onNavigate(`/knowledge?entryId=${encodeURIComponent(item.entryId)}`)}
              >
                <BookOpen size={14} aria-hidden />
                <span>{item.title}</span>
              </button>
              <p className="logs-related-knowledge__excerpt">{item.excerpt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
