import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Optional legacy regenerator for committed `src/config/dts-seed/*-board.dts` artifacts.
 * Product source of truth is the committed board files; hand-edits there are preferred.
 * `buildDtsPowerSeed(primarySource)` remains the catalog derivation API for `db:seed:m1`.
 */
import { resolveDts, type DtsValueType, type ResolvedDts } from "../server/modules/dts";
import {
  BOARD_INSTANCE_MODULE_NAME,
  businessCategoryForNodePath,
  driverGroupDisplayNameFromCompatible,
  planInstanceModulePlacements,
  type ResolvedPlacementNode,
} from "../server/modules/parameter-modules/modulePlacement";
import { isParameterSurfaceRow } from "../server/modules/parameter-topology/parameterSurface";
import { mergePrimaryDtsBoard, primaryBoardFileName } from "./merge-primary-dts";

/** Catalog template: aurora project-primary DTS (parameter library source). */
export const DTS_POWER_SEED_FILE_NAME = "aurora-board.dts";
export const DTS_POWER_SEED_ID_PREFIX = "dts-source-";

export type DtsPowerSeedProjectId = "aurora" | "nebula" | "atlas";
export type DtsPowerSeedRisk = "High" | "Medium" | "Low";

export type DtsPowerSeedParameterValue = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

export type DtsPowerSeedParameter = {
  id: string;
  /** Property key only, e.g. "gpio_int" — never the full source path. */
  name: string;
  /** Driver identity for the owning node: its `compatible` string, or node name when absent. */
  driverModule: string;
  /** Owning node's own segment, e.g. "sc8562@6E" (unit address included when present). */
  instanceName: string;
  /** Full node path in this source version; a locator, not an identity. */
  nodeLocator: string;
  description: string;
  explanation: string;
  configFormat: string;
  businessCategory: string;
  range: string;
  unit: string;
  risk: DtsPowerSeedRisk;
  valueKind: "scalar" | "complex";
  sourceFileName: string;
  sourceNodePath: string;
  values: Record<DtsPowerSeedProjectId, DtsPowerSeedParameterValue>;
};

export type DtsPowerSeedProjectFile = {
  projectId: DtsPowerSeedProjectId;
  fileName: string;
  artifactFileName: string;
  source: string;
};

export type DtsPowerSeed = {
  parameterModules: Array<{
    name: string;
    description: string;
    scope: string;
    parent?: string;
  }>;
  parameterLibrary: DtsPowerSeedParameter[];
  projectFiles: DtsPowerSeedProjectFile[];
};

type SourceOverrideMap = Record<string, string>;

const projectOverrides: Record<Exclude<DtsPowerSeedProjectId, "aurora">, SourceOverrideMap> = {
  nebula: {
    board_id: "<12346>",
    "amba/i2c@FDF5E000/hold-time": "<0x230023>",
    "amba/i2c@FDF5E000/sc8562@6E/watchdog_time": "<3000>",
    "amba/i2c@FDF5E000/sc8562@6E/vout_ovp_mv": "<5200>",
    "spmi1/scharger_v800/scharger_v800_buck/r_charger_uohm": "<900>",
    "spmi1/scharger_v800/scharger_v800_coul/batt_l_v800/r_pcb": "<22500>",
    "hisi_vbat_drop_protect_v2/vbat_drop_vol_mv": "<2450>",
    "hisi_bci_battery/battery_design_fcc": "<5650>",
    "huawei_charger/recharge_para": "<97 50 2 4 1 0 1 100>",
    "charging_core/iin_max": "<2700>",
    "charging_core/ichg_max": "<3000>",
    "wireless_charger/pmax": "<40>",
    "wireless_sc/volt_para00": "\"4580\", \"2000\", \"420\"",
    "direct_charge_comp/status": "\"okay\"",
    "direct_charge_turbo/time_para01": "\"720\", \"7600\", \"0\", \"14000\"",
    "direct_charger/resist_para": "\"0\", \"240\", \"3600\", \"240\", \"32767\", \"2300\"",
    "battery_charge_balance/unbalance_th": "<120 10000>",
    "btb_check/status": "\"okay\"",
    "amba/i2c@FF24E000/mt5788@2B/time_para": "<1900 1350 0 2700>",
    "amba/i2c@FF24E000/hl7603@77/const_vout": "<3700>",
    "amba/i2c@FF24E000/hl7603@75/const_vout": "<3400>"
  },
  atlas: {
    board_id: "<12347>",
    "amba/i2c@FDF5E000/hold-time": "<0x210021>",
    "amba/i2c@FDF5E000/sc8562@6E/watchdog_time": "<8000>",
    "amba/i2c@FDF5E000/sc8562@6E/vout_ovp_mv": "<4800>",
    "spmi1/scharger_v800/scharger_v800_buck/r_charger_uohm": "<1100>",
    "spmi1/scharger_v800/scharger_v800_coul/batt_l_v800/r_pcb": "<24100>",
    "hisi_vbat_drop_protect_v2/vbat_drop_vol_mv": "<2600>",
    "hisi_bci_battery/battery_design_fcc": "<5350>",
    "huawei_charger/recharge_para": "<95 75 4 6 1 0 1 100>",
    "charging_core/iin_max": "<1800>",
    "charging_core/ichg_max": "<2100>",
    "wireless_charger/pmax": "<15>",
    "wireless_sc/volt_para00": "\"4520\", \"1550\", \"340\"",
    "direct_charge_turbo/status": "\"disabled\"",
    "direct_charge_turbo/time_para01": "\"560\", \"6800\", \"0\", \"10500\"",
    "direct_charger/use_5A": "<0>",
    "direct_charger/resist_para": "\"0\", \"280\", \"3000\", \"280\", \"32767\", \"1800\"",
    "battery_charge_balance/unbalance_th": "<80 9000>",
    "amba/i2c@FF24E000/mt5788@2B/time_para": "<1650 1150 0 2200>",
    "amba/i2c@FF24E000/hl7603@77/const_vout": "<3500>",
    "amba/i2c@FF24E000/hl7603@75/const_vout": "<3200>"
  }
};

