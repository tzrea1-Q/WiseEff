import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveDriverSchemaPromotionRepository } from "@/application/parameters/driverSchemaPromotionResolve";
import type {
  PromotionCandidate,
  PromoteDriverSchemaOverlayInput,
} from "@/application/ports/DriverSchemaPromotionRepository";

type ConfirmAction =
  | { kind: "promote"; candidate: PromotionCandidate }
  | { kind: "revert"; candidate: PromotionCandidate; promotionId: string };

export function PlatformConsolePage() {
  const client = useMemo(() => resolveDriverSchemaPromotionRepository(), []);
  const [items, setItems] = useState<PromotionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedCompatible, setExpandedCompatible] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listPromotionCandidates();
      setItems(result.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法加载晋升候选列表。");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runPromote = async (candidate: PromotionCandidate) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input: PromoteDriverSchemaOverlayInput = {
        compatible: candidate.compatible,
        documentationSourceOrganizationId: candidate.contributorOrganizationIds[0],
      };
      const result = await client.promoteDriverSchemaOverlay(input);
      setNotice(
        `已将 ${candidate.compatible} 晋升为平台 overlay（${result.platformSchemaId}），` +
          `影响 ${result.affectedOrganizationIds.length} 个组织的贡献 overlay，` +
          `全租户解析覆盖将随之更新。`,
      );
      setConfirmAction(null);
      await refresh();
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : "晋升失败。");
    } finally {
      setBusy(false);
    }
  };

  const runRevert = async (promotionId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.revertDriverSchemaPromotion(promotionId);
      setNotice(
        `已撤销平台 overlay ${result.platformSchemaId}，` +
          `恢复 ${result.restoredSchemaIds.length} 条组织贡献 overlay。`,
      );
      setConfirmAction(null);
      await refresh();
    } catch (revertError) {
      setError(revertError instanceof Error ? revertError.message : "撤销晋升失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="platform-console-page">
      <header className="platform-console-page__header">
        <h1>平台控制台</h1>
        <p>
          审查各组织 active overlay 的 compatible 重复情况，将等价的解析知识晋升为平台 tier。
          晋升后全租户可见，贡献 overlay 标记为已晋升而非删除。
        </p>
      </header>

      {error ? <p className="platform-console-page__error" role="alert">{error}</p> : null}
      {notice ? <p className="platform-console-page__notice">{notice}</p> : null}

      {loading ? <p>正在加载晋升候选…</p> : null}

      {!loading && items.length === 0 ? (
        <p className="platform-console-page__empty">当前没有 active 组织 overlay 可供分组审查。</p>
      ) : null}

      <ul className="platform-console-candidate-list">
        {items.map((candidate) => {
          const expanded = expandedCompatible === candidate.compatible;
          const canPromote =
            candidate.equivalent &&
            !candidate.hasActivePlatformOverlay &&
            candidate.contributorCount > 0;
          const revertPromotionId = candidate.promotionIds?.[0];
          return (
            <li key={candidate.compatible} className="platform-console-candidate">
              <div className="platform-console-candidate__head">
                <div>
                  <strong>{candidate.compatible}</strong>
                  <span className="platform-console-candidate__meta">
                    {candidate.contributorCount} 个组织贡献
                    {candidate.hasActivePlatformOverlay ? " · 已有平台 overlay" : ""}
                    {candidate.equivalent ? " · 属性等价" : " · 属性不一致"}
                  </span>
                </div>
                <div className="platform-console-candidate__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setExpandedCompatible(expanded ? null : candidate.compatible)
                    }
                  >
                    {expanded ? "收起差异" : "查看贡献详情"}
                  </button>
                  {canPromote ? (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() => setConfirmAction({ kind: "promote", candidate })}
                    >
                      晋升
                    </button>
                  ) : null}
                  {candidate.hasActivePlatformOverlay && revertPromotionId ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={busy}
                      onClick={() =>
                        setConfirmAction({
                          kind: "revert",
                          candidate,
                          promotionId: revertPromotionId,
                        })
                      }
                    >
                      撤销晋升
                    </button>
                  ) : null}
                </div>
              </div>

              {expanded ? (
                <div className="platform-console-candidate__body">
                  {!candidate.equivalent && candidate.divergence ? (
                    <div className="platform-console-divergence">
                      <h3>属性不一致（不可晋升）</h3>
                      {candidate.divergence.map((row) => (
                        <div key={row.propertyKey} className="platform-console-divergence__row">
                          <strong>{row.propertyKey}</strong>
                          <table>
                            <thead>
                              <tr>
                                <th>组织</th>
                                <th>值类型</th>
                                <th>单位</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.contributors.map((entry) => (
                                <tr key={entry.organizationId}>
                                  <td>{entry.organizationId}</td>
                                  <td>{entry.valueShapeKind}</td>
                                  <td>{entry.units ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <table className="platform-console-contributors-table">
                      <thead>
                        <tr>
                          <th>组织</th>
                          <th>属性键</th>
                          <th>值类型</th>
                          <th>单位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidate.contributors.flatMap((contributor) =>
                          contributor.properties.map((property) => (
                            <tr key={`${contributor.organizationId}-${property.propertyKey}`}>
                              <td>{contributor.organizationId}</td>
                              <td>{property.propertyKey}</td>
                              <td>{property.valueShapeKind}</td>
                              <td>{property.units ?? "—"}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  )}
                  {candidate.platformSchemaId ? (
                    <p className="platform-console-candidate__platform-link">
                      平台 overlay：<code>{candidate.platformSchemaId}</code>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirmAction ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="确认操作">
          <div className="submission-dialog platform-console-confirm-dialog">
            <h2>
              {confirmAction.kind === "promote" ? "确认晋升为平台 overlay" : "确认撤销平台 overlay"}
            </h2>
            {confirmAction.kind === "promote" ? (
              <p>
                将把 compatible <strong>{confirmAction.candidate.compatible}</strong> 晋升为平台 tier。
                此次操作影响 <strong>{confirmAction.candidate.contributorCount}</strong> 个组织的贡献
                overlay，并将改变<strong>所有租户</strong>对该 compatible 的解析匹配结果。
                贡献 overlay 将标记为已晋升，不会删除。
              </p>
            ) : (
              <p>
                将废弃平台 overlay 并恢复
                <strong>{confirmAction.candidate.contributorCount}</strong> 个组织的贡献 overlay 为
                active。全租户解析覆盖将回退到晋升前状态。
              </p>
            )}
            <div className="platform-console-confirm-dialog__actions">
              <button
                type="button"
                className="ghost-button"
                disabled={busy}
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  if (confirmAction.kind === "promote") {
                    void runPromote(confirmAction.candidate);
                  } else {
                    void runRevert(confirmAction.promotionId);
                  }
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
