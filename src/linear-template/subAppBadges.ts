import type { PrototypeState } from "../mockData";

export type SubAppBadge = {
  count: number;
  label: string;
};

export type SubAppBadges = {
  parameterManagement: SubAppBadge;
  logAnalysis: SubAppBadge;
  parameterDebugging: SubAppBadge;
};

export function deriveSubAppBadges(state: PrototypeState): SubAppBadges {
  const pendingRequests = state.parameterSubmissionRounds.filter((round) => round.status === "待审阅").length;
  const completedLogs = state.logs.filter((log) => log.status === "Complete").length;
  const connectedDevices = state.devices.filter((device) => device.status === "已连接").length;

  return {
    parameterManagement: {
      count: pendingRequests,
      label: pendingRequests === 0 ? "暂无待办" : `${pendingRequests} 条待审阅`
    },
    logAnalysis: {
      count: completedLogs,
      label: completedLogs === 0 ? "暂无记录" : `已分析 ${completedLogs} 份`
    },
    parameterDebugging: {
      count: connectedDevices,
      label: connectedDevices === 0 ? "暂无在线设备" : `${connectedDevices} 台样机在线`
    }
  };
}