const moduleMetadata: DtsPowerSeed["parameterModules"] = [
  {
    name: "Power",
    description: "电源域业务模块根。",
    scope: "板级电源与充电相关参数总览"
  },
  {
    name: "Power IC",
    parent: "Power",
    description: "电源管理与充电硬件 IC。",
    scope: "电荷泵、充电 IC、旁路升压等器件"
  },
  {
    name: "Battery",
    parent: "Power",
    description: "电池相关业务模块。",
    scope: "电量、认证、热与均衡"
  },
  {
    name: "Charging",
    parent: "Power",
    description: "充电策略与协议相关模块。",
    scope: "充电策略、直充与无线充"
  },
  {
    name: "Board Identity",
    parent: "Power",
    description: "板级型号、总线骨架与构建身份。",
    scope: "板级唯一标识与基础设备树契约"
  },
  {
    name: "Charge Pump IC",
    parent: "Power IC",
    description: "SC 系列电荷泵及其保护阈值。",
    scope: "电荷泵角色、采样、看门狗与过压保护"
  },
  {
    name: "Charger IC",
    parent: "Power IC",
    description: "有线充电、旁路升压和 PMIC 子设备。",
    scope: "充电硬件电阻、GPIO、角色与输出电压"
  },
  {
    name: "Battery Gauge",
    parent: "Battery",
    description: "双电池容量、OCV 与电量计模型。",
    scope: "容量标定、电阻补偿与电量估算"
  },
  {
    name: "Battery Protection",
    parent: "Battery",
    description: "电池压降保护与 BTB 检测。",
    scope: "压降阈值、性能限制与通路检测"
  },
  {
    name: "Battery Authentication",
    parent: "Battery",
    description: "电池防伪、序列号校验及单总线芯片。",
    scope: "电池身份匹配、GPIO 与校验策略"
  },
  {
    name: "Battery Thermal",
    parent: "Battery",
    description: "多电池温度传感器拟合与补偿。",
    scope: "温度源选择、拟合模式与热参数表"
  },
  {
    name: "Battery Balance",
    parent: "Battery",
    description: "双电池均衡及 CCCV 分段曲线。",
    scope: "电池权重、不均衡阈值和温区充电曲线"
  },
  {
    name: "Charging Policy",
    parent: "Charging",
    description: "有线充电策略、补电与 JEITA 表。",
    scope: "输入/充电电流上限与温区策略"
  },
  {
    name: "Direct Charging",
    parent: "Charging",
    description: "直充 IC、补偿、Turbo 与分段控制表。",
    scope: "LVC/SC/SC4 直充模式与安全曲线"
  },
  {
    name: "Wireless Charging",
    parent: "Charging",
    description: "无线充接收端与 SC 参数。",
    scope: "无线功率、FOD 与模式参数"
  }
];

