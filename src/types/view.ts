export type AppView =
  | "chat"
  | "group"
  | "kb"
  | "skills"
  | "roles"
  | "models"
  | "settings";

export type NavCounts = Partial<
  Record<"chat" | "group" | "kb" | "skills" | "roles" | "models", number>
>;

export const VIEW_PATH: Record<AppView, string> = {
  chat: "/chat",
  group: "/group",
  kb: "/kb",
  skills: "/skills",
  roles: "/roles",
  models: "/models",
  settings: "/settings",
};

export function viewFromPathname(pathname: string): AppView {
  const segment = pathname.split("/").filter(Boolean)[0];
  switch (segment) {
    case "group":
    case "kb":
    case "skills":
    case "roles":
    case "models":
    case "settings":
      return segment;
    default:
      return "chat";
  }
}
