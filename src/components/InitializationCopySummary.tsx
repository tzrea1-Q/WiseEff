import type { InitializationConfigSnapshot } from "@/domain/parameters/initializationTypes";
import { HorizontalDragScroll } from "./HorizontalDragScroll";
import { formatWorkbenchPath } from "@/application/project-configuration/workbenchPath";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";

export function InitializationCopySummary({ snapshots, projects }: { snapshots: InitializationConfigSnapshot[]; projects: Array<{ id: string; name: string }> }) {
  const organizationId = new URLSearchParams(window.location.search).get("organizationId") ?? undefined;
  return <section className="initialization-copy-summary" aria-label="完整配置复制范围">
    <h3>完整配置独立复制</h3>
    <p>全部源码、头文件和构建输入将复制为目标项目的固定私有副本。共享来源也转为私有，源项目或共享版本后续更新不会改变目标项目。</p>
    <p>目标默认配置取自主来源的默认配置；若其为空，采用该项目按名称排序的首个完整配置。其他配置分别保留。</p>
    <HorizontalDragScroll className="project-init-table"><table aria-label="完整配置复制预览">
      <thead><tr><th>来源配置</th><th>文件</th></tr></thead>
      <tbody>{snapshots.map(snapshot => <tr key={`${snapshot.sourceProjectId}:${snapshot.sourceConfigSetId}`}>
        <td><a href={withOrganizationScope(formatWorkbenchPath(snapshot.sourceProjectId, snapshot.sourceConfigRevisionId ? `revision=${encodeURIComponent(snapshot.sourceConfigRevisionId)}` : "", { configSet: snapshot.sourceConfigSetId }), organizationId)} target="_blank" rel="noreferrer">{projects.find(project => project.id === snapshot.sourceProjectId)?.name ?? snapshot.sourceProjectId} · {snapshot.name}</a></td>
        <td>{snapshot.members.map(member => <div key={member.sourceName}><a target="_blank" rel="noreferrer"
          href={withOrganizationScope(formatWorkbenchPath(snapshot.sourceProjectId, new URLSearchParams({ configSet: snapshot.sourceConfigSetId,
            file: member.fileId, version: member.fileVersionId, ...(snapshot.sourceConfigRevisionId ? { revision: snapshot.sourceConfigRevisionId } : {}) }).toString(),
            { configSet: snapshot.sourceConfigSetId, sourceMode: "history", inspector: "file" }), organizationId)}>{member.sourceName}</a>
          {member.sharedVersion ? "（共享来源 → 项目私有）" : ""}</div>)}</td>
      </tr>)}</tbody>
    </table></HorizontalDragScroll>
  </section>;
}
