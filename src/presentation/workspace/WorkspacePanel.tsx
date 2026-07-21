import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  SandpackConsole,
  SandpackLayout,
  SandpackPreview,
  type SandpackPredefinedTemplate,
} from "@codesandbox/sandpack-react";
import type { PersistedConversation } from "@/infrastructure/persistence";
import { isBackendAuthRequiredError, type PublishedSite } from "@/infrastructure/backend";
import type { PreviewElementPromptRequest, PreviewElementSelection, PreviewRevisionState } from "@/application/preview";
import {
  findPackageJsonError,
  PreviewErrorCard,
  SandpackErrorBoundary,
  SandpackRuntime,
} from "@/infrastructure/preview";
import { useApplication } from "../runtime";
import { useBackendAccount } from "../auth/BackendAuthGate";
import { useResolvedTheme } from "../theme/ThemeProvider";
import { Icon } from "../icons";
import { useT } from "../i18n";

// Lazy-loaded so preview-first sessions don't pay for CodeMirror until the user
// opens the code pane. The editor is owned by the app rather than Sandpack so
// CSS/JS/TS files stay editable across templates.
const CodeMirrorEditor = lazy(() =>
  import("./CodeMirrorEditor").then((module) => ({ default: module.CodeMirrorEditor })),
);

type Device = "desktop" | "tablet" | "mobile";
type PublishStatus = "idle" | "checking" | "publishing" | "success" | "error";
const PENDING_PUBLISH_OPEN_KEY = "ovc.pendingPublishOpen";
const PUBLISH_STATUS_POLL_INTERVAL_MS = 2_500;
const PUBLISH_STATUS_TIMEOUT_MS = 180_000;
type FileTreeNode = {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory";
  readonly children: readonly FileTreeNode[];
};
const MIN_PREVIEW_LOADING_MS = 650;
const PREVIEW_LOAD_FALLBACK_MS = 2_500;

