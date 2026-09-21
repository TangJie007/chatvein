/** 角色（Agent）配置层。

 * 后端 ``/api/roles`` 已是 SQLite 持久化的唯一数据源，前端不再本地落盘。
 * 这里只保留：类型再导出、内置工具清单，以及「新建角色」时用的默认模板。
 */

export type { RoleRecord, RoleTone, CreateRolePayload } from "../api";

import type { CreateRolePayload, RoleTone } from "../api";

/** 该角色可用的内置工具（对应内置 MCP）。 */
export const TOOLSET: { id: string; name: string; desc: string }[] = [
  { id: "order.get", name: "订单查询", desc: "按订单号取详情、支付与状态" },
  { id: "logistics.track", name: "物流跟踪", desc: "按运单号查最新轨迹" },
  { id: "refund.check", name: "退款核验", desc: "校验订单是否符合退款政策" },
  { id: "policy.guard", name: "策略护栏", desc: "执行前做权限与额度校验" },
  { id: "kb.search", name: "知识库检索", desc: "向量召回 + 重排，注入上下文" },
  { id: "db.query", name: "数据库查询", desc: "只读 SQL，走白名单表" },
];

export const DEFAULT_ENABLED_TOOLS = TOOLSET.map((t) => t.id);

const TONE_CYCLE: RoleTone[] = ["violet", "teal", "amber", "peach", "brand"];

/** 新建角色时的默认字段（与后端主角色对齐，但不含 primary）。 */
export function makeNewRole(count: number): CreateRolePayload {
  const tone = TONE_CYCLE[count % TONE_CYCLE.length];
  return {
    name: "新角色",
    initial: "新",
    prompt: "你是一个专注特定场景的助手，按下列约束提供服务。",
    model_id: "",
    tone,
    temperature: 0.7,
    max_tokens: 4096,
    presence_penalty: 0,
    frequency_penalty: 0,
    stream: true,
    json_mode: false,
    retries: 2,
    memory: 8,
    enabled: true,
    tools: DEFAULT_ENABLED_TOOLS,
    kb: [],
  };
}
