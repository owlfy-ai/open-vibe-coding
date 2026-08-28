import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { PersistedConversation } from "@/infrastructure/persistence";
import type { AgentRunState } from "@/domain/agent";
import type { ConversationId, ToolMessage, UserContent } from "@/domain/conversation";
import type { PreviewElementPromptRequest, PreviewElementSelection } from "@/application/preview";
import { useApplication } from "../runtime";
import { interpolate, useT, type Translation } from "../i18n";
import { Icon } from "../icons";
import { ChatMessage } from "./ChatMessage";
import { MarkdownContent } from "./MarkdownContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { liveRunFor, reduceChatLiveRuns } from "./chat-live-runs";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_RASTERIZED_SVG_DIMENSION = 2048;
const SVG_IMAGE_TYPE = "image/svg+xml";

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
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [compactStatus, setCompactStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  const [liveRuns, dispatchLiveRun] = useReducer(reduceChatLiveRuns, {});
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const processedElementPromptRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const conversationId = conversation?.conversation.id ?? null;
  const liveRun = liveRunFor(liveRuns, conversationId);
  const runState: AgentRunState = liveRun.state;
  const stream = liveRun.text;
  const reasoningStream = liveRun.reasoning;
  const reasoningOpen = liveRun.reasoningOpen;
  const running = runState.status === "preparing" || runState.status === "streaming" || runState.status === "executing-tools";
  const messages = conversation?.conversation.messages ?? [];
  const canSend = Boolean(conversation && services && (input.trim() || attachments.length > 0));

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
  const seenAssistantCounts = useRef<Partial<Record<ConversationId, number>>>({});
  useEffect(() => {
    if (!conversationId) return;
    const previous = seenAssistantCounts.current[conversationId];
    seenAssistantCounts.current[conversationId] = assistantCount;
    if (previous === undefined || assistantCount === previous) return;
    dispatchLiveRun({ type: "clear-output", conversationId });
  }, [assistantCount, conversationId]);

  useEffect(() => {
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => scrollMessagesToBottom(messagesRef.current));
  }, [conversation?.conversation.id]);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollMessagesToBottom(messagesRef.current);
  }, [conversation?.conversation.id, grouped.length, messages.length, running, stream, reasoningStream]);

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

  useEffect(() => {
    let dragDepth = 0;

    function handleFileDragEnter(event: DragEvent) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth += 1;
      setDraggingFiles(true);
    }

    function handleFileDragOver(event: DragEvent) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }

    function handleFileDragLeave(event: DragEvent) {
      if (dragDepth === 0) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDraggingFiles(false);
    }

    function handleFileDrop(event: DragEvent) {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth = 0;
      setDraggingFiles(false);
      void pickAttachments(
        event.dataTransfer?.files ?? null,
        attachments,
        setAttachments,
        setAttachmentError,
        t,
      );
    }

    window.addEventListener("dragenter", handleFileDragEnter);
    window.addEventListener("dragover", handleFileDragOver);
    window.addEventListener("dragleave", handleFileDragLeave);
    window.addEventListener("drop", handleFileDrop);
    return () => {
      window.removeEventListener("dragenter", handleFileDragEnter);
      window.removeEventListener("dragover", handleFileDragOver);
      window.removeEventListener("dragleave", handleFileDragLeave);
      window.removeEventListener("drop", handleFileDrop);
    };
  }, [attachments, t]);

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
    if (!conversation || !services) return;
    const targetConversationId = conversation.conversation.id;
    const targetWasRunning = running;
    dispatchLiveRun({ type: "clear-output", conversationId: targetConversationId });
    const observer = {
      onStateChange: (state: AgentRunState) => {
        dispatchLiveRun({ type: "state", conversationId: targetConversationId, state });
      },
      onDelta: ({ type, value }: { readonly type: string; readonly value: string }) => {
        if (type !== "reasoning" && type !== "text") return;
        dispatchLiveRun({ type: "delta", conversationId: targetConversationId, kind: type, value });
      },
    };
    const run = targetWasRunning
      ? services.agent.interruptAndRun.bind(services.agent)
      : services.agent.run.bind(services.agent);
    const result = await run(targetConversationId, content, {
      hiddenContext: options.hiddenContext,
      observer,
    });
    dispatchLiveRun({ type: "clear-output", conversationId: targetConversationId });
    if (result.ok && result.value.state.status === "completed") {
      void services.conversations.generateInitialTitle(targetConversationId).catch(() => undefined);
    }
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
      {draggingFiles ? (
        <div className="ob-chat-drop-overlay" role="status" aria-live="polite">
          <span><Icon name="image" size={28} /></span>
          <strong>{t.chat.dropImages}</strong>
          <small>{t.chat.dropImageHint}</small>
        </div>
      ) : null}
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
        {reasoningStream || stream ? (
          <article className="ob-message ob-message-assistant">
            {reasoningStream ? (
              <ReasoningBlock
                text={reasoningStream}
                open={reasoningOpen}
                onOpenChange={(open) => {
                  if (conversationId) dispatchLiveRun({ type: "reasoning-open", conversationId, open });
                }}
              />
            ) : null}
            {stream ? <MarkdownContent content={stream} /> : null}
          </article>
        ) : null}
        {running && !stream && !reasoningStream ? (
          <div className="ob-running">{interpolate(t.chat.running, { status: runState.status.replaceAll("-", " ") })}</div>
        ) : null}
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
                accept="image/*,.svg"
                onChange={(event) => {
                  void pickAttachments(event.currentTarget.files, attachments, setAttachments, setAttachmentError, t);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {attachments.length > 0 ? (
              <div className="ob-attachments">
                {attachments.map((attachment) => (
                  <div className="ob-attachment-preview" key={`${attachment.name}-${attachment.size}`}>
                    <img src={attachment.data} alt={attachment.name} />
                    <span title={attachment.name}>{attachment.name}</span>
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
                  </div>
                ))}
              </div>
            ) : null}
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
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                if (composingRef.current || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={t.chat.inputPlaceholder}
            rows={1}
          />
          <button className="ob-composer-run-button" disabled={!canSend} type="submit" aria-label={running ? t.chat.send : t.chat.start}>
            <span>{running ? t.chat.send : t.chat.start}</span>
          </button>
          {running && conversation && services ? (
            <button
              type="button"
              className="ob-composer-run-button is-running"
              onClick={() => services.agent.cancel(conversation.conversation.id)}
              aria-label={t.chat.stop}
            >
              <span>{t.chat.stop}</span>
            </button>
          ) : null}
        </div>
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

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
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
  const images = [...files].filter(isSupportedImageFile);
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
    try {
      const attachment = await prepareImageAttachment(file);
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        setError(interpolate(t.chat.fileTooLarge, { name: file.name }));
        continue;
      }
      accepted.push(attachment);
    } catch {
      setError(interpolate(t.chat.readFileFailed, { name: file.name }));
    }
  }
  setAttachments([...existing, ...accepted]);
}

