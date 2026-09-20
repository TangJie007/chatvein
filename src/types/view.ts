export type AppView = "chat" | "group" | "kb" | "models" | "settings";

export type NavCounts = Partial<Record<"chat" | "group" | "kb" | "models", number>>;
