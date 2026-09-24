import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { avatarUrl, AVATAR_OPTIONS } from "../../lib/rolesStore";
import { cn } from "../../lib/cn";

/** 角色头像选择器：网格展示可选头像图标，单选绑定到角色。 */
export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-1.5">
        {AVATAR_OPTIONS.map((name) => {
          const url = avatarUrl(name);
          const selected = value === name;
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onChange(name)}
              className={cn(
                "relative flex size-9 items-center justify-center overflow-hidden rounded-lg border transition-all focus-visible:outline-2 focus-visible:outline-brand-600",
                selected
                  ? "border-brand-500 shadow-soft"
                  : "border-transparent opacity-70 hover:opacity-100"
              )}
            >
              <img
                src={url}
                alt={name}
                draggable={false}
                className="size-8 rounded-md object-cover"
              />
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center bg-brand-600/40">
                  <Check className="size-3.5 text-white" strokeWidth={2.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 通用头像展示：优先图片（avatar 非空且可加载），否则回退 initial 色块。 */
export function RoleAvatar({
  name,
  initial,
  toneClass,
  sizeClass = "size-5 text-[10px]",
  className,
  style,
}: {
  name: string;
  initial: string;
  toneClass: string;
  sizeClass?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const url = avatarUrl(name);
  if (url) {
    return (
      <span
        style={style}
        className={cn(
          "shrink-0 overflow-hidden rounded-md",
          sizeClass,
          className
        )}
      >
        <img
          src={url}
          alt={initial}
          draggable={false}
          className="size-full rounded-md object-cover"
        />
      </span>
    );
  }
  return (
    <span
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white",
        sizeClass,
        toneClass,
        className
      )}
    >
      {initial}
    </span>
  );
}