export function WorkspacePanel({
  active,
  conversation,
  onElementSelected,
  onElementPrompt,
}: {
  readonly active: boolean;
  readonly conversation: PersistedConversation;
  readonly onElementSelected?: (selection: PreviewElementSelection) => void;
  readonly onElementPrompt?: (request: PreviewElementPromptRequest) => void;
}) {
  const { runtime, services } = useApplication();
  const account = useBackendAccount();
  const t = useT();
  const theme = useResolvedTheme();
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [showConsole, setShowConsole] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [activeFile, setActiveFile] = useState(firstFile(conversation));
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(() => new Set(["src"]));
  const [createTarget, setCreateTarget] = useState<{ readonly type: "file" | "directory"; readonly parent: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishCreationTitle, setPublishCreationTitle] = useState(() => defaultPublishTitle(conversation.conversation.title));
  const [publishAppName, setPublishAppName] = useState(() => defaultAppName(conversation.conversation.title));
  const [publishSubdomain, setPublishSubdomain] = useState("");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishedSites, setPublishedSites] = useState<readonly PublishedSite[]>([]);
  const [cancelPublishBusyId, setCancelPublishBusyId] = useState<number | null>(null);
  const [previewState, setPreviewState] = useState<PreviewRevisionState | null>(null);
  const [loadedPreviewRevision, setLoadedPreviewRevision] = useState<number | null>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const previewLoadingStartedAt = useRef(performance.now());
  const preview = services?.preview;
  const vipLevel = account?.session?.vipLevel ?? 0;
  const canUseCustomSubdomain = vipLevel >= 1;
  const fixedPublishSubdomain = account?.session?.publishSubDomain?.trim() ?? "";
  const effectivePublishSubdomain = fixedPublishSubdomain || publishSubdomain;
  const effectivePublishUrl = useMemo(
    () => publishUrlPreview(publishAppName, effectivePublishSubdomain, canUseCustomSubdomain),
    [canUseCustomSubdomain, effectivePublishSubdomain, publishAppName],
  );
  const conversationId = conversation.conversation.id;
  const revision = conversation.project.revision;
  const previewStatus = previewState?.status ?? null;
  const previewLoading = active
    && mode === "preview"
    && loadedPreviewRevision !== revision
    && previewStatus !== "failed";
  const elementPromptLabels = useMemo(
    () => ({
      dialogLabel: t.workspace.elementPromptDialog,
      placeholder: t.workspace.elementPromptPlaceholder,
      submit: t.workspace.elementPromptSubmit,
      cancel: t.workspace.elementPromptCancel,
    }),
    [
      t.workspace.elementPromptCancel,
      t.workspace.elementPromptDialog,
      t.workspace.elementPromptPlaceholder,
      t.workspace.elementPromptSubmit,
    ],
  );

  const files = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(conversation.project.files).map(([path, code]) => [
          path.startsWith("/") ? path : `/${path}`,
          { code },
        ]),
      ),
    [conversation.project.files],
  );
  // A malformed package.json would crash Sandpack's provider at render time
  // (JSON.parse in addPackageJSONIfNeeded). Detect it up front so we never
  // mount the crashing provider — isolating the failure to this session.
  const packageError = useMemo(
    () => findPackageJsonError(conversation.project.files),
    [conversation.project.files],
  );
  const updateFile = useCallback(
    (path: string, content: string) => {
      void runtime.session.applyProjectOperations(conversation.conversation.id, [
        { type: "write-file", path, content },
      ]);
    },
    [conversation.conversation.id, runtime.session],
  );
  const createProjectPath = useCallback(
    (type: "file" | "directory", parent: string, name: string) => {
      const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
      if (!trimmed) return;
      const path = parent ? `${parent}/${trimmed}` : trimmed;
      const operation = type === "file"
        ? { type: "write-file" as const, path, content: defaultFileContent(path) }
        : { type: "create-directory" as const, path };
      void runtime.session.applyProjectOperations(conversation.conversation.id, [operation]).then((result) => {
        if (!result.ok) return;
        if (type === "file") setActiveFile(path);
        if (type === "directory") {
          setExpandedFolders((current) => new Set(current).add(path));
        }
      });
    },
    [conversation.conversation.id, runtime.session],
  );
  const deleteProjectPath = useCallback(
    (path: string) => {
      if (!window.confirm(t.workspace.deletePathConfirm)) return;
      void runtime.session.applyProjectOperations(conversation.conversation.id, [
        { type: "delete", path },
      ]);
    },
    [conversation.conversation.id, runtime.session, t.workspace.deletePathConfirm],
  );
  const submitCreate = useCallback(() => {
    if (!createTarget) return;
    createProjectPath(createTarget.type, createTarget.parent, createName);
    setCreateTarget(null);
    setCreateName("");
  }, [createName, createProjectPath, createTarget]);
  const cancelCreate = useCallback(() => {
    setCreateTarget(null);
    setCreateName("");
  }, []);
  const showPublishDialog = useCallback(() => {
    setPublishCreationTitle(defaultPublishTitle(conversation.conversation.title));
    setPublishAppName((current) => current || defaultAppName(conversation.conversation.title));
    setPublishStatus("idle");
    setPublishMessage(null);
    setPublishedUrl(null);
    setPublishedSites([]);
    setPublishOpen(true);
  }, [conversation.conversation.title]);
  const openPublishDialog = useCallback(async () => {
    const session = account?.client.current() ?? account?.session;
    if (!session) {
      sessionStorage.setItem(PENDING_PUBLISH_OPEN_KEY, "1");
      const next = await account?.requireLogin();
      if (!next) {
        sessionStorage.removeItem(PENDING_PUBLISH_OPEN_KEY);
        return;
      }
    }
    sessionStorage.removeItem(PENDING_PUBLISH_OPEN_KEY);
    showPublishDialog();
  }, [account, showPublishDialog]);
  const checkPublishName = useCallback(async () => {
    if (!account) {
      setPublishStatus("error");
      setPublishMessage(t.workspace.publishLoginRequired);
      return;
    }
    const validationError = validatePublishRoute(publishAppName, effectivePublishSubdomain, canUseCustomSubdomain, t.workspace);
    if (validationError) {
      setPublishStatus("error");
      setPublishMessage(validationError);
      return;
    }
    setPublishStatus("checking");
    setPublishMessage(null);
    try {
      const result = await withBackendLoginRetry(account, () =>
        account.client.checkPublishName(publishAppName.trim(), canUseCustomSubdomain ? effectivePublishSubdomain.trim() : ""),
      );
      if (!result) {
        setPublishStatus("error");
        setPublishMessage(t.workspace.publishLoginRequired);
        return;
      }
      setPublishStatus(result.available ? "success" : "error");
      setPublishMessage(result.message
        ? normalizePublishServerMessage(result.message, t.workspace)
        : (result.available ? t.workspace.publishNameAvailable : t.workspace.publishInvalidName));
      setPublishedUrl(null);
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? normalizePublishServerMessage(error.message, t.workspace) : t.workspace.publishInvalidName);
    }
  }, [account, canUseCustomSubdomain, effectivePublishSubdomain, publishAppName, t.workspace]);
  const loadPublishedSites = useCallback(async () => {
    if (!account) return [];
    const sites = await withBackendLoginRetry(account, () => account.client.listPublishedSites());
    const activeSites = (sites ?? []).filter((site) => site.status !== "disabled");
    setPublishedSites(activeSites);
    return activeSites;
  }, [account]);
  const publishProject = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!account) {
      setPublishStatus("error");
      setPublishMessage(t.workspace.publishLoginRequired);
      return;
    }
    if (!publishCreationTitle.trim()) {
      setPublishStatus("error");
      setPublishMessage(t.workspace.publishTitleRequired);
      return;
    }
    const creationTitle = publishCreationTitle.trim();
    const validationError = validatePublishRoute(publishAppName, effectivePublishSubdomain, canUseCustomSubdomain, t.workspace);
    if (validationError) {
      setPublishStatus("error");
      setPublishMessage(validationError);
      return;
    }
    setPublishStatus("publishing");
    setPublishMessage(null);
    try {
      if (conversation.conversation.title !== creationTitle) {
        await runtime.session.updateConversation(conversation.conversation.id, { title: creationTitle });
      }
      const subdomain = canUseCustomSubdomain ? effectivePublishSubdomain.trim() : "";
      if (canUseCustomSubdomain && !fixedPublishSubdomain) {
        const confirmed = window.confirm(t.workspace.publishSubdomainConfirm.replace("{domain}", `${subdomain}.qidea.ai`));
        if (!confirmed) {
          setPublishStatus("idle");
          return;
        }
      }
      const site = await withBackendLoginRetry(account, async () => {
        return account.client.publishSite({
          conversationId: conversation.conversation.id,
          title: creationTitle,
          appName: publishAppName.trim(),
          subdomain,
          files: conversation.project.files,
        });
      });
      if (!site) {
        setPublishStatus("error");
        setPublishMessage(t.workspace.publishLoginRequired);
        return;
      }
      setPublishMessage(t.workspace.publishWaiting);
      const ready = await waitForPublishedSiteReady(account, site.id, t.workspace, (buildStatus) => {
        setPublishMessage(buildStatusMessage(buildStatus, t.workspace));
      });
      const url = ready.url || ready.site.url || site.url;
      if (canUseCustomSubdomain && !fixedPublishSubdomain) {
        await account.refresh();
      }
      setPublishStatus("success");
      setPublishedUrl(url);
      setPublishMessage(t.workspace.publishSuccess);
      void loadPublishedSites();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? normalizePublishServerMessage(error.message, t.workspace) : t.workspace.publishInvalidName);
      if (error instanceof Error && error.message.includes("免费用户最多只能发布")) {
        void loadPublishedSites();
      }
    }
  }, [account, canUseCustomSubdomain, conversation.conversation.id, conversation.conversation.title, conversation.project.files, effectivePublishSubdomain, fixedPublishSubdomain, loadPublishedSites, publishAppName, publishCreationTitle, runtime.session, t.workspace]);
  const cancelPublishedSite = useCallback(async (site: PublishedSite) => {
    if (!account || !window.confirm(t.workspace.cancelPublishedConfirm)) return;
    setCancelPublishBusyId(site.id);
    try {
      await withBackendLoginRetry(account, () => account.client.cancelPublishedSite(site.id));
      setPublishStatus("success");
      setPublishMessage(t.workspace.cancelPublishedSuccess);
      await loadPublishedSites();
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? normalizePublishServerMessage(error.message, t.workspace) : t.workspace.publishInvalidName);
    } finally {
      setCancelPublishBusyId(null);
    }
  }, [account, loadPublishedSites, t.workspace]);

  useEffect(() => {
    if (conversation.project.files[activeFile as keyof typeof conversation.project.files] !== undefined) return;
    setActiveFile(firstFile(conversation));
  }, [activeFile, conversation]);

  useEffect(() => {
    if (!account?.session || sessionStorage.getItem(PENDING_PUBLISH_OPEN_KEY) !== "1") return;
    sessionStorage.removeItem(PENDING_PUBLISH_OPEN_KEY);
    showPublishDialog();
  }, [account?.session, showPublishDialog]);

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const path of Object.keys(conversation.project.files)) {
        const parts = path.split("/");
        let prefix = "";
        for (let index = 0; index < parts.length - 1; index += 1) {
          prefix = prefix ? `${prefix}/${parts[index]}` : parts[index];
          next.add(prefix);
        }
      }
      return next;
    });
  }, [conversation.project.files]);

  useEffect(() => {
    if (!preview) {
      setPreviewState(null);
      return;
    }
    setPreviewState(preview.state({ conversationId, revision }));
    return preview.subscribeState((state) => {
      if (state.conversationId === conversationId && state.revision === revision) setPreviewState(state);
    });
  }, [conversationId, preview, revision]);

  useEffect(() => {
    previewLoadingStartedAt.current = performance.now();
    setLoadedPreviewRevision(null);
    setSelectMode(false);
  }, [revision]);

  // When package.json breaks, drop the user straight into the editable code pane
  // (the preview pane shows the error card). Only fires when the error message
  // changes, so manually switching back to Preview is respected — hence `mode`
  // is deliberately excluded from the deps.
  useEffect(() => {
    if (packageError && mode !== "code") setMode("code");
  }, [packageError]);

  // When package.json is broken we don't mount SandpackRuntime, so its normal
  // request/markFailed flow never runs. Register the revision and mark it
  // failed ourselves so the preview status (and any agent waiting on it)
  // resolves to a clear failure instead of hanging.
  useEffect(() => {
    if (!active || !preview || !packageError) return;
    preview.request({ conversationId, revision, reason: "files-changed", restart: false });
    preview.markFailed({ conversationId, revision }, packageError);
  }, [active, conversationId, packageError, preview, revision]);

  useEffect(() => {
    if (!active || !preview) return undefined;
    const root = previewFrameRef.current;
    if (!root) return undefined;
    let cleanupFrame: (() => void) | undefined;
    let settleTimer: number | undefined;
    let animationFrame: number | undefined;
    let settled = false;
    const finishLoading = () => {
      if (settled) return;
      settled = true;
      setLoadedPreviewRevision(revision);
      preview.markReady({ conversationId, revision });
    };
    const markLoaded = () => {
      if (settled) return;
      window.clearTimeout(settleTimer);
      const elapsed = performance.now() - previewLoadingStartedAt.current;
      settleTimer = window.setTimeout(finishLoading, Math.max(0, MIN_PREVIEW_LOADING_MS - elapsed));
    };
    const attach = () => {
      cleanupFrame?.();
      const frame = root.querySelector("iframe");
      if (!frame) return;
      frame.addEventListener("load", markLoaded);
      const fallback = window.setTimeout(markLoaded, PREVIEW_LOAD_FALLBACK_MS);
      cleanupFrame = () => {
        frame.removeEventListener("load", markLoaded);
        window.clearTimeout(fallback);
      };
    };
    animationFrame = window.requestAnimationFrame(attach);
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(settleTimer);
      observer.disconnect();
      cleanupFrame?.();
    };
  }, [active, conversationId, preview, revision]);

  if (!services || !preview) return <div className="ob-center">{t.workspace.configureProvider}</div>;
  const fileTree = (
    <FileTree
      files={conversation.project.files}
      directories={conversation.project.directories}
      activeFile={activeFile}
      expandedFolders={expandedFolders}
      createTarget={createTarget}
      createName={createName}
      onCreateNameChange={setCreateName}
      onSubmitCreate={submitCreate}
      onCancelCreate={cancelCreate}
      onToggleFolder={(path) => {
        setExpandedFolders((current) => {
          const next = new Set(current);
          next.has(path) ? next.delete(path) : next.add(path);
          return next;
        });
      }}
      onSelectFile={setActiveFile}
      onStartCreate={(type, parent) => {
        setExpandedFolders((current) => parent ? new Set(current).add(parent) : current);
        setCreateTarget({ type, parent });
        setCreateName("");
      }}
      onDeletePath={deleteProjectPath}
      labels={t.workspace}
    />
  );
  return (
    <div className="ob-workspace">
      <header className="ob-workspace-toolbar">
        <div className="ob-segmented">
          <button className={mode === "preview" ? "is-active" : ""} onClick={() => setMode("preview")}>
            <Icon name="eye" size={15} />{t.workspace.preview}
          </button>
          <button className={mode === "code" ? "is-active" : ""} onClick={() => setMode("code")}>
            <Icon name="code" size={15} />{t.workspace.code}
          </button>
        </div>
        <div className="ob-workspace-toolbar-actions">
          {mode === "preview" ? (
            <div className="ob-segmented" role="group" aria-label={t.workspace.deviceControls}>
              <button className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")} aria-label={t.workspace.desktop} title={t.workspace.desktop}>
                <Icon name="monitor" size={15} />
              </button>
              <button className={device === "tablet" ? "is-active" : ""} onClick={() => setDevice("tablet")} aria-label={t.workspace.tablet} title={t.workspace.tablet}>
                <Icon name="tablet" size={15} />
              </button>
              <button className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")} aria-label={t.workspace.mobile} title={t.workspace.mobile}>
                <Icon name="smartphone" size={15} />
              </button>
            </div>
          ) : null}
          <div className="ob-segmented" role="group" aria-label={t.workspace.outputControls}>
            {mode === "preview" ? (
              <>
                <button
                  className={selectMode ? "is-icon is-active" : "is-icon"}
                  onClick={() => {
                    setMode("preview");
                    setSelectMode((value) => !value);
                  }}
                  aria-label={selectMode ? t.workspace.cancelSelectElement : t.workspace.selectElement}
                  title={selectMode ? t.workspace.cancelSelectElement : t.workspace.selectElement}
                >
                  <Icon name="crosshair" size={15} />
                </button>
                <button className={showConsole ? "is-icon is-active" : "is-icon"} onClick={() => setShowConsole((value) => !value)} aria-label={showConsole ? t.workspace.hideConsole : t.workspace.showConsole} title={showConsole ? t.workspace.hideConsole : t.workspace.showConsole}>
                  <Icon name="terminal" size={15} />
                </button>
              </>
            ) : null}
            <button className="is-icon" onClick={() => void services.projectArchive.download({ title: conversation.conversation.title, files: conversation.project.files })} aria-label={t.workspace.download} title={t.workspace.download}>
              <Icon name="download" size={15} />
            </button>
            <button className="is-icon" onClick={() => void openPublishDialog()} aria-label={t.workspace.publish} title={t.workspace.publish}>
              <Icon name="globe" size={15} />
            </button>
          </div>
        </div>
      </header>
      {packageError ? (
        // package.json is broken — mounting SandpackProvider would crash (it
        // JSON.parses package.json during render, killing the editor too). So we
        // render our own panes: the error card for Preview, and a plain editor
        // (bound straight to the project files) for Code, so the user can fix
        // the file. Once the JSON is valid again we fall back to full Sandpack.
        <div className="ob-workspace-fallback">
          <div className={`ob-workspace-pane ${mode === "preview" ? "" : "is-hidden"}`} aria-hidden={mode !== "preview"}>
            <PreviewErrorCard
              title={t.workspace.previewErrorTitle}
              detail={packageError}
              hint={t.workspace.previewErrorHint}
            />
          </div>
          <div className={`ob-workspace-pane ${mode === "code" ? "" : "is-hidden"}`} aria-hidden={mode !== "code"}>
            <div className="ob-code-layout">
              {fileTree}
              <Suspense fallback={<div className="ob-center">{t.workspace.editorLoading}</div>}>
                <CodeMirrorEditor
                  key={activeFile}
                  path={activeFile}
                  value={conversation.project.files[activeFile as keyof typeof conversation.project.files] ?? ""}
                  onDebouncedChange={updateFile}
                />
              </Suspense>
            </div>
          </div>
        </div>
      ) : (
        <SandpackErrorBoundary
          resetKey={revision}
          renderFallback={(error, retry) => (
            <PreviewErrorCard
              title={t.workspace.previewErrorTitle}
              detail={error.message}
              hint={t.workspace.previewErrorHint}
              retryLabel={t.workspace.retry}
              onRetry={retry}
            />
          )}
        >
          <SandpackRuntime
            conversationId={conversation.conversation.id}
            revision={revision}
            active={active}
            cachedReady={loadedPreviewRevision === revision}
            theme={theme}
            template={conversation.conversation.template as SandpackPredefinedTemplate}
            files={files}
            activeFile={activeFile.startsWith("/") ? activeFile : `/${activeFile}`}
            coordinator={preview}
            onFileChange={updateFile}
            syncEditorChanges={false}
            selectMode={active && mode === "preview" && selectMode}
            elementPromptLabels={elementPromptLabels}
            onElementSelected={(selection) => {
              setSelectMode(false);
              onElementSelected?.(selection);
            }}
            onElementPrompt={(request) => {
              setSelectMode(false);
              onElementPrompt?.(request);
            }}
          >
            <SandpackLayout>
              <div className={`ob-workspace-pane ${mode === "preview" ? "" : "is-hidden"}`} aria-hidden={mode !== "preview"}>
                <div className={`ob-preview-frame ob-device-${device}`} ref={previewFrameRef}>
                  <div className={showConsole ? "ob-preview-runtime is-console-open" : "ob-preview-runtime"}>
                    <div className={showConsole ? "ob-preview-main is-console-open" : "ob-preview-main"}>
                      <SandpackPreview
                        showNavigator
                        showRefreshButton
                        showOpenInCodeSandbox={false}
                      />
                    </div>
                    <div className={showConsole ? "ob-preview-console is-open" : "ob-preview-console"} aria-hidden={!showConsole}>
                      {previewState?.status === "failed" ? (
                        <pre className="ob-preview-console-error">{previewState.error}</pre>
                      ) : null}
                      <SandpackConsole showSyntaxError />
                    </div>
                  </div>
                  {previewLoading ? (
                    <div className="ob-preview-loading" role="status" aria-live="polite">
                      <div className="ob-preview-loading-card">
                        <span className="ob-preview-loading-cube" />
                        <strong>{t.workspace.loadingPreview}</strong>
                        <small>{t.workspace.loadingPreviewHint}</small>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={`ob-workspace-pane ${mode === "code" ? "" : "is-hidden"}`} aria-hidden={mode !== "code"}>
                <div className="ob-code-layout">
                  {fileTree}
                  <Suspense fallback={<div className="ob-center">{t.workspace.editorLoading}</div>}>
                    <CodeMirrorEditor
                      key={activeFile}
                      path={activeFile}
                      value={conversation.project.files[activeFile as keyof typeof conversation.project.files] ?? ""}
                      onDebouncedChange={updateFile}
                    />
                  </Suspense>
                </div>
              </div>
            </SandpackLayout>
          </SandpackRuntime>
        </SandpackErrorBoundary>
      )}
      {publishOpen ? (
        <PublishDialog
          creationTitle={publishCreationTitle}
          appName={publishAppName}
          canUseCustomSubdomain={canUseCustomSubdomain}
          fixedSubdomain={fixedPublishSubdomain}
          vipLevel={vipLevel}
          subdomain={publishSubdomain}
          status={publishStatus}
          message={publishMessage}
          url={publishedUrl ?? effectivePublishUrl}
          published={Boolean(publishedUrl)}
          publishedSites={publishedSites}
          cancelBusyId={cancelPublishBusyId}
          labels={t.workspace}
          onCreationTitleChange={setPublishCreationTitle}
          onAppNameChange={setPublishAppName}
          onSubdomainChange={setPublishSubdomain}
          onCheckName={() => void checkPublishName()}
          onCancelPublishedSite={(site) => void cancelPublishedSite(site)}
          onClose={() => setPublishOpen(false)}
          onSubmit={(event) => void publishProject(event)}
        />
      ) : null}
    </div>
  );
}

function PublishDialog({
  creationTitle,
  appName,
  subdomain,
  canUseCustomSubdomain,
  fixedSubdomain,
  vipLevel,
  status,
  message,
  url,
  published,
  publishedSites,
  cancelBusyId,
  labels,
  onCreationTitleChange,
  onAppNameChange,
  onSubdomainChange,
  onCheckName,
  onCancelPublishedSite,
  onClose,
  onSubmit,
}: {
  readonly creationTitle: string;
  readonly appName: string;
  readonly subdomain: string;
  readonly canUseCustomSubdomain: boolean;
  readonly fixedSubdomain: string;
  readonly vipLevel: number;
  readonly status: PublishStatus;
  readonly message: string | null;
  readonly url: string;
  readonly published: boolean;
  readonly publishedSites: readonly PublishedSite[];
  readonly cancelBusyId: number | null;
  readonly labels: ReturnType<typeof useT>["workspace"];
  readonly onCreationTitleChange: (value: string) => void;
  readonly onAppNameChange: (value: string) => void;
  readonly onSubdomainChange: (value: string) => void;
  readonly onCheckName: () => void;
  readonly onCancelPublishedSite: (site: PublishedSite) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent) => void;
}) {
  const busy = status === "checking" || status === "publishing";
  const hasFixedSubdomain = fixedSubdomain.trim() !== "";
  const [activeTab, setActiveTab] = useState<"settings" | "published">("settings");
  return (
    <div className="ob-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="ob-publish-dialog" onSubmit={onSubmit}>
        <header>
          <div>
            <h2>{labels.publishTitle}</h2>
            <p>{labels.publishDescription}</p>
          </div>
          <button type="button" className="ob-icon-button" onClick={onClose} aria-label={labels.publishCancel}>
            <Icon name="close" />
          </button>
        </header>
        <div className="ob-publish-body">
          <div className="ob-publish-tabs" role="tablist" aria-label={labels.publishTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "settings"}
              className={activeTab === "settings" ? "is-active" : ""}
              onClick={() => setActiveTab("settings")}
            >
              {labels.publishSettingsTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "published"}
              className={activeTab === "published" ? "is-active" : ""}
              onClick={() => setActiveTab("published")}
            >
              {labels.publishedAppsTab}
            </button>
          </div>
          {activeTab === "settings" ? (
            <>
              <p className="ob-publish-rule">
                {canUseCustomSubdomain ? labels.publishProRule : vipLevel > 0 ? labels.publishPlusRule : labels.publishFreeRule}
              </p>
              <label className="ob-field">
                <span>{labels.publishCreationName}</span>
                <input
                  value={creationTitle}
                  required
                  maxLength={80}
                  placeholder={labels.publishCreationNamePlaceholder}
                  onChange={(event) => onCreationTitleChange(event.currentTarget.value)}
                />
                <small>{labels.publishCreationNameHint}</small>
              </label>
              <label className="ob-field">
                <span>{labels.publishUrlPreview}</span>
                <div className={canUseCustomSubdomain ? "ob-publish-url-row is-pro" : "ob-publish-url-row"}>
                  {canUseCustomSubdomain ? (
                    <>
                      {hasFixedSubdomain ? (
                        <span className="ob-publish-url-static">{`https://${fixedSubdomain}.qidea.ai/`}</span>
                      ) : (
                        <>
                          <span className="ob-publish-url-static">https://</span>
                          <input
                            className="ob-publish-subdomain-input"
                            aria-label={labels.publishSubdomain}
                            value={subdomain}
                            minLength={3}
                            pattern="[A-Za-z0-9-]+"
                            placeholder="your-name"
                            onBlur={onCheckName}
                            onChange={(event) => onSubdomainChange(event.currentTarget.value)}
                          />
                          <span className="ob-publish-url-static">.qidea.ai/</span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="ob-publish-url-static">https://app.qidea.ai/</span>
                  )}
                  <input
                    className="ob-publish-path-input"
                    aria-label={labels.publishPath}
                    value={appName}
                    minLength={canUseCustomSubdomain ? undefined : 8}
                    placeholder={canUseCustomSubdomain ? "optional-path" : "my-awesome-app"}
                    onBlur={onCheckName}
                    onChange={(event) => onAppNameChange(event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="ob-secondary-button"
                    disabled={busy}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onCheckName}
                  >
                    {status === "checking" ? labels.checkingPublishName : labels.checkPublishName}
                  </button>
                </div>
                <small>
                  {canUseCustomSubdomain
                    ? hasFixedSubdomain ? labels.publishSubdomainFixedHint : labels.publishSubdomainSetupHint
                    : labels.publishPathHint}
                </small>
              </label>
              {message ? <p className={`ob-publish-message is-${status}`}>{message}</p> : null}
            </>
          ) : (
            <section className="ob-published-sites" aria-label={labels.publishedAppsTitle}>
              <h3>{labels.publishedAppsTitle}</h3>
              {publishedSites.length > 0 ? (
                <div className="ob-published-site-list">
                  {publishedSites.map((site) => (
                    <article className="ob-published-site" key={site.id}>
                      <div>
                        <strong>{site.title || site.appName || site.url}</strong>
                        <a href={site.url} target="_blank" rel="noreferrer">{site.url}</a>
                      </div>
                      <button
                        type="button"
                        className="ob-secondary-button"
                        disabled={cancelBusyId === site.id}
                        onClick={() => onCancelPublishedSite(site)}
                      >
                        {cancelBusyId === site.id ? labels.cancelingPublishedApp : labels.cancelPublishedApp}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="ob-published-empty">{labels.noPublishedApps}</p>
              )}
            </section>
          )}
        </div>
        <footer>
          {activeTab === "settings" ? (
            <>
              {published ? (
                <a className="ob-secondary-button" href={url} target="_blank" rel="noreferrer">
                  {labels.publishOpen}
                </a>
              ) : null}
              <button className="ob-primary-button" disabled={busy} type="submit">
                {status === "publishing" ? labels.publishing : labels.publishNow}
              </button>
            </>
          ) : (
            <button className="ob-secondary-button" type="button" onClick={onClose}>
              {labels.publishCancel}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}

function firstFile(conversation: PersistedConversation): string {
  return Object.keys(conversation.project.files).find((path) => /(?:App|index|main)\./.test(path)) ?? Object.keys(conversation.project.files)[0] ?? "package.json";
}

function defaultPublishTitle(title: string | null): string {
  const trimmed = title?.trim() ?? "";
  return isDefaultConversationTitle(trimmed) ? "" : trimmed;
}

function defaultAppName(title: string | null): string {
  const slug = (title || "my-qidea-app")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._~!$&'()*+,;=:@%-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || "my-qidea-app";
  return base.length >= 8 ? base : `${base}-app`.padEnd(8, "0");
}

function isDefaultConversationTitle(title: string): boolean {
  return title === "" || title === "新创作" || title === "New creation";
}

function publishUrlPreview(appName: string, subdomain: string, pro: boolean): string {
  const normalizedApp = normalizeRouteSegment(appName);
  if (pro) {
    const normalizedSubdomain = subdomain.trim().toLowerCase();
    const host = normalizedSubdomain ? `${normalizedSubdomain}.qidea.ai` : "your-name.qidea.ai";
    return `https://${host}${normalizedApp ? `/${normalizedApp}` : "/"}`;
  }
  return `https://app.qidea.ai/${normalizedApp || "your-app-name"}`;
}

function validatePublishRoute(
  appName: string,
  subdomain: string,
  pro: boolean,
  labels: ReturnType<typeof useT>["workspace"],
): string | null {
  const normalizedApp = normalizeRouteSegment(appName);
  if (pro) {
    const normalizedSubdomain = subdomain.trim();
    if (normalizedSubdomain && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{1,61}[A-Za-z0-9])?$/.test(normalizedSubdomain)) {
      return labels.publishInvalidSubdomain;
    }
    if (normalizedApp && !isValidRouteSegment(normalizedApp)) return labels.publishInvalidName;
    return null;
  }
  if (normalizedApp.length < 8 || !isValidRouteSegment(normalizedApp)) return labels.publishInvalidName;
  return null;
}

function normalizeRouteSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function isValidRouteSegment(value: string): boolean {
  return /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/.test(value);
}

async function withBackendLoginRetry<T>(
  account: NonNullable<ReturnType<typeof useBackendAccount>>,
  action: () => Promise<T>,
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (!isBackendAuthRequiredError(error)) throw error;
  }
  const session = await account.requireLogin();
  if (!session) return null;
  return action();
}

async function waitForPublishedSiteReady(
  account: NonNullable<ReturnType<typeof useBackendAccount>>,
  siteId: number,
  labels: ReturnType<typeof useT>["workspace"],
  onStatus: (buildStatus: string) => void,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PUBLISH_STATUS_TIMEOUT_MS) {
    const status = await withBackendLoginRetry(account, () => account.client.getPublishedSiteStatus(siteId));
    if (!status) throw new Error(labels.publishLoginRequired);
    onStatus(status.buildStatus);
    if (status.buildStatus === "succeeded") return status;
    if (status.buildStatus === "failed") {
      throw new Error(buildFailedMessage(status.buildLog, labels));
    }
    await sleep(PUBLISH_STATUS_POLL_INTERVAL_MS);
  }
  throw new Error(labels.publishTimeout);
}

function buildStatusMessage(buildStatus: string, labels: ReturnType<typeof useT>["workspace"]): string {
  if (buildStatus === "queued") return labels.publishQueued;
  if (buildStatus === "building") return labels.publishBuilding;
  return labels.publishWaiting;
}

function buildFailedMessage(buildLog: string, labels: ReturnType<typeof useT>["workspace"]): string {
  const tail = buildLog
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n");
  return tail ? `${labels.publishFailed}\n${tail}` : labels.publishFailed;
}

function normalizePublishServerMessage(message: string, labels: ReturnType<typeof useT>["workspace"]): string {
  const normalized = message.trim();
  const exactMessages: Record<string, string> = {
    "应用名称可用": labels.publishNameAvailable,
    "应用名称已被占用": labels.publishNameTaken,
    "应用名称至少需要 8 个字符": labels.publishPathHint,
    "应用名称包含不合法的 URL 字符": labels.publishInvalidName,
    "免费用户最多只能发布 1 个项目": labels.publishFreeLimitReached,
    "仅 Pro 用户可以设置专属二级域名": labels.publishProOnlySubdomain,
    "仅 Plus 和 Pro 用户可以设置专属二级域名": labels.publishProOnlySubdomain,
    "仅订阅会员可以设置专属二级域名": labels.publishProOnlySubdomain,
    "二级域名可用": labels.publishSubdomainAvailable,
    "二级域名已设置": labels.publishSubdomainFixedHint,
    "二级域名已被占用": labels.publishSubdomainTaken,
    "该二级域名已被占用": labels.publishSubdomainTaken,
    "发布二级域名已设置，不能修改": labels.publishSubdomainFixed,
    "专属二级域名至少需要 3 个字符": labels.publishSubdomainHint,
    "该二级域名为系统保留名称": labels.publishInvalidSubdomain,
    "二级域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾": labels.publishInvalidSubdomain,
    "发布作品不存在": labels.publishSiteNotFound,
    "发布版本不存在": labels.publishVersionNotFound,
  };

  const exact = exactMessages[normalized];
  if (exact) return exact;

  return normalized
    .replaceAll("应用名称可用", labels.publishNameAvailable)
    .replaceAll("应用名称已被占用", labels.publishNameTaken)
    .replaceAll("应用名称至少需要 8 个字符", labels.publishPathHint)
    .replaceAll("应用名称包含不合法的 URL 字符", labels.publishInvalidName)
    .replaceAll("免费用户最多只能发布 1 个项目", labels.publishFreeLimitReached)
    .replaceAll("仅 Pro 用户可以设置专属二级域名", labels.publishProOnlySubdomain)
    .replaceAll("仅 Plus 和 Pro 用户可以设置专属二级域名", labels.publishProOnlySubdomain)
    .replaceAll("仅订阅会员可以设置专属二级域名", labels.publishProOnlySubdomain)
    .replaceAll("发布二级域名已设置，不能修改", labels.publishSubdomainFixed)
    .replaceAll("二级域名可用", labels.publishSubdomainAvailable)
    .replaceAll("二级域名已设置", labels.publishSubdomainFixedHint)
    .replaceAll("二级域名已被占用", labels.publishSubdomainTaken)
    .replaceAll("该二级域名已被占用", labels.publishSubdomainTaken)
    .replaceAll("专属二级域名至少需要 3 个字符", labels.publishSubdomainHint)
    .replaceAll("该二级域名为系统保留名称", labels.publishInvalidSubdomain)
    .replaceAll("二级域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾", labels.publishInvalidSubdomain)
    .replaceAll("发布作品不存在", labels.publishSiteNotFound)
    .replaceAll("发布版本不存在", labels.publishVersionNotFound)
    .replace(/\bapp name\b/gi, labels.publishPath)
    .replace(/\bname is available\b/gi, labels.publishNameAvailable)
    .replace(/\bname is already used\b/gi, labels.publishNameTaken);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function FileTree({
  files,
  directories,
  activeFile,
  expandedFolders,
  createTarget,
  createName,
  labels,
  onCreateNameChange,
  onSubmitCreate,
  onCancelCreate,
  onToggleFolder,
  onSelectFile,
  onStartCreate,
  onDeletePath,
}: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories: readonly string[];
  readonly activeFile: string;
  readonly expandedFolders: ReadonlySet<string>;
  readonly createTarget: { readonly type: "file" | "directory"; readonly parent: string } | null;
  readonly createName: string;
  readonly labels: ReturnType<typeof useT>["workspace"];
  readonly onCreateNameChange: (value: string) => void;
  readonly onSubmitCreate: () => void;
  readonly onCancelCreate: () => void;
  readonly onToggleFolder: (path: string) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onStartCreate: (type: "file" | "directory", parent: string) => void;
  readonly onDeletePath: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files, directories), [directories, files]);
  return (
    <nav className="ob-file-tree" aria-label={labels.fileTree}>
      <div className="ob-file-tree-header">
        <span>{labels.fileTree}</span>
        <div className="ob-file-tree-actions">
          <button type="button" onClick={() => onStartCreate("file", "")} title={labels.newFile} aria-label={labels.newFile}>
            <Icon name="filePlus" size={14} />
          </button>
          <button type="button" onClick={() => onStartCreate("directory", "")} title={labels.newFolder} aria-label={labels.newFolder}>
            <Icon name="folderPlus" size={14} />
          </button>
        </div>
      </div>
      {createTarget?.parent === "" ? (
        <CreateRow
          type={createTarget.type}
          value={createName}
          level={0}
          labels={labels}
          onChange={onCreateNameChange}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      ) : null}
      <div className="ob-file-tree-list">
        {tree.map((node) => (
          <FileTreeNodeView
            key={`${node.type}:${node.path}`}
            node={node}
            level={0}
            activeFile={activeFile}
            expandedFolders={expandedFolders}
            createTarget={createTarget}
            createName={createName}
            labels={labels}
            onCreateNameChange={onCreateNameChange}
            onSubmitCreate={onSubmitCreate}
            onCancelCreate={onCancelCreate}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
            onStartCreate={onStartCreate}
            onDeletePath={onDeletePath}
          />
        ))}
      </div>
    </nav>
  );
}

function FileTreeNodeView({
  node,
  level,
  activeFile,
  expandedFolders,
  createTarget,
  createName,
  labels,
  onCreateNameChange,
  onSubmitCreate,
  onCancelCreate,
  onToggleFolder,
  onSelectFile,
  onStartCreate,
  onDeletePath,
}: {
  readonly node: FileTreeNode;
  readonly level: number;
  readonly activeFile: string;
  readonly expandedFolders: ReadonlySet<string>;
  readonly createTarget: { readonly type: "file" | "directory"; readonly parent: string } | null;
  readonly createName: string;
  readonly labels: ReturnType<typeof useT>["workspace"];
  readonly onCreateNameChange: (value: string) => void;
  readonly onSubmitCreate: () => void;
  readonly onCancelCreate: () => void;
  readonly onToggleFolder: (path: string) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onStartCreate: (type: "file" | "directory", parent: string) => void;
  readonly onDeletePath: (path: string) => void;
}) {
  const expanded = expandedFolders.has(node.path);
  const creatingHere = createTarget?.parent === node.path;
  if (node.type === "directory") {
    return (
      <div>
        <div className="ob-file-tree-row is-directory" style={{ "--level": level } as CSSProperties}>
          <button type="button" className="ob-file-tree-main" onClick={() => onToggleFolder(node.path)} title={node.path}>
            <Icon name={expanded ? "chevronDown" : "chevronRight"} size={13} />
            <Icon name="folder" size={14} />
            <span>{node.name}</span>
          </button>
          <div className="ob-file-tree-row-actions">
            <button type="button" onClick={() => onStartCreate("file", node.path)} title={labels.newFile} aria-label={labels.newFile}>
              <Icon name="filePlus" size={13} />
            </button>
            <button type="button" onClick={() => onStartCreate("directory", node.path)} title={labels.newFolder} aria-label={labels.newFolder}>
              <Icon name="folderPlus" size={13} />
            </button>
            <button type="button" onClick={() => onDeletePath(node.path)} title={labels.deletePath} aria-label={labels.deletePath}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
        {expanded ? (
          <>
            {creatingHere ? (
              <CreateRow
                type={createTarget.type}
                value={createName}
                level={level + 1}
                labels={labels}
                onChange={onCreateNameChange}
                onSubmit={onSubmitCreate}
                onCancel={onCancelCreate}
              />
            ) : null}
            {node.children.map((child) => (
              <FileTreeNodeView
                key={`${child.type}:${child.path}`}
                node={child}
                level={level + 1}
                activeFile={activeFile}
                expandedFolders={expandedFolders}
                createTarget={createTarget}
                createName={createName}
                labels={labels}
                onCreateNameChange={onCreateNameChange}
                onSubmitCreate={onSubmitCreate}
                onCancelCreate={onCancelCreate}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                onStartCreate={onStartCreate}
                onDeletePath={onDeletePath}
              />
            ))}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div className={activeFile === node.path ? "ob-file-tree-row is-active" : "ob-file-tree-row"} style={{ "--level": level } as CSSProperties}>
      <button type="button" className="ob-file-tree-main" onClick={() => onSelectFile(node.path)} title={node.path}>
        <span className="ob-file-tree-spacer" />
        <Icon name="file" size={14} />
        <span>{node.name}</span>
      </button>
      <div className="ob-file-tree-row-actions">
        <button type="button" onClick={() => onDeletePath(node.path)} title={labels.deletePath} aria-label={labels.deletePath}>
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

function CreateRow({
  type,
  value,
  level,
  labels,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly type: "file" | "directory";
  readonly value: string;
  readonly level: number;
  readonly labels: ReturnType<typeof useT>["workspace"];
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="ob-file-tree-row is-creating" style={{ "--level": level } as CSSProperties}>
      <span className="ob-file-tree-main">
        <span className="ob-file-tree-spacer" />
        <Icon name={type === "file" ? "file" : "folder"} size={14} />
        <input
          ref={inputRef}
          value={value}
          placeholder={type === "file" ? labels.newFilePlaceholder : labels.newFolderPlaceholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onCancel}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
            if (event.key === "Escape") onCancel();
          }}
        />
      </span>
      <div className="ob-file-tree-row-actions">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onSubmit} title={labels.confirmCreate} aria-label={labels.confirmCreate}>
          <Icon name="check" size={13} />
        </button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel} title={labels.cancelCreate} aria-label={labels.cancelCreate}>
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  );
}

function buildFileTree(
  files: Readonly<Record<string, string>>,
  directories: readonly string[],
): readonly FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const folderMap = new Map<string, FileTreeNode>();
  const ensureFolder = (path: string): FileTreeNode => {
    const existing = folderMap.get(path);
    if (existing) return existing;
    const parent = parentDirectory(path);
    const folder: FileTreeNode = { name: baseName(path), path, type: "directory", children: [] };
    folderMap.set(path, folder);
    const level = parent ? ensureFolder(parent).children as FileTreeNode[] : root;
    level.push(folder);
    return folder;
  };

  for (const directory of directories.map(normalizePath).filter(Boolean).sort()) {
    ensureFolder(directory);
  }
  for (const path of Object.keys(files).map(normalizePath).filter(Boolean).sort()) {
    const parent = parentDirectory(path);
    const level = parent ? ensureFolder(parent).children as FileTreeNode[] : root;
    level.push({ name: baseName(path), path, type: "file", children: [] });
  }
  sortFileTree(root);
  return root;
}

function sortFileTree(nodes: FileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortFileTree(node.children as FileTreeNode[]);
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function defaultFileContent(path: string): string {
  if (/\.json$/i.test(path)) return "{}\n";
  if (/\.html?$/i.test(path)) return "<!doctype html>\n<html>\n  <head></head>\n  <body></body>\n</html>\n";
  return "";
}
