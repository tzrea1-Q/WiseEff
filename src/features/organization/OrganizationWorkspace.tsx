import { useEffect, useMemo, useState } from "react";
import { OrganizationPage, type OrganizationPageProps } from "@/OrganizationPage";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { presentError } from "@/infrastructure/http/presentError";
import { listOrganizationBridges, revokeOrganizationBridge } from "@/infrastructure/http/deviceBridgeClient";
import { createIntegrationCredentialClient } from "@/infrastructure/http/logClient";

/** A URL target owns its clients and view state. No session-wide organization switch. */
export function OrganizationWorkspace({ workspaceClient, ...props }: OrganizationPageProps & { workspaceClient?: OrganizationWorkspaceClient }) {
  const requestedId = new URLSearchParams(props.search).get("organizationId") ?? undefined;
  if (!workspaceClient) return requestedId === undefined ? <OrganizationPage {...props} /> : <SectionEmpty message="当前组织管理连接不支持切换组织。" actionLabel="返回所属组织" onAction={() => props.onNavigate("/organization")} />;
  return <ResolvedOrganizationWorkspace key={requestedId ?? "home"} {...props} requestedId={requestedId} workspaceClient={workspaceClient} />;
}

function ResolvedOrganizationWorkspace({ requestedId, workspaceClient, ...props }: OrganizationPageProps & { requestedId?: string; workspaceClient: OrganizationWorkspaceClient }) {
  const [scope, setScope] = useState<Awaited<ReturnType<typeof workspaceClient.enterOperatingContext>> | null>(null);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null), [projectError, setProjectError] = useState("");
  const operatingId = scope?.organization.id;
  const client = useMemo(() => operatingId ? workspaceClient.forOrganization(operatingId) : null, [operatingId, workspaceClient]);
  const bridgeActions = useMemo(() => ({ list: () => listOrganizationBridges(undefined, operatingId), revoke: (id: string, reason: string) => revokeOrganizationBridge(id, reason, undefined, operatingId) }), [operatingId]);
  const credentialRepository = useMemo(() => createIntegrationCredentialClient(undefined, operatingId), [operatingId]);
  const foreign = Boolean(scope && scope.organization.id !== scope.actor.organization.id);
  const platform = scope?.actor.roles.some((role) => role.projectId === null && role.roleId === "platform-admin");

  useEffect(() => {
    let cancelled = false;
    setError("");
    void workspaceClient.enterOperatingContext(requestedId).then((next) => { if (!cancelled) setScope(next); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法进入该组织，请返回组织目录重试。")); });
    return () => { cancelled = true; };
  }, [workspaceClient, requestedId, attempt]);
  useEffect(() => {
    if (props.area !== "members" || !client) return;
    let cancelled = false;
    setProjects(null); setProjectError("");
    void client.listProjectCandidates().then((next) => { if (!cancelled) setProjects(next); })
      .catch((failure: unknown) => { if (!cancelled) setProjectError(presentError(failure, "无法加载该组织的项目，请重试。")); });
    return () => { cancelled = true; };
  }, [client, props.area, attempt]);

  if (error) return <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!scope || !client) return <SectionSkeleton label="正在进入组织" />;
  return <div>
    <section className="organization-operating-scope" aria-label="当前操作组织">
      <div><span className="organization-operating-scope__label">当前操作组织</span><strong>{scope.organization.name}</strong><Badge variant="secondary">正常</Badge>
        <code>{scope.organization.id}</code>{foreign ? <span>所属组织：{scope.actor.organization.name}</span> : null}</div>
      {platform ? <div className="organization-operating-scope__actions"><Button variant="outline" onClick={() => props.onNavigate("/platform/organizations")}>组织目录</Button>
        {foreign ? <Button variant="outline" onClick={() => props.onNavigate("/organization")}>返回所属组织</Button> : null}</div> : null}
    </section>
    {props.area === "members" && projectError ? <SectionError message={projectError} onRetry={() => setAttempt((value) => value + 1)} />
        : props.area === "members" && !projects ? <SectionSkeleton label="正在加载组织成员工作区" />
          : <OrganizationPage key={`${scope.organization.id}:${props.area ?? "profile"}`} {...props} apiMode directoryScope={scope.organization.id}
            userGovernanceActions={client} organizationActions={client} reviewRolesClient={client} projectCandidates={projects ?? []} bridgeActions={bridgeActions} credentialRepository={credentialRepository}
            onOrganizationUpdated={async (organization) => {
              setScope((current) => current ? { ...current, organization: { id: organization.id, name: organization.name } } : current);
              if (organization.id === scope.actor.organization.id) await props.onOrganizationUpdated?.(organization);
            }} />}
  </div>;
}
