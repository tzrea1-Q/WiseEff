import { formatDriverNatureLabel, formatInstanceCardinalityLabel } from "@/application/parameters/driverRegistrationLabels";
import type { ModuleStructurePreviewResponse } from "@/infrastructure/http/parameterCatalogDtos";

type DriverCreation = NonNullable<ModuleStructurePreviewResponse["driverCreation"]>;

const phaseCopy: Record<DriverCreation["phase"], string> = {
  required: "先发布新驱动，再确认模块和主体归属。发布会将驱动加入共享目录。",
  publishing: "正在发布新驱动，模块与组织登记尚未提交。",
  ready: "驱动已发布，模块与归属尚未提交。请核对最新预览后确认提交。",
  applied: "本次新驱动已登记到当前组织；其他变更仍以下方预览为准。",
  blocked: "新驱动发布暂时无法继续，请按提示处理后重新预览。",
};

export function ModuleStructureDriverCreation({ creation, displayPlacement, canPublish }: {
  creation: DriverCreation;
  displayPlacement: (placement: DriverCreation["drivers"][number]["placement"]) => string;
  canPublish: boolean;
}) {
  return <section className="min-w-0 space-y-3 break-words" aria-label="新增驱动预览">
    <h3>新增驱动（{creation.drivers.length}）</h3>
    <p role="status" aria-label="驱动创建进度">{phaseCopy[creation.phase]}</p>
    {creation.message ? <p>{creation.message}</p> : null}
    {(creation.phase === "required" || creation.phase === "blocked") && !canPublish ? <p role="alert" className="form-error">当前会话没有目录编写或发布权限，无法发布新驱动。</p> : null}
    <ul className="space-y-3">{creation.drivers.map(driver => <li key={driver.ref}>
      <h4>{driver.displayAlias || driver.compatible}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <dt>compatible 标识</dt><dd><code>{driver.compatible}</code></dd>
        <dt>驱动性质</dt><dd>{formatDriverNatureLabel(driver.driverNature)}</dd>
        <dt>实例基数</dt><dd>{formatInstanceCardinalityLabel(driver.instanceCardinality)}</dd>
        <dt>目标模块</dt><dd>{displayPlacement(driver.placement)}</dd>
      </dl>
    </li>)}</ul>
    <p>关闭窗口不会取消已提交的发布。刷新页面后，重新上传同一份 JSON 并点击预览，可继续登记；无需重复创建驱动。</p>
  </section>;
}
