export type PilotReadinessGateStatus = {
  ok: boolean;
  status: "ready" | "missing" | "failed" | "degraded" | "blocked";
  message?: string;
  details?: Record<string, string | number | boolean>;
};

export type PilotReadinessGateKey =
  | "contract"
  | "auth"
  | "database"
  | "objectStore"
  | "worker"
  | "deviceGateway"
  | "agentProvider"
  | "backups";

export type PilotReadinessInput = Record<PilotReadinessGateKey, PilotReadinessGateStatus>;

export type PilotReadinessResult = {
  ok: boolean;
  status: "pilot_ready" | "blocked";
  blockedBy: PilotReadinessGateKey[];
  gates: PilotReadinessInput;
};

const gateOrder: PilotReadinessGateKey[] = [
  "contract",
  "auth",
  "database",
  "objectStore",
  "worker",
  "deviceGateway",
  "agentProvider",
  "backups"
];

export function buildPilotReadiness(gates: PilotReadinessInput): PilotReadinessResult {
  const blockedBy = gateOrder.filter((gate) => !gates[gate].ok);

  return {
    ok: blockedBy.length === 0,
    status: blockedBy.length === 0 ? "pilot_ready" : "blocked",
    blockedBy,
    gates
  };
}
