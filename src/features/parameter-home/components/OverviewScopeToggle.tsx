import { ViewSwitch } from "@/components/ui/view-switch";
import type { OverviewScope } from "@/domain/parameters/dashboardTypes";

type Props = {
  scope: OverviewScope;
  onScopeChange: (scope: OverviewScope) => void;
};

export function OverviewScopeToggle({ scope, onScopeChange }: Props) {
  return (
    <ViewSwitch
      variant="toggle"
      ariaLabel="概览视角"
      value={scope}
      onValueChange={(next) => onScopeChange(next as OverviewScope)}
      items={[{ value: "personal", label: "个人" }, { value: "overall", label: "整体" }]}
    />
  );
}
