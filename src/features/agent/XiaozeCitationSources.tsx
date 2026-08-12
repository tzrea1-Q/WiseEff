import type { XiaozeCitation } from "./xiaozeTurnReplyTypes";

type XiaozeCitationSourcesProps = {
  citations: XiaozeCitation[] | undefined;
};

export function readCitationsFromMetadata(metadata: Record<string, unknown> | undefined): XiaozeCitation[] {
  const raw = metadata?.citations;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is XiaozeCitation => {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as XiaozeCitation).id === "string" &&
      typeof (entry as XiaozeCitation).label === "string"
    );
  });
}

function dedupeCitations(citations: XiaozeCitation[]): XiaozeCitation[] {
  const seen = new Set<string>();
  const result: XiaozeCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.type ?? ""}:${citation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

/**
 * Renders answer citations as source links. Citations with an href (e.g.
 * knowledge entries deep-linking to /knowledge?entryId=…) become anchors;
 * href-less citations render as plain source chips.
 */
export function XiaozeCitationSources({ citations }: XiaozeCitationSourcesProps) {
  const items = dedupeCitations(citations ?? []);
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="xiaoze-citation-sources" aria-label="引用来源">
      <span className="xiaoze-citation-sources__label">来源</span>
      <ul className="xiaoze-citation-sources__list">
        {items.map((citation) => (
          <li key={`${citation.type ?? ""}:${citation.id}`} className="xiaoze-citation-sources__item">
            {citation.href ? (
              <a
                className="xiaoze-citation-sources__link"
                href={citation.href}
                title={citation.snippet ?? citation.label}
              >
                {citation.label}
              </a>
            ) : (
              <span className="xiaoze-citation-sources__chip" title={citation.snippet ?? citation.label}>
                {citation.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