const propertySemantics: Record<string, string> = {
  board_id: "板级构建标识，用于区分硬件平台或板型变体",
  status: "节点启停状态；ok/okay 表示启用，disabled 表示禁用",
  compatible: "内核驱动匹配字符串，决定节点绑定的驱动实现",
  "hold-time": "I²C 控制器时序保持参数",
  slave_mode: "充电泵主从工作模式",
  ic_role: "器件在多芯片拓扑中的角色编号",
  reg: "设备在父总线上的地址",
  fcp_support: "是否支持 FCP 快充协议",
  scp_support: "是否支持 SCP 快充协议",
  gpio_int: "器件中断 GPIO phandle 与引脚配置",
  gpio_en: "器件使能 GPIO phandle 与引脚配置",
  gpio_enable: "器件使能 GPIO phandle 与引脚配置",
  gpios: "节点使用的 GPIO phandle 与引脚配置",
  sense_r_config: "驱动配置的电流采样电阻值",
  sense_r_actual: "板级实际电流采样电阻值",
  watchdog_time: "充电芯片看门狗超时时间",
  vout_ovp_mv: "输出过压保护阈值",
  r_charger_uohm: "充电通路等效电阻",
  usbovp_sw_flag: "USB 过压保护开关控制表",
  pswovp_sw_flag: "电源开关过压保护控制表",
  cur_balance_mos: "电流均衡 MOS 管数量或模式",
  batt_index: "电池或电量计实例序号",
  batt_name: "电池电量计逻辑名称",
  r_pcb: "电池采样通路 PCB 等效电阻",
  batt_indentify_fcc: "用于电池识别的标称满充容量",
  soe_dynamic_enable: "动态 SOE（可用能量）估算开关",
  "vendor,led-type": "充电闪光灯 LED 类型选择",
  vbat_drop_vol_mv: "电池压降保护触发电压",
  active_perf_limit: "主动压降保护的 CPU 性能限制矩阵",
  passive_perf_limit: "被动压降保护的 CPU 性能限制矩阵",
  battery_design_fcc: "整机设计满充容量",
  battery_board_type: "电池板型分类编号",
  vth_correct_para: "电压阈值校正参数",
  vth_correct_para_low_temp: "低温场景电压阈值分段校正参数",
  ocv_table: "温度与开路电压对应表",
  weak_source_sleep_enabled: "弱电源场景允许进入充电休眠",
  charge_done_sleep_enabled: "充满后允许充电模块进入休眠",
  support_new_pd_process: "启用新版 USB-PD 处理流程",
  recharge_para: "补电门限、时间和策略组合参数",
  iin_max: "充电输入电流上限",
  ichg_max: "电池充电电流上限",
  iterm_table: "按温度区间配置的充电终止电流表",
  jeita_table: "JEITA 温区下的输入电流、充电电流和电压策略表",
  test_para: "充电模式测试用协议、模式与电流参数表",
  pmax: "无线充电最大接收功率",
  trx_plim: "无线收发模式功率限制表",
  sc_err_tx: "无线快充错误上报编码",
  rx_mode_type_para: "无线接收模式类型映射",
  rx_mode_para: "无线接收模式的电压、电流与温控参数表",
  init_para_col: "无线直充初始化表的列数约束",
  init_para: "无线直充模式初始化参数矩阵",
  volt_para00: "第 0 组直充电压与电流曲线",
  volt_para01: "第 1 组直充电压与电流曲线",
  bat_para: "电池类型/温区到曲线表的间接映射",
  ic_para1: "直充 IC 组合、角色与限流配置",
  mode_para: "直充模式到 IC 参数表的映射",
  vbat_comp_ic_para: "不同直充 IC 的电池电压补偿参数",
  time_para01: "直充 Turbo 时间与电流限制表",
  time_para_group: "直充模式到时间参数表的映射",
  use_5A: "是否允许 5A 直充档位",
  volt_para: "默认直充分段电压/电流曲线",
  volt_para1: "特定电池场景直充分段电压/电流曲线",
  stage_need_to_jump: "需要跳过的直充阶段编号",
  temp_para: "温度区间下的电流、电压或直充附加控制参数",
  resist_para: "线缆/回路电阻区间对应的限流表",
  "sn-check-type": "电池序列号校验策略类型",
  matchable: "允许匹配的电池认证芯片 phandle 列表",
  "spare-cycles": "电池认证允许的备用循环次数",
  "onewire-gpio": "电池认证单总线 GPIO",
  "battct_id_gpio-supply": "电池认证 GPIO 电源 phandle",
  ow_reset_start_delay: "单总线复位开始延时",
  ow_read_end_delay: "单总线读结束延时",
  ic_index: "认证芯片实例序号",
  id_voltage_gpiov: "电池识别电压对应的 GPIO 电平组合",
  btf_temp_lth: "温度拟合算法的低温下限",
  fitting_mode: "电池温度拟合模式",
  replace_sensor: "温度拟合时替代使用的传感器名称",
  "sensor-names": "多电池 BTB 温度传感器与补偿表映射",
  unbalance_th: "双电池容量/电量不均衡判定阈值",
  weight: "参与双电池均衡计算的容量权重",
  cccv_0: "0°C 温区的 CCCV 曲线",
  cccv_10_20: "10–20°C 温区的 CCCV 曲线",
  temp_tab: "温度到 CCCV 参数表名称的映射",
  battery_tbl: "电池型号到 CCCV 参数组的映射",
  buck_cccv_0_5: "Buck 充电 0–5°C 温区 CCCV 曲线",
  buck_temp_tab: "Buck 温区到 CCCV 曲线的映射",
  vol_check_para: "BTB 电压检查阈值、次数与时序参数",
  gpio_5v_boost: "5V 升压使能 GPIO",
  "#address-cells": "子节点 reg 地址字段的 cell 数量",
  "#size-cells": "子节点 reg 长度字段的 cell 数量",
  "interrupt-parent": "默认中断控制器 phandle",
  ranges: "父子总线地址空间直通映射",
  rx_mod_cm_cfg: "无线接收调制共模配置字节",
  rx_ploss_th0: "无线接收功率损耗分段阈值字节表",
  rx_fod_cond: "无线接收异物检测条件表",
  time_para: "模式运行时间与限流参数矩阵",
  tx_current_fod_para: "无线发射电流异物检测参数表",
  prevfod1_product_list: "启用预 FOD 策略的产品编号列表",
  const_vout: "旁路升压芯片恒定输出电压",
  shutdown_cfg: "旁路芯片关断寄存器与电压配置表"
};

