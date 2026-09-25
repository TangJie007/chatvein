import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { PickerOptionList, type PickerItem } from "./PickerOptionList";

/** 建群弹窗：名称 + 成员一次选完。受控组件，状态由 GroupView 持有。 */
export function CreateGroupDialog({
  open,
  name,
  members,
  options,
  error,
  creating,
  onOpenChange,
  onNameChange,
  onToggleMember,
  onCreate,
}: {
  open: boolean;
  name: string;
  members: string[];
  options: PickerItem[];
  error: string | null;
  creating: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (name: string) => void;
  onToggleMember: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建群组</DialogTitle>
          <DialogDescription>
            一个群组就是一条群对话，成员在这里一次选好。
          </DialogDescription>
        </DialogHeader>

        <Input
          value={name}
          autoFocus
          placeholder="群组名称"
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
        />

        <div className="mt-3">
          <p className="mb-1.5 px-1 text-[11px] font-medium text-ink-400">
            成员（已选 {members.length} 个角色）
          </p>
          <PickerOptionList
            items={options}
            picked={members}
            onToggle={onToggleMember}
            emptyText="还没有可添加的角色，请先在「角色」里创建"
          />
        </div>

        {error ? (
          <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-[12.5px] text-danger-600">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || creating}
            onClick={onCreate}
          >
            {creating ? "创建中…" : "创建"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
