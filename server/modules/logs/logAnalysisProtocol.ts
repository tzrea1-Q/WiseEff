import { z } from "zod";

export const logAnalysisProtocolSchema = z.enum(["auto", "tools", "json"]);
export type LogAnalysisProtocol = z.infer<typeof logAnalysisProtocolSchema>;
export const logAnalysisWireProtocolSchema = logAnalysisProtocolSchema.exclude(["auto"]);
export type LogAnalysisWireProtocol = z.infer<typeof logAnalysisWireProtocolSchema>;
