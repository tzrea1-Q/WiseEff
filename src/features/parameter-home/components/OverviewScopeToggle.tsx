import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OverviewScope } from "@/domain/parameters/dashboardTypes";

type Props = {
  scope: OverviewScope;
  onScopeChange: (scope: OverviewScope) => void;
};

export function OverviewScopeToggle({ scope, onScopeChange }: Props) {
  return (
    <ToggleGroup
      aria-label="概览视角"
      className="parameter-home__toggle-group parameter-home__overview-scope-toggle"
      type="single"
      value={scope}
      onValueChange={(next) => {
        if (next) onScopeChange(next as OverviewScope);
      }}
    >
      <ToggleGroupItem className="parameter-home__toggle-item" value="personal">
        个人
      </ToggleGroupItem>
      <ToggleGroupItem className="parameter-home__toggle-item" value="overall">
        整体
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
