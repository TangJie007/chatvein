/** 群组（本地持久化）。

 * 后端暂无群组表，这里沿用 settings/prefs 的方式落到 localStorage：
 * - 成员 = 角色 id（/api/roles），建群时选定
 * - 群组即群对话：一个群组独占一条会话（/api/conversations），不再挂共享会话列表
 * 实体数据仍以后端为唯一数据源，角色 / 会话被删除时这里只在展示层过滤，
 * 不留悬挂引用。
 */

const STORAGE_KEY = "chatvein.groups.v1";

/** 群组头像色块（与角色头像同一套色板）。 */
export const GROUP_COLORS = [
  "bg-brand-500",
  "bg-violet-400",
  "bg-teal-400",
  "bg-peach-400",
  "bg-amber-400",
] as const;

export type ChatGroup = {
  id: string;
  name: string;
  /** 头像色块（Tailwind bg 类）。 */
  color: string;
  /** 成员 = 角色 id。 */
  memberIds: string[];
  /** 群对话：本群独占的那条会话（建群时创建，缺失时会补建）。 */
  conversationId: string | null;
  createdAt: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** 单条记录的容错解析：缺字段回落默认值，坏数据直接丢弃。
 *  旧结构（conversationIds 数组）在这里收敛成独占的 conversationId。 */
function normalize(raw: unknown): ChatGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.id !== "string" || !g.id) return null;
  return {
    id: g.id,
    name: typeof g.name === "string" && g.name.trim() ? g.name : "未命名群组",
    color: typeof g.color === "string" && g.color ? g.color : GROUP_COLORS[0],
    memberIds: asStringArray(g.memberIds),
    conversationId:
      typeof g.conversationId === "string" && g.conversationId
        ? g.conversationId
        : asStringArray(g.conversationIds)[0] ?? null,
    createdAt:
      typeof g.createdAt === "string" ? g.createdAt : new Date().toISOString(),
  };
}

/** 读取本地群组；缺失 / 损坏 / 重复 id 一律安全降级。 */
export function loadGroups(): ChatGroup[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .map(normalize)
      .filter((g): g is ChatGroup => {
        if (!g || seen.has(g.id)) return false;
        seen.add(g.id);
        return true;
      });
  } catch {
    return [];
  }
}

export function saveGroups(groups: ChatGroup[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    /* 隐私模式或无 localStorage 时静默降级为内存态 */
  }
}

/** 新建群组的默认字段；颜色按已有群组数轮转，避免连建几个都是同色。 */
export function makeGroup(name: string, index: number): ChatGroup {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "新群组",
    color: GROUP_COLORS[index % GROUP_COLORS.length] ?? GROUP_COLORS[0],
    memberIds: [],
    // 群对话由调用方在建群时创建后回填，避免这里依赖后端。
    conversationId: null,
    createdAt: new Date().toISOString(),
  };
}
