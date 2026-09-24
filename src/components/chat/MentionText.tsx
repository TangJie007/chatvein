import { cn } from "../../lib/cn";
import { parseMentionSegments, type MemberAvatar } from "./mentions";

type MentionTextProps = {
  content: string;
  /** 群成员；缺省 / 为空时按纯文本渲染。 */
  members?: MemberAvatar[];
  /** 气泡底色决定高亮配色：深色气泡（用户）用半透明白底，浅色气泡用品牌色。 */
  tone?: "onDark" | "onLight";
};

/** 消息正文：把「@昵称」渲染成高亮片段，其余按原样输出（保留空白排版）。 */
export function MentionText({ content, members, tone = "onLight" }: MentionTextProps) {
  const segments = parseMentionSegments(content, members ?? []);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <>{content}</>;
  }
  return (
    <>
      {segments.map((seg, index) =>
        seg.kind === "text" ? (
          <span key={index}>{seg.text}</span>
        ) : (
          <span
            key={index}
            title={`点名 ${seg.name}`}
            className={cn(
              "rounded px-0.5 font-medium",
              tone === "onDark" ? "bg-white/20 text-white" : "bg-brand-50 text-brand-700"
            )}
          >
            {seg.text}
          </span>
        )
      )}
    </>
  );
}
