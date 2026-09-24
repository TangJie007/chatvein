import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import logo from "../../assets/logo.png";

async function withWindow(
  fn: (win: ReturnType<typeof getCurrentWindow>) => Promise<void>
) {
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
          ? "hover:bg-danger-500 hover:text-white"
          : "hover:bg-tint hover:text-ink-700"
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

const menuContentClass =
  "z-50 min-w-[168px] rounded-lg bg-surface p-1 shadow-lift focus:outline-none";

const menuItemClass =
  "flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-700 outline-none transition-colors focus:bg-tint data-[highlighted]:bg-tint data-[highlighted]:text-ink-900";

const menuTriggerClass =
  "flex h-[26px] items-center rounded-md px-2 text-[12px] text-ink-500 transition-colors hover:bg-tint hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600 data-[state=open]:bg-tint data-[state=open]:text-ink-900";

function WindowMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={menuTriggerClass}>窗口</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClass}>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() => void withWindow((w) => w.minimize())}
          >
            最小化
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() =>
              void withWindow(async (w) => {
                if (await w.isMaximized()) await w.unmaximize();
                else await w.maximize();
              })
            }
          >
            最大化 / 还原
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-ink-200" />
          <DropdownMenu.Item
            className={cn(menuItemClass, "text-danger-600 focus:text-danger-600")}
            onSelect={() => void withWindow((w) => w.close())}
          >
            关闭窗口
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function HelpMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={menuTriggerClass}>帮助</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClass}>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() => window.open("https://gitee.com/wetspace/chatvein", "_blank")}
          >
            使用文档
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() =>
              window.open("https://gitee.com/wetspace/chatvein/issues", "_blank")
            }
          >
            反馈问题
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        /* browser preview */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[340px]">
        <DialogHeader className="mb-4 flex flex-col items-center pt-2 pr-0 text-center">
          <img
            src={logo}
            alt="ChatVein"
            className="size-12 rounded-xl shadow-soft"
            draggable={false}
          />
          <DialogTitle className="mt-3 text-[18px]">ChatVein</DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px]">
            版本 {version} · 智能对话助手
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 border-t border-ink-200 pt-4 text-center">
          <DialogDescription className="mt-0 text-[12px] leading-5">
            基于 Tauri + React 的本地优先 AI 聊天应用
          </DialogDescription>
          <DialogDescription className="mt-0 text-[12px]">
            gitee.com/wetspace/chatvein
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AboutMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={menuTriggerClass}>关于</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClass}>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setOpen(true)}>
              关于 ChatVein
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AboutDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function TitleBar({ title = "ChatVein" }: { title?: string }) {
  return (
    <header className="flex h-9 shrink-0 items-stretch bg-page">
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-3" data-tauri-drag-region>
        <img
          src={logo}
          alt={title}
          title={title}
          className="size-5 shrink-0 rounded-[6px] object-cover"
          draggable={false}
          data-tauri-drag-region
        />
        <div className="flex items-center gap-0.5" data-tauri-drag-region>
          <WindowMenu />
          <HelpMenu />
          <AboutMenu />
        </div>
      </div>
      <WindowControls />
    </header>
  );
}
