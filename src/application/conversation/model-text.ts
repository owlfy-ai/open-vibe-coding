import type { ConversationMessage } from "@/domain/conversation";
import type { LanguageModelPort } from "@/application/ports/language-model";

export async function collectModelText(
  model: LanguageModelPort,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  signal: AbortSignal,
): Promise<string> {
  let text = "";
  for await (const event of model.stream({
    systemPrompt,
    messages,
    tools: [],
    signal,
  })) {
    if (event.type === "text-delta") text += event.delta;
  }
  return text.trim();
}
