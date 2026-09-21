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
