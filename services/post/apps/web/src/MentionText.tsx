import type { ChatMention } from "../../../packages/contracts/generated/ts/models";
import {
  messageMentionTargets,
  mentionPreview,
  projectMentions,
  withLegacyMentions,
  type MentionTarget,
} from "./chat-mentions";

export function MentionText({
  content,
  mentions,
  targets = [],
}: {
  content: string;
  mentions: ChatMention[];
  targets?: MentionTarget[];
}) {
  const parts = projectMentions(
    withLegacyMentions(content, mentions),
    messageMentionTargets(mentions, targets),
  ).parts;
  return (
    <>
      {parts.map((part) =>
        part.mention ? (
          <span className="chat-inline-mention" key={part.rawStart} title={part.mention.name}>
            {part.text}
          </span>
        ) : (
          mentionPreview(part.text)
        ),
      )}
    </>
  );
}
