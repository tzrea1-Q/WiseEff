import { describe, expect, it } from "vitest";

import { initialState } from "@/mockData";
import {
  logRecordFromDto,
  logRecordToDto,
  parameterRecordFromDto,
  parameterRecordToDto
} from "./dto";

describe("http dto mappers", () => {
  it("round-trips a parameter record through the dto boundary", () => {
    const source = initialState.parameters[0];

    expect(parameterRecordFromDto(parameterRecordToDto(source))).toEqual(source);
  });

  it("round-trips a log record through the dto boundary", () => {
    const source = initialState.logs[0];

    expect(logRecordFromDto(logRecordToDto(source))).toEqual(source);
  });
});
