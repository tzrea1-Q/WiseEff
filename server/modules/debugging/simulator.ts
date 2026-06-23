import type {
  DebugDeviceGateway,
  GatewayNodeResult,
  GatewayReadInput,
  GatewayTarget,
  GatewayWriteInput,
  GatewayWriteResult
} from "./gateway";

type SimulatorTarget = GatewayTarget & {
  projectId?: string;
  nodes: Record<string, string>;
  readOnlyNodes?: string[];
  readbackMismatchNodes?: string[];
};

type SimulatorState = {
  targets: SimulatorTarget[];
};

type SimulatorGatewayOptions = {
  targets?: SimulatorTarget[];
  now?: () => number;
};

const defaultSimulatorState: SimulatorState = {
  targets: [
    {
      id: "sim-target-aurora-1",
      deviceId: "sim-device-aurora-1",
      targetRef: "simulator://aurora-1",
      label: "Aurora Simulator 1",
      online: true,
      nodes: {
        "/sys/class/power_supply/battery/constant_charge_current": "3000",
        "/sys/class/power_supply/battery/input_current_limit": "2800",
        "/sys/class/power_supply/battery/temp_limit": "45",
        "/sys/class/power_supply/battery/cycle_count": "128",
        "/sys/class/power_supply/battery/readback_mismatch": "1",
        "/sys/class/debug/config_json": '{\n  "enabled": true,\n  "limit": 42\n}'
      },
      readOnlyNodes: ["/sys/class/power_supply/battery/cycle_count"],
      readbackMismatchNodes: ["/sys/class/power_supply/battery/readback_mismatch"]
    }
  ]
};

export function createSimulatorDebugDeviceGateway(options: SimulatorGatewayOptions = {}): DebugDeviceGateway {
  const targets = options.targets ?? defaultSimulatorState.targets;
  const now = options.now ?? (() => 0);
  const nodeValues = new Map(targets.map((target) => [target.targetRef, new Map(Object.entries(target.nodes))]));

  function durationSince(startedAt: number) {
    return Math.max(1, now() - startedAt);
  }

  function findTarget(targetRef: string) {
    return targets.find((target) => target.targetRef === targetRef);
  }

  function unavailableResult(input: GatewayReadInput, startedAt: number): GatewayNodeResult | undefined {
    const target = findTarget(input.targetRef);

    if (!target || !target.online) {
      return {
        ok: false,
        stderr: `Target ${input.targetRef} is offline or unavailable.`,
        error: `Target ${input.targetRef} is offline or unavailable.`,
        durationMs: durationSince(startedAt)
      };
    }

    return undefined;
  }

  function readNodeValue(input: GatewayReadInput, startedAt: number): GatewayNodeResult {
    const unavailable = unavailableResult(input, startedAt);

    if (unavailable) {
      return unavailable;
    }

    const value = nodeValues.get(input.targetRef)?.get(input.nodePath);

    if (value === undefined) {
      return {
        ok: false,
        stderr: `Node ${input.nodePath} was not found.`,
        error: `Node ${input.nodePath} was not found.`,
        durationMs: durationSince(startedAt)
      };
    }

    return {
      ok: true,
      value,
      stdout: value,
      durationMs: durationSince(startedAt)
    };
  }

  return {
    async detectTargets(input) {
      const requestedTargets = targets
        .filter((target) => (target.projectId ? target.projectId === input.projectId : input.projectId === "aurora"))
        .filter((target) => (input.deviceId ? target.deviceId === input.deviceId : true))
        .map(({ nodes: _nodes, readOnlyNodes: _readOnlyNodes, readbackMismatchNodes: _mismatchNodes, projectId: _projectId, ...target }) => target);

      return {
        ok: true,
        targets: requestedTargets
      };
    },

    async readNode(input) {
      const startedAt = now();

      return readNodeValue(input, startedAt);
    },

    async writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult> {
      const startedAt = now();
      const unavailable = unavailableResult(input, startedAt);
      const target = findTarget(input.targetRef);

      if (unavailable || !target) {
        const writeResult = unavailable ?? {
          ok: false,
          stderr: `Target ${input.targetRef} is offline or unavailable.`,
          error: `Target ${input.targetRef} is offline or unavailable.`,
          durationMs: durationSince(startedAt)
        };

        return {
          ok: false,
          verified: false,
          error: writeResult.error,
          writeResult
        };
      }

      if (target.readOnlyNodes?.includes(input.nodePath)) {
        const writeResult: GatewayNodeResult = {
          ok: false,
          stderr: "Node is read-only.",
          error: "Node is read-only.",
          durationMs: durationSince(startedAt)
        };

        return {
          ok: false,
          verified: false,
          error: "Node is read-only.",
          writeResult
        };
      }

      if (!nodeValues.get(input.targetRef)?.has(input.nodePath)) {
        const writeResult: GatewayNodeResult = {
          ok: false,
          stderr: `Node ${input.nodePath} was not found.`,
          error: `Node ${input.nodePath} was not found.`,
          durationMs: durationSince(startedAt)
        };

        return {
          ok: false,
          verified: false,
          error: writeResult.error,
          writeResult
        };
      }

      nodeValues.get(input.targetRef)?.set(input.nodePath, input.value);

      const writeResult: GatewayNodeResult = {
        ok: true,
        value: input.value,
        stdout: input.value,
        durationMs: durationSince(startedAt)
      };

      if (!input.readBack) {
        return {
          ok: true,
          value: input.value,
          verified: true,
          writeResult
        };
      }

      if (target.readbackMismatchNodes?.includes(input.nodePath)) {
        nodeValues.get(input.targetRef)?.set(input.nodePath, "1");
      }

      const readResult = readNodeValue({ ...input, preserveExactRead: input.preserveExactRead ?? false }, startedAt);

      const readbackMatches = input.compareReadback
        ? input.compareReadback(input.value, readResult.value ?? "")
        : readResult.ok && readResult.stdout === input.value;

      return {
        ok: true,
        value: input.value,
        verified: readbackMatches,
        error: readbackMatches ? undefined : "Readback mismatch.",
        writeResult,
        readResult
      };
    }
  };
}
