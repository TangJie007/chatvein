export type AppView = "chat" | "group" | "kb" | "skills" | "models" | "settings";

export type NavCounts = Partial<
  Record<"chat" | "group" | "kb" | "skills" | "models", number>
>;
