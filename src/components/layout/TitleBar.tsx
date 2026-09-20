import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

async function withWindow(fn: (win: ReturnType<typeof getCurrentWindow>) => Promise<void>) {
  try {
    await fn(getCurrentWindow());
  } catch {
    // Browser preview without Tauri — no-op.
  }
}

function WinButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex w-[46px] items-center justify-center text-ink-400 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-brand-600",
        danger
          ? "hover:bg-danger-600 hover:text-white"
          : "hover:bg-tint-deep hover:text-ink-700"
      )}
    >
      {children}
    </button>
  );
}

export function WindowControls() {
  return (
    <div className="flex shrink-0 items-stretch">
      <WinButton
        title="最小化"
        onClick={() => void withWindow((w) => w.minimize())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </WinButton>
      <WinButton
        title="最大化"
        onClick={() =>
          void withWindow(async (w) => {
            if (await w.isMaximized()) await w.unmaximize();
            else await w.maximize();
          })
        }
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </WinButton>
      <WinButton
        title="关闭"
        danger
        onClick={() => void withWindow((w) => w.close())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M0.5 0.5l9 9M9.5 0.5l-9 9"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </WinButton>
    </div>
  );
}

export function TitleBar() {
  return (
    <header className="flex h-9 shrink-0 items-stretch bg-page">
      <div className="flex min-w-0 flex-1 items-center pl-3" data-tauri-drag-region>
        <span className="flex items-center gap-1.5" data-tauri-drag-region>
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[10px] font-bold text-white"
            data-tauri-drag-region
          >
            C
          </span>
          <span className="text-[11.5px] font-medium text-ink-500" data-tauri-drag-region>
            ChatVein
          </span>
        </span>
        <span className="min-w-0 flex-1" data-tauri-drag-region />
      </div>
      <WindowControls />
    </header>
  );
}
