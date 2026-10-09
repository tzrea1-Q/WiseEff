import { useEffect, useMemo, useState } from "react";

import { buildCatalogHref, EMPTY_CATALOG_URL_ANCHOR } from "@/application/parameter-catalog/urlAnchor";
import { resolveDriverSchemaPromotionRepository } from "@/application/parameters/driverSchemaPromotionResolve";
import type { DriverSchemaPromotionHistoryItem } from "@/application/ports/DriverSchemaPromotionRepository";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";

export function PlatformConsolePage() {
  const client = useMemo(() => resolveDriverSchemaPromotionRepository(), []);
  const [items, setItems] = useState<DriverSchemaPromotionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.listPromotionHistory()
      .then(result => { if (!cancelled) setItems(result.items); })
      .catch(cause => { if (!cancelled) setError(presentError(cause, "无法加载晋升历史。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client]);

  return (
    <section className="platform-console-page" aria-label="平台控制台">
      <div className="platform-console-candidate">
        <div className="platform-console-candidate__head">
          <h2><strong>覆盖解析已退役</strong></h2>
          <a className="button subtle" href={buildCatalogHref(EMPTY_CATALOG_URL_ANCHOR)}>前往 Catalog</a>
        </div>
        <p className="platform-console-candidate__meta">组织覆盖解析编写、激活、平台晋升与撤销已退役。覆盖变更请提交定义提案，并通过 Catalog 发布流程生效。历史记录仅供查阅，不代表当前规范目录。</p>
      </div>
      <h3 className="platform-console-candidate__meta"><strong>晋升历史（只读）</strong></h3>
      {loading ? <p role="status">正在加载晋升历史…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p>没有历史晋升记录。</p> : null}
      <ul className="platform-console-candidate-list">
        {items.map(item => (
          <li key={item.id} className="platform-console-candidate">
            <div className="platform-console-candidate__head"><strong>{item.id}</strong></div>
            <dl>
              <dt>原平台解析</dt><dd>{item.platformSchemaId}</dd>
              <dt>原组织解析</dt><dd>{item.sourceSchemaId}</dd>
              <dt>贡献组织</dt><dd>{item.sourceOrganizationId}</dd>
              <dt>历史操作人</dt><dd>{item.promotedByUserId ?? "未记录"}</dd>
              <dt>历史晋升时间</dt><dd><time dateTime={item.promotedAt} title={item.promotedAt}>{formatAbsolute(item.promotedAt)}</time></dd>
              <dt>文档来源</dt><dd>{item.documentationSource ?? "未记录"}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