const projectUpdatedAt: Record<DtsPowerSeedProjectId, string> = {
  aurora: "今天 09:00",
  nebula: "今天 10:30",
  atlas: "昨天 16:20"
};

const hardwareIdentityProperties = new Set([
  "board_id",
  "compatible",
  "reg",
  "slave_mode",
  "ic_role",
  "batt_index",
  "batt_name",
  "battery_board_type",
  "ic_index",
  "status",
  "gpios",
  "gpio_int",
  "gpio_en",
  "gpio_enable",
  "gpio_5v_boost",
  "onewire-gpio",
  "battct_id_gpio-supply",
  "matchable",
  "interrupt-parent",
  "sensor-names",
  "replace_sensor",
  "vendor,led-type"
]);

export function buildDtsPowerSeed(baseSource: string): DtsPowerSeed {
  const projectFiles: DtsPowerSeedProjectFile[] = [
    toProjectFile("aurora", baseSource),
    toProjectFile(
      "nebula",
      applySourceOverrides(baseSource, buildDiversifiedOverrides(baseSource, "nebula", projectOverrides.nebula))
    ),
    toProjectFile(
      "atlas",
      applySourceOverrides(baseSource, buildDiversifiedOverrides(baseSource, "atlas", projectOverrides.atlas))
    )
  ];
  const resolvedByProject = new Map(
    projectFiles.map((file) => [file.projectId, propertyMap(resolveDts(file.source))] as const)
  );
  const baseResolved = resolveDts(baseSource);

  const parameterLibrary = baseResolved.nodes.flatMap((node) =>
    node.properties.map((property): DtsPowerSeedParameter => {
      const sourceNodePath = propertySourcePath(node.nodePath, property.name);
      const businessCategory = businessCategoryForNodePath(node.nodePath, property.name);
      const values = {} as Record<DtsPowerSeedProjectId, DtsPowerSeedParameterValue>;

      for (const projectId of ["aurora", "nebula", "atlas"] as const) {
        const currentValue = requiredValue(resolvedByProject, projectId, sourceNodePath);
        const baseValue = requiredValue(resolvedByProject, "aurora", sourceNodePath);
        values[projectId] = {
          currentValue,
          recommendedValue:
            projectId === "aurora" || hardwareIdentityProperties.has(property.name) ? currentValue : baseValue,
          updatedAt: projectUpdatedAt[projectId]
        };
      }

      const metadata = inferMetadata({
        propertyName: property.name,
        sourceNodePath,
        nodePath: node.nodePath,
        valueType: property.valueType,
        normalizedValue: property.normalizedValue,
        businessCategory
      });
      return {
        id: parameterId(sourceNodePath),
        name: property.name,
        driverModule: node.compatible ?? node.name,
        instanceName:
          node.name === "/" || !node.nodePath
            ? BOARD_INSTANCE_MODULE_NAME
            : node.unitAddress
              ? `${node.name}@${node.unitAddress}`
              : node.name,
        nodeLocator: node.nodePath,
        description: metadata.description,
        explanation: metadata.explanation,
        configFormat: `DTS ${property.valueType}: ${sourceNodePath} = ${property.rawText.trim() || "<presence>"};`,
        businessCategory,
        range: metadata.range,
        unit: metadata.unit,
        risk: metadata.risk,
        valueKind: isScalarValue(property.valueType, property.normalizedValue) ? "scalar" : "complex",
        sourceFileName: DTS_POWER_SEED_FILE_NAME,
        sourceNodePath,
        values
      };
    })
  );

  return {
    parameterModules: buildParameterModulesFromResolved(baseResolved),
    parameterLibrary,
    projectFiles
  };
}

