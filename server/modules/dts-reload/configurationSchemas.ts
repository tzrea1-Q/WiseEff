import { z } from "zod";

export const reloadConfigurationContractBodySchema = z.object({
  destinationDirectory: z.string().min(1),
  destinationFilename: z.string().min(1),
  triggerNodePath: z.string().min(1),
  triggerPayload: z.string().min(1),
  kernelLogCommand: z.string().min(1)
});
