import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LogAdminRole } from "@/mockData";

export type AddUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; title: string; role: LogAdminRole }) => void;
};

export function AddUserDialog({ open, onOpenChange, onSubmit }: AddUserDialogProps) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<LogAdminRole>("Editor");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setTitle("");
    setRole("Editor");
    setError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("姓名为必填项");
      return;
    }

    onSubmit({ name: trimmedName, title: title.trim(), role });
    reset();
    onOpenChange(false);
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增后台用户</DialogTitle>
          <DialogDescription>为日志分析管理后台添加一位新用户。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="add-user-name" className="text-sm font-medium text-foreground">
              姓名
            </label>
            <input
              id="add-user-name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="如：Jane Smith"
              aria-invalid={Boolean(error)}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="add-user-title" className="text-sm font-medium text-foreground">
              职位
            </label>
            <input
              id="add-user-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="（可选）"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="add-user-role" className="text-sm font-medium text-foreground">
              角色
            </label>
            <select
              id="add-user-role"
              value={role}
              onChange={(event) => setRole(event.target.value as LogAdminRole)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="Admin">Admin · 全部管理权限</option>
              <option value="Editor">Editor · 记录处理</option>
              <option value="Viewer">Viewer · 只读</option>
            </select>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleCancel}>
              取消
            </Button>
            <Button type="submit">添加</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
