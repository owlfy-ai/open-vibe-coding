import type { ConversationMessage, ToolMessage } from "@/domain/conversation";
import { ToolCallCard } from "./ToolCallCard";
import { MarkdownContent } from "./MarkdownContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { Icon } from "../icons";
import { useT } from "../i18n";

export function ChatMessage({
  message,
  toolResults,
}: {
  readonly message: Exclude<ConversationMessage, ToolMessage>;
  readonly toolResults: ReadonlyMap<string, ToolMessage>;
}) {
  const t = useT();
  const hasText = message.content.some((part) => part.type === "text" && part.text.trim());
  return (
    <article className={`ob-message ob-message-${message.role}`}>
      {message.content.map((part, index) => {
        if (part.type === "text") {
          return message.role === "assistant"
            ? <MarkdownContent key={index} content={part.text} />
            : <p key={index}>{part.text}</p>;
        }
        if (part.type === "reasoning") {
          // History: collapsed when an answer exists; open when only reasoning was saved.
          return <ReasoningBlock key={index} text={part.text} defaultOpen={!hasText} />;
        }
        if (part.type === "image") {
          return <img key={index} src={part.data} alt={part.name ?? t.chat.attachment} />;
        }
        if (part.type === "file") {
          return <div key={index} className="ob-file-chip"><Icon name="file" size={13} /> {part.name}</div>;
        }
        return (
          <ToolCallCard
            key={part.callId}
            call={part}
            result={toolResults.get(part.callId)}
          />
        );
      })}
    </article>
  );
}