export type DtsPowerSeedModuleMapping = {
  matchKind: "instance" | "compatible" | "driver";
  matchValue: string;
  moduleName: string;
  priority?: number;
};

function toPlacementNodes(resolved: ResolvedDts): ResolvedPlacementNode[] {
  return resolved.nodes.map((node) => ({
    name: node.name,
    unitAddress: node.unitAddress,
    compatible: node.compatible,
    nodePath: node.nodePath,
  }));
}

export function buildParameterModulesFromResolved(resolved: ResolvedDts): DtsPowerSeed["parameterModules"] {
  const placement = planInstanceModulePlacements(toPlacementNodes(resolved), (nodePath) =>
    businessCategoryForNodePath(nodePath),
  );
  const modules = moduleMetadata.map((module) => ({ ...module }));
  const seen = new Set(modules.map((module) => module.name));

  const ensureModule = (entry: (typeof modules)[number]) => {
    if (seen.has(entry.name)) return;
    modules.push(entry);
    seen.add(entry.name);
  };

  for (const group of placement.driverGroups.values()) {
    ensureModule({
      name: group.moduleName,
      parent: group.businessCategory,
      description: `${group.moduleName} 驱动组（compatible: ${group.compatibleKey}）。`,
      scope: `共享 compatible ${group.compatibleKey} 的实例分组`,
    });
  }

  for (const instance of placement.instances.values()) {
    const group = instance.compatibleKey
      ? placement.driverGroups.get(instance.compatibleKey)
      : null;
    if (group && instance.moduleName === group.moduleName) continue;
    ensureModule({
      name: instance.moduleName,
      parent: instance.parentModuleName,
      description: `${instance.moduleName} DTS 实例模块。`,
      scope: `实例 ${instance.moduleName} 的可管理参数`,
    });
  }

  ensureModule({
    name: BOARD_INSTANCE_MODULE_NAME,
    parent: "Board Identity",
    description: "板级身份参数（board_id 等根级属性）。",
    scope: "板级唯一标识与构建身份",
  });

  return modules;
}

export function buildSeedModuleMappings(resolved: ResolvedDts): DtsPowerSeedModuleMapping[] {
  const placement = planInstanceModulePlacements(toPlacementNodes(resolved), (nodePath) =>
    businessCategoryForNodePath(nodePath),
  );
  const mappings = new Map<string, DtsPowerSeedModuleMapping>();

  const putMapping = (mapping: DtsPowerSeedModuleMapping) => {
    mappings.set(`${mapping.matchKind}:${mapping.matchValue}`, mapping);
  };

  for (const [compatibleKey, group] of placement.driverGroups) {
    putMapping({
      matchKind: "compatible",
      matchValue: compatibleKey,
      moduleName: group.moduleName,
      priority: 300,
    });
    const shortDriver = driverGroupDisplayNameFromCompatible(compatibleKey);
    if (shortDriver) {
      putMapping({
        matchKind: "driver",
        matchValue: shortDriver,
        moduleName: group.moduleName,
        priority: 100,
      });
    }
  }

  for (const [instanceKey, instance] of placement.instances) {
    putMapping({
      matchKind: "instance",
      matchValue: instanceKey.toLowerCase(),
      moduleName: instance.moduleName,
      priority: 500,
    });
  }

  putMapping({
    matchKind: "instance",
    matchValue: BOARD_INSTANCE_MODULE_NAME,
    moduleName: BOARD_INSTANCE_MODULE_NAME,
    priority: 500,
  });
  // Legacy / re-ingest safety: DTS root nodename must never become a product module named "/".
  putMapping({
    matchKind: "instance",
    matchValue: "/",
    moduleName: BOARD_INSTANCE_MODULE_NAME,
    priority: 500,
  });

  return [...mappings.values()];
}

function toProjectFile(projectId: DtsPowerSeedProjectId, source: string): DtsPowerSeedProjectFile {
  const fileName = primaryBoardFileName(projectId);
  return {
    projectId,
    fileName,
    artifactFileName: fileName,
    source
  };
}

