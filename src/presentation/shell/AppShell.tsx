import { lazy, Suspense, useEffect, useState } from "react";
import type { ConversationId } from "@/domain/conversation";
import type { PreviewElementPromptRequest, PreviewElementSelection } from "@/application/preview";
import { useApplication } from "../runtime";
import { SessionSidebar } from "../sessions/SessionSidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { Icon } from "../icons";
import { useT } from "../i18n";

const WorkspacePanel = lazy(() =>
  import("../workspace/WorkspacePanel").then((module) => ({ default: module.WorkspacePanel })),
);

export function AppShell() {
  const { database, runtime } = useApplication();
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceCache, setWorkspaceCache] = useState<readonly ConversationId[]>([]);
  const [selectedElements, setSelectedElements] = useState<Readonly<Record<ConversationId, PreviewElementSelection | null>>>({});
  const [elementPromptRequest, setElementPromptRequest] = useState<PreviewElementPromptRequest | null>(null);

  useEffect(() => {
    if (database.activeConversationId || Object.keys(database.conversations).length > 0) return;
    void runtime.session.createConversation();
  }, [database.activeConversationId, database.conversations, runtime.session]);

  const active = database.activeConversationId
    ? database.conversations[database.activeConversationId]
    : null;
  const activeWorkspaceId = active?.project.initialized ? active.conversation.id : null;
  const workspaceIds = activeWorkspaceId && !workspaceCache.includes(activeWorkspaceId)
    ? [...workspaceCache, activeWorkspaceId]
    : workspaceCache;

  useEffect(() => {
    setWorkspaceCache((ids) => {
      const existing = ids.filter((id) => database.conversations[id]?.project.initialized);
      return activeWorkspaceId && !existing.includes(activeWorkspaceId)
        ? [...existing, activeWorkspaceId]
        : existing;
    });
  }, [activeWorkspaceId, database.conversations]);

  return (
    <div className={`ob-app ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <SessionSidebar
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatPanel
        conversation={active}
        selectedElement={active ? selectedElements[active.conversation.id] ?? null : null}
        elementPromptRequest={
          active && elementPromptRequest?.conversationId === active.conversation.id
            ? elementPromptRequest
            : null
        }
        onElementPromptRequestConsumed={() => setElementPromptRequest(null)}
        onSelectedElementClear={() => {
          if (!active) return;
          setSelectedElements((current) => ({ ...current, [active.conversation.id]: null }));
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <section className="ob-workspace-shell">
        <Suspense fallback={<div className="ob-center">{t.workspace.loading}</div>}>
          {workspaceIds.map((id) => {
            const conversation = database.conversations[id];
            if (!conversation?.project.initialized) return null;
            const isActive = id === active?.conversation.id;
            return (
              <div
                className={`ob-workspace-cache-entry ${isActive ? "" : "is-hidden"}`}
                aria-hidden={!isActive}
                key={id}
              >
                <WorkspacePanel
                  active={isActive}
                  conversation={conversation}
                  onElementSelected={(selection) => {
                    setSelectedElements((current) => ({ ...current, [selection.conversationId]: selection }));
                  }}
                  onElementPrompt={(request) => {
                    setSelectedElements((current) => ({ ...current, [request.conversationId]: null }));
                    setElementPromptRequest(request);
                  }}
                />
              </div>
            );
          })}
        </Suspense>
        {!active?.project.initialized ? (
          <div className="ob-center ob-empty-workspace">
            <span><Icon name="command" size={26} /></span>
            <h2>{t.workspace.emptyTitle}</h2>
            <p>{t.workspace.emptyDescription}</p>
          </div>
        ) : null}
      </section>
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
