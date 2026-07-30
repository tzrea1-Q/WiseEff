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
        `已将 ${candidate.compatible} 晋升为平台级解析（${result.platformSchemaId}），` +
          `影响 ${result.affectedOrganizationIds.length} 个贡献组织；全组织解析匹配将随之更新。`,
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
        `已撤销平台级解析 ${result.platformSchemaId}，` +
          `已恢复 ${result.restoredSchemaIds.length} 条组织级解析覆盖。`,
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
    <section className="platform-console-page" aria-label="平台控制台">
      {error ? <p className="platform-console-page__error" role="alert">{error}</p> : null}
      {notice ? <p className="platform-console-page__notice">{notice}</p> : null}

      {loading ? <p>正在加载晋升候选…</p> : null}

      {!loading && items.length === 0 ? (
        <p className="platform-console-page__empty">当前没有可供审查的组织级解析覆盖候选。</p>
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
                    {candidate.hasActivePlatformOverlay ? " · 已有平台级覆盖" : ""}
                    {candidate.equivalent ? " · 属性等价" : " · 属性不一致"}
                  </span>
                </div>
                <div className="platform-console-candidate__actions">
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() =>
                      setExpandedCompatible(expanded ? null : candidate.compatible)
                    }
                  >
                    {expanded ? "收起差异" : "查看贡献详情"}
                  </button>
                  {canPromote ? (
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() => setConfirmAction({ kind: "promote", candidate })}
                    >
                      晋升至平台
                    </button>
                  ) : null}
                  {candidate.hasActivePlatformOverlay && revertPromotionId ? (
                    <button
                      type="button"
                      className="button subtle"
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
                      平台级解析：<code>{candidate.platformSchemaId}</code>
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
              {confirmAction.kind === "promote" ? "确认晋升为平台级解析" : "确认撤销平台级解析"}
            </h2>
            {confirmAction.kind === "promote" ? (
              <p>
                将把 <strong>{confirmAction.candidate.compatible}</strong> 晋升为平台级解析覆盖，对所有组织生效。
                此次操作影响 <strong>{confirmAction.candidate.contributorCount}</strong> 个贡献组织，
                并改变<strong>全部组织</strong>对该驱动的解析匹配结果。
                各组织原有的组织级解析覆盖将改为展示「官方解析覆盖」，底层记录保留，不会删除。
              </p>
            ) : (
              <p>
                将废弃平台级解析覆盖，并恢复
                <strong>{confirmAction.candidate.contributorCount}</strong> 个组织的组织级解析覆盖。
                全部组织的解析匹配将回退至晋升前状态。
              </p>
            )}
            <div className="platform-console-confirm-dialog__actions">
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
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