function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg");
}

function isSvgImageFile(file: File): boolean {
  return file.type === SVG_IMAGE_TYPE || file.name.toLowerCase().endsWith(".svg");
}

async function prepareImageAttachment(file: File): Promise<PendingAttachment> {
  if (!isSvgImageFile(file)) {
    return {
      name: file.name,
      mediaType: file.type,
      size: file.size,
      data: await readBlobAsDataUrl(file, file.name),
    };
  }

  const png = await rasterizeSvgAsPng(file);
  return {
    name: file.name,
    mediaType: "image/png",
    size: png.size,
    data: await readBlobAsDataUrl(png, file.name),
  };
}

async function rasterizeSvgAsPng(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl, file.name);
    const sourceWidth = image.naturalWidth || 300;
    const sourceHeight = image.naturalHeight || 150;
    const scale = Math.min(
      1,
      MAX_RASTERIZED_SVG_DIMENSION / Math.max(sourceWidth, sourceHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Failed to create canvas for ${file.name}`);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToPng(canvas, file.name);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Failed to load ${name}`)), { once: true });
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement, name: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Failed to convert ${name} to PNG`));
    }, "image/png");
  });
}

function readBlobAsDataUrl(blob: Blob, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Failed to read ${name}`)));
    reader.readAsDataURL(blob);
  });
}
