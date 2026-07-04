import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PersistedConversation } from "@/infrastructure/persistence";
import type { AgentRunState } from "@/domain/agent";
import type { ToolMessage, UserContent } from "@/domain/conversation";
import type { PreviewElementPromptRequest, PreviewElementSelection } from "@/application/preview";
import { useApplication } from "../runtime";
import { interpolate, useT, type Translation } from "../i18n";
import { Icon } from "../icons";
import { ChatMessage } from "./ChatMessage";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

interface PendingAttachment {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly data: string;
}

export function ChatPanel({
  conversation,
  onOpenSettings,
  selectedElement,
  elementPromptRequest,
  onSelectedElementClear,
  onElementPromptRequestConsumed,
}: {
  readonly conversation: PersistedConversation | null;
  readonly onOpenSettings: () => void;
  readonly selectedElement?: PreviewElementSelection | null;
  readonly elementPromptRequest?: PreviewElementPromptRequest | null;
  readonly onSelectedElementClear?: () => void;
  readonly onElementPromptRequestConsumed?: () => void;
}) {
  const { services, serviceError, runtime } = useApplication();
  const t = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<readonly PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [compactStatus, setCompactStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  const [runState, setRunState] = useState<AgentRunState>({ status: "idle" });
  const [stream, setStream] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const processedElementPromptRef = useRef<string | null>(null);
  const running = runState.status === "preparing" || runState.status === "streaming" || runState.status === "executing-tools";
  const messages = conversation?.conversation.messages ?? [];
  const canSend = Boolean(conversation && services && (input.trim() || attachments.length > 0) && !running);

  const toolResults = useMemo(
    () =>
      new Map(
        messages
          .filter((message): message is ToolMessage => message.role === "tool")
          .map((message) => [message.callId, message]),
      ),
    [messages],
  );
  const grouped = useMemo(() => messages.filter((message) => message.role !== "tool"), [messages]);
  const compacting = compactStatus === "running";
  const canRunShortcut = Boolean(conversation && services && !running && !compacting);

  // Once the in-progress assistant turn is committed to the conversation, drop
  // the live streaming buffer so the text isn't shown twice. Tied to the render
  // where the new message actually appears (no flicker while it persists).
  const assistantCount = messages.filter((message) => message.role === "assistant").length;
  const seenAssistantCount = useRef(assistantCount);
  useEffect(() => {
    if (assistantCount === seenAssistantCount.current) return;
    seenAssistantCount.current = assistantCount;
    setStream("");
  }, [assistantCount]);

  useEffect(() => {
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => scrollMessagesToBottom(messagesRef.current));
  }, [conversation?.conversation.id]);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollMessagesToBottom(messagesRef.current);
  }, [conversation?.conversation.id, grouped.length, messages.length, running, stream]);

  useLayoutEffect(() => {
    resizeComposerTextarea(textareaRef.current);
  }, [input]);

  useEffect(() => {
    if (!elementPromptRequest || processedElementPromptRef.current === elementPromptRequest.requestId) return;
    if (!conversation || !services || running) return;
    processedElementPromptRef.current = elementPromptRequest.requestId;
    void runAgentContent(
      [{ type: "text", text: elementPromptRequest.prompt }],
      { hiddenContext: formatSelectedElementHiddenContext(elementPromptRequest) },
    ).then(() => onElementPromptRequestConsumed?.());
  }, [conversation, elementPromptRequest, onElementPromptRequestConsumed, running, services]);

  function handleMessagesScroll(event: React.UIEvent<HTMLDivElement>) {
    stickToBottomRef.current = isNearScrollBottom(event.currentTarget);
  }

  function handleMessagesWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.deltaY < -8 && event.currentTarget.scrollTop > 0) {
      stickToBottomRef.current = false;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !conversation || !services) return;
    const text = input.trim();
    const outgoing = attachments;
    setInput("");
    setAttachments([]);
    setAttachmentError(null);
    if (isKnownSlashCommand(text) && outgoing.length === 0) {
      await runSlashCommand(text);
      return;
    }
    const content: UserContent[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...outgoing.map((attachment): UserContent => ({
        type: "image",
        mediaType: attachment.mediaType,
        data: attachment.data,
        name: attachment.name,
      })),
    ];
    await runAgentContent(content, selectedElement
      ? { hiddenContext: formatSelectedElementHiddenContext(selectedElement) }
      : undefined);
    onSelectedElementClear?.();
  }

  async function runAgentContent(
    content: readonly UserContent[],
    options: { readonly hiddenContext?: string } = {},
  ) {
    if (!conversation || !services || running) return;
    setStream("");
    await services.agent.run(conversation.conversation.id, content, {
      hiddenContext: options.hiddenContext,
      observer: {
        onStateChange: setRunState,
        onDelta: ({ type, value }) => {
          if (type === "text") setStream((current) => current + value);
        },
      },
    });
    setStream("");
  }

  async function runSlashCommand(command: string) {
    if (!conversation || !services) return;
    const id = conversation.conversation.id;
    if (command === "/new") await runtime.session.createConversation();
    else if (command === "/fork") await runtime.session.forkConversation(id);
    else if (command === "/compact") await compactConversation();
    else if (command === "/review") await runAgentContent([{ type: "text", text: t.chat.reviewPrompt }]);
  }

  async function compactConversation() {
    if (!conversation || !services || running || compacting) return;
    setCompactStatus("running");
    setCompactMessage(t.chat.compacting);
    const result = await services.conversations.compress(conversation.conversation.id);
    if (result.ok) {
      setCompactStatus("success");
      setCompactMessage(t.chat.compacted);
      window.setTimeout(() => {
        setCompactStatus("idle");
        setCompactMessage(null);
      }, 2400);
      return;
    }
    setCompactStatus("error");
    setCompactMessage(
      result.error.code === "insufficient-history"
        ? t.chat.compactNeedHistory
        : `${t.chat.compactFailed}: ${result.error.message}`,
    );
  }

  return (
    <section className="ob-chat">
      <header className="ob-chat-header">
        <div>
          <strong>{conversation?.conversation.title || t.sidebar.untitled}</strong>
          <small>{conversation?.conversation.template ?? t.chat.noProject}</small>
        </div>
      </header>
      <div
        className="ob-messages"
        onScroll={handleMessagesScroll}
        onWheel={handleMessagesWheel}
        ref={messagesRef}
      >
        {grouped.length === 0 ? (
          <div className="ob-welcome">
            <span><Icon name="sparkles" size={28} /></span>
            <h1>{t.chat.whatBuild}</h1>
            <p>{t.chat.welcomeDescription}</p>
          </div>
        ) : (
          grouped.map((message) => <ChatMessage key={message.id} message={message} toolResults={toolResults} />)
        )}
        {stream ? <article className="ob-message ob-message-assistant"><p>{stream}</p></article> : null}
        {running && !stream ? <div className="ob-running">{interpolate(t.chat.running, { status: runState.status.replaceAll("-", " ") })}</div> : null}
        {runState.status === "failed" ? (
          <article className="ob-message ob-message-assistant is-error">
            <p>{agentFailureTitle(runState.error.code, t)}: {runState.error.message}</p>
          </article>
        ) : null}
      </div>
      {serviceError ? (
        <button className="ob-config-warning" onClick={onOpenSettings}>
          {t.chat.configureProvider} · {serviceError.message}
        </button>
      ) : null}
      <form className="ob-composer" onSubmit={submit}>
        <div className="ob-composer-toolbar">
          <div className="ob-composer-toolbar-left">
            <label className="ob-attach-button" aria-label={t.chat.attach} title={t.chat.attach}>
              <Icon name="image" size={17} />
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(event) => {
                  void pickAttachments(event.currentTarget.files, attachments, setAttachments, setAttachmentError, t);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {selectedElement ? (
              <span className="ob-selected-element-chip">
                <Icon name="crosshair" size={13} />
                {interpolate(t.chat.selectedElement, {
                  tag: selectedElement.dom.tag || selectedElement.source.tag,
                  file: selectedElement.source.file,
                })}
                <button type="button" onClick={onSelectedElementClear} aria-label={t.chat.clearSelectedElement}>
                  ×
                </button>
              </span>
            ) : null}
          </div>
          <div className="ob-composer-toolbar-right" aria-label={t.chat.shortcuts}>
            {compactMessage ? (
              <small className={`ob-compact-status is-${compactStatus}`}>{compactMessage}</small>
            ) : null}
            <button
              type="button"
              className={`ob-chat-tool-button ${compacting ? "is-busy" : ""}`}
              disabled={!canRunShortcut}
              onClick={() => void compactConversation()}
              aria-label={t.chat.compact}
              title={t.chat.compact}
            >
              <Icon name="database" size={15} />
            </button>
            <button
              type="button"
              className="ob-chat-tool-button"
              disabled={!canRunShortcut}
              onClick={() => void runAgentContent([{ type: "text", text: t.chat.reviewPrompt }])}
              aria-label={t.chat.review}
              title={t.chat.review}
            >
              <Icon name="eye" size={15} />
            </button>
          </div>
        </div>
        <div className="ob-composer-input">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={t.chat.inputPlaceholder}
            rows={1}
          />
          {running && conversation && services ? (
            <button
              type="button"
              className="ob-composer-run-button is-running"
              onClick={() => services.agent.cancel(conversation.conversation.id)}
              aria-label={t.chat.stop}
            >
              <span>{t.chat.stop}</span>
            </button>
          ) : (
            <button className="ob-composer-run-button" disabled={!canSend} type="submit" aria-label={t.chat.start}>
              <span>{t.chat.start}</span>
            </button>
          )}
        </div>
        {attachments.length > 0 ? (
          <div className="ob-attachments">
            {attachments.map((attachment) => (
              <span key={`${attachment.name}-${attachment.size}`}>
                <Icon name="image" size={13} /> {attachment.name}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item !== attachment),
                    )
                  }
                  aria-label={interpolate(t.chat.removeAttachment, { name: attachment.name })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachmentError ? <small className="ob-attachment-error">{attachmentError}</small> : null}
      </form>
    </section>
  );
}

function isKnownSlashCommand(command: string): boolean {
  return command === "/new" ||
    command === "/fork" ||
    command === "/compact" ||
    command === "/review";
}

function isNearScrollBottom(element: HTMLElement, threshold = 28): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function scrollMessagesToBottom(element: HTMLElement | null): void {
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}

function formatSelectedElementHiddenContext(selection: PreviewElementSelection): string {
  const domSelector = [
    selection.dom.tag || selection.source.tag,
    selection.dom.id ? `#${selection.dom.id}` : "",
    selection.dom.className ? `.${selection.dom.className.trim().split(/\s+/).join(".")}` : "",
  ].join("");
  return [
    "Selected element edit task:",
    "IMPORTANT: Apply the user's request to the selected DOM element only.",
    "Do not change html/body styles, page/container backgrounds, global theme colors, or unrelated elements unless the user explicitly asks for a page-wide change.",
    "The visible user message is the user's actual request. This hidden context is only for locating and scoping the edit.",
    "",
    "Selected target:",
    `DOM selector: ${domSelector}`,
    selection.dom.text ? `Visible text: ${selection.dom.text}` : "",
    `Source file: ${selection.source.file}`,
    `Source location: ${selection.source.line}:${selection.source.column}`,
    `Opening tag: ${selection.source.openingTag}`,
    "",
    "Implementation guidance:",
    "If the request is visual styling, scope the CSS change to this target element or add a class to this target element, then style that class.",
    "Keep surrounding layout and other page elements unchanged unless they are necessary for this selected element.",
    "",
    "Source snippet:",
    "```",
    selection.source.snippet,
    "```",
  ].filter(Boolean).join("\n");
}

function resizeComposerTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
}

function agentFailureTitle(code: string, t: Translation): string {
  return code === "max-iterations" ? t.chat.agentStopped : t.chat.modelFailed;
}

async function pickAttachments(
  files: FileList | null,
  existing: readonly PendingAttachment[],
  setAttachments: (attachments: readonly PendingAttachment[]) => void,
  setError: (message: string | null) => void,
  t: Translation,
) {
  if (!files || files.length === 0) return;
  setError(null);
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  if (images.length < files.length) {
    setError(t.chat.onlyImages);
  }
  const selected = images.slice(0, MAX_ATTACHMENTS - existing.length);
  if (selected.length < images.length) {
    setError(interpolate(t.chat.onlyAttachments, { count: MAX_ATTACHMENTS }));
  }
  const accepted: PendingAttachment[] = [];
  for (const file of selected) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(interpolate(t.chat.fileTooLarge, { name: file.name }));
      continue;
    }
    accepted.push({
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      data: await readFileAsDataUrl(file),
    });
  }
  setAttachments([...existing, ...accepted]);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Failed to read ${file.name}`)));
    reader.readAsDataURL(file);
  });
}
