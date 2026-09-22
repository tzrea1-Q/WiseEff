import { z } from "zod";

import { itemEnvelopeSchema } from "./envelopes";

const dashboardWindowSchema = z.enum(["7d", "30d", "180d"]);
const riskAvailabilitySchema = z.enum(["available", "unavailable"]);

const trendPointDtoSchema = z.object({
  bucketStart: z.string(),
  label: z.string(),
  changeCount: z.number(),
  workflowEventCount: z.number()
});

const dashboardKpisDtoSchema = z.object({
  totalParameters: z.number(),
  totalBindings: z.number(),
  totalDefinitions: z.number(),
  managedProjects: z.number(),
  changeFrequency: z.number(),
  activeContributors: z.number(),
  highRiskParameters: z.number().nullable(),
  riskAvailability: riskAvailabilitySchema
});

const personalDashboardKpisDtoSchema = z.object({
  contributionCount: z.number(),
  workflowCount: z.number(),
  openItemCount: z.number(),
  pendingTodoCount: z.number(),
  highRiskTouchCount: z.number().nullable(),
  riskAvailability: riskAvailabilitySchema
});

const dashboardRiskBucketDtoSchema = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  high: z.number().nullable(),
  medium: z.number().nullable(),
  low: z.number().nullable(),
  total: z.number().nullable(),
  riskAvailability: riskAvailabilitySchema
});

const workbenchSignalsDtoSchema = z.object({
  reviewQueue: z.number(),
  myDrafts: z.number(),
  returnedChanges: z.number(),
  waitingMerge: z.number(),
  unappliedImportBatches: z.number(),
  inactiveAccounts: z.number()
});

export const parameterDashboardSummaryDtoSchema = z.object({
  window: dashboardWindowSchema,
  windowLabel: z.string(),
  projectId: z.string().nullable(),
  kpis: dashboardKpisDtoSchema,
  trend: z.array(trendPointDtoSchema),
  personalKpis: personalDashboardKpisDtoSchema,
  personalTrend: z.array(trendPointDtoSchema),
  riskBuckets: z.array(dashboardRiskBucketDtoSchema),
  workbenchSignals: workbenchSignalsDtoSchema
});

export const parameterDashboardSummaryResponseSchema = itemEnvelopeSchema(parameterDashboardSummaryDtoSchema);

