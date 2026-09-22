import {
  BookOpen,
  Bot,
  MessagesSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  UserCog,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";
import {
  VIEW_PATH,
  viewFromPathname,
  type AppView,
  type NavCounts,
} from "../../types/view";

const NAV: {
  key: Exclude<AppView, "settings">;
  label: string;
  icon: typeof MessagesSquare;
  badgeKey?: keyof NavCounts;
}[] = [
  { key: "chat", label: "对话", icon: MessagesSquare, badgeKey: "chat" },
  { key: "group", label: "群组", icon: Users, badgeKey: "group" },
  { key: "kb", label: "知识库", icon: BookOpen, badgeKey: "kb" },
  { key: "skills", label: "技能", icon: Sparkles, badgeKey: "skills" },
  { key: "roles", label: "角色", icon: UserCog, badgeKey: "roles" },
  { key: "models", label: "模型", icon: Bot, badgeKey: "models" },
];

const NEW_LABEL: Partial<Record<AppView, string>> = {
  chat: "新建对话",
  group: "新建群组",
  models: "添加模型",
};

type SidebarProps = {
  counts?: NavCounts;
  onNew?: () => void;
};

export function Sidebar({ counts = {}, onNew }: SidebarProps) {
  const location = useLocation();
  const view = viewFromPathname(location.pathname);
  const newLabel = NEW_LABEL[view] ?? "新建对话";
  const canNew = view === "chat" || view === "models";

  return (
    <aside className="flex w-[138px] shrink-0 flex-col select-none pb-[15px]">
      <div className="px-3 pt-1.5">
        <Button
          variant="tint"
          className="w-full"
          disabled={!canNew}
          onClick={onNew}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          {newLabel}
        </Button>
      </div>

      <nav className="mt-3 flex flex-col gap-0.5 px-3">
        {NAV.map(({ key, label, icon: Icon, badgeKey }) => {
          const badge = badgeKey ? counts[badgeKey] : undefined;
          return (
            <NavLink
              key={key}
              to={VIEW_PATH[key]}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-xl px-3 py-[6px] text-[12.5px] transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-brand-600",
                  isActive
                    ? "bg-surface font-medium text-ink-900 shadow-soft"
                    : "text-ink-500 hover:bg-tint/70 hover:text-ink-700"
                )
              }
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="flex-1 text-left">{label}</span>
              {!!badge && (
                <span className="rounded-full bg-tint px-1.5 py-px text-[10.5px] font-medium text-ink-500">
                  {badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto px-3">
        <NavLink
          to={VIEW_PATH.settings}
          className={({ isActive }) =>
            cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-[6px] text-[12.5px] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-brand-600",
              isActive
                ? "bg-surface font-medium text-ink-900 shadow-soft"
                : "text-ink-500 hover:bg-tint/70 hover:text-ink-700"
            )
          }
        >
          <Settings className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="flex-1 text-left">设置</span>
        </NavLink>
      </div>
    </aside>
  );
}
