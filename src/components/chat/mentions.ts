/** 群组成员最小展示信息：气泡头像 + @ 候选弹层 + @ 文本高亮共用。 */
export type MemberAvatar = {
  id: string;
  name: string;
  colorClass: string;
  avatarUrl?: string;
};

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; id: string; name: string };

/** 昵称后面允许紧跟标点（「@张三，你来」），@",.;:!?" 之类都算边界。 */
const TRAILING_PUNCT = /[.,!?;:，。！？、；：'"’”)\]}]/;

/** @ 前必须是开头或空白，避免邮箱 / 正文里的 @ 被误当成点名。 */
function isBoundary(char: string | undefined): boolean {
  return char == null || /\s/.test(char);
}

/** 按文本里的「@昵称」切分片段。
 *
 * 规则与微信群一致：@ 紧跟成员昵称即算点名（昵称后允许尾随标点，如「@张三，」）；
 * 昵称按最长匹配，避免「@张三」误命中成员「张」。文本是点名的唯一事实来源——
 * 删掉文本里的 @昵称 就等于取消对 TA 的点名。
 */
export function parseMentionSegments(
  text: string,
  options: MemberAvatar[]
): MentionSegment[] {
  if (!text || options.length === 0) return [{ kind: "text", text }];
  const segments: MentionSegment[] = [];
  let cursor = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "@" || !isBoundary(text[i - 1])) {
      i++;
      continue;
    }
    // 取 @ 之后连续的非空白字符作为候选昵称。
    let end = i + 1;
    while (end < text.length && !/\s/.test(text[end] as string)) end++;
    const token = text.slice(i + 1, end);
    let hit: { member: MemberAvatar; length: number } | null = null;
    for (let len = token.length; len > 0; len--) {
      const name = token.slice(0, len).toLowerCase();
      const found = options.find((m) => m.name.toLowerCase() === name);
      // 昵称必须是一个完整的词：要么正好到 token 末尾，要么后面紧跟标点。
      // 否则「@张三你好」会被当成点名「张三」，与删除时的口径不一致。
      if (found && (len === token.length || TRAILING_PUNCT.test(token[len] as string))) {
        hit = { member: found, length: len };
        break;
      }
    }
    if (!hit) {
      i++;
      continue;
    }
    if (cursor < i) segments.push({ kind: "text", text: text.slice(cursor, i) });
    segments.push({
      kind: "mention",
      text: text.slice(i, i + 1 + hit.length),
      id: hit.member.id,
      name: hit.member.name,
    });
    cursor = i + 1 + hit.length;
    i = cursor;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/** 文本里被点名的成员 id（按出现顺序、去重）。 */
export function parseMentionIds(text: string, options: MemberAvatar[]): string[] {
  const ids: string[] = [];
  for (const seg of parseMentionSegments(text, options)) {
    if (seg.kind === "mention" && !ids.includes(seg.id)) ids.push(seg.id);
  }
  return ids;
}

/** 昵称可能含正则元字符，构造删除用的正则前先转义。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