function buildDiversifiedOverrides(
  baseSource: string,
  projectId: Exclude<DtsPowerSeedProjectId, "aurora">,
  manual: SourceOverrideMap
): SourceOverrideMap {
  const resolved = resolveDts(baseSource);
  const auto: SourceOverrideMap = {};
  const delta = projectId === "nebula" ? -11 : 17;

  for (const node of resolved.nodes) {
    for (const property of node.properties) {
      if (
        !isParameterSurfaceRow({
          propertyKey: property.name,
          locator: node.nodePath,
          compatible: node.compatible
        })
      ) {
        continue;
      }
      if (!isDiversifiableSeedProperty(property.name, property.valueType)) {
        continue;
      }
      const sourceNodePath = propertySourcePath(node.nodePath, property.name);
      if (manual[sourceNodePath] !== undefined) {
        continue;
      }
      const diversified = diversifyPropertyRawText(
        property.rawText,
        property.valueType,
        property.name,
        projectId,
        delta
      );
      if (diversified !== property.rawText) {
        auto[sourceNodePath] = diversified;
      }
    }
  }

  return { ...auto, ...manual };
}

/** Wiring / structural keys stay shared; other surface values may differ across demo projects. */
const nonDiversifiableSeedProperties = new Set([
  "compatible",
  "reg",
  "status",
  "gpios",
  "gpio_int",
  "gpio_en",
  "gpio_enable",
  "gpio_5v_boost",
  "onewire-gpio",
  "battct_id_gpio-supply",
  "matchable",
  "interrupt-parent",
  "sensor-names",
  "replace_sensor"
]);

/** Tunable surface values may differ across demo projects; wiring/identity stay shared. */
function isDiversifiableSeedProperty(propertyName: string, valueType: DtsValueType): boolean {
  if (nonDiversifiableSeedProperties.has(propertyName)) {
    return false;
  }
  if (valueType === "phandle-list" || valueType === "bool" || valueType === "empty") {
    return false;
  }
  return true;
}

function diversifyPropertyRawText(
  rawText: string,
  valueType: DtsValueType,
  propertyName: string,
  projectId: Exclude<DtsPowerSeedProjectId, "aurora">,
  delta: number
): string {
  if (valueType === "u32-array" || valueType === "bytes" || valueType === "mixed") {
    let changed = false;
    const next = rawText.replace(/<([^>]*)>/g, (_full, inner: string) => {
      const tokens = inner.trim().length === 0 ? [] : inner.trim().split(/\s+/);
      if (tokens.length === 1 && (tokens[0] === "0" || tokens[0] === "1")) {
        // Binary flags only have two legal values; flip for both peer projects so each differs from Aurora.
        changed = true;
        return `<${rewriteWhitespaceSeparatedTokens(inner, () => (tokens[0] === "0" ? "1" : "0"))}>`;
      }
      const rewritten = rewriteWhitespaceSeparatedTokens(inner, (token, index) => {
        // Prefer bumping the first mutable cell so multi-cell tables stay recognizable.
        if (index > 0) {
          return formatDtsCellToken(token);
        }
        const bumped = bumpNumericToken(token, delta);
        if (bumped !== unwrapDtsCellToken(token)) {
          changed = true;
        }
        return formatDtsCellToken(bumped);
      });
      return `<${rewritten}>`;
    });
    return changed ? next : rawText;
  }

  if (valueType === "string-list") {
    let changed = false;
    let bumpedOnce = false;
    const next = rawText.replace(/"([^"]*)"/g, (full, inner: string) => {
      if (bumpedOnce) {
        return full;
      }
      if (!/^(-?\d+|0x[0-9a-fA-F]+)$/.test(inner)) {
        return full;
      }
      if (inner === "0" || inner === "1") {
        bumpedOnce = true;
        changed = true;
        return `"${inner === "0" ? "1" : "0"}"`;
      }
      const bumped = bumpNumericToken(inner, delta);
      if (bumped === inner) {
        return full;
      }
      bumpedOnce = true;
      changed = true;
      return `"${bumped}"`;
    });
    if (changed) {
      return next;
    }
    // Free-form name strings (e.g. batt_name) can take a project suffix; skip table/mode cross-refs.
    if (propertyName.endsWith("_name") || propertyName === "batt_name") {
      const suffix = projectId === "nebula" ? "_nebula" : "_atlas";
      return rawText.replace(/"([^"]*)"/, (_full, inner: string) => `"${inner}${suffix}"`);
    }
    return rawText;
  }

  return rawText;
}

/** Replace non-whitespace tokens while keeping original separators (spaces, tabs, newlines). */
function rewriteWhitespaceSeparatedTokens(
  text: string,
  mutate: (token: string, index: number) => string
): string {
  let index = 0;
  return text.replace(/[^\s]+/g, (token) => {
    const next = mutate(token, index);
    index += 1;
    return next;
  });
}

