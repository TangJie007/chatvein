import type { ComponentProps } from "react";
import { Streamdown, type Components } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import "streamdown/styles.css";

const code = createCodePlugin({
  themes: ["github-light", "github-light"],
});

const plugins = { code, cjk };

const components: Components = {
  a: MarkdownLink,
};

type MarkdownMessageProps = {
  content: string;
  streaming?: boolean;
};

/** 助手消息的 Markdown。流式时保留未闭合语法，结束后按完整文档渲染。 */
export function MarkdownMessage({ content, streaming = false }: MarkdownMessageProps) {
  if (!content && streaming) {
    return (
      <span
        aria-hidden
        className="inline-block h-4 w-1 animate-pulse rounded-sm bg-ink-400 align-middle"
      />
    );
  }

  return (
    <Streamdown
      className="chat-md space-y-2 text-[13.5px] leading-6 text-ink-900"
      plugins={plugins}
      components={components}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      caret={streaming ? "block" : undefined}
      animated={streaming ? { animation: "fadeIn", duration: 140, sep: "word" } : false}
      lineNumbers={false}
      codeBlockMaxHeight={320}
      controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}
      translations={{
        copyCode: "复制代码",
        copied: "已复制",
        copyTable: "复制表格",
        copyTableAsCsv: "复制为 CSV",
        copyTableAsMarkdown: "复制为 Markdown",
        copyTableAsTsv: "复制为 TSV",
      }}
    >
      {content}
    </Streamdown>
  );
}

function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-brand-700 underline underline-offset-2"
      onClick={(event) => {
        if (!href || href.startsWith("streamdown:")) return;
        event.preventDefault();
        event.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {children}
    </a>
  );
}
