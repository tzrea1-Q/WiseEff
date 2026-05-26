import type { ParameterRecord } from "@/domain/parameters/types";

export type ParameterRecordDto = {
  id: ParameterRecord["id"];
  name: ParameterRecord["name"];
  description: ParameterRecord["description"];
  explanation: ParameterRecord["explanation"];
  configFormat: ParameterRecord["configFormat"];
  module: ParameterRecord["module"];
  projectId: ParameterRecord["projectId"];
  currentValue: ParameterRecord["currentValue"];
  recommendedValue: ParameterRecord["recommendedValue"];
  range: ParameterRecord["range"];
  unit: ParameterRecord["unit"];
  risk: ParameterRecord["risk"];
  updatedAt: ParameterRecord["updatedAt"];
  updatedAtTs: ParameterRecord["updatedAtTs"];
  history: ParameterRecord["history"];
};

export function parameterRecordFromDto(dto: ParameterRecordDto): ParameterRecord {
  return { ...dto };
}

export function parameterRecordToDto(record: ParameterRecord): ParameterRecordDto {
  return { ...record };
}