function unwrapDtsCellToken(token: string): string {
  return token.startsWith("(") && token.endsWith(")") ? token.slice(1, -1) : token;
}

/** dtc 1.8+ rejects bare `<-1>` cell forms; keep signed demo values parenthesized. */
function formatDtsCellToken(token: string): string {
  const bare = unwrapDtsCellToken(token);
  return /^-\d+$/.test(bare) ? `(${bare})` : bare;
}

function bumpNumericToken(token: string, delta: number): string {
  const bare = unwrapDtsCellToken(token);
  if (/^0x[0-9a-fA-F]+$/.test(bare)) {
    const width = bare.length - 2;
    const next = (parseInt(bare, 16) + delta) >>> 0;
    return `0x${next.toString(16).padStart(width, "0")}`;
  }
  if (/^-?\d+$/.test(bare)) {
    return String(Number(bare) + delta);
  }
  return bare;
}

function applySourceOverrides(source: string, overrides: SourceOverrideMap): string {
  const resolved = resolveDts(source);
  const replacements: Array<{ start: number; end: number; rawText: string; sourceNodePath: string }> = [];
  const available = new Set<string>();

  for (const node of resolved.nodes) {
    for (const property of node.properties) {
      const sourceNodePath = propertySourcePath(node.nodePath, property.name);
      available.add(sourceNodePath);
      const rawText = overrides[sourceNodePath];
      if (rawText !== undefined) {
        replacements.push({
          start: property.cst.span.start,
          end: property.cst.span.end,
          rawText,
          sourceNodePath
        });
      }
    }
  }

  const missing = Object.keys(overrides).filter((key) => !available.has(key));
  if (missing.length > 0) {
    throw new Error(`DTS seed override path not found: ${missing.join(", ")}`);
  }

  let output = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.rawText}${output.slice(replacement.end)}`;
  }
  return output;
}

function propertyMap(resolved: ResolvedDts) {
  return new Map(
    resolved.nodes.flatMap((node) =>
      node.properties.map((property) => [
        propertySourcePath(node.nodePath, property.name),
        property.normalizedValue
      ] as const)
    )
  );
}

function requiredValue(
  resolvedByProject: Map<DtsPowerSeedProjectId, Map<string, string>>,
  projectId: DtsPowerSeedProjectId,
  sourceNodePath: string
) {
  const value = resolvedByProject.get(projectId)?.get(sourceNodePath);
  if (value === undefined) {
    throw new Error(`DTS seed value missing for ${projectId}:${sourceNodePath}`);
  }
  return value;
}

function propertySourcePath(nodePath: string, propertyName: string) {
  return nodePath ? `${nodePath}/${propertyName}` : propertyName;
}

function parameterId(sourceNodePath: string) {
  const digest = createHash("sha256").update(sourceNodePath).digest("hex").slice(0, 10);
  const tail = sourceNodePath
    .split("/")
    .slice(-2)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${DTS_POWER_SEED_ID_PREFIX}${tail}-${digest}`;
}

function inferMetadata(input: {
  propertyName: string;
  sourceNodePath: string;
  nodePath: string;
  valueType: DtsValueType;
  normalizedValue: string;
  businessCategory: string;
}) {
  const semantic = propertySemantics[input.propertyName] ?? `${readableName(input.propertyName)} 配置`;
  const nodeName = input.nodePath.split("/").filter(Boolean).at(-1) ?? "根节点";
  const { range, unit } = inferRangeAndUnit(input);
  const risk = inferRisk(input);
  const typeNote = valueTypeNote(input.valueType);
  return {
    description: `${nodeName}：${semantic}。`,
    explanation: `${semantic}；DTS 来源：${input.sourceNodePath}。${typeNote}`,
    range,
    unit,
    risk
  };
}

