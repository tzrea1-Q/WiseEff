import { mapPublicationFact } from "./dto";
import { fingerprintIdSelection } from "./query";
import type {
  RegistrationProjectionPort,
  TimelineComposerPort,
  UsageProjectionPort,
} from "./types";

const emptySelection = { kind: "only" as const, ids: [] as const, fingerprint: fingerprintIdSelection([]) };

export const unregisteredProjection: RegistrationProjectionPort = {
  async projectSubject() {
    return {
      registration: { status: "unregistered" },
      reviewCount: 0,
    };
  },
  async projectDefinition() {
    return { status: "unregistered" };
  },
  async selectSubjectIds({ registration }) {
    if (registration === "active" || registration === "retired") {
      return emptySelection;
    }
    return { kind: "all" };
  },
  async selectDefinitionIds({ registration }) {
    if (registration === "active" || registration === "retired") {
      return emptySelection;
    }
    return { kind: "all" };
  },
};

export const zeroUsageProjection: UsageProjectionPort = {
  async summarize() {
    return { policyCount: 0, projectCount: 0, currentValueCount: 0 };
  },
};

export const kernelOnlyTimelineComposer: TimelineComposerPort = {
  async compose({ facts, next }) {
    return {
      items: facts.map(mapPublicationFact),
      next,
    };
  },
};
