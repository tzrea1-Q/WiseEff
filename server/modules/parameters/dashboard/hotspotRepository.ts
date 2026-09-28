import type { Database } from "../../../shared/database/client";
import {
  aggregateBindingDashboardHotspots,
  type BindingDashboardHotspotGroup
} from "../../parameter-bindings/dashboardRead";
import type { HotspotDimension } from "../../../../src/domain/parameters/dashboardTypes";

export type HotspotGroupAggregate = BindingDashboardHotspotGroup;

type AggregateInput = {
  organizationId: string;
  projectId: string | null;
  authorizedProjectIds?: readonly string[] | null;
  dimension: HotspotDimension;
  windowStart: string;
  windowEnd: string;
};

export async function aggregateHotspotGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  return aggregateBindingDashboardHotspots(db, input);
}