function inferRangeAndUnit(input: {
  propertyName: string;
  valueType: DtsValueType;
  normalizedValue: string;
}) {
  const name = input.propertyName.toLowerCase();
  if (name === "status") return { range: "ok | okay | disabled", unit: "state" };
  if (name === "compatible") return { range: "Linux DT compatible string", unit: "string" };
  if (input.valueType === "bool") return { range: "present | absent", unit: "bool" };
  if (input.valueType === "empty") return { range: "empty property", unit: "marker" };
  if (name === "reg") return { range: "0x00 - 0xff", unit: "bus address" };
  if (name.includes("fcc")) return { range: "500 - 20000", unit: "mAh" };
  if (name.includes("uohm") || name === "r_pcb") return { range: "0 - 100000", unit: "µΩ" };
  if (name.endsWith("_mv") || name.includes("vout") || name.includes("voltage")) {
    return { range: "0 - 25000", unit: "mV" };
  }
  if (name === "iin_max" || name === "ichg_max") return { range: "0 - 12000", unit: "mA" };
  if (name.includes("time") || name.includes("delay")) return { range: "0 - 600000", unit: "ms" };
  if (name === "pmax") return { range: "0 - 100", unit: "W" };
  if (name === "ocv_table") return { range: "temperature → OCV rows", unit: "mV table" };
  if (name.includes("temp") || name === "jeita_table") return { range: "-32767 - 32767", unit: "°C/table" };
  if (name.includes("gpio") || name.endsWith("-supply") || name === "matchable") {
    return { range: "valid DTS phandle/cell list", unit: "phandle" };
  }
  if (input.valueType === "string-list") return { range: "schema-defined string-list", unit: "table/list" };
  if (input.valueType === "bytes") return { range: "0x00 - 0xff per cell", unit: "byte array" };
  if (input.valueType === "phandle-list" || input.valueType === "mixed") {
    return { range: "schema-defined DTS cells", unit: "cell list" };
  }
  return { range: "0 - 0xffffffff", unit: "cell" };
}

function inferRisk(input: {
  propertyName: string;
  businessCategory: string;
  valueType: DtsValueType;
}): DtsPowerSeedRisk {
  const name = input.propertyName.toLowerCase();
  if (
    name === "compatible" ||
    name === "reg" ||
    name.includes("ovp") ||
    name.includes("ichg") ||
    name.includes("iin") ||
    name.includes("fcc") ||
    name.includes("protect") ||
    name.includes("cccv") ||
    name === "jeita_table" ||
    name === "use_5a"
  ) {
    return "High";
  }
  if (
    ["Charge Pump IC", "Direct Charging", "Charging Policy", "Battery Protection"].includes(
      input.businessCategory
    ) ||
    input.valueType === "phandle-list" ||
    input.valueType === "mixed"
  ) {
    return "High";
  }
  if (input.businessCategory === "Board Identity" || name === "board_id") return "Low";
  return "Medium";
}

function isScalarValue(valueType: DtsValueType, normalizedValue: string) {
  if (valueType === "bool" || valueType === "empty") return true;
  if (valueType === "u32-array") {
    return normalizedValue.slice(1, -1).trim().split(/\s+/).filter(Boolean).length <= 1;
  }
  if (valueType === "string-list") {
    return (normalizedValue.match(/"/g)?.length ?? 0) <= 2;
  }
  if (valueType === "bytes") {
    const match = normalizedValue.match(/<([^>]*)>/);
    return (match?.[1].trim().split(/\s+/).filter(Boolean).length ?? 0) <= 1;
  }
  return false;
}

function readableName(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function valueTypeNote(valueType: DtsValueType) {
  const notes: Record<DtsValueType, string> = {
    "u32-array": "该值按 32 位 cell 数组解析和规范化比较。",
    bytes: "该值保留 /bits/ 位宽并按字节数组比较。",
    "string-list": "该值按有序字符串列表解析，表格列顺序不可随意调整。",
    "phandle-list": "该值包含节点引用，变更前需检查引用目标和驱动契约。",
    mixed: "该值包含多组 cell 或 phandle/cell 混合结构，必须整体校验。",
    bool: "该属性以是否存在表达布尔开关。",
    empty: "该属性是无值标记，语义由设备树规范定义。"
  };
  return notes[valueType];
}

export async function generateDtsPowerSeedArtifacts(rootDir: string) {
  console.warn(
    "dts:seed:generate is an optional legacy regenerator. Committed *-board.dts files are the product source of truth; prefer hand-edits there."
  );
  const seedDir = path.join(rootDir, "src/config/dts-seed");
  const fixtureDir = path.join(rootDir, "server/modules/dts/fixtures");
  const syntheticBase = await readFile(path.join(fixtureDir, "synthetic-power-base.dts"), "utf8");
  const auroraOverlay = await readFile(path.join(seedDir, "aurora-power-overlay.dts"), "utf8");
  const auroraPrimary = mergePrimaryDtsBoard(syntheticBase, auroraOverlay);
  const seed = buildDtsPowerSeed(auroraPrimary);
  for (const file of seed.projectFiles) {
    await writeFile(path.join(seedDir, file.artifactFileName), file.source, "utf8");
  }
  return seed;
}

async function main() {
  const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const seed = await generateDtsPowerSeedArtifacts(rootDir);
  console.log(
    `Generated ${seed.projectFiles.length} project DTS files from ${seed.parameterLibrary.length} resolved properties.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
