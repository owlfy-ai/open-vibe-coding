import { useEffect, useRef, useState } from "react";
import type { ConversationId } from "@/domain/conversation";
import { useApplication } from "../runtime";
import { useT } from "../i18n";
import { Icon } from "../icons";

export function SessionSidebar({
  collapsed,
  onCollapsedChange,
  onOpenSettings,
}: {
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onOpenSettings: () => void;
}) {
  const { database, runtime } = useApplication();
  const t = useT();
  const sidebarRef = useRef<HTMLElement>(null);
  const [openMenuId, setOpenMenuId] = useState<ConversationId | null>(null);
  const conversations = Object.values(database.conversations).sort(
    (left, right) => right.conversation.updatedAt - left.conversation.updatedAt,
  );

  useEffect(() => {
    if (collapsed) setOpenMenuId(null);
  }, [collapsed]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && sidebarRef.current?.contains(target)) return;
      setOpenMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  if (collapsed) {
    return (
      <aside className="ob-sidebar ob-sidebar-collapsed" ref={sidebarRef}>
        <div className="ob-sidebar-collapsed-top">
          <button className="ob-icon-button" onClick={() => onCollapsedChange(false)} aria-label={t.sidebar.openSessions}>
            <Icon name="menu" />
          </button>
          <button className="ob-icon-button" onClick={() => void runtime.session.createConversation()} aria-label={t.sidebar.newApplication}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="ob-sidebar-collapsed-bottom">
          <button className="ob-icon-button" onClick={onOpenSettings} aria-label={t.sidebar.settings}>
            <Icon name="settings" />
          </button>
        </div>
      </aside>
    );
  }

  const select = (id: ConversationId) => {
    setOpenMenuId(null);
    void runtime.session.switchConversation(id);
  };
  return (
    <aside className="ob-sidebar" ref={sidebarRef}>
      <header className="ob-sidebar-header">
        <div className="ob-sidebar-title-row">
          <BrandLogo />
          <strong>{t.app.name}</strong>
        </div>
        <button className="ob-icon-button" onClick={() => onCollapsedChange(true)} aria-label={t.sidebar.collapseSessions}>
          <Icon name="chevronLeft" />
        </button>
      </header>
      <button className="ob-primary-button ob-new-button" onClick={() => void runtime.session.createConversation()} aria-label={t.sidebar.newApplication} title={t.sidebar.newApplication}>
        <Icon name="plus" size={16} />
        {t.sidebar.newApplication}
      </button>
      <nav className="ob-session-list" aria-label={t.sidebar.conversations}>
        {conversations.map(({ conversation }) => (
          <div
            className={`ob-session ${conversation.id === database.activeConversationId ? "is-active" : ""}`}
            key={conversation.id}
          >
            <button className="ob-session-main" onClick={() => select(conversation.id)}>
              <span className={`ob-pin ${conversation.pinned ? "is-on" : ""}`}>
                <Icon name={conversation.pinned ? "pinFilled" : "pin"} size={11} />
              </span>
              <span>{conversation.title || t.sidebar.untitled}</span>
            </button>
            <details className="ob-session-menu" open={openMenuId === conversation.id}>
              <summary
                aria-label={t.sidebar.actions}
                onClick={(event) => {
                  event.preventDefault();
                  setOpenMenuId((current) => current === conversation.id ? null : conversation.id);
                }}
              >
                <Icon name="more" size={16} />
              </summary>
              <div className="ob-popover">
                <button onClick={() => {
                  setOpenMenuId(null);
                  void rename(conversation.id, conversation.title, runtime.session, t.sidebar.titlePrompt);
                }}>
                  <Icon name="pencil" size={15} />{t.sidebar.rename}
                </button>
                <button
                  onClick={() => {
                    setOpenMenuId(null);
                    void runtime.session.updateConversation(conversation.id, {
                      pinned: !conversation.pinned,
                    });
                  }}
                >
                  <Icon name={conversation.pinned ? "pin" : "pinFilled"} size={15} />
                  {conversation.pinned ? t.sidebar.unpin : t.sidebar.pin}
                </button>
                <button
                  onClick={() => {
                    setOpenMenuId(null);
                    void runtime.session.updateConversation(conversation.id, {
                      archived: !conversation.archived,
                    });
                  }}
                >
                  <Icon name="folder" size={15} />{conversation.archived ? t.sidebar.restore : t.sidebar.archive}
                </button>
                <button onClick={() => {
                  setOpenMenuId(null);
                  void runtime.session.forkConversation(conversation.id);
                }}>
                  <Icon name="code" size={15} />{t.sidebar.fork}
                </button>
                <button className="is-danger" onClick={() => {
                  setOpenMenuId(null);
                  void runtime.session.deleteConversation(conversation.id);
                }}>
                  <Icon name="trash" size={15} />{t.sidebar.delete}
                </button>
              </div>
            </details>
          </div>
        ))}
      </nav>
      <footer className="ob-sidebar-footer">
        <button className="ob-secondary-button" onClick={onOpenSettings} aria-label={t.sidebar.settings} title={t.sidebar.settings}>
          <Icon name="settings" />
        </button>
      </footer>
    </aside>
  );
}

function BrandLogo() {
  return <img className="ob-brand-mark" src="/logo.svg" alt="" />;
}

async function rename(
  id: ConversationId,
  current: string | null,
  session: ReturnType<typeof useApplication>["runtime"]["session"],
  titlePrompt: string,
) {
  const title = window.prompt(titlePrompt, current ?? "");
  if (title?.trim()) await session.updateConversation(id, { title: title.trim() });
}
