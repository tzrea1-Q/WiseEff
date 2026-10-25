import { useId, useRef } from "react";
import { X } from "lucide-react";
import type { ConfigSetRole, DtsConfigSet, DtsConfigSetMemberFile } from "@/application/ports/DtsStructuredRepository";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./workbench-configuration-files-dialog.css";

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础", overlay: "覆盖层", charging: "充电", thermal: "温控", misc: "其他"
};

export type WorkbenchConfigurationFilesDialogProps = {
  open: boolean;
  onClose: () => void;
  configSet: DtsConfigSet;
  members: DtsConfigSetMemberFile[];
  canAdmin: boolean;
  pendingAction: string | null;
  loading: boolean;
  error: string;
  operationError?: string;
  ready: boolean;
  canonical: boolean;
  onRetry: () => void;
  availableFiles: ProjectParameterFile[];
  addErrors: Readonly<Record<string, string>>;
  memberFileId: string;
  memberRole: ConfigSetRole;
  memberSortOrder: number;
  onMemberFileIdChange: (fileId: string) => void;
  onMemberRoleChange: (role: ConfigSetRole) => void;
  onMemberSortOrderChange: (sortOrder: number) => void;
  onAddMember: () => void;
  onRemoveMember: (member: DtsConfigSetMemberFile) => void;
  onReviewedMemberRemoval?: (member: DtsConfigSetMemberFile) => void;
  canRequestReviewedMemberRemoval: boolean;
  onOpenFile: (fileId: string) => void;
  onUpdateFile: (fileId: string) => void;
  onOpenVersions: (fileId: string) => void;
  onAddSourceFile: () => void;
  onCanonicalAdd?: () => void;
  onSetRoot?: (member: DtsConfigSetMemberFile) => void;
  onSwitchSharedVersion?: (member:DtsConfigSetMemberFile)=>void;
  onCreateShared?: (member: DtsConfigSetMemberFile) => void;
  onConvertShared?: (member: DtsConfigSetMemberFile) => void;
};

