import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import type { ConversationId } from "@/domain/conversation";
import { useApplication } from "../runtime";
import { useBackendAccount } from "../auth/BackendAuthGate";
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
          <BrandLogo />
          <button className="ob-icon-button" onClick={() => onCollapsedChange(false)} aria-label={t.sidebar.openSessions}>
            <Icon name="menu" />
          </button>
          <button className="ob-icon-button" onClick={() => void runtime.session.createConversation()} aria-label={t.sidebar.newApplication}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="ob-sidebar-collapsed-bottom">
          <AccountMenu collapsed />
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
        <AccountMenu />
        <button className="ob-secondary-button" onClick={onOpenSettings} aria-label={t.sidebar.settings} title={t.sidebar.settings}>
          <Icon name="settings" />
        </button>
      </footer>
    </aside>
  );
}

function AccountMenu({ collapsed = false }: { readonly collapsed?: boolean }) {
  const account = useBackendAccount();
  const { user } = useUser();
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!account?.session) {
    return (
      <div className="ob-account-menu" ref={menuRef}>
        <button
          className="ob-user-avatar-button"
          onClick={() => void account?.requireLogin()}
          aria-label={t.auth.signIn}
          title={t.auth.signIn}
        >
          {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : "U"}
        </button>
      </div>
    );
  }

  const session = account.session;
  const displayName = session.user.name || session.user.email || "User";
  const avatarUrl = user?.imageUrl;
  const credits = session.plan.creditsRemaining;
  const planText = credits === undefined
    ? session.plan.name
    : `${session.plan.name} · ${credits} credits`;

  async function openBilling() {
    if (!account) return;
    setBillingBusy(true);
    try {
      window.location.assign(await account.client.createBillingPortal());
    } finally {
      setBillingBusy(false);
    }
  }

  return (
    <div className="ob-account-menu" ref={menuRef}>
      <button
        className="ob-user-avatar-button"
        onClick={() => setOpen((current) => !current)}
        aria-label={displayName}
        title={displayName}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" /> : avatarInitial(displayName)}
      </button>
      {open ? (
        <div className={collapsed ? "ob-account-popover is-collapsed" : "ob-account-popover"}>
          <div className="ob-account-popover-header">
            <span className="ob-user-avatar-large">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : avatarInitial(displayName)}
            </span>
            <span>
              <strong>{displayName}</strong>
              <small>{session.user.email}</small>
            </span>
          </div>
          <div className="ob-account-credit-row">
            <span>{planText}</span>
          </div>
          <button className="ob-account-action" disabled={billingBusy} onClick={() => void openBilling()}>
            {t.auth.billing}
          </button>
          <button className="ob-account-action is-danger" onClick={() => void account.logout()}>
            {t.auth.logout}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BrandLogo() {
  return <img className="ob-brand-mark" src="/logo.svg" alt="" />;
}

function avatarInitial(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "U";
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
