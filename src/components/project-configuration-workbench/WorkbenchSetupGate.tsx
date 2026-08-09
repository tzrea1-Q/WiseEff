export type WorkbenchSetupGateProps = {
  configSetsLoading: boolean;
  configSetsError: string;
  onConfigSetsRetry: () => void;
  selectedConfigSet: { id: string } | null;
  canAdmin: boolean;
};

export function WorkbenchSetupGate({
  configSetsLoading,
  configSetsError,
  onConfigSetsRetry,
  selectedConfigSet,
  canAdmin
}: WorkbenchSetupGateProps) {
  if (configSetsLoading) {
    return (
      <div className="configuration-workbench__setup-state" role="status">
        正在加载配置集…
      </div>
    );
  }

  if (configSetsError) {
    return (
      <div className="configuration-workbench__setup-state" role="alert">
        <strong>配置集加载失败</strong>
        <p>{configSetsError}</p>
        <button className="button subtle" type="button" onClick={onConfigSetsRetry}>
          重试配置集
        </button>
      </div>
    );
  }

  if (!selectedConfigSet) {
    return (
      <div className="configuration-workbench__setup-state" role="status">
        <strong>项目还没有配置集</strong>
        {canAdmin ? (
          <>
            <p>
              从配置集下拉框选择「+ 新建配置集…」即可创建。上传文件或候选不会自动激活工作配置；创建后需明确把文件编入成员。
            </p>
            <p className="configuration-workbench__empty-hint">上传不会自动激活工作配置。</p>
          </>
        ) : (
          <p>当前账号无法创建配置集。只读上下文仍可查看；请联系管理员完成初始化。</p>
        )}
      </div>
    );
  }

  return null;
}
