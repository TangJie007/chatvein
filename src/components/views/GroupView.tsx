import { Users } from "lucide-react";
import { CenterHint } from "../layout/CenterHint";

export function GroupView() {
  return (
    <CenterHint
      title="群组"
      desc="多人共享会话与成员管理将在此接入。当前为占位页。"
      icon={<Users className="size-6" strokeWidth={1.75} />}
    />
  );
}
