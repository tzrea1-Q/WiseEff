import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { WiseEffIcon } from "@/components/WiseEffIcon";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { createPublicInvitationClient } from "@/infrastructure/http/organizationInvitationsClient";
import { presentError } from "@/infrastructure/http/presentError";
import { platformRoles } from "@/domain/users/types";
import { formatAbsolute } from "@/domain/format/formatDateTime";

export function InvitationAcceptancePage() {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const readLink = () => { setToken(window.location.hash.slice(1)); window.history.replaceState(window.history.state, "", "/invite"); };
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  return <InvitationForm key={token} token={token} />;
}

function InvitationForm({ token }: { token: string }) {
  const [client] = useState(createPublicInvitationClient);
  const [invitation, setInvitation] = useState<Awaited<ReturnType<typeof client.preview>> | null>(null);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [name, setName] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [pending, setPending] = useState(false), [accepted, setAccepted] = useState(false);
  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/invite");
    if (!token) return;
    let cancelled = false;
    setError("");
    void client.preview(token).then((item) => { if (!cancelled) setInvitation(item); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载邀请，请重试。")); });
    return () => { cancelled = true; };
  }, [client, token, attempt]);
  async function accept(event: FormEvent) {
    event.preventDefault(); if (pending || !invitation) return;
    setPending(true); setError("");
    try { await client.accept(token, { name: name.trim(), username: username.trim().toLowerCase(), password }); setPassword(""); setAccepted(true); }
    catch (failure) { setError(presentError(failure, "接受邀请失败，请重试。")); }
    finally { setPending(false); }
  }
  return <main className="auth-screen" aria-labelledby="invitation-title"><section className="auth-panel">
    <div className="auth-brand"><WiseEffIcon className="auth-brand-icon" title="雷泽" /><div><span className="eyebrow">WiseEff</span><h1 id="invitation-title">加入组织</h1></div></div>
    {accepted ? <><p role="status">账号已创建，可直接登录。</p><a className="button" href="/">前往登录</a></> : !token ? <SectionEmpty message="请使用管理员提供的完整邀请链接。链接仅可使用一次。" /> : !invitation ? error ? <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <SectionSkeleton label="正在加载邀请" /> : invitation.status !== "pending" ? <SectionEmpty message="邀请已接受、撤销或过期，请联系管理员获取新链接。" /> : <>
      <p className="auth-help">你将加入 <strong>{invitation.organizationName}</strong>，接受后权限立即生效。</p>
      <p className="auth-help">组织角色：{invitation.roles.map((role) => platformRoles.find((item) => item.id === role)?.name ?? role).join("、")}<br />有效期至 {formatAbsolute(invitation.expiresAt)}</p>
      <div className="auth-help">团队：{invitation.teams.length ? <ul>{invitation.teams.map((team) => <li key={team.id}>{team.name}</li>)}</ul> : "未预设"}</div>
      <div className="auth-help">项目参与：{invitation.projects.length ? <ul>{invitation.projects.map((project) => <li key={project.projectId}>{project.name} · {project.roles.map((role) => platformRoles.find((item) => item.id === role)?.name ?? role).join("、")}</li>)}</ul> : "未预设"}</div>
      <form className="auth-form" onSubmit={(event) => void accept(event)}>
        <label className="auth-field"><span>姓名</span><input autoComplete="name" value={name} maxLength={120} required disabled={pending} onChange={(event) => setName(event.target.value)} /></label>
        <label className="auth-field"><span>用户名</span><input autoComplete="username" value={username} minLength={3} maxLength={64} pattern={"[a-zA-Z0-9._\\-]+"} required disabled={pending} onChange={(event) => setUsername(event.target.value)} /></label>
        <label className="auth-field"><span>设置密码</span><input type="password" autoComplete="new-password" value={password} minLength={8} maxLength={1024} required disabled={pending} onChange={(event) => setPassword(event.target.value)} /></label>
        <p className="auth-help">用户名支持 3–64 位字母、数字、点、下划线和连字符；密码至少 8 位。已有账号请登录后联系管理员管理成员或办理组织调动。</p>
        {error ? <p role="alert" className="auth-error">{error}</p> : null}
        <Button type="submit" disabled={pending}>{pending ? "正在加入…" : "接受邀请并创建账号"}</Button>
      </form>
    </>}
  </section></main>;
}
