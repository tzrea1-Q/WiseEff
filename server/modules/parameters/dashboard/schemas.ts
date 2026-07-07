import { z } from "zod";

export const dashboardWindowSchema = z.enum(["7d", "30d", "180d"]);
export const hotspotDimensionSchema = z.enum(["overall", "module", "project", "parameter"]);

export const dashboardSummaryQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  window: dashboardWindowSchema.default("30d")
});

export const dashboardHotspotsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  window: dashboardWindowSchema.default("30d"),
  dimension: hotspotDimensionSchema.default("overall")
});
