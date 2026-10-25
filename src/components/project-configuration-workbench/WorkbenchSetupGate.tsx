export type WorkbenchSetupGateProps = {
  configSetsLoading: boolean;
  configSetsError: string;
  onConfigSetsRetry: () => void;
  selectedConfigSet: { id: string } | null;
  canAdmin: boolean;
  onCreateConfigSet?: () => void;
  onImportPackage?: () => void;
};

export function WorkbenchSetupGate({
  configSetsLoading,
  configSetsError,
  onConfigSetsRetry,
  selectedConfigSet,
  canAdmin,
  onCreateConfigSet,
  onImportPackage
}: WorkbenchSetupGateProps) {
  if (configSetsLoading) {
    return (
      <div className="configuration-workbench__setup-state" role="status">
        正在加载配置…
      </div>
    );
  }

  if (configSetsError) {
    return (
      <div className="configuration-workbench__setup-state" role="alert">
        <strong>配置加载失败</strong>
        <p>{configSetsError}</p>
        <button className="button subtle" type="button" onClick={onConfigSetsRetry}>
          重试配置
        </button>
      </div>
    );
  }

  if (!selectedConfigSet) {
    return (
      <div className="configuration-workbench__setup-state" role="status">
        <strong>项目还没有配置</strong>
        {canAdmin ? (
          <>
            <p>先创建配置，再添加需要管理的文件。</p>
            {onCreateConfigSet ? <button className="button primary" type="button" onClick={onCreateConfigSet}>新建配置</button> : <p>在「配置」菜单中选择「新建配置…」。</p>}
            {onImportPackage ? <button className="button subtle" type="button" onClick={onImportPackage}>导入完整配置…</button> : null}
          </>
        ) : (
          <p>请联系项目管理员创建配置并添加文件。</p>
        )}
      </div>
    );
  }

  return null;
}
