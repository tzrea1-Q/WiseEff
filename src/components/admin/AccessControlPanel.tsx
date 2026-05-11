import { Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogAdminRole, LogAdminUser, LogAdminUserAvatarTone } from "@/mockData";

export type AccessControlPanelProps = {
  users: LogAdminUser[];
  onRoleChange: (userId: string, role: LogAdminRole) => void;
  onAddClick: () => void;
  onRemove: (userId: string) => void;
  canManage: boolean;
  showRoleLegend?: boolean;
  className?: string;
};

const avatarColors: Record<LogAdminUserAvatarTone, string> = {
  blue: "bg-blue-100 text-blue-900",
  teal: "bg-teal-100 text-teal-900",
  violet: "bg-violet-100 text-violet-900",
  slate: "bg-slate-200 text-slate-800"
};

const roleBadgeClasses: Record<LogAdminRole, string> = {
  Admin: "bg-primary/10 text-primary",
  Editor: "bg-emerald-100 text-emerald-900",
  Viewer: "bg-muted text-muted-foreground"
};

export function AccessControlPanel({
  users,
  onRoleChange,
  onAddClick,
  onRemove,
  canManage,
  showRoleLegend = true,
  className
}: AccessControlPanelProps) {
  const managementTitle = canManage ? undefined : "需要 Admin 权限";

  return (
    <section className={cn("flex flex-col rounded-lg border border-border bg-card", className)}>
      <header className="flex items-center justify-between border-b border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">后台访问权限</h3>
        <button
          type="button"
          onClick={onAddClick}
          disabled={!canManage}
          title={managementTitle}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <UserPlus className="size-3.5" />
          添加
        </button>
      </header>

      <ul className="flex-1 divide-y divide-border overflow-y-auto">
        {users.map((user) => (
          <li key={user.id} className="flex items-center gap-3 p-3">
            <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold", avatarColors[user.avatarTone])}>
              {user.avatarInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.title}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={cn("hidden h-5 items-center rounded-md px-1.5 text-[10px] font-semibold uppercase sm:inline-flex", roleBadgeClasses[user.role])}>
                {user.role}
              </span>
              <select
                aria-label={`${user.name} 的角色`}
                value={user.role}
                disabled={!canManage}
                title={managementTitle}
                onChange={(event) => onRoleChange(user.id, event.target.value as LogAdminRole)}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                <option value="Admin">Admin</option>
                <option value="Editor">Editor</option>
                <option value="Viewer">Viewer</option>
              </select>
              <button
                type="button"
                aria-label={`移除 ${user.name}`}
                disabled={!canManage}
                title={managementTitle}
                onClick={() => onRemove(user.id)}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {showRoleLegend ? (
        <footer className="space-y-1 border-t border-border p-3 text-xs text-muted-foreground">
          <p>Admin：全部管理权限</p>
          <p>Editor：记录处理（重新分析 / 归档）</p>
          <p>Viewer：只读</p>
        </footer>
      ) : null}
    </section>
  );
}