export function WorkbenchConfigurationFilesDialog({
  open, onClose, configSet, members, canAdmin, pendingAction, loading, error, operationError = "", ready, canonical, onRetry,
  availableFiles, addErrors, memberFileId, memberRole, memberSortOrder, onMemberFileIdChange,
  onMemberRoleChange, onMemberSortOrderChange, onAddMember, onRemoveMember, canRequestReviewedMemberRemoval,
  onOpenFile, onUpdateFile, onOpenVersions, onAddSourceFile, onCanonicalAdd, onReviewedMemberRemoval, onSetRoot,onSwitchSharedVersion,onCreateShared,onConvertShared
}: WorkbenchConfigurationFilesDialogProps) {
  const addErrorId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = pendingAction === "create-shared" || pendingAction === "add-member" || pendingAction === "remove-member" || Boolean(pendingAction?.startsWith("remove-member-"));
  const checked = ready && !loading && !error;
  const canAdd = canAdmin && checked && !canonical && !onCanonicalAdd;
  const canRemove = (member: DtsConfigSetMemberFile) => !member.sharedReference && canAdmin && checked
    && (!canonical || canRequestReviewedMemberRemoval);
  const addError = addErrors[memberFileId];
  const selectedFileAvailable = availableFiles.some((file) => file.id === memberFileId);

  return <ModalDialog open={open} onDismiss={busy ? undefined : onClose}
    className="workbench-configuration-files-dialog" backdropClassName="param-admin-modal-backdrop" describedBy initialFocusRef={closeRef}>
    {({ titleId, descriptionId }) => <>
      <header className="workbench-configuration-files-dialog__header">
        <div>
          <h2 id={titleId}>配置组成</h2>
          <p id={descriptionId}>{configSet.name === "default" ? "默认配置" : configSet.name} · {members.length} 个文件{!canAdmin ? " · 只读" : ""}</p>
        </div>
        <Button ref={closeRef} type="button" variant="ghost" size="icon-sm" aria-label="关闭配置组成" disabled={busy} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="workbench-configuration-files-dialog__body" aria-busy={loading || busy}>
        {canonical ? <p className="workbench-configuration-files-dialog__note">此配置已登记来源。添加或移除文件均需预览并确认，项目文件及历史会保留。</p> : null}
        {canAdmin && checked && onCreateShared ? <p className="workbench-configuration-files-dialog__note">创建共享资源会把所选私有源码及依赖复制到本组织共享草稿；原项目配置保留。</p> : null}
        {canAdmin && checked && onCanonicalAdd ? <Button type="button" disabled={busy} onClick={onCanonicalAdd}>添加配置文件</Button> : null}
        {loading ? <p role="status">正在核对配置文件…</p> : null}
        {busy && pendingAction !== "add-member" ? <p role="status">{pendingAction === "create-shared" ? "正在读取冻结源码及依赖…" : "正在移除文件…"}</p> : null}
        {operationError ? <p className="workbench-configuration-files-dialog__operation-error" role="alert">{operationError}</p> : null}
        {error ? <div className="workbench-configuration-files-dialog__error" role="alert">
          <p>{error}</p><Button type="button" variant="outline" size="sm" disabled={loading || busy} onClick={onRetry}>重新核对</Button>
        </div> : null}
        {!ready && !loading && !error ? <div className="workbench-configuration-files-dialog__status">
          <p>尚未完成配置文件来源核对。</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>核对来源</Button>
        </div> : null}
        {members.length ? <Table aria-label="配置文件" className="workbench-configuration-files-dialog__table">
          <TableHeader><TableRow>
            <TableHead>文件名</TableHead><TableHead>格式</TableHead><TableHead>用途</TableHead><TableHead>当前版本</TableHead>
            {members.length > 1 ? <TableHead>顺序</TableHead> : null}<TableHead className="workbench-configuration-files-dialog__actions-heading">操作</TableHead>
          </TableRow></TableHeader>
          <TableBody>{members.map((member) => <TableRow key={member.fileId}>
            <TableCell className="workbench-configuration-files-dialog__name">
              <Button type="button" variant="link" className="workbench-configuration-files-dialog__file-link" disabled={busy}
                onClick={() => onOpenFile(member.fileId)}>{member.fileName}</Button>
              <p>{member.sharedReference ? `共享引用 · 版本 ${member.sharedReference.version} · 只读` : "项目私有源码"}</p>
            </TableCell>
            <TableCell>{member.format.toUpperCase()}</TableCell><TableCell>{ROLE_LABELS[member.role]}</TableCell>
            <TableCell>{member.currentVersionNumber === undefined ? "暂无版本" : `版本 ${member.currentVersionNumber}`}</TableCell>
            {members.length > 1 ? <TableCell>{member.sortOrder}</TableCell> : null}
            <TableCell><div className="workbench-configuration-files-dialog__row-actions">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => member.sharedReference ? onOpenFile(member.fileId) : onUpdateFile(member.fileId)}>{member.sharedReference ? "查看源码" : canAdmin ? "更新文件" : "更新记录"}</Button>
              <RowActionMenu label={`${member.fileName} 文件操作`} triggerLabel={`${member.fileName} 更多`} items={[
                { id: "versions", label: "版本历史与下载", disabled: busy, onSelect: () => onOpenVersions(member.fileId) },
                ...(canAdmin&&checked&&member.sharedReference?.direct&&onSwitchSharedVersion
                  && members.find(item=>item.sharedReference?.resourceId===member.sharedReference!.resourceId)?.fileId===member.fileId
                  ?[{id:"switch-shared",label:"切换共享版本",disabled:busy,onSelect:()=>onSwitchSharedVersion(member)}]:[]),
                ...(canAdmin && checked && !member.sharedReference && member.format === "dts" && /\.dtsi?$/u.test(member.fileName) && onCreateShared
                  ? [{id:"create-shared",label:"创建共享资源",disabled:busy,onSelect:()=>onCreateShared(member)}] : []),
                ...(canAdmin && checked && !member.sharedReference && member.format === "dts" && /\.dtsi?$/u.test(member.fileName) && onConvertShared
                  ? [{id:"convert-shared",label:"转换为共享引用",disabled:busy,onSelect:()=>onConvertShared(member)}] : []),
                ...(canAdmin && checked && !member.sharedReference && member.format === "dts" && member.role !== "base" && onSetRoot
                  ? [{ id: "set-root", label: "设为根文件", disabled: busy, onSelect: () => onSetRoot(member) }] : []),
                ...(canRemove(member) ? [{ id: "remove", label: canonical ? "预览移除影响" : "从配置移除", destructive: true as const,
                  disabled: busy, onRequestConfirmation: () => onRemoveMember(member) }] : []),
                ...(canRemove(member) && canonical && member.format === "json" && onReviewedMemberRemoval ? [{ id: "remove-review", label: "申请从配置移除", destructive: true as const,
                  disabled: busy, onRequestConfirmation: () => onReviewedMemberRemoval(member) }] : [])
              ]} />
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : checked ? <div className="workbench-configuration-files-dialog__empty">
          <p>此配置暂无文件。</p>
          <Button type="button" disabled={busy} onClick={onAddSourceFile}>{canAdd ? "上传来源文件" : "更新记录"}</Button>
        </div> : null}
        {members.some(canRemove) ? <p className="workbench-configuration-files-dialog__note">移除仅解除配置关联，不会删除项目文件。</p> : null}
        {canAdd && availableFiles.length ? <form className="workbench-configuration-files-dialog__add" onSubmit={(event) => {
          event.preventDefault();
          if (!busy && selectedFileAvailable && !addError) onAddMember();
        }}>
          <h3>添加项目文件</h3>
          <div className="workbench-configuration-files-dialog__fields">
            <label>文件<SelectControl ariaLabel="待加入文件" value={memberFileId} placeholder="选择项目文件" disabled={busy}
              ariaInvalid={Boolean(addError)} ariaDescribedBy={addError ? addErrorId : undefined}
              onValueChange={onMemberFileIdChange} options={availableFiles.map((file) => ({ value: file.id, label: file.fileName }))} /></label>
            <label>用途<SelectControl ariaLabel="文件用途" value={memberRole} disabled={busy} onValueChange={onMemberRoleChange}
              options={(Object.keys(ROLE_LABELS) as ConfigSetRole[]).map((role) => ({ value: role, label: ROLE_LABELS[role] }))} /></label>
            <label>顺序<Input type="number" aria-label="文件顺序" value={memberSortOrder} disabled={busy}
              onChange={(event) => onMemberSortOrderChange(Number(event.target.value) || 0)} /></label>
            <Button type="submit" disabled={busy || !selectedFileAvailable || Boolean(addError)}>{pendingAction === "add-member" ? "添加中…" : "添加文件"}</Button>
          </div>
          {addError ? <p id={addErrorId} role="alert">{addError}</p> : null}
        </form> : null}
      </div>
    </>}
  </ModalDialog>;
}
