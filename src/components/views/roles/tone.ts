import type { RoleTone } from "../../../api";

/* 角色头像 / 标签的色调，沿用参考设计的色板（chatvein tokens 已具备）。 */
export const TONE: Record<
  RoleTone,
  { avatar: string; chip: string }
> = {
  brand: { avatar: "bg-brand-500", chip: "bg-brand-50 text-brand-700" },
  violet: { avatar: "bg-violet-400", chip: "bg-violet-50 text-violet-600" },
  teal: { avatar: "bg-teal-400", chip: "bg-teal-50 text-teal-600" },
  amber: { avatar: "bg-amber-400", chip: "bg-warn-50 text-warn-600" },
  peach: { avatar: "bg-peach-400", chip: "bg-warn-50 text-warn-600" },
};
